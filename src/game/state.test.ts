import { describe, expect, it } from 'vitest'
import { addExtraSpare, createGame, growBlock, hideBlocks, sealSpares, tap, undo } from './state'
import { pour } from './rules'
import type { GameState, Move } from './types'

/** A fresh board whose second tube is a partly grown spare. */
function opened(): GameState {
  const game = createGame([[1, 1], []])
  return { ...game, tubes: [game.tubes[0], { colors: [], open: 2 }] }
}

describe('addExtraSpare (ticket 18)', () => {
  it('appends one empty tube without shifting the generated indices', () => {
    const game = createGame([[1, 1, 1], [1], [], []])
    const next = addExtraSpare(game)

    expect(next.tubes).toHaveLength(game.tubes.length + 1)
    expect(next.tubes.slice(0, game.tubes.length)).toEqual(game.tubes)
    expect(next.tubes.at(-1)).toEqual({ colors: [] })
    expect(game.tubes).toHaveLength(4) // immutable
  })

  it('the appended spare is the one that seals, so the solution stays a clean win', () => {
    // Like every shipped board, the solution uses the generated empty (2);
    // only the appended spare (3) is untouched and therefore sealed.
    const game = createGame([[1, 1, 1], [1], []])
    const solution: Move[] = [
      { from: 1, to: 2, amount: 1 },
      { from: 2, to: 0, amount: 1 },
    ]
    const built = sealSpares(addExtraSpare(game), solution, 3)

    expect(built.tubes.map((tube) => tube.open)).toEqual([undefined, undefined, undefined, 0])
    let state = built
    for (const move of solution) state = pour(state, move.from, move.to)
    expect(state.tubes[3]).toEqual({ colors: [], open: 0 }) // never opened
    expect(state.won).toBe(true)
  })
})

