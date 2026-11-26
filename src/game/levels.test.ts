import { describe, expect, it } from 'vitest'
import {
  CLIMB_FROM,
  CLIMB_LAST,
  CLIMB_SCRAMBLE,
  EXPERT_FROM,
  EXTRA_SPARE_FROM,
  LATE_BOARD_MIN_MULTI,
  LEVELS,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  SCORE_MAX_STEPS,
  SCORE_PLAYOUTS,
  SHUFFLE_CANDIDATES,
  SHUFFLE_COLORS,
  SHUFFLE_FROM,
  SHUFFLE_FULL_FROM,
  SHUFFLE_MAX_DRAWS,
  SHUFFLE_MIX_ANCHORS,
  SHUFFLE_SPARES,
  SHUFFLE_TARGET_ANCHORS,
  SOLVE_NODE_BUDGET,
  SPARES_LOCK_FROM,
  hiddenTubeCount,
  levelConfig,
  shuffleMix,
  shuffleTarget,
} from './levels'
import { generateLevel } from './generator'
import { randomWinRate } from './difficulty'

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
  // Ticket 24: the playable ceiling drops to 11 colours from level 46 so the
  // appended spare is genuinely empty and can carry the padlock. 46–50 repeat
  // the five-step scramble cycle at 11 colours; 1–45 are unchanged.
  '11/2/38', '11/2/42', '11/2/46', '11/2/50', '11/2/54',
  // The back-loaded climb (ticket 21). Scramble holds at the unchanged gate's
  // ceiling — ticket 20 found 78 passes only 11/50 and 82+ passes 0/50 — so
  // concealment, not a longer scramble, is the ramp. Every token is pinned.
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
  '11/2/54', '11/2/54', '11/2/54', '11/2/54', '11/2/54',
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
]

