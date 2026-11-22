/**
 * The session controller: the only place that decides what a tap means.
 *
 * It owns the game state and drives presentation through ports — UI text,
 * the water stage, audio, haptics, saved settings and saved progress. The stage
 * port exposes no way to ask whether an animation is running, on purpose:
 * input is never conditional on animation, so a move lands the instant it is
 * tapped and the stage catches up or preempts. If a "busy" check is ever added
 * here, the design has regressed.
 *
 * The controller never generates a board itself: `board(level)` is a port, so
 * the level table and seeded generator stay on the wiring side and this module
 * stays a pure session.
 *
 * No DOM and no canvas imports: every effect arrives through a port, which is
 * what makes a whole session testable with fakes.
 */
import { advanceDraw, type Challenge } from './challenges'
import type { Level } from './generator'
import { pickHiddenTubes } from './hidden'
import {
  EXTRA_SPARE_FROM,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  SPARES_LOCK_FROM,
  clampLevel,
} from './levels'
import type { Progress } from './progress'
import { canGrow, isComplete, openSlots } from './rules'
import type { SoundName } from './audio'
import type { Settings } from './settings'
import {
  addExtraSpare,
  createGame,
  growBlock,
  hideBlocks,
  sealSpares,
  tap as applyTap,
  undo as applyUndo,
} from './state'
import type { GameEvent, GameState } from './types'
import type { StagePrefs } from './water/stage'

/** What the single primary button does for the current session. */
export type PrimaryAction = 'restart' | 'next' | 'play-again'

/**
 * Free undos per level. This is the difficulty pin, not a persistence
 * setting, so it lives with the session.
 */
export const UNDO_CREDITS = 5

/**
 * Ceiling on undo credits, free and earned combined. Credits earned at the
 * gate stack onto the level's budget; the cap keeps the counter to one digit
 * and stops a lucky streak from banking an endless supply. Session state,
 * like the budget itself — never persisted.
 */
export const UNDO_CAP = 9

/**
 * What a correct answer at the gate is worth. The gate only judges the
 * answer; the caller decides the prize (ticket 08's rule), so a caller
 * hands its reward in when it opens the gate.
 */
export type Reward = { kind: 'undo' } | { kind: 'grow'; tube: number }

/** Presentation-only view of the session, passed alongside the game state. */
export interface UIView {
  level: number
  maxLevel: number
  primary: PrimaryAction
  /** Undos left this level; the UI renders it on the undo button. */
  undoCredits: number
}

export interface ControllerUI {
  update(state: GameState, settings: Settings, view: UIView): void
  /**
   * Show the earn gate with this challenge and the reward at stake, so the
   * UI can say what a correct answer is worth. The gate is the controller's.
   */
  showChallenge(challenge: Challenge, reward: Reward): void
  /** Close the earn gate, whatever the reason: answered, dismissed or redrawn. */
  hideChallenge(): void
}

/**
 * The stage port. Note what is missing: no `isAnimating`, no animation state
 * of any kind. The controller cannot gate input on the stage being idle.
 */
export interface ControllerStage {
  dispatch(event: GameEvent, state: GameState): void
  setPrefs(prefs: StagePrefs): void
}

export interface ControllerAudio {
  play(name: SoundName): void
  unlock(): void
  setEnabled(enabled: boolean): void
}

export interface ControllerSettings {
  load(): Settings
  save(settings: Settings): void
}

export interface ControllerProgress {
  load(): Progress
  save(progress: Progress): void
}

export interface ControllerPorts {
  ui: ControllerUI
  stage: ControllerStage
  audio: ControllerAudio
  haptic(pattern: number | number[]): void
  settings: ControllerSettings
  progress: ControllerProgress
  /**
   * Start the session on this level instead of the saved one, for the
   * `?level=N` test shortcut. A valid `1..MAX_LEVEL` level, or omitted. The
   * jump becomes the saved position, so a reload resumes there.
   */
  startAt?: number
  /**
   * Build the deterministic board and its validated solution for a numbered
   * level. The solution travels with the board because sealing is
   * solution-aware (ticket 14): the controller needs to know which empties the
   * solution pours into before it decides which spares to lock.
   */
  board(level: number): Level
}

