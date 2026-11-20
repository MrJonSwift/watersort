// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { CHALLENGES } from './challenges'
import { createGame } from './state'
import { DEFAULT_SETTINGS } from './settings'
import type { GameState } from './types'
import { MAX_LEVEL } from './levels'
import {
  createUI,
  bannerCopy,
  PADLOCK_ARIA,
  rewardNote,
  tubeAria,
  tubeColumns,
  undoAria,
  undoCopy,
  type UIHandlers,
} from './ui'

describe('bannerCopy', () => {
  it('reports the moves for a mid-run win', () => {
    expect(bannerCopy(7, MAX_LEVEL, 1)).toBe('Level 7 solved in 1 move')
    expect(bannerCopy(7, MAX_LEVEL, 12)).toBe('Level 7 solved in 12 moves')
  })

  it('names the level count on the last level', () => {
    expect(bannerCopy(MAX_LEVEL, MAX_LEVEL, 24)).toBe(`All ${MAX_LEVEL} levels complete!`)
  })
})

describe('undoCopy and undoAria', () => {
  it('show the remaining budget in both places', () => {
    expect(undoCopy(5)).toBe('Undo (5)')
    expect(undoCopy(0)).toBe('Undo (0)')
    expect(undoAria(5)).toBe('Undo, 5 left')
    expect(undoAria(0)).toBe('Undo, 0 left')
  })
})

describe('tubeAria', () => {
  const full = { colors: [1, 1] }
  const sealed = { colors: [], open: 0 }
  const partly = { colors: [], open: 2 }
  const partlyFilled = { colors: [1], open: 2 }

  it('keeps the plain count for an ordinary tube', () => {
    expect(tubeAria(full, 0, 4)).toBe('Tube 1, 2 of 4 filled')
  })

  it('names a sealed spare and its affordance', () => {
    expect(tubeAria(sealed, 1, 4)).toBe('Tube 2, sealed, tap to open a slot')
  })

  it('reports open slots for a partly grown spare, filled or empty', () => {
    expect(tubeAria(partly, 2, 4)).toBe('Tube 3, 2 of 4 slots open, tap to open a slot')
    expect(tubeAria(partlyFilled, 2, 4)).toBe('Tube 3, 2 of 4 slots open, 1 filled')
  })

  it('never says a partly open spare is complete', () => {
    expect(tubeAria({ colors: [1, 1, 1, 1], open: 2 }, 0, 4)).toBe(
      'Tube 1, 2 of 4 slots open, 4 filled, full',
    )
  })

  it('says when a partly open spare is full at its open count', () => {
    expect(tubeAria({ colors: [1, 1], open: 2 }, 1, 4)).toBe(
      'Tube 2, 2 of 4 slots open, 2 filled, full',
    )
    expect(tubeAria({ colors: [1], open: 2 }, 1, 4)).toBe(
      'Tube 2, 2 of 4 slots open, 1 filled',
    )
    expect(tubeAria({ colors: [1], open: 3 }, 1, 4)).toBe(
      'Tube 2, 3 of 4 slots open, 1 filled',
    )
  })

  it('names concealed blocks by count and never by colour (ticket 10)', () => {
    expect(tubeAria({ colors: [1, 2, 3, 4], hidden: 3 }, 0, 4)).toBe(
      'Tube 1, 4 of 4 filled, 3 hidden',
    )
    expect(tubeAria({ colors: [1, 1], hidden: 1 }, 2, 4)).toBe(
      'Tube 3, 2 of 4 filled, 1 hidden',
    )
    expect(tubeAria({ colors: [1, 1], hidden: 0 }, 0, 4)).toBe('Tube 1, 2 of 4 filled')
  })
})

describe('rewardNote', () => {
  it('says plainly what a correct answer is worth', () => {
    expect(rewardNote({ kind: 'undo' })).toBe('A correct answer adds one undo.')
    expect(rewardNote({ kind: 'grow', tube: 3 })).toBe(
      'A correct answer opens one more slot in that tube.',
    )
  })
})

describe('tubeColumns', () => {
  it('uses one row up to five tubes and at most two rows above that', () => {
    const table: Array<[number, number]> = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [10, 5],
    ]
    for (const [count, columns] of table) {
      expect(tubeColumns(count)).toBe(columns)
    }
  })
})