describe('levels', () => {
  it('ships the validated 40-level curve, the expert tier and the climb', () => {
    expect(LEVELS.map((l) => `${l.colors}/${l.emptyTubes}/${l.scramble}`)).toEqual(
      CURVE.slice(0, LEVELS.length),
    )
    expect(LEVELS).toHaveLength(40) // the hand-tuned boards are never re-rolled
    // Ticket 25: the reverse-scrambled curve ends at 100 and is frozen; the
    // shuffled tier runs on to MAX_LEVEL.
    expect(CLIMB_LAST).toBe(100)
    expect(MAX_LEVEL).toBe(9999)
    expect(CURVE).toHaveLength(CLIMB_LAST)
    expect(CLIMB_FROM).toBe(51)
    expect(CLIMB_SCRAMBLE).toBe(54)
    expect(LATE_BOARD_MIN_MULTI).toBe(11)
  })

  it('derives levels past the table from the level number', () => {
    expect(EXPERT_FROM).toBe(LEVELS.length + 1)
    expect(levelConfig(41)).toEqual({ colors: 11, emptyTubes: 2, scramble: 38 })
    expect(levelConfig(45)).toEqual({ colors: 11, emptyTubes: 2, scramble: 54 })
    // Ticket 24: 11 colours from 46, so the appended spare is empty.
    expect(levelConfig(46)).toEqual({ colors: 11, emptyTubes: 2, scramble: 38 })
    expect(levelConfig(50)).toEqual({ colors: 11, emptyTubes: 2, scramble: 54 })
    // The climb starts where level 50 ended and never grows the board.
    expect(levelConfig(51)).toEqual({ colors: 11, emptyTubes: 2, scramble: 54 })
    expect(levelConfig(100)).toEqual({ colors: 11, emptyTubes: 2, scramble: 54 })
    expect(levelConfig(MAX_LEVEL + 10)).toEqual(levelConfig(MAX_LEVEL)) // clamped
  })

  it('holds the expert tier at eleven colours, then fixes the climb scramble', () => {
    for (let level = EXPERT_FROM; level < CLIMB_FROM; level++) {
      const config = levelConfig(level)
      // 41–45 already sat at 11; 46 is where the ceiling binds for good.
      expect(config.colors, `level ${level}`).toBe(11)
      expect(config.scramble, `level ${level}`).toBe(38 + ((level - EXPERT_FROM) % 5) * 4)
      expect(config.emptyTubes, `level ${level}`).toBe(2)
      // Generated tubes leave room for the appended spare under two rows.
      expect(config.colors + config.emptyTubes).toBeLessThan(MAX_TWO_ROW_TUBES)
    }
    for (let level = CLIMB_FROM; level <= CLIMB_LAST; level++) {
      const config = levelConfig(level)
      expect(config.colors, `level ${level}`).toBe(11)
      expect(config.scramble, `level ${level}`).toBe(CLIMB_SCRAMBLE)
      expect(config.emptyTubes, `level ${level}`).toBe(2)
      expect(config.colors + config.emptyTubes + 1).toBe(MAX_TWO_ROW_TUBES)
    }
  })

  it('climbs concealment back-loaded from 3 to 11, derived from the level', () => {
    expect(hiddenTubeCount(40)).toBe(2)
    expect(hiddenTubeCount(EXPERT_FROM)).toBe(3)
    expect(hiddenTubeCount(50)).toBe(3)
    // The four anchors, pinned individually so a formula edit is visible.
    expect(hiddenTubeCount(51)).toBe(3)
    expect(hiddenTubeCount(70)).toBe(5)
    expect(hiddenTubeCount(85)).toBe(9)
    expect(hiddenTubeCount(100)).toBe(11)
    expect(hiddenTubeCount(MAX_LEVEL)).toBe(11)

    let previous = hiddenTubeCount(50)
    for (let level = CLIMB_FROM; level <= CLIMB_LAST; level++) {
      const count = hiddenTubeCount(level)
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(previous)
      expect(count, `level ${level}`).toBeLessThanOrEqual(LATE_BOARD_MIN_MULTI)
      previous = count
    }
  })

  it('appends the guaranteed spare from level 30 (ticket 18)', () => {
    // A content pin: moving this changes which levels show a padlock. The
    // generated curve above is untouched by it.
    expect(EXTRA_SPARE_FROM).toBe(30)
    expect(EXTRA_SPARE_FROM).toBeGreaterThanOrEqual(SPARES_LOCK_FROM)
    expect(EXTRA_SPARE_FROM).toBeLessThanOrEqual(MAX_LEVEL)
  })

  it('never removes a spare tube and never jumps backwards in colour', () => {
    for (let level = 1; level <= CLIMB_LAST; level++) {
      const config = levelConfig(level)
      expect(config.emptyTubes, `level ${level}`).toBe(2)
      if (level > 1) {
        expect(config.colors, `level ${level}`).toBeGreaterThanOrEqual(
          levelConfig(level - 1).colors,
        )
      }
    }
  })

  it('raises the scramble within a colour tier up to the gate ceiling', () => {
    // The hand-tuned tiers start below the last and rise level by level.
    for (let level = 2; level <= LEVELS.length; level++) {
      const current = levelConfig(level)
      const previous = levelConfig(level - 1)
      if (current.colors === previous.colors) {
        expect(current.scramble, `level ${level}`).toBeGreaterThan(previous.scramble)
      }
    }
    // The derived tier has no colour step left at 46 (ticket 24), so it runs
    // the same five-step cycle twice — 38…54 — restarting at 46 rather than
    // raising the scramble past the gate's ceiling. From 51 the climb holds.
    for (let level = EXPERT_FROM; level < CLIMB_FROM; level++) {
      const current = levelConfig(level)
      const previous = levelConfig(level - 1)
      expect(current.scramble, `level ${level}`).toBe(38 + ((level - EXPERT_FROM) % 5) * 4)
      if ((level - EXPERT_FROM) % 5 === 0) {
        expect(current.scramble, `level ${level} restarts the cycle`).toBeLessThan(
          previous.scramble,
        )
      } else {
        expect(current.scramble, `level ${level}`).toBeGreaterThan(previous.scramble)
      }
    }
  })

  it('adds one colour at a time, below the previous tier end', () => {
    for (let level = 2; level <= CLIMB_LAST; level++) {
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

/**
 * The shuffled tier's ramp (ticket 25). Every constant is pinned: a change
 * re-rolls boards people may have played, so it is a content decision.
 * Calibrated by the ticket-25 probe over levels 101–1000, recorded in the
 * ticket: shipped 51–100 median random-win 0.635, full shuffle about 0.03.
 */
describe('shuffled tier ramp', () => {
  it('pins the shuffled tier constants', () => {
    expect(SHUFFLE_FROM).toBe(101)
    expect(SHUFFLE_FROM).toBe(CLIMB_LAST + 1)
    expect(SHUFFLE_COLORS).toBe(11)
    expect(SHUFFLE_SPARES).toBe(2)
    expect(SHUFFLE_COLORS + SHUFFLE_SPARES + 1).toBe(MAX_TWO_ROW_TUBES)
    expect(SHUFFLE_TARGET_ANCHORS).toEqual([
      [101, 0.5],
      [400, 0.03],
      [600, 0.015],
    ])
    expect(SHUFFLE_MIX_ANCHORS).toEqual([
      [101, 9],
      [400, 24],
    ])
    expect(SHUFFLE_FULL_FROM).toBe(400)
    expect(SHUFFLE_CANDIDATES).toBe(6)
    expect(SHUFFLE_MAX_DRAWS).toBe(256)
    expect(SCORE_PLAYOUTS).toBe(100)
    expect(SCORE_MAX_STEPS).toBe(300)
    expect(SOLVE_NODE_BUDGET).toBe(5000)
  })

  it('keeps the shuffled tier on the climb config for its fallback and board shape', () => {
    // levelConfig past 100 is the level-100 reverse config: the fallback the
    // generator uses if no candidate solves, and the 11/2 board shape.
    expect(levelConfig(SHUFFLE_FROM)).toEqual(levelConfig(CLIMB_LAST))
    expect(levelConfig(MAX_LEVEL)).toEqual(levelConfig(CLIMB_LAST))
    expect(hiddenTubeCount(SHUFFLE_FROM)).toBe(11)
    expect(hiddenTubeCount(MAX_LEVEL)).toBe(11)
  })

  it('lowers the target win rate monotonically to the plateau, then holds', () => {
    expect(shuffleTarget(SHUFFLE_FROM)).toBe(0.5)
    expect(shuffleTarget(400)).toBeCloseTo(0.03, 10)
    expect(shuffleTarget(600)).toBeCloseTo(0.015, 10)
    let previous = shuffleTarget(SHUFFLE_FROM)
    for (let level = SHUFFLE_FROM + 1; level <= 1200; level++) {
      const target = shuffleTarget(level)
      expect(target, `level ${level}`).toBeLessThanOrEqual(previous)
      if (level <= 600) expect(target, `level ${level}`).toBeLessThan(previous)
      previous = target
    }
    expect(shuffleTarget(MAX_LEVEL)).toBe(shuffleTarget(600))
  })

  it('raises the mix with the level, then switches to a full shuffle', () => {
    expect(shuffleMix(SHUFFLE_FROM)).toBe(9)
    expect(shuffleMix(SHUFFLE_FULL_FROM - 1)).toBe(24)
    let previous = 0
    for (let level = SHUFFLE_FROM; level < SHUFFLE_FULL_FROM; level++) {
      const mix = shuffleMix(level) as number
      expect(mix, `level ${level}`).toBeGreaterThanOrEqual(previous)
      previous = mix
    }
    expect(shuffleMix(SHUFFLE_FULL_FROM)).toBeNull()
    expect(shuffleMix(MAX_LEVEL)).toBeNull()
  })

  it('measures sampled boards close to the target', () => {
    // An independent re-measure (1000 playouts, a different seed from the
    // build's) of ten-level windows. The probe recorded window medians within
    // a log ratio of 0.55 of the target; the tolerance is a factor of two.
    // Scores below 1% are floored there, where playouts cannot resolve them.
    const TOLERANCE = Math.log(2)
    const floor = 0.01
    for (const start of [101, 200, 300, 400, 600, 1000]) {
      const scores: number[] = []
      const targets: number[] = []
      for (let level = start; level < start + 10; level++) {
        const { board } = generateLevel(level)
        scores.push(randomWinRate(board, { playouts: 1000, maxSteps: 300, seed: 0xabc + level }))
        targets.push(shuffleTarget(level))
      }
      const median = (values: number[]): number =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
      const ratio = Math.log(Math.max(median(scores), floor) / Math.max(median(targets), floor))
      expect(Math.abs(ratio), `window from ${start}`).toBeLessThanOrEqual(TOLERANCE)
    }
  })
})
