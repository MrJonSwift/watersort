import { describe, expect, it } from 'vitest'
import {
  createController,
  describeTap,
  primaryAction,
  UNDO_CAP,
  UNDO_CREDITS,
  type ControllerPorts,
  type ControllerStage,
  type Reward,
  type UIView,
} from './controller'
import type { Challenge } from './challenges'
import { pickHiddenTubes } from './hidden'
import { HIDDEN_FROM, MAX_LEVEL, SPARES_LOCK_FROM } from './levels'
import { DEFAULT_PROGRESS, type Progress } from './progress'
import { pour } from './rules'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { createGame } from './state'
import type { SoundName } from './audio'
import type { GameEvent, GameState, Move } from './types'
import type { StagePrefs } from './water/stage'

/* --------------------------------------------------------------- fakes ---- */

interface Harness {
  controller: ReturnType<typeof createController>
  events: GameEvent[]
  dispatched: GameState[]
  prefs: StagePrefs[]
  sounds: SoundName[]
  haptics: Array<number | number[]>
  saved: Settings[]
  savedProgress: Progress[]
  boards: number[]
  updates: Array<{ state: GameState; settings: Settings; view: UIView }>
  unlocks: () => number
  challengeShows: Challenge[]
  /** The reward handed to the UI with each shown challenge. */
  rewards: Reward[]
  challengeHides: () => number
}

/**
 * Build a controller over recording fakes.
 *
 * The stage fake is a proxy that throws on any property it does not have. That
 * is the tripwire: the moment a controller asks the stage whether it is busy,
 * every test fails with a clear message rather than the gate quietly returning.
 */
function harness(
  board: number[][],
  settings: Partial<Settings> = {},
  progress: Partial<Progress> = {},
  startAt?: number,
  solution: Move[] = [],
): Harness {
  const events: GameEvent[] = []
  const dispatched: GameState[] = []
  const prefs: StagePrefs[] = []
  const sounds: SoundName[] = []
  const haptics: Array<number | number[]> = []
  const saved: Settings[] = []
  const savedProgress: Progress[] = []
  const boards: number[] = []
  const updates: Array<{ state: GameState; settings: Settings; view: UIView }> = []
  const challengeShows: Challenge[] = []
  const rewards: Reward[] = []
  let challengeHides = 0
  let unlocks = 0

  const stage = new Proxy(
    {
      dispatch(event: GameEvent, state: GameState) {
        events.push(event)
        dispatched.push(state)
      },
      setPrefs(next: StagePrefs) {
        prefs.push(next)
      },
    },
    {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver)
        throw new Error(
          `the controller reached for stage.${String(key)}; the stage port exposes no animation state`,
        )
      },
    },
  ) as ControllerStage

  const ports: ControllerPorts = {
    ui: {
      update(state, next, view) {
        updates.push({ state, settings: next, view })
      },
      showChallenge(challenge, reward) {
        challengeShows.push(challenge)
        rewards.push(reward)
      },
      hideChallenge() {
        challengeHides++
      },
    },
    stage,
    audio: {
      play(name) {
        sounds.push(name)
      },
      unlock() {
        unlocks++
      },
      setEnabled() {},
    },
    haptic(pattern) {
      haptics.push(pattern)
    },
    settings: {
      load: () => ({ ...DEFAULT_SETTINGS, ...settings }),
      save(next) {
        saved.push(next)
      },
    },
    progress: {
      load: () => ({ ...DEFAULT_PROGRESS, ...progress }),
      save(next) {
        savedProgress.push(next)
      },
    },
    startAt,
    board(level) {
      boards.push(level)
      return {
        board: board.map((colors) => [...colors]),
        solution: solution.map((move) => ({ ...move })),
      }
    },
  }

  return {
    controller: createController(ports),
    events,
    dispatched,
    prefs,
    sounds,
    haptics,
    saved,
    savedProgress,
    boards,
    updates,
    unlocks: () => unlocks,
    challengeShows,
    rewards,
    challengeHides: () => challengeHides,
  }
}

const pourEvents = (events: GameEvent[]) => events.filter((event) => event.type === 'pour')

/* --------------------------------------------------------------- suite ---- */

describe('describeTap', () => {
  const board = [[1, 1], [2, 2], []]

  it('describes a pour with the source, destination, amount and colour', () => {
    const before = createGame(board)
    const after = pour(before, 0, 2)
    expect(describeTap(before, after, 2)).toEqual({
      type: 'pour',
      from: 0,
      to: 2,
      amount: 2,
      color: 1,
    })
  })

  it('describes a fresh selection', () => {
    const before = createGame(board)
    const after = { ...before, selected: 1 }
    expect(describeTap(before, after, 1)).toEqual({ type: 'select', index: 1 })
  })

  it('describes a deselection', () => {
    const before = { ...createGame(board), selected: 1 }
    const after = { ...before, selected: null }
    expect(describeTap(before, after, 1)).toEqual({ type: 'deselect' })
  })
})

