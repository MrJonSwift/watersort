import { describe, expect, it } from 'vitest'
import { createGame, growBlock, sealSpares, tap, undo } from './state'
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
