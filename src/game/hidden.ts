/**
 * Which tubes start a level with hidden blocks (ticket 10).
 *
 * The mechanic (what reveals a segment) lives in the rules; this module only
 * answers "which tubes" — deterministically, from the level number, so the
 * same level always hides the same tubes on every device. No `Math.random`:
 * the pick is a mixed hash over the candidate indices, the same trick the
 * generator uses for its seeds.
 */
import { hiddenTubeCount } from './levels'
import type { Tube } from './types'

/** Mix a counter into a well-spread 32-bit hash (no platform drift). */
function mix(n: number): number {
  let h = Math.imul(n + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The indices of the tubes that start hidden, in pick order.
 *
 * Only tubes holding colours are candidates — an empty tube has nothing to
 * hide, which also keeps the pick clear of the sealed spares. When the level
 * asks for more tubes than the board can offer, every candidate is picked.
 */
export function pickHiddenTubes(level: number, tubes: readonly Tube[]): number[] {
  const candidates = tubes
    .map((_, index) => index)
    .filter((index) => tubes[index].colors.length > 0)
  const count = Math.min(hiddenTubeCount(level), candidates.length)

  const picked: number[] = []
  for (let k = 0; k < count; k++) {
    const at = mix(level * 7919 + k) % candidates.length
    picked.push(candidates[at])
    candidates.splice(at, 1)
  }
  return picked
}
