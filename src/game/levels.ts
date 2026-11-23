/**
 * The numbered difficulty curve.
 *
 * A level config describes one board: how many colours fill tubes, how many
 * spare tubes sit beside them, and how many reverse moves to scramble it with.
 * Capacity is not part of it — capacity is a rule (`rules.ts`), not difficulty.
 */
export interface LevelConfig {
  /** Distinct colours on the board, one full tube's worth each. */
  colors: number
  /** Spare tubes added after the full ones. */
  emptyTubes: number
  /** Reverse moves applied to the solved board while scrambling. */
  scramble: number
}

/**
 * The hand-tuned 40-level curve: 3 colours at level 1 up to 10 colours and 40
 * reverse moves at level 40. Levels past 40 are derived by `levelConfig`.
 * Every level keeps two spare tubes; the ramp comes from colours and scramble,
 * never from taking a spare away.
 *
 * Each new colour tier starts below the previous tier's last scramble, so the
 * extra colour is the step rather than the colour plus a scramble jump. The
 * 9-colour tier (31–35) and 10-colour tier (36–40) each add five levels; their
 * boards use 11 and 12 tubes, which is why the board lays out seven per row
 * above ten tubes (ticket 17).
 */
export const LEVELS: readonly LevelConfig[] = [
  { colors: 3, emptyTubes: 2, scramble: 6 },
  { colors: 3, emptyTubes: 2, scramble: 8 },
  { colors: 3, emptyTubes: 2, scramble: 10 },
  { colors: 4, emptyTubes: 2, scramble: 8 },
  { colors: 4, emptyTubes: 2, scramble: 10 },
  { colors: 4, emptyTubes: 2, scramble: 12 },
  { colors: 5, emptyTubes: 2, scramble: 10 },
  { colors: 5, emptyTubes: 2, scramble: 12 },
  { colors: 5, emptyTubes: 2, scramble: 14 },
  { colors: 5, emptyTubes: 2, scramble: 16 },
  { colors: 6, emptyTubes: 2, scramble: 12 },
  { colors: 6, emptyTubes: 2, scramble: 14 },
  { colors: 6, emptyTubes: 2, scramble: 16 },
  { colors: 6, emptyTubes: 2, scramble: 18 },
  { colors: 7, emptyTubes: 2, scramble: 14 },
  { colors: 7, emptyTubes: 2, scramble: 16 },
  { colors: 7, emptyTubes: 2, scramble: 18 },
  { colors: 7, emptyTubes: 2, scramble: 20 },
  { colors: 7, emptyTubes: 2, scramble: 22 },
  { colors: 8, emptyTubes: 2, scramble: 16 },
  { colors: 8, emptyTubes: 2, scramble: 18 },
  { colors: 8, emptyTubes: 2, scramble: 20 },
  { colors: 8, emptyTubes: 2, scramble: 22 },
  { colors: 8, emptyTubes: 2, scramble: 24 },
  { colors: 8, emptyTubes: 2, scramble: 26 },
  { colors: 8, emptyTubes: 2, scramble: 28 },
  { colors: 8, emptyTubes: 2, scramble: 30 },
  { colors: 8, emptyTubes: 2, scramble: 32 },
  { colors: 8, emptyTubes: 2, scramble: 34 },
  { colors: 8, emptyTubes: 2, scramble: 36 },
  { colors: 9, emptyTubes: 2, scramble: 22 },
  { colors: 9, emptyTubes: 2, scramble: 26 },
  { colors: 9, emptyTubes: 2, scramble: 30 },
  { colors: 9, emptyTubes: 2, scramble: 34 },
  { colors: 9, emptyTubes: 2, scramble: 38 },
  { colors: 10, emptyTubes: 2, scramble: 24 },
  { colors: 10, emptyTubes: 2, scramble: 28 },
  { colors: 10, emptyTubes: 2, scramble: 32 },
  { colors: 10, emptyTubes: 2, scramble: 36 },
  { colors: 10, emptyTubes: 2, scramble: 40 },
]