describe('rapid input', () => {
  it('applies every tapped move with no animation to wait for', () => {
    // Both pours are legal from the start and independent of each other.
    const h = harness([
      [1, 1], // 0
      [], // 1
      [2, 2, 2, 2], // 2
      [1, 1], // 3
      [], // 4
    ])
    h.controller.start()

    // All four taps in one synchronous burst: no timers, no frames, no waiting.
    h.controller.tap(3) // select 3
    h.controller.tap(1) // pour 3 -> 1
    h.controller.tap(0) // select 0
    h.controller.tap(4) // pour 0 -> 4

    expect(h.controller.state.moves).toBe(2)
    expect(h.controller.state.tubes[1].colors).toEqual([1, 1])
    expect(h.controller.state.tubes[4].colors).toEqual([1, 1])
    expect(h.controller.state.tubes[3].colors).toEqual([])
    expect(h.controller.state.tubes[0].colors).toEqual([])

    const pours = pourEvents(h.events)
    expect(pours).toEqual([
      { type: 'pour', from: 3, to: 1, amount: 2, color: 1 },
      { type: 'pour', from: 0, to: 4, amount: 2, color: 1 },
    ])
    // Every event reached the stage, in tap order, and each carried the state
    // as it stood at that moment.
    // `new` is the opening board from start(), then the four taps in order.
    expect(h.events.map((event) => event.type)).toEqual(['new', 'select', 'pour', 'select', 'pour'])
    expect(h.dispatched[2].moves).toBe(1)
    expect(h.dispatched[4].moves).toBe(2)
  })

  it('does not need the stage to report anything', () => {
    const h = harness([[1, 1], []])
    h.controller.start()
    // The proxy stage throws on any property access beyond dispatch/setPrefs.
    expect(() => {
      h.controller.tap(0) // select
      h.controller.tap(1) // pour, while a pour would still be playing
      h.controller.tap(0) // rejected: the tube is now empty
      h.controller.tap(1) // select
    }).not.toThrow()
    // Every tap was still handled, in order, with no animation check anywhere.
    expect(h.events.map((event) => event.type)).toEqual([
      'new',
      'select',
      'pour',
      'invalid',
      'select',
    ])
    expect(h.controller.state.moves).toBe(1)
    expect(h.controller.state.selected).toBe(1)
  })
})

describe('taps', () => {
  it('rejects a tap on an empty tube without changing state', () => {
    const h = harness([[1, 1], []])
    h.controller.start()
    const before = h.controller.state
    h.controller.tap(1)
    expect(h.controller.state).toBe(before)
    expect(h.sounds).toContain('invalid')
    expect(h.events).toContainEqual({ type: 'invalid', index: 1 })
    expect(pourEvents(h.events)).toEqual([])
  })

  it('says nothing when tapping a full tube with nothing selected', () => {
    const h = harness([[2, 2, 2, 2]])
    h.controller.start()
    h.controller.tap(0)
    expect(h.controller.state.selected).toBe(0)
    expect(h.sounds).not.toContain('invalid')
  })

  it('switches selection when the pour is illegal', () => {
    const h = harness([
      [1, 2], // 0
      [3, 3], // 1
    ])
    h.controller.start()
    h.controller.tap(0)
    expect(h.controller.state.selected).toBe(0)
    h.controller.tap(1) // top colours differ, so this is a selection change
    expect(h.controller.state.selected).toBe(1)
    expect(h.controller.state.moves).toBe(0)
  })

  it('deselects when the selected tube is tapped again', () => {
    const h = harness([[1, 1]])
    h.controller.start()
    h.controller.tap(0)
    h.controller.tap(0)
    expect(h.controller.state.selected).toBeNull()
    expect(h.events.map((event) => event.type)).toEqual(['new', 'select', 'deselect'])
  })
})

describe('undo and restart', () => {
  it('restores the previous board and tells the stage', () => {
    const h = harness([[1, 1], []])
    h.controller.start()
    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.controller.state.moves).toBe(1)

    h.controller.undo()
    expect(h.controller.state.moves).toBe(0)
    expect(h.controller.state.tubes[0].colors).toEqual([1, 1])
    expect(h.controller.state.tubes[1].colors).toEqual([])
    expect(h.events[h.events.length - 1]).toEqual({ type: 'undo' })
  })

  it('does nothing when there is no history', () => {
    const h = harness([[1, 1], []])
    h.controller.start()
    const stageCalls = h.events.length
    h.controller.undo()
    expect(h.events).toHaveLength(stageCalls)
    expect(h.controller.state.moves).toBe(0)
  })

  it('restart rebuilds the same level and resets moves', () => {
    const h = harness([[1, 1], []], {}, { level: 2, highest: 2 })
    h.controller.start()
    const initial = JSON.stringify(h.controller.state.tubes)
    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.controller.state.moves).toBe(1)

    h.controller.restart()
    expect(h.controller.level).toBe(2)
    expect(h.boards).toEqual([2, 2])
    expect(h.controller.state.moves).toBe(0)
    expect(h.controller.state.selected).toBeNull()
    expect(JSON.stringify(h.controller.state.tubes)).toBe(initial)
    expect(h.events[h.events.length - 1]).toEqual({ type: 'new' })
  })
})

