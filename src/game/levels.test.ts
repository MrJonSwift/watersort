import { describe, expect, it } from 'vitest'
import {
  EXPERT_FROM,
  EXTRA_SPARE_FROM,
  LEVELS,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  SPARES_LOCK_FROM,
  hiddenTubeCount,
  levelConfig,
} from './levels'

/**
 * The validated curve as `colours/spare/scramble`. This is the contract the
 * family plays: a change to any token is a difficulty change and belongs in
 * the ticket, not in a drive-by edit.
 */
const CURVE = [
  '3/2/6', '3/2/8', '3/2/10',
  '4/2/8', '4/2/10', '4/2/12',
  '5/2/10', '5/2/12', '5/2/14', '5/2/16',
  '6/2/12', '6/2/14', '6/2/16', '6/2/18',
  '7/2/14', '7/2/16', '7/2/18', '7/2/20', '7/2/22',
  '8/2/16', '8/2/18', '8/2/20', '8/2/22', '8/2/24', '8/2/26', '8/2/28',
  '8/2/30', '8/2/32', '8/2/34', '8/2/36',
  '9/2/22', '9/2/26', '9/2/30', '9/2/34', '9/2/38',
  '10/2/24', '10/2/28', '10/2/32', '10/2/36', '10/2/40',
  '11/2/38', '11/2/42', '11/2/46', '11/2/50', '11/2/54',
  '12/2/38', '12/2/42', '12/2/46', '12/2/50', '12/2/54',
]

/** The level that first adds a colour, and the tubes it starts with. */
const TIERS: Array<[level: number, tubes: number]> = [
  [1, 5],
  [4, 6],
  [7, 7],
  [11, 8],
  [15, 9],
  [20, 10],
  [31, 11],
  [36, 12],
  [41, 13],
  [46, 14],
]

describe('levels', () => {
  it('ships the validated 40-level curve plus the derived expert tier', () => {
    expect(LEVELS.map((l) => `${l.colors}/${l.emptyTubes}/${l.scramble}`)).toEqual(
      CURVE.slice(0, LEVELS.length),
    )
    expect(LEVELS).toHaveLength(40) // the hand-tuned boards are never re-rolled
    expect(MAX_LEVEL).toBe(50)
    expect(CURVE).toHaveLength(MAX_LEVEL)
  })

  it('derives levels past the table from the level number', () => {
    expect(EXPERT_FROM).toBe(LEVELS.length + 1)
    expect(levelConfig(41)).toEqual({ colors: 11, emptyTubes: 2, scramble: 38 })
    expect(levelConfig(45)).toEqual({ colors: 11, emptyTubes: 2, scramble: 54 })
    expect(levelConfig(46)).toEqual({ colors: 12, emptyTubes: 2, scramble: 38 })
    expect(levelConfig(50)).toEqual({ colors: 12, emptyTubes: 2, scramble: 54 })
    expect(levelConfig(99)).toEqual(levelConfig(MAX_LEVEL)) // clamped, then derived
  })

  it('steps the expert tier up to the phone ceiling, then rides the scramble', () => {
    for (let level = EXPERT_FROM; level <= MAX_LEVEL; level++) {
      const config = levelConfig(level)
      const expectedColors = Math.min(12, 11 + Math.floor((level - EXPERT_FROM) / 5))
      const expectedScramble = 38 + ((level - EXPERT_FROM) % 5) * 4
      expect(config.colors, `level ${level}`).toBe(expectedColors)
      expect(config.scramble, `level ${level}`).toBe(expectedScramble)
      expect(config.emptyTubes, `level ${level}`).toBe(2)
      // The colour count and the two spares together never outgrow two rows.
      expect(config.colors + config.emptyTubes).toBeLessThanOrEqual(MAX_TWO_ROW_TUBES)
    }
  })

  it('raises concealment to three tubes on the expert tier', () => {
    expect(hiddenTubeCount(40)).toBe(2)
    expect(hiddenTubeCount(EXPERT_FROM)).toBe(3)
    expect(hiddenTubeCount(MAX_LEVEL)).toBe(3)
  })

  it('appends the guaranteed spare from level 30 (ticket 18)', () => {
    // A content pin: moving this changes which levels show a padlock. The
    // generated curve above is untouched by it.
    expect(EXTRA_SPARE_FROM).toBe(30)
    expect(EXTRA_SPARE_FROM).toBeGreaterThanOrEqual(SPARES_LOCK_FROM)
    expect(EXTRA_SPARE_FROM).toBeLessThanOrEqual(MAX_LEVEL)
  })

  it('never removes a spare tube and never jumps backwards in colour', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const config = levelConfig(level)
      expect(config.emptyTubes, `level ${level}`).toBe(2)
      if (level > 1) {
        expect(config.colors, `level ${level}`).toBeGreaterThanOrEqual(
          levelConfig(level - 1).colors,
        )
      }
    }
  })

  it('raises the scramble within a colour tier', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const current = levelConfig(level)
      const previous = levelConfig(level - 1)
      if (current.colors === previous.colors) {
        expect(current.scramble, `level ${level}`).toBeGreaterThan(previous.scramble)
      }
    }
  })

  it('adds one colour at a time, below the previous tier end', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const current = levelConfig(level)
      const previous = levelConfig(level - 1)
      if (current.colors > previous.colors) {
        expect(current.colors, `level ${level}`).toBe(previous.colors + 1)
        expect(current.scramble, `level ${level}`).toBeLessThan(previous.scramble)
      }
    }
  })

  it('grows the tube count on the documented levels', () => {
    for (const [level, tubes] of TIERS) {
      const config = levelConfig(level)
      expect(config.colors + config.emptyTubes).toBe(tubes)
    }
  })

  it('clamps out-of-range levels into the table', () => {
    expect(levelConfig(0)).toBe(LEVELS[0])
    expect(levelConfig(-3)).toBe(LEVELS[0])
    expect(levelConfig(MAX_LEVEL + 10)).toEqual(levelConfig(MAX_LEVEL))
  })

  it('truncates fractional levels', () => {
    expect(levelConfig(2.9)).toBe(LEVELS[1])
  })
})
