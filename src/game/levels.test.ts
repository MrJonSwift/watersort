import { describe, expect, it } from 'vitest'
import {
  COLOR_TIERS,
  EXTRA_SPARE_FROM,
  FULL_SHUFFLE_FROM,
  HIDDEN_FROM,
  LEVEL_CANDIDATES,
  LEVEL_SPARES,
  MAX_DRAWS,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  MIX_ANCHORS,
  PADLOCK_USEFUL_FROM,
  PADLOCK_USEFUL_TARGET,
  SCORE_MAX_STEPS,
  SCORE_PLAYOUTS,
  SOLVE_NODE_BUDGET,
  TARGET_ANCHORS,
  clampLevel,
  hiddenTubeCount,
  levelColors,
  levelMix,
  levelTarget,
} from './levels'
import { generateLevel } from './generator'
import { randomWinRate } from './difficulty'

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

describe('level schedules', () => {
  it('pins the colour tiers: 3 colours at level 1 rising to 11 at 41', () => {
    // Unchanged by ticket 29: only the board underneath each level changed.
    expect(COLOR_TIERS).toEqual([
      [1, 3],
      [4, 4],
      [7, 5],
      [11, 6],
      [15, 7],
      [20, 8],
      [31, 9],
      [36, 10],
      [41, 11],
    ])
    expect(levelColors(1)).toBe(3)
    expect(levelColors(40)).toBe(10)
    expect(levelColors(41)).toBe(11)
    expect(levelColors(MAX_LEVEL)).toBe(11)
    let previous = 0
    for (let level = 1; level <= 200; level++) {
      const colors = levelColors(level)
      expect(colors - previous, `level ${level}`).toBeLessThanOrEqual(level === 1 ? 3 : 1)
      expect(colors).toBeGreaterThanOrEqual(previous)
      previous = colors
    }
  })

  it('keeps every board within two rows of seven, appended spare included', () => {
    expect(LEVEL_SPARES).toBe(2)
    expect(MAX_TWO_ROW_TUBES).toBe(14)
    expect(levelColors(MAX_LEVEL) + LEVEL_SPARES + 1).toBe(MAX_TWO_ROW_TUBES)
  })

  it('pins the feature schedules the player recognises', () => {
    expect(HIDDEN_FROM).toBe(15)
    expect(EXTRA_SPARE_FROM).toBe(30)
    const expected = (level: number): number => {
      if (level < 15) return 0
      if (level < 20) return 1
      if (level < 41) return 2
      if (level < 51) return 3
      return -1
    }
    for (let level = 1; level < 51; level++) {
      expect(hiddenTubeCount(level), `level ${level}`).toBe(expected(level))
    }
    // The climb anchors (ticket 21/24): 3 at 51, 5 by 70, 9 by 85, 11 at 100.
    expect(hiddenTubeCount(51)).toBe(3)
    expect(hiddenTubeCount(70)).toBe(5)
    expect(hiddenTubeCount(85)).toBe(9)
    expect(hiddenTubeCount(100)).toBe(11)
    expect(hiddenTubeCount(MAX_LEVEL)).toBe(11)
    let previous = 0
    for (let level = 1; level <= 200; level++) {
      const count = hiddenTubeCount(level)
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(previous)
      // Never more vials than tubes holding colour.
      expect(count).toBeLessThanOrEqual(levelColors(level))
      previous = count
    }
  })

  it('clamps and truncates level numbers', () => {
    expect(clampLevel(0)).toBe(1)
    expect(clampLevel(-3)).toBe(1)
    expect(clampLevel(2.9)).toBe(2)
    expect(clampLevel(Number.NaN)).toBe(1)
    expect(clampLevel(MAX_LEVEL + 5)).toBe(MAX_LEVEL)
    expect(MAX_LEVEL).toBe(9999)
  })
})

