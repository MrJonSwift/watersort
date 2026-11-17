import { describe, expect, it } from 'vitest'
import {
  canGrow,
  canPour,
  isFull,
  isWon,
  openSlots,
  pour,
  pourAmount,
  topRun,
} from './rules'
import { createGame, tap, undo } from './state'
import type { ColorId, Tube } from './types'

/** Build a Tube for the pure rule helpers. */
const tube = (...colors: ColorId[]): Tube => ({ colors })

/** Build a Tube with a limited open slot count (a partly grown spare). */
const spare = (open: number, ...colors: ColorId[]): Tube => ({ colors, open })

/** Build a board of color arrays for createGame. */
const board = (...tubes: ColorId[][]): ColorId[][] => tubes

describe('topRun', () => {
  it('counts equal colors at the top only', () => {
    expect(topRun(tube(1, 2, 2))).toBe(2)
    expect(topRun(tube(1, 1, 2))).toBe(1)
    expect(topRun(tube())).toBe(0)
  })
})

describe('canPour', () => {
  it('rejects pouring into a full tube', () => {
    expect(canPour([tube(1), tube(1, 1, 1, 1)], 0, 1, 4)).toBe(false)
  })

  it('rejects pouring onto a different color', () => {
    expect(canPour([tube(1), tube(2)], 0, 1, 4)).toBe(false)
  })

  it('allows pouring onto an empty tube', () => {
    expect(canPour([tube(1), tube()], 0, 1, 4)).toBe(true)
  })

  it('rejects pouring from an empty tube', () => {
    expect(canPour([tube(), tube()], 0, 1, 4)).toBe(false)
  })

  it('rejects pouring a tube into itself', () => {
    expect(canPour([tube(1, 1)], 0, 0, 4)).toBe(false)
  })
})

describe('pourAmount', () => {
  it('moves the whole top run when there is room', () => {
    expect(pourAmount([tube(1, 2, 2, 2), tube()], 0, 1, 4)).toBe(3)
  })

  it('moves only as many units as fit', () => {
    expect(pourAmount([tube(2, 2, 2), tube(2, 2)], 0, 1, 4)).toBe(2)
  })
})

describe('pour', () => {
  it('is immutable and records history', () => {
    const state = createGame(board([1, 1], []))
    const next = pour(state, 0, 1)

    expect(state.tubes[0].colors).toEqual([1, 1])
    expect(next.tubes[0].colors).toEqual([])
    expect(next.tubes[1].colors).toEqual([1, 1])
    expect(next.moves).toBe(1)
    expect(next.history).toEqual([{ from: 0, to: 1, amount: 2 }])
  })

  it('detects a win', () => {
    const state = createGame(board([1, 1], [1, 1]))
    expect(isWon(state)).toBe(false)

    const next = pour(state, 0, 1)
    expect(next.tubes[1].colors).toEqual([1, 1, 1, 1])
    expect(next.won).toBe(true)
  })

  it('ignores illegal pours', () => {
    const state = createGame(board([1], [2]))
    expect(pour(state, 0, 1)).toBe(state)
  })
})

describe('tap', () => {
  it('selects a tube, then pours on the next tap', () => {
    let state = createGame(board([1, 1], []))
    state = tap(state, 0)
    expect(state.selected).toBe(0)

    state = tap(state, 1)
    expect(state.selected).toBeNull()
    expect(state.tubes[1].colors).toEqual([1, 1])
  })

  it('deselects when tapping the selected tube again', () => {
    let state = createGame(board([1], []))
    state = tap(state, 0)
    state = tap(state, 0)
    expect(state.selected).toBeNull()
  })

  it('ignores taps on empty tubes', () => {
    const state = createGame(board([], []))
    expect(tap(state, 0)).toBe(state)
  })
})

describe('undo', () => {
  it('reverses the most recent pour', () => {
    let state = createGame(board([1, 1], []))
    state = tap(state, 0)
    state = tap(state, 1)
    state = undo(state)

    expect(state.tubes[0].colors).toEqual([1, 1])
    expect(state.tubes[1].colors).toEqual([])
    expect(state.moves).toBe(0)
    expect(state.history).toEqual([])
  })

  it('is a no-op when there is nothing to undo', () => {
    const state = createGame(board([1], []))
    expect(undo(state)).toBe(state)
  })
})