describe('undo budget', () => {
  /**
   * One pour and its undo: both tubes keep a unit of colour 1, so the pour
   * repeats. Each cycle spends exactly one credit.
   */
  function spendOne(h: Harness): void {
    h.controller.tap(0)
    h.controller.tap(1)
    h.controller.undo()
  }

  it('counts down from 5 and renders the count on every view', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(5)

    for (let spent = 1; spent <= 5; spent++) {
      spendOne(h)
      expect(h.updates.at(-1)?.view.undoCredits).toBe(5 - spent)
    }
    // The fifth undo still applied: the pour before it was taken back.
    expect(h.controller.state.moves).toBe(0)
    expect(h.events[h.events.length - 1].type).toBe('undo')
  })

  it('exhausts to a no-op: no event, no state change, no credit spent', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    for (let spent = 0; spent < 5; spent++) spendOne(h)

    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.controller.state.moves).toBe(1)
    const calls = h.events.length
    h.controller.undo()
    expect(h.events).toHaveLength(calls)
    expect(h.controller.state.moves).toBe(1)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(0)
  })

  it('an undo with no history does not consume a credit', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    h.controller.undo() // nothing applied
    spendOne(h)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(4)
  })

  it('restart restores the budget', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    h.controller.tap(0)
    h.controller.tap(1)
    h.controller.undo()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(4)

    h.controller.restart()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(5)
  })

  it('next level and play again restore the budget', () => {
    const h = harness([[1, 1], [1, 1]])
    h.controller.start()
    h.controller.tap(0) // select
    h.controller.tap(1) // completes both tubes: won
    expect(h.controller.state.won).toBe(true)
    h.controller.undo()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(4)

    h.controller.nextLevel()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(5)
  })

  it('play again from the last level restores the budget', () => {
    const h = harness([[1, 1], [1, 1]], {}, { level: MAX_LEVEL, highest: MAX_LEVEL })
    h.controller.start()
    h.controller.tap(0)
    h.controller.tap(1)
    h.controller.undo()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(4)

    h.controller.playAgain()
    expect(h.controller.level).toBe(1)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(5)
  })

  it('a rapid burst mixing pours and undo applies in order', () => {
    const h = harness([[1, 1], [1, 1, 1], []])
    h.controller.start()
    h.controller.tap(0)
    h.controller.tap(1) // pour 0→1 (1 unit: only room for one)
    h.controller.undo() // back to start, credit 4
    h.controller.tap(0)
    h.controller.tap(1) // pour again
    h.controller.tap(0) // the source keeps one unit, so this selects it
    h.controller.tap(2) // pour 1 unit into the empty tube
    expect(h.controller.state.moves).toBe(2)
    expect(h.controller.state.tubes.map((t) => t.colors)).toEqual([[], [1, 1, 1, 1], [1]])
    expect(h.updates.at(-1)?.view.undoCredits).toBe(4)
  })
})

