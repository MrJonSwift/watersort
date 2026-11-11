/**
 * DOM chrome: HUD, board with glass tubes, controls, toggles, and banner.
 *
 * This layer owns *static* presentation only — text, ARIA state, and visual
 * classes. All motion and liquid live in the water stage (`water/stage.ts`),
 * which is the single writer of tube transforms.
 */
import type { PrimaryAction, Reward, UIView } from './controller'
import type { Challenge } from './challenges'
import type { Settings } from './settings'
import { isComplete, openSlots } from './rules'
import type { GameState, Tube } from './types'

export interface UIHandlers {
  onTap(index: number): void
  onPrimary(): void
  onUndo(): void
  onToggleSound(): void
  onTogglePourFx(): void
  /** The player tapped challenge option `index`; the controller judges it. */
  onAnswer(index: number): void
  /** The player closed the gate without answering. */
  onDismiss(): void
}

export interface UI {
  update(state: GameState, settings: Settings, view: UIView): void
  /** Show the earn gate; the reward is said plainly under the prompt. */
  showChallenge(challenge: Challenge, reward?: Reward): void
  hideChallenge(): void
}

interface Toggle {
  root: HTMLButtonElement
  set(on: boolean): void
}

const PRIMARY_COPY: Record<PrimaryAction, string> = {
  restart: 'Restart',
  next: 'Next level',
  'play-again': 'Play again',
}

function movesCopy(count: number): string {
  return `${count} ${count === 1 ? 'move' : 'moves'}`
}

/** Undo button text: the remaining budget, visible at a glance. */
export function undoCopy(credits: number): string {
  return `Undo (${credits})`
}

/** What the undo button tells assistive tech, including the budget. */
export function undoAria(credits: number): string {
  return `Undo, ${credits} left`
}

/** What a correct answer at the gate is worth, said plainly. */
export function rewardNote(reward: Reward): string {
  return reward.kind === 'undo'
    ? 'A correct answer adds one undo.'
    : 'A correct answer opens one more slot in that tube.'
}

/**
 * What a tube tells assistive tech, including sealed slots (ticket 09): a
 * sealed spare says so and offers the affordance; a partly open spare reads
 * as its open slot count, never as a complete tube.
 */
export function tubeAria(tube: Tube, index: number, capacity: number): string {
  const base = `Tube ${index + 1}`
  const open = openSlots(tube, capacity)
  if (open >= capacity) return `${base}, ${tube.colors.length} of ${capacity} filled`
  if (open === 0) return `${base}, sealed, tap to open a slot`
  return tube.colors.length > 0
    ? `${base}, ${open} of ${capacity} slots open, ${tube.colors.length} filled`
    : `${base}, ${open} of ${capacity} slots open, tap to open a slot`
}

/** Banner text for a finished board: the last level reads as the end of the run. */
export function bannerCopy(level: number, maxLevel: number, moves: number): string {
  return level >= maxLevel
    ? `All ${maxLevel} levels complete!`
    : `Level ${level} solved in ${movesCopy(moves)}`
}

/**
 * How many grid columns the board uses for `count` tubes.
 *
 * Up to five tubes sit in one row. Above that the board splits into two rows
 * with a balanced split: 3+3, 4+3, 4+4, 5+4, 5+5. Fixed columns keep the row
 * split independent of viewport width, so tubes never change width.
 */
export function tubeColumns(count: number): number {
  if (count <= 5) return Math.max(1, count)
  return Math.min(5, Math.ceil(count / 2))
}

/**
 * Place the tubes on the grid, pushing the first tube of a short last row
 * sideways so that row is centred as closely as whole columns allow.
 */
function placeTubes(tubes: HTMLButtonElement[], columns: number): void {
  const count = tubes.length
  const rows = Math.ceil(count / columns)
  const lastRow = count - (rows - 1) * columns
  const offset = rows > 1 && lastRow < columns ? Math.ceil((columns - lastRow) / 2) : 0

  for (const tube of tubes) tube.style.gridColumnStart = ''
  if (offset > 0) tubes[count - lastRow].style.gridColumnStart = String(offset + 1)
}