describe('open slots (locked spares)', () => {
  it('reads undefined as fully open and honours an explicit count', () => {
    expect(openSlots(tube(), 4)).toBe(4)
    expect(openSlots(spare(2), 4)).toBe(2)
    expect(openSlots(spare(0), 4)).toBe(0)
  })

  it('treats a sealed or partly open tube as full at its open count', () => {
    expect(isFull(spare(0), 4)).toBe(true)
    expect(isFull(spare(2, 1, 1), 4)).toBe(true)
    expect(isFull(spare(2, 1), 4)).toBe(false)
  })

  it('limits pours into a partly open spare', () => {
    expect(canPour([tube(1, 1, 1), spare(2)], 0, 1, 4)).toBe(true)
    expect(pourAmount([tube(1, 1, 1), spare(2)], 0, 1, 4)).toBe(2)
    expect(canPour([tube(1, 1), spare(2, 1, 1)], 0, 1, 4)).toBe(false)
  })

  it('pour carries open slots through the copy', () => {
    const game = createGame(board([1, 1, 1], []))
    const opened = { ...game, tubes: [game.tubes[0], spare(2)] }
    const next = pour(opened, 0, 1)

    expect(next.tubes[1].open).toBe(2)
    expect(next.tubes[1].colors).toEqual([1, 1])
    expect(next.tubes[0].open).toBeUndefined()
  })

  it('a partly open spare is never complete and must be empty to win', () => {
    const fullOfOne = { ...createGame([]), tubes: [spare(2, 1, 1), tube()] }
    expect(isFull(fullOfOne.tubes[0], 4)).toBe(true)
    expect(isWon(fullOfOne)).toBe(false)

    const emptied = { ...fullOfOne, tubes: [spare(2), tube()] }
    expect(isWon(emptied)).toBe(true)
  })

  it('knows which tubes can still grow', () => {
    expect(canGrow(spare(0), 4)).toBe(true)
    expect(canGrow(spare(3), 4)).toBe(true)
    expect(canGrow(spare(4), 4)).toBe(false)
    expect(canGrow(spare(2, 1), 4)).toBe(false) // not empty
    expect(canGrow(tube(), 4)).toBe(false) // fully open
  })
})

describe('pour reveals concealed blocks (ticket 10)', () => {
  /** A tube with its bottom `hidden` units concealed. */
  const concealed = (hidden: number, ...colors: ColorId[]): Tube => ({ colors, hidden })

  it('reveals the poured units and the unit that surfaces beneath them', () => {
    // Fully concealed at deal is gone (ticket 13): a dealt hidden tube is
    // [1,2,2,2] with the top 2 seen and three units concealed. Pouring the
    // 2-run onto a half-full 2-tube shows both poured 2s in the stream, and
    // the third 2 surfaces to the top and is seen.
    const state = createGame([[1, 2, 2, 2], [2, 2]])
    const start = { ...state, tubes: [concealed(3, 1, 2, 2, 2), state.tubes[1]] }
    const next = pour(start, 0, 1)
    expect(next.tubes[0].colors).toEqual([1, 2])
    expect(next.tubes[0].hidden).toBe(1)
    expect(next.tubes[1].colors).toEqual([2, 2, 2, 2])
  })

  it('uncovers nothing when the pour stays inside the seen prefix', () => {
    // [1,2,2] with only the bottom 1 concealed: the one poured unit was
    // seen, and the top 2 remains above the concealed 1, which never
    // surfaces.
    const state = createGame([[1, 2, 2], [2, 2, 2]])
    const start = { ...state, tubes: [concealed(1, 1, 2, 2), state.tubes[1]] }
    const next = pour(start, 0, 1)
    expect(next.tubes[0].colors).toEqual([1, 2])
    expect(next.tubes[0].hidden).toBe(1) // untouched: the bottom 1 is still secret
  })

  it('reveals the last concealed unit only when it truly surfaces', () => {
    const state = createGame([[1, 1, 2], []])
    const start = { ...state, tubes: [concealed(2, 1, 1, 2), state.tubes[1]] }
    const next = pour(start, 0, 1)
    expect(next.tubes[0].colors).toEqual([1, 1])
    expect(next.tubes[0].hidden).toBe(1) // the 2 left; the top 1 surfaced
  })

  it('leaves the destination concealed: landed units are seen, the bottom is not', () => {
    const state = createGame([[2], [2, 2]])
    const start = {
      ...state,
      tubes: [state.tubes[0], concealed(2, 2, 2)],
    }
    const next = pour(start, 0, 1)
    expect(next.tubes[1].colors).toEqual([2, 2, 2])
    expect(next.tubes[1].hidden).toBe(2)
    expect(next.tubes[0].hidden).toBe(0) // emptied: nothing left to conceal
  })

  it('clears the count when a pour empties the tube', () => {
    const state = createGame([[1, 1], []])
    const start = { ...state, tubes: [concealed(2, 1, 1), state.tubes[1]] }
    const next = pour(start, 0, 1)
    expect(next.tubes[0].colors).toEqual([])
    expect(next.tubes[0].hidden).toBe(0)
  })

  it('carries the count through an ordinary pour unchanged', () => {
    const state = createGame([[1, 1], []])
    const start = { ...state, tubes: [concealed(1, 1, 1, 2), state.tubes[1]] }
    const next = pour(start, 0, 1)
    expect(next.tubes[0].colors).toEqual([1, 1])
    expect(next.tubes[0].hidden).toBe(1) // the poured 2 was seen; the bottom 1 stays
    expect(next.tubes[1].hidden).toBeUndefined()
  })
})
