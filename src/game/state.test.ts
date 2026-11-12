import { describe, expect, it } from 'vitest'
import { createGame, growBlock, hideBlocks, sealSpares, tap, undo } from './state'
import { pour } from './rules'
import type { GameState } from './types'

/** A fresh board whose second tube is a partly grown spare. */
function opened(): GameState {
  const game = createGame([[1, 1], []])
  return { ...game, tubes: [game.tubes[0], { colors: [], open: 2 }] }
}

describe('sealSpares', () => {
  it('seals every tube that starts empty, wherever it sits on the board', () => {
    const state = sealSpares(createGame([[1, 2, 1, 2], [2], [], []]))
    expect(state.tubes.map((tube) => tube.open)).toEqual([undefined, undefined, 0, 0])
  })

  it('never seals a tube holding colours', () => {
    const state = sealSpares(createGame([[1], [2, 2]]))
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('leaves a board with no empty tube alone', () => {
    const state = sealSpares(createGame([[1, 1], [2, 2]]))
    expect(state.tubes.every((tube) => tube.open === undefined)).toBe(true)
  })

  it('leaves everything else untouched', () => {
    const state = createGame([[1], []])
    const sealed = sealSpares(state)
    expect(sealed.capacity).toBe(state.capacity)
    expect(sealed.tubes[0]).toEqual(state.tubes[0])
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

  it('refuses a non-empty tube, a fully open tube or a missing index', () => {
    const base = createGame([[1], []])
    expect(growBlock(base, 0)).toBe(base) // holds colours
    expect(growBlock(base, 1)).toBe(base) // fully open, nothing to earn
    expect(growBlock(base, 9)).toBe(base) // no such tube
  })

  it('is the seam between a sealed board and a playable pour', () => {
    let state = sealSpares(createGame([[1, 1, 1], []]))
    expect(pour(state, 0, 1)).toBe(state) // sealed: nothing fits

    state = growBlock(state, 1)
    state = growBlock(state, 1) // two slots earned
    const poured = pour(state, 0, 1)
    expect(poured.tubes[1].colors).toEqual([1, 1])
    expect(poured.tubes[1].open).toBe(2)
    expect(pour(poured, 0, 1)).toBe(poured) // full at its open count again
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

describe('hideBlocks (ticket 10)', () => {
  it('conceals the bottom units of the named tubes only', () => {
    const state = hideBlocks(createGame([[1, 2, 1, 2], [2, 2], []]), [0, 2])
    expect(state.tubes[0].hidden).toBe(4)
    expect(state.tubes[1].hidden).toBeUndefined()
    expect(state.tubes[2].hidden).toBeUndefined() // empty: nothing to hide
  })

  it('leaves the original state untouched', () => {
    const state = createGame([[1, 1], [2, 2]])
    const hidden = hideBlocks(state, [1])
    expect(state.tubes[1].hidden).toBeUndefined()
    expect(hidden.tubes[0]).toBe(state.tubes[0]) // untouched tubes are reused
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