describe('earn gate', () => {
  /** Spend the whole budget with repeatable pour+undo cycles. */
  function spendAll(h: Harness): void {
    for (let spent = 0; spent < UNDO_CREDITS; spent++) {
      h.controller.tap(0)
      h.controller.tap(1)
      h.controller.undo()
    }
    expect(h.updates.at(-1)?.view.undoCredits).toBe(0)
  }

  it('the spent undo button opens the gate instead of doing nothing', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    const eventsBefore = h.events.length

    h.controller.undo()
    expect(h.challengeShows).toHaveLength(1)
    expect(h.challengeShows[0].options.length).toBeGreaterThanOrEqual(2)
    // Opening the gate is not a move: no stage event, no board change.
    expect(h.events).toHaveLength(eventsBefore)
    expect(h.controller.state.moves).toBe(0)
  })

  it('a second earn while the gate is open does not redraw', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    h.controller.undo()
    h.controller.undo()
    h.controller.earn()
    expect(h.challengeShows).toHaveLength(1)
  })

  it('a correct answer grants one credit, shows it and closes the gate', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    h.controller.undo()
    const shown = h.challengeShows[0]

    h.controller.answer(shown.answer)
    expect(h.challengeHides()).toBe(1)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(1)
    expect(h.sounds).toContain('complete')
    expect(h.sounds).not.toContain('invalid')
  })

  it('a wrong answer closes the gate and grants nothing', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    h.controller.undo()
    const shown = h.challengeShows[0]
    const wrong = (shown.answer + 1) % shown.options.length

    h.controller.answer(wrong)
    expect(h.challengeHides()).toBe(1)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(0)
    expect(h.sounds).toContain('invalid')
    expect(h.sounds).not.toContain('complete')
  })

  it('dismissing closes the gate and grants nothing', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    h.controller.undo()

    h.controller.dismiss()
    expect(h.challengeHides()).toBe(1)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(0)
    expect(h.sounds).not.toContain('complete')
  })

  it('a closed challenge is not the immediate next draw', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)

    h.controller.undo()
    const dismissed = h.challengeShows[0]
    h.controller.dismiss()
    h.controller.undo()
    expect(h.challengeShows[1].prompt).not.toBe(dismissed.prompt)

    const answered = h.challengeShows[1]
    h.controller.answer(answered.answer)
    h.controller.earn() // the gate itself, as a later caller (ticket 09) would use it
    expect(h.challengeShows[2].prompt).not.toBe(answered.prompt)
  })

  it('the draw sequence is deterministic for the same session input', () => {
    const run = () => {
      const h = harness([[1, 1], [1]])
      h.controller.start()
      const prompts: string[] = []
      for (let round = 0; round < 3; round++) {
        h.controller.earn()
        prompts.push(h.challengeShows.at(-1)?.prompt ?? 'missing')
        h.controller.dismiss()
      }
      return prompts
    }
    expect(run()).toEqual(run())
  })

  it('earned credits stack onto the budget and stop at the cap', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    // Earned credits stack onto what is left, so spend the free budget first.
    spendAll(h)
    for (let earned = 1; earned <= UNDO_CAP + 2; earned++) {
      h.controller.earn()
      h.controller.answer(h.challengeShows.at(-1)!.answer)
      const credits = h.updates.at(-1)?.view.undoCredits
      expect(credits, `earn ${earned}`).toBe(Math.min(earned, UNDO_CAP))
    }
    expect(h.updates.at(-1)?.view.undoCredits).toBe(UNDO_CAP)
  })

  it('board input waits while the gate is open, and restart cannot strand it', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    spendAll(h)
    h.controller.undo()
    const eventsBefore = h.events.length

    h.controller.tap(0)
    expect(h.controller.state.selected).toBeNull()
    expect(h.events).toHaveLength(eventsBefore)

    h.controller.restart()
    expect(h.updates.at(-1)?.view.undoCredits).toBe(0)
    expect(h.challengeShows).toHaveLength(1)

    h.controller.dismiss()
    h.controller.tap(0)
    expect(h.controller.state.selected).toBe(0)
  })

  it('answering with no gate open does nothing', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    h.controller.answer(0)
    h.controller.dismiss()
    expect(h.challengeShows).toHaveLength(0)
    expect(h.challengeHides()).toBe(0)
    expect(h.updates).toHaveLength(1) // start() only
  })
})