function makeToggle(label: string, onClick: () => void): Toggle {
  const root = document.createElement('button')
  root.type = 'button'
  root.className = 'toggle'
  root.setAttribute('aria-pressed', 'false')
  const dot = document.createElement('span')
  dot.className = 'toggle__dot'
  const text = document.createElement('span')
  text.className = 'toggle__label'
  text.textContent = label
  root.append(dot, text)
  root.addEventListener('click', onClick)
  return {
    root,
    set(on) {
      root.classList.toggle('is-on', on)
      root.setAttribute('aria-pressed', String(on))
    },
  }
}

export function createUI(root: HTMLElement, handlers: UIHandlers): UI {
  root.classList.add('game')

  const hud = document.createElement('header')
  hud.className = 'hud'
  const identity = document.createElement('div')
  identity.className = 'hud__identity'
  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = 'WaterSort'
  const levelLine = document.createElement('p')
  levelLine.className = 'level'
  levelLine.setAttribute('aria-live', 'polite')
  identity.append(title, levelLine)
  const moves = document.createElement('p')
  moves.className = 'moves'
  hud.append(identity, moves)

  const board = document.createElement('div')
  board.className = 'board'
  board.setAttribute('role', 'group')
  board.setAttribute('aria-label', 'Tubes')

  // The banner lives inside the board so it can overlay the empty "sky" above
  // the tubes without adding page height. It is out of the grid flow.
  const banner = document.createElement('p')
  banner.className = 'banner'
  banner.setAttribute('role', 'status')
  banner.hidden = true
  board.append(banner)

  const controls = document.createElement('div')
  controls.className = 'controls'
  const undoBtn = document.createElement('button')
  undoBtn.type = 'button'
  undoBtn.className = 'btn'
  undoBtn.addEventListener('click', () => handlers.onUndo())
  const primaryBtn = document.createElement('button')
  primaryBtn.type = 'button'
  primaryBtn.className = 'btn btn--primary'
  primaryBtn.addEventListener('click', () => handlers.onPrimary())
  controls.append(undoBtn, primaryBtn)

  const toggles = document.createElement('div')
  toggles.className = 'toggles'
  const soundToggle = makeToggle('Sound', handlers.onToggleSound)
  const pourToggle = makeToggle('Pour FX', handlers.onTogglePourFx)
  toggles.append(soundToggle.root, pourToggle.root)

  /*
   * The earn gate: a modal the controller opens and closes through the UI
   * port. The UI renders the challenge and reports choices; whether an
   * answer was right and what it was worth are the controller's decisions.
   * Content-shape agnostic: the same dialog serves any reward (ticket 09).
   */
  const gate = document.createElement('div')
  gate.className = 'gate'
  gate.hidden = true
  const gatePanel = document.createElement('div')
  gatePanel.className = 'gate__panel'
  gatePanel.setAttribute('role', 'dialog')
  gatePanel.setAttribute('aria-modal', 'true')
  gatePanel.setAttribute('aria-label', 'Challenge')
  const gatePrompt = document.createElement('p')
  gatePrompt.className = 'gate__prompt'
  const gateNote = document.createElement('p')
  gateNote.className = 'gate__note'
  gateNote.hidden = true
  const gateOptions = document.createElement('div')
  gateOptions.className = 'gate__options'
  const gateSkip = document.createElement('button')
  gateSkip.type = 'button'
  gateSkip.className = 'btn gate__skip'
  gateSkip.textContent = 'Not now'
  gateSkip.addEventListener('click', () => handlers.onDismiss())
  gatePanel.append(gatePrompt, gateNote, gateOptions, gateSkip)
  gate.append(gatePanel)

  // Where focus returns when the gate closes: the control that opened it.
  let gateOpener: HTMLElement | null = null

  function gateFocusables(): HTMLElement[] {
    return Array.from(gatePanel.querySelectorAll<HTMLElement>('button'))
  }

  // Focus stays inside the dialog while it is open, and Escape dismisses.
  gatePanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handlers.onDismiss()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = gateFocusables()
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey) {
      if (active === first || !gatePanel.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !gatePanel.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  })

  root.append(hud, board, controls, toggles, gate)

  function ensureTubes(count: number): HTMLButtonElement[] {
    const existing = board.querySelectorAll<HTMLButtonElement>('.tube')
    if (existing.length === count) return Array.from(existing)

    board.replaceChildren()
    const tubes: HTMLButtonElement[] = []
    for (let i = 0; i < count; i++) {
      const tube = document.createElement('button')
      tube.type = 'button'
      tube.className = 'tube'
      tube.dataset.index = String(i)
      const glass = document.createElement('span')
      glass.className = 'glass'
      tube.append(glass)
      tube.addEventListener('click', () => handlers.onTap(i))
      board.append(tube)
      tubes.push(tube)
    }
    // `replaceChildren()` above also removed the banner; keep it across a
    // tube-count change (level 3 to level 4 is 5 to 6 tubes).
    board.append(banner)
    return tubes
  }

  return {
    update(state: GameState, settings: Settings, view: UIView) {
      const tubes = ensureTubes(state.tubes.length)
      const columns = tubeColumns(state.tubes.length)
      board.style.setProperty('--cols', String(columns))
      placeTubes(tubes, columns)

      levelLine.textContent = `Level ${view.level}`
      moves.textContent = movesCopy(state.moves)
      primaryBtn.textContent = PRIMARY_COPY[view.primary]
      undoBtn.textContent = undoCopy(view.undoCredits)
      undoBtn.setAttribute('aria-label', undoAria(view.undoCredits))
      undoBtn.disabled = view.undoCredits <= 0 || state.history.length === 0
      soundToggle.set(settings.sound)
      pourToggle.set(settings.pourFx)

      tubes.forEach((tubeEl, i) => {
        const tube = state.tubes[i]
        const open = openSlots(tube, state.capacity)
        tubeEl.setAttribute('aria-label', tubeAria(tube, i, state.capacity))
        tubeEl.classList.toggle('is-selected', state.selected === i)
        tubeEl.classList.toggle('is-complete', isComplete(tube, state.capacity))
        tubeEl.classList.toggle('is-sealed', open === 0)
      })

      banner.hidden = !state.won
      if (state.won) {
        banner.textContent = bannerCopy(view.level, view.maxLevel, state.moves)
      }

      /*
       * The undo button is the earn affordance at zero credits: enabled and
       * marked, so tapping it opens the gate instead of doing nothing. Above
       * zero it stays the plain undo and still needs history to rewind.
       */
      const earnable = view.undoCredits <= 0
      undoBtn.disabled = !earnable && state.history.length === 0
      undoBtn.classList.toggle('btn--earn', earnable)
    },

    showChallenge(challenge, reward) {
      gateOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      gatePrompt.textContent = challenge.prompt
      gateNote.textContent = reward ? rewardNote(reward) : ''
      gateNote.hidden = !reward
      const options = challenge.options.map((option, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'btn gate__option'
        button.textContent = option
        button.addEventListener('click', () => handlers.onAnswer(index))
        return button
      })
      gateOptions.replaceChildren(...options)
      gate.hidden = false
      options[0]?.focus()
    },

    hideChallenge() {
      if (gate.hidden) return
      gate.hidden = true
      gateOptions.replaceChildren()
      gatePrompt.textContent = ''
      gateNote.textContent = ''
      gateNote.hidden = true
      gateOpener?.focus()
      gateOpener = null
    },
  }
}