export interface Controller {
  /** First paint: build the DOM tubes, then tell the stage the board exists. */
  start(): void
  tap(index: number): void
  /**
   * Tap a sealed slot's padlock. Unlike the glass, this stays an earn affordance
   * even while the spare holds colour: the padlock is the unlock target.
   */
  tapPadlock(index: number): void
  undo(): void
  /** Rebuild the current level; same board, zero moves. */
  restart(): void
  /** Move to the next level (or play again at the end) and save it. */
  nextLevel(): void
  /** Back to level 1, keeping the highest level reached. */
  playAgain(): void
  /** Run whatever the primary button currently means. */
  primary(): void
  /** Open the earn gate with the reward a correct answer should grant. */
  earn(request?: Reward): void
  /** Answer the open challenge by option index; a correct answer grants a credit. */
  answer(option: number): void
  /** Close the open challenge without granting anything. */
  dismiss(): void
  toggleSound(): void
  togglePourFx(): void
  readonly state: GameState
  readonly settings: Settings
  readonly level: number
  readonly progress: Progress
}

/** What the primary button should do, given the state and current level. */
export function primaryAction(state: GameState, level: number): PrimaryAction {
  if (!state.won) return 'restart'
  return level < MAX_LEVEL ? 'next' : 'play-again'
}

/**
 * Describe what a tap did so presentation can react to it.
 *
 * `index` is the tube the player tapped, which for a pour is the destination.
 */
export function describeTap(before: GameState, after: GameState, index: number): GameEvent {
  if (after.moves > before.moves) {
    const move = after.history[after.history.length - 1]
    const to = after.tubes[index]
    return {
      type: 'pour',
      from: move.from,
      to: index,
      amount: move.amount,
      color: to.colors[to.colors.length - 1] ?? 0,
    }
  }
  return after.selected === index ? { type: 'select', index } : { type: 'deselect' }
}

function completedCount(game: GameState): number {
  return game.tubes.filter((tube) => isComplete(tube, game.capacity)).length
}