describe('locked spares (ticket 09)', () => {
  /** Level 20 is the first locked level; `SPARES_LOCK_FROM` is that pin. */
  const locked = { level: SPARES_LOCK_FROM, highest: SPARES_LOCK_FROM }

  it('seals empty spares at the locked level and leaves colours alone', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    expect(h.controller.state.tubes.map((tube) => tube.open)).toEqual([undefined, 0, 0])
  })

  it('leaves every spare open below the locked level', () => {
    const h = harness([[1, 1], [], []], {}, { level: SPARES_LOCK_FROM - 1 })
    h.controller.start()
    expect(h.controller.state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('tapping a sealed spare opens the gate for that tube, not a move', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    const eventsBefore = h.events.length

    h.controller.tap(1)
    expect(h.rewards).toEqual([{ kind: 'grow', tube: 1 }])
    expect(h.events).toHaveLength(eventsBefore)
    expect(h.controller.state.selected).toBeNull()
    expect(h.sounds).not.toContain('invalid')
  })

  it('a correct answer opens one slot and says so to the stage', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    h.controller.tap(2)
    h.controller.answer(h.challengeShows[0].answer)

    expect(h.controller.state.tubes[2].open).toBe(1)
    expect(h.events[h.events.length - 1]).toEqual({ type: 'grow', index: 2 })
    expect(h.controller.state.moves).toBe(0)
    expect(h.controller.state.history).toEqual([])
    expect(h.updates.at(-1)?.view.undoCredits).toBe(UNDO_CREDITS)
  })

  it('a wrong answer or dismissal grants no slot', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()

    h.controller.tap(1)
    h.controller.answer((h.challengeShows[0].answer + 1) % h.challengeShows[0].options.length)
    expect(h.controller.state.tubes[1].open).toBe(0)

    h.controller.tap(1)
    h.controller.dismiss()
    expect(h.controller.state.tubes[1].open).toBe(0)
  })

  it('growth stops at capacity, and a grown spare then pours normally', () => {
    const h = harness([[1, 1], []], {}, locked)
    h.controller.start()

    for (let grown = 1; grown <= 4; grown++) {
      h.controller.tap(1)
      h.controller.answer(h.challengeShows.at(-1)!.answer)
      expect(h.controller.state.tubes[1].open).toBe(grown)
    }
    // Fully open: the tap is no longer a grow affordance.
    const shows = h.challengeShows.length
    h.controller.tap(1)
    expect(h.challengeShows).toHaveLength(shows)

    h.controller.tap(0) // select the source
    h.controller.tap(1) // pour into the fully open spare
    expect(h.controller.state.tubes[1].colors).toEqual([1, 1])
  })

  it('a partly open spare pours only up to its open slots', () => {
    const h = harness([[1, 1, 1, 1], []], {}, locked)
    h.controller.start()
    h.controller.tap(1)
    h.controller.answer(h.challengeShows[0].answer) // one slot open

    h.controller.tap(0) // select the full tube
    h.controller.tap(1) // pour into the one open slot
    expect(h.controller.state.tubes[1].colors).toEqual([1])
    expect(h.updates.at(-1)?.view.undoCredits).toBe(UNDO_CREDITS)
  })

  it('the spent undo button still asks for an undo, not a slot', () => {
    const h = harness([[1, 1], [1]], {}, locked)
    h.controller.start()
    // Spend the budget; the board's spare stays sealed but plays no part.
    for (let spent = 0; spent < UNDO_CREDITS; spent++) {
      h.controller.tap(0)
      h.controller.tap(1)
      h.controller.undo()
    }
    h.controller.undo()
    expect(h.rewards).toEqual([{ kind: 'undo' }])

    h.controller.answer(h.challengeShows[0].answer)
    expect(h.updates.at(-1)?.view.undoCredits).toBe(1)
    expect(h.controller.state.tubes[1].open).toBeUndefined() // no slot grew
  })

  it('restart, next level and play again reseal the spares', () => {
    const reseal = () => {
      const h = harness([[1, 1], []], {}, locked)
      h.controller.start()
      h.controller.tap(1)
      h.controller.answer(h.challengeShows[0].answer)
      expect(h.controller.state.tubes[1].open).toBe(1)
      return h
    }

    const restarted = reseal()
    restarted.controller.restart()
    expect(restarted.controller.state.tubes[1].open).toBe(0)

    const next = harness([[1, 1], []], {}, locked)
    next.controller.start()
    next.controller.nextLevel()
    expect(next.controller.state.tubes[1].open).toBe(0)
    expect(next.controller.level).toBe(SPARES_LOCK_FROM + 1)

    const again = harness([[1, 1], []], {}, { level: MAX_LEVEL, highest: MAX_LEVEL })
    again.controller.start()
    again.controller.playAgain()
    expect(again.controller.level).toBe(1)
    expect(again.controller.state.tubes[1].open).toBeUndefined()
  })

  it('many rapid taps on a sealed spare do not draw more than one gate', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    for (let i = 0; i < 12; i++) h.controller.tap(1)
    expect(h.challengeShows).toHaveLength(1)
    expect(h.controller.state.tubes[1].open).toBe(0)

    h.controller.answer(h.challengeShows[0].answer)
    for (let i = 0; i < 12; i++) h.controller.tap(2)
    expect(h.challengeShows).toHaveLength(2)
    h.controller.answer(h.challengeShows[1].answer)
    expect(h.controller.state.tubes[2].open).toBe(1)
  })

  it('a sealed spare refuses a pour with feedback and keeps the selection', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    h.controller.tap(0) // select the full tube
    const before = h.controller.state

    h.controller.tap(1) // sealed: no slot can receive it
    expect(h.controller.state).toBe(before)
    expect(h.controller.state.selected).toBe(0)
    expect(h.sounds).toContain('invalid')
    expect(h.events[h.events.length - 1]).toEqual({ type: 'invalid', index: 1 })
  })

  it('the reward does not change which challenge is drawn', () => {
    const drawFor = (open: (h: Harness) => void): string | undefined => {
      const h = harness([[1, 1], [1], []], {}, locked)
      h.controller.start()
      open(h)
      return h.challengeShows[0]?.prompt
    }

    const rounded = drawFor((h) => {
      for (let spent = 0; spent < UNDO_CREDITS; spent++) {
        h.controller.tap(0)
        h.controller.tap(1)
        h.controller.undo()
      }
      h.controller.undo() // spent button: undo reward
    })
    const grown = drawFor((h) => h.controller.tap(2)) // sealed spare: grow reward

    expect(grown).toBe(rounded)
  })

  it('earn() still defaults to the undo reward for other callers', () => {
    const h = harness([[1, 1], [1]])
    h.controller.start()
    h.controller.earn()
    expect(h.rewards).toEqual([{ kind: 'undo' }])
  })
})

describe('optional spares (ticket 14)', () => {
  const locked = { level: SPARES_LOCK_FROM, highest: SPARES_LOCK_FROM }

  /**
   * `[[1,1,1],[1],[],[]]`: tip tube 1 into empty tube 2, then tip tube 2 into
   * tube 0 to complete it. The solution uses empty 2 but never empty 3, so 2
   * stays open and 3 is the optional lock.
   */
  const solution: Move[] = [
    { from: 1, to: 2, amount: 1 },
    { from: 2, to: 0, amount: 1 },
  ]

  it('seals only the empty the solution never pours into', () => {
    const h = harness([[1, 1, 1], [1], [], []], {}, locked, undefined, solution)
    h.controller.start()
    expect(h.controller.state.tubes.map((tube) => tube.open)).toEqual([
      undefined,
      undefined,
      undefined,
      0,
    ])
  })

  it('wins by replaying the solution without ever opening the gate', () => {
    const h = harness([[1, 1, 1], [1], [], []], {}, locked, undefined, solution)
    h.controller.start()

    for (const move of solution) {
      h.controller.tap(move.from)
      h.controller.tap(move.to)
    }

    expect(h.controller.state.won).toBe(true)
    expect(h.controller.state.tubes[3].open).toBe(0) // the lock stayed shut
    expect(h.challengeShows).toEqual([])
    expect(h.rewards).toEqual([])
  })

  it('shows no lock when the solution pours into every empty', () => {
    const both: Move[] = [
      { from: 1, to: 2, amount: 1 },
      { from: 2, to: 3, amount: 1 },
      { from: 3, to: 0, amount: 1 },
    ]
    const h = harness([[1, 1, 1], [1], [], []], {}, locked, undefined, both)
    h.controller.start()
    expect(h.controller.state.tubes.every((tube) => tube.open === undefined)).toBe(true)

    for (const move of both) {
      h.controller.tap(move.from)
      h.controller.tap(move.to)
    }
    expect(h.controller.state.won).toBe(true)
    expect(h.challengeShows).toEqual([])
  })
})