describe('padlocks (ticket 15)', () => {
  function harnessWithSpare(open: number, colors: number[] = []) {
    document.body.replaceChildren()
    const root = document.createElement('div')
    document.body.append(root)
    const handlers: UIHandlers & { taps: number[]; grows: number[] } = {
      onTap: (index) => handlers.taps.push(index),
      onGrow: (index) => handlers.grows.push(index),
      onPrimary: vi.fn(),
      onUndo: vi.fn(),
      onToggleSound: vi.fn(),
      onTogglePourFx: vi.fn(),
      onAnswer: vi.fn(),
      onDismiss: vi.fn(),
      taps: [],
      grows: [],
    }
    const ui = createUI(root, handlers)
    const state = createGame([[1, 1], [2], [...colors]])
    state.tubes[2] = { colors: [...colors], open }
    ui.update(state, { ...DEFAULT_SETTINGS }, {
      level: 23,
      maxLevel: MAX_LEVEL,
      primary: 'restart',
      undoCredits: 5,
    })
    return { ui, handlers, state, tubes: document.querySelectorAll<HTMLElement>('.tube') }
  }

  it('shows one labelled padlock per sealed slot, over the top bands', () => {
    const h = harnessWithSpare(2)
    const locks = h.tubes[2].querySelectorAll<HTMLButtonElement>('.padlock')
    expect(locks).toHaveLength(4)
    expect(Array.from(locks).map((lock) => lock.hidden)).toEqual([false, false, true, true])
    expect(Array.from(locks).slice(0, 2).map((lock) => lock.style.top)).toEqual(['12.5%', '37.5%'])
    expect(locks[0].getAttribute('aria-label')).toBe(PADLOCK_ARIA)
    expect(locks[0].querySelector('svg')).not.toBeNull()
    // Ordinary tubes never grow, so they carry no visible padlock.
    expect(h.tubes[0].querySelectorAll('.padlock:not([hidden])')).toHaveLength(0)
  })

  it('tracks the count as slots open, even while the spare holds colour', () => {
    const h = harnessWithSpare(3, [1])
    expect(h.tubes[2].querySelectorAll('.padlock:not([hidden])')).toHaveLength(1)
    expect(h.tubes[2].getAttribute('aria-label')).toBe(
      'Tube 3, 3 of 4 slots open, 1 filled',
    )
    h.ui.update(
      { ...h.state, tubes: h.state.tubes.map((t, i) => (i === 2 ? { colors: [1], open: 4 } : t)) },
      { ...DEFAULT_SETTINGS },
      { level: 23, maxLevel: MAX_LEVEL, primary: 'restart', undoCredits: 5 },
    )
    expect(h.tubes[2].querySelectorAll('.padlock:not([hidden])')).toHaveLength(0)
  })

  it('a padlock tap grows, never pours through the glass', () => {
    const h = harnessWithSpare(1, [1])
    h.tubes[2].querySelector<HTMLButtonElement>('.padlock:not([hidden])')!.click()
    expect(h.handlers.grows).toEqual([2])
    expect(h.handlers.taps).toEqual([])
  })

  it('keeps the glass keyboard-reachable without hijacking padlock keys', () => {
    const h = harnessWithSpare(0)
    h.tubes[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.handlers.taps).toEqual([2])
    h.tubes[2]
      .querySelector<HTMLElement>('.padlock')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.handlers.taps).toEqual([2]) // the padlock owns its own keys
  })
})

