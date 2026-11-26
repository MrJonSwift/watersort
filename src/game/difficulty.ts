/**
 * How hard a board is, as one number (ticket 25).
 *
 * The score is the share of seeded random playouts that win: a "random tapper"
 * plays legal moves chosen uniformly, never returning to a position it has
 * already seen in that playout, and loses when every legal move leads back to
 * one (or it runs out of steps). A near-sorted board scores close to 1; a full
 * eleven-colour shuffle scores well under 0.1. Concealment is ignored — the
 * tapper sees every colour — so the score measures the board itself.
 *
 * Pure and deterministic: the playouts are driven by a seeded PRNG, never
 * `Math.random`, and positions are compared through an order-independent hash
 * so tube order does not matter.
 */
import { DEFAULT_CAPACITY } from './rules'
import type { ColorId } from './types'

/** Deterministic, tiny PRNG (mulberry32). Same output on every platform. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash of one tube's contents, bottom-first. */
function tubeHash(tube: readonly ColorId[]): number {
  let h = 0x811c9dc5 ^ tube.length
  for (const color of tube) h = Math.imul(h ^ (color + 1), 0x01000193)
  h ^= h >>> 15
  return Math.imul(h, 0x2c1b3c6d) >>> 0
}

export interface ScoreOptions {
  /** Number of playouts. More is steadier and slower. */
  playouts: number
  /** Steps after which a playout counts as lost. */
  maxSteps: number
  /** PRNG seed for the playouts. */
  seed: number
  capacity?: number
}

/**
 * The random-playout win rate of a board, in `[0, 1]`.
 */
export function randomWinRate(
  board: readonly (readonly ColorId[])[],
  options: ScoreOptions,
): number {
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const playouts = Math.max(1, Math.trunc(options.playouts))
  const rng = mulberry32(options.seed)
  const n = board.length
  const tubes: ColorId[][] = board.map((tube) => [...tube])
  const hashes = new Array<number>(n)
  const froms: number[] = []
  const tos: number[] = []
  const seen = new Set<number>()
  let wins = 0

  for (let p = 0; p < playouts; p++) {
    for (let i = 0; i < n; i++) {
      tubes[i] = [...board[i]]
      hashes[i] = tubeHash(tubes[i])
    }
    seen.clear()
    let total = 0
    for (let i = 0; i < n; i++) total = (total + hashes[i]) >>> 0
    seen.add(total)

    for (let step = 0; ; step++) {
      // Win check: every tube empty or complete.
      let won = true
      for (let i = 0; i < n && won; i++) {
        const tube = tubes[i]
        if (tube.length === 0) continue
        if (tube.length !== capacity) won = false
        else for (let k = 1; k < capacity; k++) if (tube[k] !== tube[0]) won = false
      }
      if (won) {
        wins++
        break
      }
      if (step >= options.maxSteps) break

      froms.length = 0
      tos.length = 0
      for (let from = 0; from < n; from++) {
        const source = tubes[from]
        if (source.length === 0) continue
        const color = source[source.length - 1]
        for (let to = 0; to < n; to++) {
          if (to === from) continue
          const target = tubes[to]
          if (target.length >= capacity) continue
          if (target.length > 0 && target[target.length - 1] !== color) continue
          froms.push(from)
          tos.push(to)
        }
      }

      // Try legal moves in a random order until one reaches a new position.
      let moved = false
      let remaining = froms.length
      while (remaining > 0 && !moved) {
        const pick = Math.floor(rng() * remaining)
        const from = froms[pick]
        const to = tos[pick]
        froms[pick] = froms[remaining - 1]
        tos[pick] = tos[remaining - 1]
        remaining--

        const source = tubes[from]
        const target = tubes[to]
        const color = source[source.length - 1]
        let run = 1
        while (run < source.length && source[source.length - 1 - run] === color) run++
        const amount = Math.min(run, capacity - target.length)
        for (let i = 0; i < amount; i++) target.push(source.pop() as ColorId)
        const hf = tubeHash(source)
        const ht = tubeHash(target)
        const next = (total - hashes[from] - hashes[to] + hf + ht) >>> 0
        if (seen.has(next)) {
          for (let i = 0; i < amount; i++) source.push(target.pop() as ColorId)
          continue
        }
        seen.add(next)
        hashes[from] = hf
        hashes[to] = ht
        total = next
        moved = true
      }
      if (!moved) break
    }
  }
  return wins / playouts
}