/**
 * The last level people can reach. Levels 1–40 are the hand-tuned curve above;
 * 41–`MAX_LEVEL` are derived by `levelConfig`, so extending the game is a
 * one-line change here rather than a new row in a table. A procedural ramp is
 * bounded by the phone (see `MAX_TWO_ROW_TUBES`), so "infinite" means unbounded
 * in *level number*, not in board size — past the colour ceiling the ramp
 * climbs through what the player can see rather than a bigger board.
 *
 * Ticket 21 raised this from 50 to 100. Levels 51–100 are the back-loaded
 * climb: 11 colours, 14 tubes and a fixed gate-capped scramble, with the number
 * of concealed vials rising 3 → 11 (ticket 24).
 */
export const MAX_LEVEL = 100

/** The first derived level. Everything up to 40 is the validated hand-tuned curve. */
export const EXPERT_FROM = 41

/**
 * The playable colour ceiling (ticket 24, decision 25). The derived tier has
 * held 11 colours since ticket 19; ticket 24 makes 11 the final ceiling too, so
 * the twelfth `palette` swatch never appears on a board that can host the
 * appended spare: at 11 colours the generated board is 13 tubes, so the
 * appended empty spare fits under the 14-tube ceiling and can carry the padlock
 * while a plain empty spare stays a solution destination.
 */
const EXPERT_MAX_COLORS = 11

/**
 * Scramble formula for the derived tier: 38, 42, 46, 50, 54, repeating. The
 * cycle restarts at each five-level boundary, including 46 after the colour
 * ceiling stops stepping; the ramp past 50 is concealment, not a longer
 * scramble.
 */
const EXPERT_BASE_SCRAMBLE = 38
const EXPERT_SCRAMBLE_STEP = 4
const EXPERT_SCRAMBLE_CYCLE = 5

/** Every derived level keeps the same two generated spares. */
const EXPERT_EMPTY_TUBES = 2

/**
 * First level of the back-loaded climb (ticket 21). Everything through 50 keeps
 * its shipped config, board, solution and hidden pick; both the generator's
 * shape rule and the concealment schedule below start here. Gating on the level
 * number is what makes 1–50 byte-for-byte frozen.
 */
export const CLIMB_FROM = 51

/**
 * Scramble ceiling for the climb. The unchanged quality gate binds well below
 * a scramble of 100; ticket 24's probe re-confirmed 54 passes every level
 * 46–100 at 11 colours inside the search budget, so the climb holds the
 * level-50 value and concealment is the ramp — the gate is never weakened to
 * let a longer scramble through.
 */
export const CLIMB_SCRAMBLE = 54

/**
 * Minimum number of tubes holding at least two units on a late board (ticket
 * 20). It gives level 100's eleven concealed vials somewhere to hide — the
 * locked appended spare is empty and can conceal nothing, so the eleven
 * colour-bearing candidates carry the whole climb.
 */
export const LATE_BOARD_MIN_MULTI = 11

/**
 * The most tubes that still fit in two rows of seven on a 360px phone (ticket
 * 17's wide layout). The controller uses this to decide whether the extra
 * spare from `EXTRA_SPARE_FROM` can be appended without forcing a third row.
 */
export const MAX_TWO_ROW_TUBES = 14

/**
 * The level from which spare tubes may start sealed (tickets 09 and 14). Only
 * an empty the level's validated solution never pours into is locked: the
 * spare is an optional escape hatch, never a toll on the solution path. An
 * empty the solution uses stays fully open, and a level whose solution uses
 * every empty shows no lock at all — on the shipped 20–30 curve that is every
 * level, recorded deliberately rather than re-rolling boards. Tubes holding
 * colours are never sealed. Levels below this number are untouched. Moving it
 * is a content decision that needs a deliberate ticket.
 *
 * Ticket 15 adds the padlock affordance but leaves the 20–30 curve alone; the
 * owner declined a re-roll after seeing the cost (20–23 would have had to
 * become easier than level 19). Ticket 17's new boards kept that outcome: the
 * generator uses every empty, so `generateLevel` alone still shows no lock
 * (pinned in `generator.test.ts`). Ticket 18 gives levels from
 * `EXTRA_SPARE_FROM` an appended spare, which is what makes a padlock visible.
 */
export const SPARES_LOCK_FROM = 20

/**
 * The level from which the board carries one extra empty spare beyond the two
 * the generator scrambles into (ticket 18). It is appended *after* generation,
 * so the validated solution's tube indices stay valid and never name it:
 * solution-aware sealing then leaves exactly one guaranteed padlock. Generated
 * boards, solutions, snapshots and curve tokens stay byte-for-byte the same.
 * Moving this line changes which levels show a lock — a content decision.
 */