describe('sealSpares (one sealing rule, ticket 29)', () => {
  it('seals nothing without an appended spare, even an unused empty', () => {
    const board = [[1, 2, 1, 2], [2], [], []]
    const state = sealSpares(createGame(board), [])
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('leaves everything but the appended spare untouched', () => {
    const state = addExtraSpare(createGame([[1], []]))
    const sealed = sealSpares(state, [], 2)
    expect(sealed.capacity).toBe(state.capacity)
    expect(sealed.tubes.slice(0, 2)).toEqual(state.tubes.slice(0, 2))
    expect(sealed.tubes[2]).toEqual({ colors: [], open: 0 })
  })
})

describe('appended empty lock (ticket 24)', () => {
  // Three colour tubes plus the two generated spares (3, 4). Tube 3 is a
  // coloured spare the solution never pours into; tube 4 is the working empty.
  // The session appends the empty spare at index 5, which is the lock target.
  const board = [
    [1, 1, 2],
    [2, 2, 3],
    [3, 3, 1],
    [1, 2, 3],
    [],
  ]
  const solution: Move[] = [
    { from: 3, to: 1, amount: 1 },
    { from: 3, to: 0, amount: 1 },
    { from: 3, to: 2, amount: 1 },
    { from: 0, to: 4, amount: 2 },
    { from: 2, to: 0, amount: 2 },
    { from: 1, to: 2, amount: 2 },
    { from: 4, to: 1, amount: 2 },
  ]
  const session = () => addExtraSpare(createGame(board))
  const appended = session().tubes.length - 1

  it('seals the appended empty spare, never a coloured spare', () => {
    const withSpare = session()
    const state = sealSpares(withSpare, solution, appended)

    expect(state.tubes[appended]).toEqual({ colors: [], open: 0 })
    // Ticket 22 used to pad the coloured, solution-unused spare 3. Ticket 24
    // supersedes that: the coloured spare and the working empty stay plain, so
    // unlocking the padlock reveals an empty tube rather than colour or "?".
    expect(state.tubes[3]).toEqual({ colors: [1, 2, 3] })
    expect(state.tubes[4]).toEqual({ colors: [] })
    expect(state.tubes.slice(0, 3)).toEqual(withSpare.tubes.slice(0, 3))
  })

  it('seals nothing when no appended spare is named', () => {
    const state = sealSpares(createGame(board), solution)
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('never seals an appended tube that holds colour or is on the solution path', () => {
    const withSpare = session()
    const coloured: GameState = {
      ...withSpare,
      tubes: withSpare.tubes.map((tube, index) =>
        index === appended ? { colors: [1] } : tube,
      ),
    }
    expect(sealSpares(coloured, solution, appended)).toBe(coloured)

    const used = [...solution, { from: 0, to: appended, amount: 1 }]
    expect(sealSpares(withSpare, used, appended)).toBe(withSpare)
  })

  it('a sealed appended spare is never a source, so the solution wins question-free', () => {
    let state = sealSpares(session(), solution, appended)
    for (const move of solution) {
      expect(state.tubes[move.from].colors.length).toBeGreaterThan(0)
      state = pour(state, move.from, move.to)
    }
    expect(state.won).toBe(true)
    expect(state.tubes[appended]).toEqual({ colors: [], open: 0 }) // never earned a slot
    expect(state.tubes[4]).toMatchObject({ colors: [] })
  })

  it('grows the empty appended spare one slot at a time', () => {
    let state = sealSpares(session(), solution, appended)
    expect(pour(state, 0, appended)).toBe(state) // sealed: nothing fits yet

    state = growBlock(state, appended)
    expect(state.tubes[appended]).toEqual({ colors: [], open: 1 })
    state = growBlock(state, appended)
    expect(state.tubes[appended]).toEqual({ colors: [], open: 2 })

    const poured = pour(state, 0, appended)
    expect(poured.tubes[appended]).toEqual({ colors: [2], open: 2 })
    // The padlock, not the empty rule, allows another block above the colour.
    expect(growBlock(poured, appended).tubes[appended]).toEqual({ colors: [2], open: 3 })
  })
})

describe('growBlock', () => {
  it('opens one more slot on an empty, growable tube', () => {
    const state = opened()
    const next = growBlock(state, 1)
    expect(next.tubes[1].open).toBe(3)
    expect(state.tubes[1].open).toBe(2) // immutable
  })

  it('stops at full capacity', () => {
    const game = createGame([[], []])
    let state: GameState = { ...game, tubes: [{ colors: [], open: 3 }, game.tubes[1]] }
    state = growBlock(state, 0)
    expect(state.tubes[0].open).toBe(4)
    expect(growBlock(state, 0)).toBe(state) // nothing left to grow
  })

  it('refuses an ordinary tube, a fully open tube or a missing index', () => {
    const base = createGame([[1], []])
    expect(growBlock(base, 0)).toBe(base) // ordinary tube holds colours: no `open`
    expect(growBlock(base, 1)).toBe(base) // fully open, nothing to earn
    expect(growBlock(base, 9)).toBe(base) // no such tube
  })

  it('grows above colour a spare already holds (ticket 15)', () => {
    const game = createGame([[1], []])
    const state: GameState = { ...game, tubes: [game.tubes[0], { colors: [1], open: 1 }] }
    const next = growBlock(state, 1)
    expect(next.tubes[1]).toEqual({ colors: [1], open: 2 })
    expect(state.tubes[1].open).toBe(1) // immutable
  })

  it('is the seam between a sealed board and a playable pour', () => {
    let state = sealSpares(addExtraSpare(createGame([[1, 1, 1]])), [], 1)
    expect(pour(state, 0, 1)).toBe(state) // sealed: nothing fits

    state = growBlock(state, 1)
    state = growBlock(state, 1) // two slots earned
    const poured = pour(state, 0, 1)
    expect(poured.tubes[1].colors).toEqual([1, 1])
    expect(poured.tubes[1].open).toBe(2)
    expect(pour(poured, 0, 1)).toBe(poured) // full at its open count again

    // Ticket 15: the player can come back for another block after the pour.
    const grownAgain = growBlock(poured, 1)
    expect(grownAgain.tubes[1].open).toBe(3)
    expect(pour(grownAgain, 0, 1).tubes[1].colors).toEqual([1, 1, 1])
  })
})

describe('undo keeps earned slots', () => {
  it('carries open through the tube copies', () => {
    let state = opened()
    state = tap(state, 0)
    state = tap(state, 1) // pour into the partly open spare, up to its slots
    expect(state.tubes[1].colors).toEqual([1, 1])

    state = undo(state)
    expect(state.tubes[1].colors).toEqual([])
    expect(state.tubes[1].open).toBe(2)
  })
})

describe('hideBlocks', () => {
  it('conceals all but the top unit of the named tubes (ticket 13)', () => {
    const state = hideBlocks(createGame([[1, 2, 1, 2], [2, 2], []]), [0, 2])
    expect(state.tubes[0].hidden).toBe(3) // the top 2 is seen, three units below stay secret
    expect(state.tubes[1].hidden).toBeUndefined()
    expect(state.tubes[2].hidden).toBeUndefined() // empty: nothing to hide
  })

  it('hides nothing on a one-unit tube: the top unit is always seen', () => {
    const state = hideBlocks(createGame([[1], [2, 2]]), [0, 1])
    expect(state.tubes[0].hidden).toBeUndefined()
    expect(state.tubes[1].hidden).toBe(1)
  })

  it('leaves the original state untouched', () => {
    const state = createGame([[1, 1], [2, 2]])
    const hidden = hideBlocks(state, [1])
    expect(state.tubes[1].hidden).toBeUndefined()
    expect(hidden.tubes[0]).toBe(state.tubes[0]) // untouched tubes are reused
  })

  it('never conceals the empty sealed spare (ticket 24)', () => {
    // The climb's padlock sits on the appended empty spare. An empty tube has
    // nothing to hide, so a concealment pass leaves the padlock exactly as it
    // was — no `hidden` count, no colour to leak or reveal.
    const withSpare = addExtraSpare(createGame([[1, 1], [2, 2], [3, 3], [], []]))
    const appended = withSpare.tubes.length - 1
    const sealed = sealSpares(withSpare, [], appended)
    const hidden = hideBlocks(sealed, [appended, 0])
    expect(hidden.tubes[appended]).toEqual({ colors: [], open: 0 })
    expect(hidden.tubes[0].hidden).toBe(1)
  })
})

describe('undo keeps concealment honest (ticket 10)', () => {
  it('what surfaced and was poured stays seen after an undo', () => {
    // [1,2] fully concealed: the pour shows the 2 and the 1 surfaces. The
    // undo returns the liquid but not the secret.
    const game = createGame([[1, 2], []])
    let state: GameState = { ...game, tubes: [{ colors: [1, 2], hidden: 2 }, game.tubes[1]] }
    state = tap(state, 0)
    state = tap(state, 1)
    expect(state.tubes[0].hidden).toBe(0)
    state = undo(state)
    expect(state.tubes[0].colors).toEqual([1, 2])
    expect(state.tubes[0].hidden).toBe(0)
  })

  it('a tube that was never opened is concealed again once the pour is undone', () => {
    // The poured-in 2s were seen on top and poured back out; the 2s below
    // were never on screen, so they conceal again exactly as before.
    const game = createGame([[2, 2], [2, 2]])
    let state: GameState = { ...game, tubes: [{ colors: [2, 2], hidden: 2 }, game.tubes[1]] }
    state = tap(state, 1)
    state = tap(state, 0) // pour 2,2 into the concealed tube
    expect(state.tubes[0].colors).toEqual([2, 2, 2, 2])
    expect(state.tubes[0].hidden).toBe(2)
    state = undo(state)
    expect(state.tubes[0].colors).toEqual([2, 2])
    expect(state.tubes[0].hidden).toBe(2) // exactly as concealed as before
  })
})