describe('padlocks (ticket 15)', () => {
  const locked = { level: SPARES_LOCK_FROM, highest: SPARES_LOCK_FROM }

  it('a padlock tap asks to grow that tube and is not a glass tap', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    const eventsBefore = h.events.length

    h.controller.tapPadlock(1)
    expect(h.rewards).toEqual([{ kind: 'grow', tube: 1 }])
    expect(h.events).toHaveLength(eventsBefore)
    expect(h.controller.state.selected).toBeNull()
    expect(h.sounds).not.toContain('invalid')
  })

  it('comes back for a second block after pouring into the spare', () => {
    const h = harness([[1, 1, 1, 1], []], {}, locked)
    h.controller.start()

    // Earn one slot, then pour one unit into it.
    h.controller.tapPadlock(1)
    h.controller.answer(h.challengeShows[0].answer)
    expect(h.controller.state.tubes[1].open).toBe(1)
    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.controller.state.tubes[1]).toMatchObject({ colors: [1], open: 1 })

    // The padlock, not the empty rule, opens the gate again.
    h.controller.tapPadlock(1)
    expect(h.rewards).toEqual([
      { kind: 'grow', tube: 1 },
      { kind: 'grow', tube: 1 },
    ])
    h.controller.answer(h.challengeShows[1].answer)
    expect(h.controller.state.tubes[1].open).toBe(2)

    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.controller.state.tubes[1].colors).toEqual([1, 1])
    expect(h.controller.state.moves).toBe(2)
  })

  it('a padlock tap while the gate is open draws nothing', () => {
    const h = harness([[1, 1], [], []], {}, locked)
    h.controller.start()
    h.controller.tapPadlock(1)
    for (let i = 0; i < 12; i++) h.controller.tapPadlock(2)
    expect(h.challengeShows).toHaveLength(1)
    expect(h.controller.state.tubes[2].open).toBe(0)
  })

  it('the glass of a coloured partly-open spare still selects', () => {
    const h = harness([[1, 1], []], {}, locked)
    h.controller.start()
    h.controller.tapPadlock(1)
    h.controller.answer(h.challengeShows[0].answer)
    h.controller.tap(0)
    h.controller.tap(1) // pour colour into the spare
    expect(h.controller.state.tubes[1].colors).toEqual([1])

    const shows = h.challengeShows.length
    h.controller.tap(1) // empty-handed glass tap: selection, not the gate
    expect(h.controller.state.selected).toBe(1)
    expect(h.challengeShows).toHaveLength(shows)
  })

  it('a fully open tube has no padlock left to tap', () => {
    const h = harness([[1, 1], []], {}, locked)
    h.controller.start()
    for (let grown = 1; grown <= 4; grown++) {
      h.controller.tapPadlock(1)
      h.controller.answer(h.challengeShows.at(-1)!.answer)
    }
    expect(h.controller.state.tubes[1].open).toBe(4)
    const shows = h.challengeShows.length
    h.controller.tapPadlock(1)
    expect(h.challengeShows).toHaveLength(shows)
  })
})

describe('feedback', () => {
  it('completes a tube with a chime, but does not call it a win', () => {
    const h = harness([
      [1, 1, 1], // 0
      [1], // 1
      [2, 2], // 2: unfinished, so the game is not won
    ])
    h.controller.start()
    h.controller.tap(1)
    h.controller.tap(0)
    expect(h.sounds).toContain('complete')
    expect(h.sounds).not.toContain('win')
  })

  it('plays the win fanfare and a haptic pattern on the last tube', () => {
    const h = harness([
      [1, 1, 1], // 0
      [1], // 1
      [2, 2, 2, 2], // 2
    ])
    h.controller.start()
    h.controller.tap(1)
    h.controller.tap(0)
    expect(h.controller.state.won).toBe(true)
    expect(h.sounds).toContain('win')
    expect(h.haptics).toContainEqual([14, 40, 14, 40, 22])
  })

  it('unlocks audio before every committed move', () => {
    const h = harness([[1, 1], []])
    h.controller.start()
    expect(h.unlocks()).toBe(0)
    h.controller.tap(0)
    h.controller.tap(1)
    expect(h.unlocks()).toBe(2)
  })
})