export function createController(ports: ControllerPorts): Controller {
  let progress: Progress = ports.progress.load()
  /**
   * The `?level=N` shortcut applies before anything is drawn. It is a jump,
   * not a peek: the level becomes the saved position, so the address bar no
   * longer has to carry the parameter and a reload resumes here. `highest`
   * follows the same rule as `loadProgress` — you cannot be on a level you
   * have not reached.
   */
  const startAt = ports.startAt === undefined ? undefined : clampLevel(ports.startAt)
  if (startAt !== undefined) {
    const jumped: Progress = {
      level: startAt,
      highest: Math.max(progress.highest, startAt),
    }
    if (jumped.level !== progress.level || jumped.highest !== progress.highest) {
      ports.progress.save(jumped)
    }
    progress = jumped
  }
  let level = progress.level
  let state: GameState = buildBoard(level)
  let settings: Settings = ports.settings.load()
  let undoCredits = UNDO_CREDITS

  /**
   * The open earn gate, if any. The drawn pack index is what the session
   * records as seen, so redraws skip it; the reward is what a correct
   * answer grants, decided by whichever affordance opened the gate.
   */
  let gate: { index: number; challenge: Challenge; reward: Reward } | null = null
  /** Pack indices already offered this session; the pick skips them. */
  let usedDraws: number[] = []

  /**
   * Build the board for a level, then apply the level's presentation
   * policies as game decisions: at or above `SPARES_LOCK_FROM` only the empty
   * tubes the solution never pours into start sealed (ticket 14, refining
   * ticket 09), from `EXTRA_SPARE_FROM` an extra empty appended after generation
   * gives every level a guaranteed optional padlock (ticket 18), and at or above
   * `HIDDEN_FROM` a seeded pick of the tubes holding colours starts concealed
   * (ticket 10). From `CLIMB_FROM`, `sealSpares` also locks the solution-unused
   * spare that the generator fills with colour (ticket 22) — the level number
   * passed through is what keeps 1–50 on the old empty-only rule. The extra
   * spare only goes on a board that still fits in two seven-wide rows on a
   * phone; the 12-colour tier is already at that ceiling, so it keeps its two
   * generated spares and its extra colours instead. Neither happens in the
   * wiring; the controller owns the session.
   */
  function buildBoard(next: number): GameState {
    const { board, solution } = ports.board(next)
    const built = createGame(board)
    const withSpare =
      next >= EXTRA_SPARE_FROM && built.tubes.length < MAX_TWO_ROW_TUBES
        ? addExtraSpare(built)
        : built
    const sealed =
      next >= SPARES_LOCK_FROM ? sealSpares(withSpare, solution, next) : withSpare
    const hidden = pickHiddenTubes(next, sealed.tubes)
    return hidden.length > 0 ? hideBlocks(sealed, hidden) : sealed
  }

  /**
   * The draw seed is the level number: deterministic per session input, no
   * `Math.random`, and the sequence replays in tests. `usedDraws` carries the
   * rest of the state.
   */
  function openGate(reward: Reward): void {
    if (gate) return
    const { draw, nextUsed } = advanceDraw(level, usedDraws)
    usedDraws = nextUsed
    gate = { ...draw, reward }
    ports.ui.showChallenge(draw.challenge, reward)
  }

  function closeGate(): void {
    if (!gate) return
    gate = null
    ports.ui.hideChallenge()
  }

  /**
   * While the gate is open, board input waits: taps, undos and the primary
   * button all drop. The gate is session state, not presentation, so this
   * does not reintroduce an animation gate — a tap while the gate is open is
   * the player asking to answer first, and the board is untouched.
   */
  function gateOpen(): boolean {
    return gate !== null
  }

  function viewFor(next: GameState = state): UIView {
    return {
      level,
      maxLevel: MAX_LEVEL,
      primary: primaryAction(next, level),
      undoCredits,
    }
  }

  /**
   * A win is the only moment progress advances. The transition can fire only
   * once per board: a won state ignores further taps, and every new board
   * starts unwon.
   */
  function recordWin(before: GameState, after: GameState): void {
    if (!after.won || before.won) return
    progress = { ...progress, highest: Math.max(progress.highest, level) }
    ports.progress.save(progress)
  }

  function playFeedback(before: GameState, after: GameState, event: GameEvent): void {
    if (event.type === 'pour') {
      ports.audio.play('pour')
      ports.haptic(12)
    } else if (event.type === 'select') {
      ports.audio.play('select')
      ports.haptic(6)
    }

    if (after.won && !before.won) {
      ports.audio.play('win')
      ports.haptic([14, 40, 14, 40, 22])
    } else if (completedCount(after) > completedCount(before)) {
      ports.audio.play('complete')
    }
  }

  /** Apply a state change: save, sound and UI first, then the stage, then commit. */
  function commit(before: GameState, next: GameState, event: GameEvent): void {
    ports.audio.unlock()
    recordWin(before, next)
    playFeedback(before, next, event)
    ports.ui.update(next, settings, viewFor(next))
    ports.stage.dispatch(event, next)
    state = next
  }

  function restart(): void {
    if (gateOpen()) return
    // Same level, same deterministic board: only moves and history reset,
    // and earned slots reseal with it.
    undoCredits = UNDO_CREDITS
    commit(state, buildBoard(level), { type: 'new' })
  }

  function nextLevel(): void {
    if (gateOpen()) return
    if (level >= MAX_LEVEL) {
      playAgain()
      return
    }
    level += 1
    progress = { ...progress, level }
    ports.progress.save(progress)
    undoCredits = UNDO_CREDITS
    commit(state, buildBoard(level), { type: 'new' })
  }

  function playAgain(): void {
    if (gateOpen()) return
    level = 1
    progress = { ...progress, level }
    ports.progress.save(progress)
    undoCredits = UNDO_CREDITS
    commit(state, buildBoard(level), { type: 'new' })
  }

  function primary(): void {
    switch (primaryAction(state, level)) {
      case 'next':
        nextLevel()
        break
      case 'play-again':
        playAgain()
        break
      default:
        restart()
    }
  }

  return {
    get state() {
      return state
    },
    get settings() {
      return settings
    },
    get level() {
      return level
    },
    get progress() {
      return progress
    },

    start() {
      // Mount only: the UI must build the tubes before the stage can measure.
      // The board was already built (and sealed) with the controller, so this
      // does not rebuild it; closing a gate keeps a repeat call from leaving
      // an orphaned dialog on screen.
      undoCredits = UNDO_CREDITS
      closeGate()
      usedDraws = []
      ports.ui.update(state, settings, viewFor())
      ports.stage.setPrefs({ pourFx: settings.pourFx })
      ports.audio.setEnabled(settings.sound)
      ports.stage.dispatch({ type: 'new' }, state)
    },

    tap(index) {
      if (gateOpen()) return
      const before = state
      const target = before.tubes[index]
      // A sealed spare is an earn affordance, not a rejected move: tapping it
      // with nothing selected asks the gate to grow it. With a selection the
      // tap is a pour attempt, and a sealed target answers it as invalid —
      // silently dropping the selection would leave the player guessing.
      if (target && target.colors.length === 0) {
        if (openSlots(target, before.capacity) === 0) {
          if (before.selected === null) {
            openGate({ kind: 'grow', tube: index })
          } else {
            ports.audio.play('invalid')
            ports.stage.dispatch({ type: 'invalid', index }, before)
          }
          return
        }
        // An empty partly open spare with nothing selected is also earnable;
        // with a selection the tap below pours into its open slots.
        if (before.selected === null && canGrow(target, before.capacity)) {
          openGate({ kind: 'grow', tube: index })
          return
        }
      }
      const next = applyTap(before, index)
      if (next === before) {
        // Tapping an empty tube is the one rejected move worth answering.
        if (before.tubes[index]?.colors.length === 0) {
          ports.audio.play('invalid')
          ports.stage.dispatch({ type: 'invalid', index }, before)
        }
        return
      }
      commit(before, next, describeTap(before, next, index))
    },

    tapPadlock(index) {
      if (gateOpen()) return
      const tube = state.tubes[index]
      // A padlock exists only on a spare with a slot still to earn. The UI
      // renders them, but a stale tap (a slot just opened) must not redraw.
      if (!tube || !canGrow(tube, state.capacity)) return
      openGate({ kind: 'grow', tube: index })
    },

    undo() {
      if (gateOpen()) return
      if (undoCredits === 0) {
        // The spent undo button is the earn affordance: no credit, open the
        // gate. Whether a credit comes back is the challenge's answer.
        openGate({ kind: 'undo' })
        return
      }
      const before = state
      const next = applyUndo(before)
      if (next === before) return // no history: nothing used, nothing consumed
      undoCredits -= 1
      commit(before, next, { type: 'undo' })
    },

    restart,
    nextLevel,
    playAgain,
    primary,

    earn(request = { kind: 'undo' }) {
      openGate(request)
    },

    answer(option) {
      if (!gate) return
      const correct = option === gate.challenge.answer
      const { reward } = gate
      closeGate()
      if (correct) {
        ports.audio.play('complete')
        ports.haptic(12)
        if (reward.kind === 'undo') {
          undoCredits = Math.min(undoCredits + 1, UNDO_CAP)
          ports.ui.update(state, settings, viewFor())
          return
        }
        // A grown slot is a state change like any other: commit runs the
        // same save/feedback/UI/stage order, and the stage pops the tube.
        const before = state
        const next = growBlock(before, reward.tube)
        if (next !== before) {
          commit(before, next, { type: 'grow', index: reward.tube })
        } else {
          ports.ui.update(state, settings, viewFor())
        }
      } else {
        ports.audio.play('invalid')
        ports.haptic(24)
        ports.ui.update(state, settings, viewFor())
      }
    },

    dismiss() {
      if (!gate) return
      closeGate()
    },

    toggleSound() {
      settings = { ...settings, sound: !settings.sound }
      ports.settings.save(settings)
      ports.audio.setEnabled(settings.sound)
      if (settings.sound) {
        ports.audio.unlock()
        ports.audio.play('select')
      }
      ports.ui.update(state, settings, viewFor())
    },

    togglePourFx() {
      settings = { ...settings, pourFx: !settings.pourFx }
      ports.settings.save(settings)
      ports.stage.setPrefs({ pourFx: settings.pourFx })
      ports.ui.update(state, settings, viewFor())
    },
  }
}