describe('one ramp from level 1', () => {
  it('pins the ramp constants (owner pick: the padlock is useful from 60)', () => {
    expect(PADLOCK_USEFUL_FROM).toBe(60)
    expect(PADLOCK_USEFUL_TARGET).toBe(0.25)
    expect(TARGET_ANCHORS).toEqual([
      [1, 1],
      [60, 0.25],
      [400, 0.03],
      [600, 0.015],
    ])
    expect(MIX_ANCHORS).toEqual([
      [1, 4],
      [60, 12],
      [400, 24],
    ])
    expect(FULL_SHUFFLE_FROM).toBe(400)
    expect(LEVEL_CANDIDATES).toBe(6)
    expect(MAX_DRAWS).toBe(256)
    expect(SCORE_PLAYOUTS).toBe(100)
    expect(SCORE_MAX_STEPS).toBe(300)
    expect(SOLVE_NODE_BUDGET).toBe(5000)
  })

  it('lowers the target monotonically from level 1 to the plateau, then holds', () => {
    expect(levelTarget(1)).toBe(1)
    expect(levelTarget(60)).toBeCloseTo(0.25, 10)
    expect(levelTarget(400)).toBeCloseTo(0.03, 10)
    expect(levelTarget(600)).toBeCloseTo(0.015, 10)
    let previous = levelTarget(1)
    for (let level = 2; level <= 1200; level++) {
      const target = levelTarget(level)
      expect(target, `level ${level}`).toBeLessThanOrEqual(previous)
      if (level <= 600) expect(target, `level ${level}`).toBeLessThan(previous)
      previous = target
    }
    expect(levelTarget(MAX_LEVEL)).toBe(levelTarget(600))
  })

  it('raises the mix with the level, never below colours + 1, then fully shuffles', () => {
    expect(levelMix(1)).toBe(4)
    expect(levelMix(60)).toBe(12)
    expect(levelMix(FULL_SHUFFLE_FROM - 1)).toBe(24)
    let previous = 0
    for (let level = 1; level < FULL_SHUFFLE_FROM; level++) {
      const mix = levelMix(level) as number
      expect(mix, `level ${level}`).toBeGreaterThanOrEqual(previous)
      expect(mix, `level ${level}`).toBeGreaterThan(levelColors(level))
      previous = mix
    }
    expect(levelMix(FULL_SHUFFLE_FROM)).toBeNull()
    expect(levelMix(MAX_LEVEL)).toBeNull()
  })

  // An independent re-measure: 1000 playouts, a different seed from the build's.
  const measure = (board: number[][]): number =>
    randomWinRate(board, { playouts: 1000, maxSteps: 300, seed: 0xabc })

  it('keeps levels 1–4 near-certain wins', () => {
    for (let level = 1; level <= 4; level++) {
      expect(measure(generateLevel(level).board), `level ${level}`).toBeGreaterThanOrEqual(0.95)
    }
  })

  it('measures sampled windows close to the target', () => {
    // Ten-level window medians against the target median. The probe recorded
    // log ratios within 0.4 from level 20 on; the tolerance is a factor of two.
    // Below 20 the small boards cannot get as hard as the target (a 3–7
    // colour board is easy however it is mixed), so that stretch only has to
    // be at least as easy as the target. Scores below 1% are floored, where
    // playouts cannot resolve them.
    const floor = 0.01
    for (const start of [1, 11, 20, 40, 60, 100, 200, 300, 400, 600, 1000]) {
      const scores: number[] = []
      const targets: number[] = []
      for (let level = start; level < start + 10; level++) {
        scores.push(measure(generateLevel(level).board))
        targets.push(levelTarget(level))
      }
      const ratio = Math.log(Math.max(median(scores), floor) / Math.max(median(targets), floor))
      if (start < 20) expect(ratio, `window from ${start}`).toBeGreaterThanOrEqual(-Math.log(2))
      else expect(Math.abs(ratio), `window from ${start}`).toBeLessThanOrEqual(Math.log(2))
    }
  })
})

describe('padlock balance (decision 31, half 2)', () => {
  it('from level 60, a stuck tapper is common sealed and rescued by the padlock', () => {
    // Windows from the agreed level: the median sealed score is at or below
    // the agreed ceiling, and opening the padlocked spare (one more empty
    // tube) lifts the median by at least the agreed amount. The probe recorded
    // sealed medians of 0.18–0.26 over 60–119 with opened medians of 0.86+;
    // the ceiling allows a 1.4× margin on the 0.25 target and the lift asks
    // for half the recorded gap.
    const CEILING = 0.35
    const MIN_LIFT = 0.3
    const MIN_RATIO = 2
    for (const start of [60, 100, 200, 400, 1000]) {
      const sealed: number[] = []
      const open: number[] = []
      for (let level = start; level < start + 10; level++) {
        const { board } = generateLevel(level)
        const options = { playouts: 400, maxSteps: 300, seed: 0xabc + level }
        sealed.push(randomWinRate(board, options))
        open.push(randomWinRate([...board, []], options))
      }
      const s = median(sealed)
      const o = median(open)
      expect(s, `window from ${start} sealed`).toBeLessThanOrEqual(CEILING)
      expect(o - s, `window from ${start} lift`).toBeGreaterThanOrEqual(MIN_LIFT)
      expect(o / Math.max(s, 0.01), `window from ${start} ratio`).toBeGreaterThanOrEqual(MIN_RATIO)
    }
  })

  it('before the padlock appears, levels stay easier than the agreed point', () => {
    const sealed: number[] = []
    for (let level = 20; level < 30; level++) {
      sealed.push(randomWinRate(generateLevel(level).board, { playouts: 400, maxSteps: 300, seed: 0xabc + level }))
    }
    expect(median(sealed)).toBeGreaterThan(PADLOCK_USEFUL_TARGET)
  })
})