describe('toggles', () => {
  it('persists the sound setting and applies it', () => {
    const h = harness([[1, 1]], { sound: false })
    h.controller.start()
    h.controller.toggleSound()
    expect(h.controller.settings.sound).toBe(true)
    expect(h.saved[h.saved.length - 1].sound).toBe(true)
    expect(h.sounds).toContain('select')
  })

  it('persists the pour effect setting and tells the stage', () => {
    const h = harness([[1, 1]], { pourFx: true })
    h.controller.start()
    h.controller.togglePourFx()
    expect(h.saved[h.saved.length - 1].pourFx).toBe(false)
    expect(h.prefs[h.prefs.length - 1]).toEqual({ pourFx: false })
  })
})

describe('start', () => {
  it('paints the UI before the stage, so the stage can measure', () => {
    const h = harness([[1, 1], []], { sound: false, pourFx: true })
    h.controller.start()
    expect(h.updates).toHaveLength(1)
    expect(h.prefs).toEqual([{ pourFx: true }])
    expect(h.events).toEqual([{ type: 'new' }])
    expect(h.sounds).toEqual([])
  })
})

/* ------------------------------------------------- levels and progress ---- */

/** `[1, 1, 1]` plus `[1]` is a one-pour win. */
function winInOnePour(h: Harness): void {
  h.controller.start()
  h.controller.tap(1)
  h.controller.tap(0)
  expect(h.controller.state.won).toBe(true)
}

describe('levels and progress', () => {
  it('loads the saved level and builds its board', () => {
    const h = harness([[1, 1], []], {}, { level: 3, highest: 3 })
    expect(h.controller.level).toBe(3)
    expect(h.controller.progress).toEqual({ level: 3, highest: 3 })
    expect(h.boards).toEqual([3])

    h.controller.start()
    expect(h.updates[0].view).toEqual({
      level: 3,
      maxLevel: MAX_LEVEL,
      primary: 'restart',
      undoCredits: 5,
    })
  })

  it('saves the highest level on a win without lowering it', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: 1, highest: 4 })
    winInOnePour(h)
    expect(h.savedProgress).toEqual([{ level: 1, highest: 4 }])
  })

  it('offers next level after a win', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: 1, highest: 1 })
    winInOnePour(h)
    expect(h.updates[h.updates.length - 1].view.primary).toBe('next')
  })

  it('advances, saves and dispatches a fresh start on next level', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: 1, highest: 1 })
    winInOnePour(h)

    h.controller.nextLevel()
    expect(h.controller.level).toBe(2)
    expect(h.controller.progress).toEqual({ level: 2, highest: 1 })
    expect(h.savedProgress[h.savedProgress.length - 1]).toEqual({ level: 2, highest: 1 })
    expect(h.boards).toEqual([1, 2])
    expect(h.events[h.events.length - 1]).toEqual({ type: 'new' })
    expect(h.controller.state.won).toBe(false)
  })

  it('returns to level 1 without losing the highest on play again', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: MAX_LEVEL, highest: MAX_LEVEL })
    winInOnePour(h)

    h.controller.playAgain()
    expect(h.controller.level).toBe(1)
    expect(h.controller.progress).toEqual({ level: 1, highest: MAX_LEVEL })
    expect(h.savedProgress[h.savedProgress.length - 1]).toEqual({
      level: 1,
      highest: MAX_LEVEL,
    })
    expect(h.boards).toEqual([MAX_LEVEL, 1])
    expect(h.events[h.events.length - 1]).toEqual({ type: 'new' })
    expect(h.controller.state.won).toBe(false)
  })
})

describe('primaryAction', () => {
  const playing = createGame([[1, 1], []])
  const won = { ...playing, won: true }

  it('restarts while the level is in play', () => {
    expect(primaryAction(playing, 1)).toBe('restart')
    expect(primaryAction(playing, MAX_LEVEL)).toBe('restart')
  })

  it('advances after a win', () => {
    expect(primaryAction(won, 1)).toBe('next')
  })

  it('plays again on the last level', () => {
    expect(primaryAction(won, MAX_LEVEL)).toBe('play-again')
  })
})

describe('primary', () => {
  it('restarts the current level while playing', () => {
    const h = harness([[1, 1], []], {}, { level: 1, highest: 1 })
    h.controller.start()
    h.controller.tap(0)

    h.controller.primary()
    expect(h.boards).toEqual([1, 1])
    expect(h.controller.state.selected).toBeNull()
    expect(h.controller.state.moves).toBe(0)
  })

  it('advances after a win', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: 1, highest: 1 })
    winInOnePour(h)
    h.controller.primary()
    expect(h.controller.level).toBe(2)
  })

  it('plays again after the last level', () => {
    const h = harness([[1, 1, 1], [1]], {}, { level: MAX_LEVEL, highest: MAX_LEVEL })
    winInOnePour(h)
    h.controller.primary()
    expect(h.controller.level).toBe(1)
    expect(h.controller.progress.highest).toBe(MAX_LEVEL)
  })
})

