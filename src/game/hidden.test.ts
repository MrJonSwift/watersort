import { describe, expect, it } from 'vitest'
import { pickHiddenTubes } from './hidden'
import { HIDDEN_FROM, hiddenTubeCount } from './levels'
import { generateLevel } from './generator'
import { createGame } from './state'
import type { Tube } from './types'

const tube = (...colors: number[]): Tube => ({ colors })

/** The real board of a level, as the session sees it. */
const realTubes = (level: number): Tube[] => createGame(generateLevel(level).board).tubes

describe('hiddenTubeCount', () => {
  it('is zero below HIDDEN_FROM, one on the 7-colour tier, two on the last', () => {
    expect(hiddenTubeCount(HIDDEN_FROM - 1)).toBe(0)
    expect(hiddenTubeCount(HIDDEN_FROM)).toBe(1)
    expect(hiddenTubeCount(HIDDEN_FROM + 4)).toBe(1)
    expect(hiddenTubeCount(20)).toBe(2)
    expect(hiddenTubeCount(30)).toBe(2)
  })

  it('never asks a sub-1 level for hidden tubes', () => {
    expect(hiddenTubeCount(0)).toBe(0)
    expect(hiddenTubeCount(-3)).toBe(0)
  })
})

describe('pickHiddenTubes', () => {
  const board = [tube(1, 2, 1, 2), tube(2), tube(), tube(3, 3), tube()]

  it('is deterministic for the same level and board', () => {
    expect(pickHiddenTubes(15, board)).toEqual(pickHiddenTubes(15, board))
    expect(pickHiddenTubes(20, board)).toEqual(pickHiddenTubes(20, board))
  })

  it('picks only tubes that hold colours, however the board is laid out', () => {
    const picks = pickHiddenTubes(20, board)
    expect(picks).toEqual(picks.filter((index) => board[index].colors.length > 0))
    expect(picks).not.toContain(2) // empty
    expect(picks).not.toContain(4) // empty
  })

  it('asks for the level count and never repeats a tube', () => {
    const picks = pickHiddenTubes(20, board)
    expect(picks).toHaveLength(hiddenTubeCount(20))
    expect(new Set(picks).size).toBe(picks.length)
  })

  it('takes every candidate when the board cannot supply the count', () => {
    expect(pickHiddenTubes(20, [tube(1), tube()])).toEqual([0])
  })

  it('asks for nothing below the tier, whatever the board looks like', () => {
    expect(pickHiddenTubes(1, board)).toEqual([])
  })

  it('spreads the pick across the board instead of always the first tube', () => {
    const tenTubes = Array.from({ length: 10 }, (_, i) => tube(i % 4, i % 4))
    const picks = pickHiddenTubes(20, tenTubes)
    expect(picks).toHaveLength(2)
    expect(picks[0]).not.toBe(picks[1])
    // Not pinned to the front of the board: the same level must not always
    // hide tube 1 just because it is first.
    expect(picks).not.toEqual([0, 1])
  })
})

describe('per-level pick (integration pin)', () => {
  it('hides the same tubes of the real boards on every device', () => {
    // Same level, same board, same pick: a re-roll of either the generator or
    // the pick shows up here and must be a deliberate content decision.
    expect(pickHiddenTubes(15, realTubes(15))).toEqual([4])
    expect(pickHiddenTubes(20, realTubes(20))).toEqual([1, 9])
  })
})