describe('the earn gate dialog', () => {
  const challenge = CHALLENGES[0]

  function gateHarness() {
    document.body.replaceChildren()
    const root = document.createElement('div')
    document.body.append(root)
    const handlers: UIHandlers & { answers: number[]; dismissals: number } = {
      onTap: vi.fn(),
      onGrow: vi.fn(),
      onPrimary: vi.fn(),
      onUndo: vi.fn(),
      onToggleSound: vi.fn(),
      onTogglePourFx: vi.fn(),
      onAnswer: (index) => handlers.answers.push(index),
      onDismiss: () => {
        handlers.dismissals++
      },
      answers: [],
      dismissals: 0,
    }
    const ui = createUI(root, handlers)
    const state = createGame([[1, 1], [2]])
    return { ui, state, handlers }
  }

  function updateOnce(
    h: ReturnType<typeof gateHarness>,
    overrides: { undoCredits?: number; history?: GameState['history'] } = {},
  ): void {
    h.state.history = overrides.history ?? []
    h.ui.update(h.state, { ...DEFAULT_SETTINGS }, {
      level: 1,
      maxLevel: MAX_LEVEL,
      primary: 'restart',
      undoCredits: overrides.undoCredits ?? 5,
    })
  }

  it('stays hidden until the controller opens it', () => {
    const h = gateHarness()
    updateOnce(h)
    const gate = document.querySelector<HTMLElement>('.gate')
    expect(gate?.hidden).toBe(true)
  })

  it('shows the prompt, one button per option and focuses the first', () => {
    const h = gateHarness()
    updateOnce(h)
    h.ui.showChallenge(challenge)

    const gate = document.querySelector<HTMLElement>('.gate')!
    expect(gate.hidden).toBe(false)
    expect(document.querySelector('.gate__prompt')?.textContent).toBe(challenge.prompt)

    const options = document.querySelectorAll<HTMLButtonElement>('.gate__option')
    expect(options.length).toBe(challenge.options.length)
    options.forEach((option, index) => {
      expect(option.textContent).toBe(challenge.options[index])
    })
    expect(document.activeElement).toBe(options[0])
  })

  it('reports the tapped option index and Escape as a dismissal', () => {
    const h = gateHarness()
    updateOnce(h)
    h.ui.showChallenge(challenge)

    const options = document.querySelectorAll<HTMLButtonElement>('.gate__option')
    options[2]?.click()
    expect(h.handlers.answers).toEqual([2])

    document.querySelector<HTMLElement>('.gate__panel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    )
    expect(h.handlers.dismissals).toBe(0)

    document.querySelector<HTMLElement>('.gate__panel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(h.handlers.dismissals).toBe(1)
    expect(h.handlers.answers).toEqual([2])
  })

  it('traps Tab inside the dialog', () => {
    const h = gateHarness()
    updateOnce(h)
    h.ui.showChallenge(challenge)

    const focusable = Array.from(document.querySelectorAll<HTMLElement>('.gate__panel button'))
    focusable.at(-1)!.focus()
    document.querySelector<HTMLElement>('.gate__panel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    )
    expect(document.activeElement).toBe(focusable[0])

    focusable[0]!.focus()
    document.querySelector<HTMLElement>('.gate__panel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    )
    expect(document.activeElement).toBe(focusable.at(-1))
  })

  it('closing hides the dialog, clears it and restores focus to the opener', () => {
    const h = gateHarness()
    updateOnce(h)
    const opener = document.querySelector<HTMLButtonElement>('.btn--primary')!
    opener.focus()

    h.ui.showChallenge(challenge)
    expect(document.activeElement).not.toBe(opener)

    h.ui.hideChallenge()
    const gate = document.querySelector<HTMLElement>('.gate')!
    expect(gate.hidden).toBe(true)
    expect(gate.querySelector('.gate__option')).toBeNull()
    expect(document.querySelector('.gate__prompt')?.textContent).toBe('')
    expect(document.activeElement).toBe(opener)
  })

  it('says what a correct answer is worth under the prompt', () => {
    const h = gateHarness()
    updateOnce(h)
    const note = document.querySelector<HTMLElement>('.gate__note')!

    h.ui.showChallenge(challenge, { kind: 'grow', tube: 1 })
    expect(note.hidden).toBe(false)
    expect(note.textContent).toBe(rewardNote({ kind: 'grow', tube: 1 }))

    h.ui.hideChallenge()
    expect(note.hidden).toBe(true)
    expect(note.textContent).toBe('')
  })

  it('marks a sealed spare and keeps its ARIA honest', () => {
    const h = gateHarness()
    h.state.tubes[1] = { colors: [], open: 0 }
    h.ui.update(h.state, { ...DEFAULT_SETTINGS }, {
      level: 20,
      maxLevel: MAX_LEVEL,
      primary: 'restart',
      undoCredits: 5,
    })

    const tubes = document.querySelectorAll<HTMLButtonElement>('.tube')
    expect(tubes[0].classList.contains('is-sealed')).toBe(false)
    expect(tubes[1].classList.contains('is-sealed')).toBe(true)
    expect(tubes[1].getAttribute('aria-label')).toBe('Tube 2, sealed, tap to open a slot')
    expect(tubes[0].getAttribute('aria-label')).toBe('Tube 1, 2 of 4 filled')
  })

  it('the undo button becomes the earn affordance at zero credits', () => {
    const h = gateHarness()
    updateOnce(h, { undoCredits: 0, history: [{ from: 0, to: 1, amount: 1 }] })

    const undoBtn = document.querySelector<HTMLButtonElement>('.controls .btn:not(.btn--primary)')!
    expect(undoBtn.disabled).toBe(false)
    expect(undoBtn.classList.contains('btn--earn')).toBe(true)
    expect(undoBtn.textContent).toBe(undoCopy(0))

    updateOnce(h, { undoCredits: 5, history: [{ from: 0, to: 1, amount: 1 }] })
    expect(undoBtn.disabled).toBe(false) // plain undo: credits and history both exist
    expect(undoBtn.classList.contains('btn--earn')).toBe(false)

    updateOnce(h, { undoCredits: 3, history: [] })
    expect(undoBtn.disabled).toBe(true) // credits left but nothing to rewind
  })
})
