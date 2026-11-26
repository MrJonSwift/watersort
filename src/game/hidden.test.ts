import { describe, expect, it } from 'vitest'
import { pickHiddenTubes } from './hidden'
import { HIDDEN_FROM, hiddenTubeCount } from './levels'
import { generateLevel } from './generator'
import { addExtraSpare, createGame, hideBlocks, sealSpares } from './state'
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
    // Ticket 17's tiers keep two concealed tubes: the extra colours and the
    // wider board are the difficulty step, not a change to concealment.
    expect(hiddenTubeCount(31)).toBe(2)
    expect(hiddenTubeCount(40)).toBe(2)
    // The derived expert tier adds a third concealed tube on top of its
    // longer scrambles (ticket 19).
    expect(hiddenTubeCount(41)).toBe(3)
    expect(hiddenTubeCount(50)).toBe(3)
  })

  it('climbs back-loaded through the anchors, monotonic and never above 11', () => {
    expect(hiddenTubeCount(51)).toBe(3)
    expect(hiddenTubeCount(70)).toBe(5)
    expect(hiddenTubeCount(85)).toBe(9)
    expect(hiddenTubeCount(100)).toBe(11)
    let previous = hiddenTubeCount(50)
    for (let level = 51; level <= 100; level++) {
      const count = hiddenTubeCount(level)
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(previous)
      expect(count, `level ${level}`).toBeLessThanOrEqual(11)
      previous = count
    }
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

  it('picks only tubes holding two or more units (ticket 13), however the board is laid out', () => {
    const picks = pickHiddenTubes(20, board)
    expect(picks).toEqual(picks.filter((index) => board[index].colors.length > 1))
    expect(picks).not.toContain(1) // one unit: the top would be seen, nothing to hide
    expect(picks).not.toContain(2) // empty
    expect(picks).not.toContain(4) // empty
  })

  it('asks for the level count and never repeats a tube', () => {
    const picks = pickHiddenTubes(20, board)
    expect(picks).toHaveLength(hiddenTubeCount(20))
    expect(new Set(picks).size).toBe(picks.length)
  })

  it('picks nothing when every tube would conceal nothing', () => {
    expect(pickHiddenTubes(20, [tube(1), tube(2), tube(3)])).toEqual([])
  })

  it('takes every candidate when the board cannot supply the count', () => {
    expect(pickHiddenTubes(20, [tube(1, 1), tube()])).toEqual([0])
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
    // Re-pinned in ticket 29, when every level moved onto one generator.
    expect(pickHiddenTubes(15, realTubes(15))).toEqual([3])
    expect(pickHiddenTubes(20, realTubes(20))).toEqual([2,  1])
    expect(pickHiddenTubes(31, realTubes(31))).toEqual([2,  1])
    expect(pickHiddenTubes(40, realTubes(40))).toEqual([7,  3])
    expect(pickHiddenTubes(41, realTubes(41))).toEqual([7,  9,  4])
    expect(pickHiddenTubes(45, realTubes(45))).toEqual([10,  5,  8])
    expect(pickHiddenTubes(46, realTubes(46))).toEqual([5,  3,  2])
    expect(pickHiddenTubes(50, realTubes(50))).toEqual([6,  1,  5])
  })

  it('pins the picks at each anchor of the climb', () => {
    // Four anchors of the 3→11 schedule, on the actual boards, so a generator
    // change cannot silently move them.
    expect(pickHiddenTubes(51, realTubes(51))).toEqual([3,  7,  6])
    expect(pickHiddenTubes(70, realTubes(70))).toEqual([4,  10,  5,  7,  3])
    expect(pickHiddenTubes(85, realTubes(85))).toEqual([5,  0,  3,  9,  6,  1,  10,  2,  7])
    expect(pickHiddenTubes(100, realTubes(100))).toEqual([9,  6,  2,  5,  8,  4,  10,  1,  7,  0,  3])
  })

  it('hosts every configured vial on every climb level, with its top revealed', () => {
    // The four anchors above pin the hash picks; this closes the content gate
    // over the whole tier: no level may ask for more concealed vials than its
    // board can supply, and every pick must leave a seen top above its secrets.
    for (let level = 51; level <= 100; level++) {
      const tubes = realTubes(level)
      const picks = pickHiddenTubes(level, tubes)
      expect(picks, `level ${level} host count`).toHaveLength(hiddenTubeCount(level))
      for (const index of picks) {
        // More than one unit guarantees a revealed top plus at least one
        // hidden block; a one-unit tube would conceal nothing (ticket 13).
        expect(tubes[index].colors.length, `level ${level} tube ${index} units`).toBeGreaterThan(1)
      }
      const concealed = hideBlocks(createGame(tubes.map((t) => [...t.colors])), picks)
      for (const index of picks) {
        expect(concealed.tubes[index].hidden, `level ${level} tube ${index} hidden`).toBe(
          concealed.tubes[index].colors.length - 1,
        )
      }
    }
  })

  it('never hides the late padlock: it is an empty spare', () => {
    // Ticket 24: from level 51 the padlock sits on the empty appended spare,
    // which has nothing to conceal, so it is never a candidate nor a ? vial.
    for (const level of [51, 100]) {
      const { board, solution } = generateLevel(level)
      const withSpare = addExtraSpare(createGame(board))
      const appended = withSpare.tubes.length - 1
      const sealed = sealSpares(withSpare, solution, appended).tubes
      expect(sealed[appended], `level ${level} lock`).toEqual({ colors: [], open: 0 })

      const picks = pickHiddenTubes(level, sealed)
      expect(picks, `level ${level} lock is not hidden`).not.toContain(appended)
      for (const index of picks) {
        expect(sealed[index].colors.length, `level ${level} pick ${index} holds colour`).toBeGreaterThan(1)
      }
    }
  })

  it('hides all eleven colour tubes at level 100', () => {
    const level = generateLevel(100)
    const tubes = level.board.map((colors) => ({ colors }))
    const candidates = tubes.filter((tube) => tube.colors.length > 1)
    expect(candidates).toHaveLength(11)

    const picks = pickHiddenTubes(100, tubes)
    expect(picks).toHaveLength(11)
    expect(new Set(picks).size).toBe(11)
    // The appended spare is not part of the generated board, and an empty tube
    // can conceal nothing, so every pick is a colour-bearing vial.
    expect(picks.every((index) => tubes[index].colors.length > 1)).toBe(true)
  })
})