describe('hidden blocks (ticket 10)', () => {
  it('applies the level pick at and above HIDDEN_FROM', () => {
    const h = harness([[1, 1], [2, 2], []], {}, { level: HIDDEN_FROM })
    h.controller.start()
    const picks = pickHiddenTubes(HIDDEN_FROM, h.controller.state.tubes)
    expect(picks).toHaveLength(1)
    expect(h.controller.state.tubes[picks[0]].hidden).toBe(1)
    // The unpicked tube shows everything.
    const others = [0, 1, 2].filter((i) => !picks.includes(i))
    others.forEach((i) => expect(h.controller.state.tubes[i].hidden).toBeUndefined())
  })

  it('hides two tubes and seals the spares on the final tier', () => {
    const h = harness([[1, 1], [2, 2], [], []], {}, { level: SPARES_LOCK_FROM })
    h.controller.start()
    expect(h.controller.state.tubes[2].open).toBe(0)
    const picks = pickHiddenTubes(SPARES_LOCK_FROM, h.controller.state.tubes)
    expect(picks).toHaveLength(2)
    // The pick never lands on an empty tube, so it stays clear of the seals.
    picks.forEach((i) => {
      expect(h.controller.state.tubes[i].hidden).toBe(1)
      expect(h.controller.state.tubes[i].open).toBeUndefined()
    })
  })

  it('hides nothing below HIDDEN_FROM', () => {
    const h = harness([[1, 1], [2, 2], []], {}, { level: HIDDEN_FROM - 1 })
    h.controller.start()
    expect(h.controller.state.tubes.every((tube) => tube.hidden === undefined)).toBe(true)
  })

  it('reconceals on restart, like undo credits', () => {
    const h = harness([[1, 1], [2, 2], []], {}, { level: HIDDEN_FROM })
    h.controller.start()
    const pick = pickHiddenTubes(HIDDEN_FROM, h.controller.state.tubes)[0]
    h.controller.tap(pick)
    h.controller.tap(2) // pour the whole tube out; nothing is concealed any more
    expect(h.controller.state.tubes[pick].hidden).toBe(0)
    h.controller.restart()
    expect(h.controller.state.tubes[pick].hidden).toBe(1)
  })

  it('an undo keeps what the pour revealed (once seen, stays seen)', () => {
    const h = harness([[1, 2], [1], []], {}, { level: HIDDEN_FROM })
    h.controller.start()
    const pick = pickHiddenTubes(HIDDEN_FROM, h.controller.state.tubes)[0]
    h.controller.tap(pick)
    h.controller.tap(2) // the top 2 pours out; the 1 surfaces and is seen
    expect(h.controller.state.tubes[pick].colors).toEqual([1])
    expect(h.controller.state.tubes[pick].hidden).toBe(0)
    h.controller.undo()
    expect(h.controller.state.tubes[pick].colors).toEqual([1, 2])
    expect(h.controller.state.tubes[pick].hidden).toBe(0) // knowledge, not liquid
  })
})

describe('level jump (ticket 11)', () => {
  it('builds the level the shortcut asks for, with its policies applied', () => {
    const h = harness(Array.from({ length: 9 }, () => [1, 2]), {}, { level: 3, highest: 3 }, 15)
    h.controller.start()
    expect(h.boards).toEqual([15])
    expect(h.controller.level).toBe(15)
    const picks = pickHiddenTubes(15, h.controller.state.tubes)
    expect(picks).toHaveLength(1)
    expect(h.controller.state.tubes[picks[0]].hidden).toBe(1)
  })

  it('makes the jump the saved position, so a reload resumes there', () => {
    const h = harness([[1, 1], []], {}, { level: 3, highest: 3 }, 15)
    expect(h.savedProgress).toEqual([{ level: 15, highest: 15 }])
  })

  it('seals the spares when the jump lands on the locked tier', () => {
    const h = harness([[1, 1], [2, 2], [], []], {}, { level: 1 }, 20)
    h.controller.start()
    expect(h.boards).toEqual([20])
    expect(h.controller.state.tubes[2].open).toBe(0)
  })

  it('clamps a jump outside the board range', () => {
    expect(harness([[1]], {}, {}, 99).boards).toEqual([MAX_LEVEL])
    expect(harness([[1]], {}, {}, 0).boards).toEqual([1])
  })

  it('without a jump the saved level is used and nothing is written at boot', () => {
    const h = harness([[1, 1], []], {}, { level: 7, highest: 9 })
    expect(h.boards).toEqual([7])
    expect(h.savedProgress).toEqual([])
  })

  it('a jump to the level already saved writes nothing', () => {
    const h = harness([[1, 1], []], {}, { level: 15, highest: 15 }, 15)
    expect(h.savedProgress).toEqual([])
  })

  it('advancing from a jump saves the next level as usual', () => {
    const h = harness([[1]], {}, { level: 3, highest: 3 }, 15)
    h.controller.nextLevel()
    expect(h.controller.level).toBe(16)
    expect(h.savedProgress.at(-1)).toEqual({ level: 16, highest: 15 })
  })
})
