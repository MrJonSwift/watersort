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
 * The 40-level curve: 3 colours at level 1 up to 10 colours and 40 reverse
 * moves at level 40. Every level keeps two spare tubes; the ramp comes from
 * colours and scramble, never from taking a spare away.
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

export const MAX_LEVEL = LEVELS.length

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
 * How many tubes hide their blocks on a level. One from `HIDDEN_FROM` to 19;
 * two from level 20 on (the 8-, 9- and 10-colour tiers), where concealment
 * stacks on the sealed spares. Always zero below `HIDDEN_FROM`.
 */
export function hiddenTubeCount(level: number): number {
  if (level < HIDDEN_FROM) return 0
  return level >= SPARES_LOCK_FROM ? 2 : 1
}

/** Clamp any input into the valid `1..MAX_LEVEL` range. */
export function clampLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.trunc(level) : 1
  return Math.min(MAX_LEVEL, Math.max(1, safe))
}

/**
 * Config for a level number, clamped into `1..MAX_LEVEL`.
 *
 * Clamping (rather than throwing) keeps a corrupt save or a bad call from
 * taking the app down. Progress is clamped independently on load.
 */
export function levelConfig(level: number): LevelConfig {
  return LEVELS[clampLevel(level) - 1]
}