export const EXTRA_SPARE_FROM = 30

/**
 * The level from which a tube starts with hidden blocks (ticket 10): one of
 * the tubes that holds colours shows "?" until its segments surface, so the
 * mid tiers add a knowledge tax before the final tier seals the spares.
 * Levels below it are untouched. Moving this number is a content decision —
 * it re-skins every level at or above it — and needs a deliberate ticket.
 */
export const HIDDEN_FROM = 15

/**
 * How many tubes hide their blocks on a level. One from `HIDDEN_FROM` to 19,
 * two from level 20 to 40 (the 8-, 9- and 10-colour tiers), and three on the
 * derived tier through level 50. From `CLIMB_FROM` the back-loaded climb takes
 * over: 3, 5, 9 and 11 vials at its four anchors, interpolated between them.
 * Always zero below `HIDDEN_FROM`.
 */
export function hiddenTubeCount(level: number): number {
  if (level < HIDDEN_FROM) return 0
  if (level >= CLIMB_FROM) return climbHiddenCount(level)
  if (level >= EXPERT_FROM) return 3
  return level >= SPARES_LOCK_FROM ? 2 : 1
}

/**
 * The four anchors of the concealment climb (ticket 21): 3 vials at 51, 5 by
 * 70, 9 by 85 and 11 at 100. A level between anchors interpolates, so the count
 * is derived from the level number instead of a fifty-row table. Rounding gives
 * a stepped, monotonic ramp (3→4→5 over the first stretch, then the climb
 * accelerates) without ever asking for more vials than the board can host. The
 * top anchor is 11 because an empty appended spare can hide nothing (ticket 24).
 */
const CLIMB_HIDDEN_ANCHORS: readonly (readonly [level: number, count: number])[] = [
  [CLIMB_FROM, 3],
  [70, 5],
  [85, 9],
  [MAX_LEVEL, 11],
]

function climbHiddenCount(level: number): number {
  for (let i = 1; i < CLIMB_HIDDEN_ANCHORS.length; i++) {
    const [toLevel, toCount] = CLIMB_HIDDEN_ANCHORS[i]
    if (level <= toLevel) {
      const [fromLevel, fromCount] = CLIMB_HIDDEN_ANCHORS[i - 1]
      const span = toLevel - fromLevel
      return fromCount + Math.round(((level - fromLevel) * (toCount - fromCount)) / span)
    }
  }
  return CLIMB_HIDDEN_ANCHORS[CLIMB_HIDDEN_ANCHORS.length - 1][1]
}

/** Clamp any input into the valid `1..MAX_LEVEL` range. */
export function clampLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.trunc(level) : 1
  return Math.min(MAX_LEVEL, Math.max(1, safe))
}

/**
 * Config for a level number, clamped into `1..MAX_LEVEL`.
 *
 * Levels 1–40 are the validated hand-tuned table. From `EXPERT_FROM` the
 * config is derived from the level number: colours hold at the playable
 * ceiling of 11, while the scramble cycles through a rising five-step pattern
 * and restarts every five levels. From `CLIMB_FROM` that cycle stops at the
 * gate's scramble ceiling and the level is fixed at 11 colours and two spares —
 * the back-loaded climb is carried by concealment. The derivation is pure and
 * deterministic, so the same level always makes the same board, and raising
 * `MAX_LEVEL` is all that is needed to add more levels.
 *
 * Clamping (rather than throwing) keeps a corrupt save or a bad call from
 * taking the app down. Progress is clamped independently on load.
 */
export function levelConfig(level: number): LevelConfig {
  const safe = clampLevel(level)
  if (safe <= LEVELS.length) return LEVELS[safe - 1]
  if (safe >= CLIMB_FROM) {
    return {
      colors: EXPERT_MAX_COLORS,
      emptyTubes: EXPERT_EMPTY_TUBES,
      scramble: CLIMB_SCRAMBLE,
    }
  }

  const since = safe - EXPERT_FROM
  const scramble =
    EXPERT_BASE_SCRAMBLE + (since % EXPERT_SCRAMBLE_CYCLE) * EXPERT_SCRAMBLE_STEP
  return { colors: EXPERT_MAX_COLORS, emptyTubes: EXPERT_EMPTY_TUBES, scramble }
}
