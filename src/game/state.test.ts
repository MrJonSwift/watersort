import { describe, expect, it } from 'vitest'
import { addExtraSpare, createGame, growBlock, hideBlocks, sealSpares, tap, undo } from './state'
import { CLIMB_FROM } from './levels'
import { pour } from './rules'
import type { GameState, Move } from './types'

/** Every pre-ticket-22 test below exercises the untouched 1–50 rule. */
const OLD_LEVEL = CLIMB_FROM - 1

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
    const built = sealSpares(addExtraSpare(game), solution, OLD_LEVEL)

    expect(built.tubes.map((tube) => tube.open)).toEqual([undefined, undefined, undefined, 0])
    let state = built
    for (const move of solution) state = pour(state, move.from, move.to)
    expect(state.tubes[3]).toEqual({ colors: [], open: 0 }) // never opened
    expect(state.won).toBe(true)
  })
})

describe('sealSpares', () => {
  const board = [[1, 2, 1, 2], [2], [], []]

  it('seals an empty the solution never pours into (ticket 14)', () => {
    // Only empty 2 is a solution destination; empty 3 is untouched and locks.
    const solution: Move[] = [{ from: 0, to: 2, amount: 1 }]
    const state = sealSpares(createGame(board), solution, OLD_LEVEL)
    expect(state.tubes.map((tube) => tube.open)).toEqual([undefined, undefined, undefined, 0])
  })

  it('leaves an empty the solution pours into fully open', () => {
    const solution: Move[] = [{ from: 0, to: 3, amount: 1 }]
    const state = sealSpares(createGame(board), solution, OLD_LEVEL)
    expect(state.tubes[3].open).toBeUndefined()
    expect(state.tubes[2].open).toBe(0)
  })

  it('seals every empty when the solution uses none of them', () => {
    const state = sealSpares(createGame(board), [], OLD_LEVEL)
    expect(state.tubes.map((tube) => tube.open)).toEqual([undefined, undefined, 0, 0])
  })

  it('seals nothing when the solution uses every empty', () => {
    const solution: Move[] = [
      { from: 0, to: 2, amount: 1 },
      { from: 0, to: 3, amount: 1 },
    ]
    const state = sealSpares(createGame(board), solution, OLD_LEVEL)
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('never seals a tube holding colours, wherever the solution pours', () => {
    const solution: Move[] = [{ from: 1, to: 0, amount: 1 }]
    const state = sealSpares(createGame([[1], [2, 2]]), solution, OLD_LEVEL)
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('leaves a board with no empty tube alone', () => {
    const state = sealSpares(createGame([[1, 1], [2, 2]]), [], OLD_LEVEL)
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('leaves everything else untouched', () => {
    const state = createGame([[1], []])
    const sealed = sealSpares(state, [], OLD_LEVEL)
    expect(sealed.capacity).toBe(state.capacity)
    expect(sealed.tubes[0]).toEqual(state.tubes[0])
  })
})

describe('late coloured lock (ticket 22)', () => {
  // Five tubes: spares are the last two (3, 4) at any level. The coloured spare
  // 3 is never a solution destination — it is emptied as a source — and the
  // plain empty spare 4 is the working space.
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

  it('seals a solution-unused coloured spare from the climb, keeping its colour', () => {
    const state = sealSpares(createGame(board), solution, CLIMB_FROM)
    expect(state.tubes[3]).toEqual({ colors: [1, 2, 3], open: 0 })
    expect(state.tubes[4]).toEqual({ colors: [] }) // used by the solution: plain
    expect(state.tubes.slice(0, 3)).toEqual(createGame(board).tubes.slice(0, 3))
  })

  it('never seals a coloured tube below the climb', () => {
    const state = sealSpares(createGame(board), solution, OLD_LEVEL)
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('a sealed coloured spare is still a source, so the solution wins it question-free', () => {
    let state = sealSpares(createGame(board), solution, CLIMB_FROM)
    for (const move of solution) {
      const source = state.tubes[move.from]
      expect(source.colors.length).toBeGreaterThan(0)
      state = pour(state, move.from, move.to)
    }
    expect(state.won).toBe(true)
    expect(state.tubes[3]).toMatchObject({ colors: [], open: 0 }) // never earned a slot
    expect(state.tubes[4]).toMatchObject({ colors: [] })
  })

  it('grows above the colour it holds, then accepts a pour once slots exceed it', () => {
    let state = sealSpares(createGame(board), solution, CLIMB_FROM)
    expect(state.tubes[3]).toEqual({ colors: [1, 2, 3], open: 0 })
    expect(pour(state, 1, 3)).toBe(state) // sealed: nothing fits yet

    // Three units of colour inside a four-slot spare: all four blocks must be
    // earned before one more fits (the padlock, not the empty rule, protects it).
    for (let grown = 1; grown <= 4; grown++) {
      state = growBlock(state, 3)
      expect(state.tubes[3].open).toBe(grown)
    }
    expect(growBlock(state, 3)).toBe(state) // capacity reached
    expect(pour(state, 1, 3).tubes[3]).toEqual({ colors: [1, 2, 3, 3], open: 4 })
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
    let state = sealSpares(createGame([[1, 1, 1], []]), [], OLD_LEVEL)
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

  it('keeps the padlock on a vial that is both sealed and concealed (ticket 22)', () => {
    // At 51+ the generator's spare is full of colour, so it is hidden *and*
    // padded. Concealing must not drop the open count, or the padlocks vanish.
    const game = createGame([[1, 1], [2, 2], [3, 3], [1, 2, 3, 4], []])
    const sealed = sealSpares(game, [{ from: 4, to: 0, amount: 1 }], CLIMB_FROM)
    const hidden = hideBlocks(sealed, [3])
    expect(hidden.tubes[3]).toEqual({ colors: [1, 2, 3, 4], open: 0, hidden: 3 })

    // The reverse composition: growing a slot must not reveal the secret.
    const grown = growBlock(hidden, 3)
    expect(grown.tubes[3]).toEqual({ colors: [1, 2, 3, 4], open: 1, hidden: 3 })
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
