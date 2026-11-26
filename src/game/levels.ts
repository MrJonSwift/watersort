/**
 * The numbered difficulty curve (ticket 29: one generator for every level).
 *
 * Every level is a seeded shuffle of full colour tubes plus two empty spares,
 * proven solvable by the bundled solver and chosen by its measured difficulty
 * (`generator.ts`, `difficulty.ts`). What changes with the level number is
 * only: how many colours (`levelColors`), how mixed the board starts
 * (`levelMix`), which random-win rate the kept board aims for
 * (`levelTarget`), and the feature schedules the player recognises
 * (concealment from `HIDDEN_FROM`, the padlocked spare from
 * `EXTRA_SPARE_FROM`). Everything is derived from the level number; there is
 * no per-level table. Capacity is a rule (`rules.ts`), not difficulty.
 */

/**
 * The last level people can reach. Boards are bounded by the phone (see
 * `MAX_TWO_ROW_TUBES`), so "unbounded" means in level number, not board size:
 * past the colour ceiling the ramp climbs through how mixed the board is, then
 * holds on a plateau.
 */
export const MAX_LEVEL = 9999

/**
 * The colour tiers: from each listed level the board has that many colours.
 * Three colours at level 1 rising to the playable ceiling of 11 at 41
 * (ticket 24, decision 25): at 11 colours the generated board is 13 tubes, so
 * the appended padlocked spare still fits under the 14-tube ceiling.
 */
export const COLOR_TIERS: readonly (readonly [fromLevel: number, colors: number])[] = [
  [1, 3],
  [4, 4],
  [7, 5],
  [11, 6],
  [15, 7],
  [20, 8],
  [31, 9],
  [36, 10],
  [41, 11],
]

/** Generated empty spares on every board; the controller may append a third. */
export const LEVEL_SPARES = 2

/**
 * The most tubes that still fit in two rows of seven on a 360px phone (ticket
 * 17's wide layout). The controller uses this to decide whether the extra
 * spare from `EXTRA_SPARE_FROM` can be appended without forcing a third row.
 */
export const MAX_TWO_ROW_TUBES = 14

/**
 * The level from which the board carries one extra empty spare beyond the two
 * the generator makes (ticket 18), padlocked (ticket 24). It is appended
 * *after* generation, so the solver's solution never names it: the level is
 * always winnable with the padlock sealed and no question answered. It is the
 * only tube that is ever sealed. Moving this line is a content decision.
 */
export const EXTRA_SPARE_FROM = 30

/**
 * The level from which tubes start with hidden blocks (ticket 10). Moving this
 * number re-skins every level at or above it: a content decision.
 */
export const HIDDEN_FROM = 15

/**
 * How many tubes hide their blocks, by level: one from `HIDDEN_FROM`, two from
 * 20, three from 41, then a climb through the anchors 3 → 5 → 9 → 11 over
 * levels 51–100 (ticket 21), holding at 11 — an empty appended spare can hide
 * nothing (ticket 24). Interpolated between anchors and rounded, so the count
 * is a stepped, monotonic ramp derived from the level number.
 */
const HIDDEN_ANCHORS: readonly (readonly [level: number, count: number])[] = [
  [51, 3],
  [70, 5],
  [85, 9],
  [100, 11],
]

export function hiddenTubeCount(level: number): number {
  if (level < HIDDEN_FROM) return 0
  if (level < 20) return 1
  if (level < 41) return 2
  if (level < HIDDEN_ANCHORS[0][0]) return 3
  return Math.round(interpolate(HIDDEN_ANCHORS, level, false))
}

/** Clamp any input into the valid `1..MAX_LEVEL` range. */
export function clampLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.trunc(level) : 1
  return Math.min(MAX_LEVEL, Math.max(1, safe))
}

/** Colours on the board for a level (clamped). */
export function levelColors(level: number): number {
  const safe = clampLevel(level)
  let colors = COLOR_TIERS[0][1]
  for (const [from, count] of COLOR_TIERS) if (safe >= from) colors = count
  return colors
}

/**
 * The difficulty target, as a random-playout win rate (`difficulty.ts`),
 * interpolated in log space between anchors so the fall is geometric. Level 1
 * is a near-certain win; `PADLOCK_USEFUL_FROM` is where a typical player is
 * often stuck enough to reach for the padlock (decision 31, chosen by the
 * owner from the ticket-29 probe); the plateau from 600 is ticket 25's.
 */
export const PADLOCK_USEFUL_FROM = 60
export const PADLOCK_USEFUL_TARGET = 0.25

export const TARGET_ANCHORS: readonly (readonly [level: number, winRate: number])[] = [
  [1, 1],
  [PADLOCK_USEFUL_FROM, PADLOCK_USEFUL_TARGET],
  [400, 0.03],
  [600, 0.015],
]

/**
 * How many seeded transpositions mix the sorted board. A ramp derived from
 * the level number, never below `colors + 1`: fewer swaps cannot touch every
 * tube, so most draws would start with a complete tube and be rejected. From
 * `FULL_SHUFFLE_FROM` the board is a full Fisher–Yates shuffle and difficulty
 * comes from selection alone.
 */
export const MIX_ANCHORS: readonly (readonly [level: number, swaps: number])[] = [
  [1, 4],
  [PADLOCK_USEFUL_FROM, 12],
  [400, 24],
]

/** From this level the board is a full shuffle, not a counted mix. */
export const FULL_SHUFFLE_FROM = 400

/** Scored candidates per level; the one nearest the target is kept. */
export const LEVEL_CANDIDATES = 6

/**
 * Draws allowed per level, including boards rejected for starting with a
 * complete tube. Low mixes reject often; this bound keeps a build finite.
 */
export const MAX_DRAWS = 256

/** Random playouts per candidate score, and the steps after which one is lost. */
export const SCORE_PLAYOUTS = 100
export const SCORE_MAX_STEPS = 300

/** States the solver may expand on one candidate before it is skipped. */
export const SOLVE_NODE_BUDGET = 5000

export function interpolate(
  anchors: readonly (readonly [number, number])[],
  level: number,
  log: boolean,
): number {
  const [firstLevel, firstValue] = anchors[0]
  if (level <= firstLevel) return firstValue
  for (let i = 1; i < anchors.length; i++) {
    const [toLevel, toValue] = anchors[i]
    if (level === toLevel) return toValue
    if (level < toLevel) {
      const [fromLevel, fromValue] = anchors[i - 1]
      const t = (level - fromLevel) / (toLevel - fromLevel)
      return log
        ? Math.exp(Math.log(fromValue) + t * (Math.log(toValue) - Math.log(fromValue)))
        : fromValue + t * (toValue - fromValue)
    }
  }
  return anchors[anchors.length - 1][1]
}

/** The target random-win rate for a level (non-increasing, then flat). */
export function levelTarget(level: number): number {
  return interpolate(TARGET_ANCHORS, clampLevel(level), true)
}

/**
 * Transpositions for a level, or `null` for a full shuffle. Rounded so the
 * board depends only on integers.
 */
export function levelMix(level: number): number | null {
  const safe = clampLevel(level)
  if (safe >= FULL_SHUFFLE_FROM) return null
  return Math.max(levelColors(safe) + 1, Math.round(interpolate(MIX_ANCHORS, safe, false)))
}
