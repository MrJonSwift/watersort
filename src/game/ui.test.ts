// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { CHALLENGES } from './challenges'
import { createGame } from './state'
import { DEFAULT_SETTINGS } from './settings'
import type { GameState } from './types'
import { MAX_LEVEL } from './levels'
import { createUI, bannerCopy, tubeColumns, undoAria, undoCopy, type UIHandlers } from './ui'

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

describe('the earn gate dialog', () => {
  const challenge = CHALLENGES[0]

  function gateHarness() {
    document.body.replaceChildren()
    const root = document.createElement('div')
    document.body.append(root)
    const handlers: UIHandlers & { answers: number[]; dismissals: number } = {
      onTap: vi.fn(),
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
