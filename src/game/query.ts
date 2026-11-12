/**
 * The `?level=N` shortcut (ticket 11).
 *
 * A test affordance, not a player feature: it lets a phone open a specific
 * level on the live site without a console, which is how the hidden and
 * locked tiers get inspected. The parser is pure and takes the raw
 * `location.search` string so it can be tested without a window.
 */

/** The only query key this module reads. */
const LEVEL_KEY = 'level'

/**
 * Read a level number out of a query string, clamped to `1..maxLevel`.
 *
 * Returns `null` when the parameter is absent or is not a whole number, so
 * the caller falls back to the saved position. Out-of-range numbers clamp
 * rather than fail: `?level=99` opens the last level instead of doing
 * nothing, which is what someone typing it expects.
 */
export function parseLevelJump(search: string, maxLevel: number): number | null {
  const params = new URLSearchParams(search)
  const raw = params.get(LEVEL_KEY)
  if (raw === null) return null

  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null

  return Math.min(maxLevel, Math.max(1, Number(text)))
}
