/**
 * A small deterministic solver for generated boards (ticket 25).
 *
 * Every level is a seeded shuffle (ticket 29), so it is solvable by
 * verification: this solver finds a solution once at build time, and tests replay it to a win. It only has to
 * find *a* solution, not the shortest one.
 *
 * Pure and deterministic: a fixed move order, a node budget instead of a clock,
 * and no `Math.random`. The same board always yields the same answer — or the
 * same `null` when the budget runs out — on every device.
 */
import { DEFAULT_CAPACITY } from './rules'
import type { ColorId, Move } from './types'

export interface SolveResult {
  /** Forward moves that win from the board, or `null` if none was found in budget. */
  solution: Move[] | null
  /** States expanded. Never more than the budget. */
  nodes: number
}

function topRunOf(tube: readonly ColorId[]): number {
  const n = tube.length
  if (n === 0) return 0
  const color = tube[n - 1]
  let run = 1
  while (run < n && tube[n - 1 - run] === color) run++
  return run
}

function isSolved(tubes: readonly (readonly ColorId[])[], capacity: number): boolean {
  for (const tube of tubes) {
    if (tube.length === 0) continue
    if (tube.length !== capacity || topRunOf(tube) !== capacity) return false
  }
  return true
}

/** Two independent hashes of one tube's contents, bottom-first. */
function tubeHashA(tube: readonly ColorId[]): number {
  let h = 0x811c9dc5 ^ tube.length
  for (const color of tube) h = Math.imul(h ^ (color + 1), 0x01000193)
  h ^= h >>> 15
  return Math.imul(h, 0x2c1b3c6d) >>> 0
}

function tubeHashB(tube: readonly ColorId[]): number {
  let h = 0x9747b28c ^ (tube.length * 0x45d9f3b)
  for (const color of tube) h = Math.imul(h ^ (color + 7), 0x5bd1e995)
  h ^= h >>> 13
  return Math.imul(h, 0x297a2d39) >>> 0
}

/**
 * Canonical state key: an order-independent 52-bit hash of the tube contents.
 * Two boards that differ only in which tube holds what are the same position,
 * so summing per-tube hashes collapses them. A collision could only make the
 * search skip a position — every returned move is still played on the real
 * board, so a solution is always genuine — and at 52 bits over a few thousand
 * states it is vanishingly rare.
 */
function canonicalKey(tubes: readonly (readonly ColorId[])[]): number {
  let a = 0
  let b = 0
  for (const tube of tubes) {
    a = (a + tubeHashA(tube)) >>> 0
    b = (b + tubeHashB(tube)) & 0xfffff
  }
  return b * 0x100000000 + a
}

/**
 * The candidate moves from a position, in the fixed search order.
 *
 * Pours onto a matching colour come first, then pours into an empty tube. Two
 * kinds of move are pruned because they can never help: moving out of a
 * complete tube, and pouring a tube that holds a single colour into an empty
 * one (it only relabels the tube). Only the first empty tube is offered as a
 * destination — empties are interchangeable.
 */
function candidateMoves(tubes: readonly (readonly ColorId[])[], capacity: number): Move[] {
  const onto: Move[] = []
  const into: Move[] = []
  let firstEmpty = -1
  for (let i = 0; i < tubes.length; i++) {
    if (tubes[i].length === 0) {
      firstEmpty = i
      break
    }
  }
  for (let from = 0; from < tubes.length; from++) {
    const source = tubes[from]
    if (source.length === 0) continue
    const run = topRunOf(source)
    if (run === capacity) continue
    const color = source[source.length - 1]
    for (let to = 0; to < tubes.length; to++) {
      if (to === from) continue
      const target = tubes[to]
      if (target.length === 0 || target.length >= capacity) continue
      if (target[target.length - 1] !== color) continue
      onto.push({ from, to, amount: Math.min(run, capacity - target.length) })
    }
    if (firstEmpty >= 0 && run < source.length) {
      into.push({ from, to: firstEmpty, amount: run })
    }
  }
  return onto.concat(into)
}

/**
 * Search for a solution with at most `budget` expanded states.
 *
 * Depth-first over canonical states with a visited set. A position already
 * expanded is never expanded again, so the search terminates even without the
 * budget; the budget is what keeps a hard board from stalling a level build.
 */
export function solve(
  board: readonly (readonly ColorId[])[],
  budget: number,
  capacity: number = DEFAULT_CAPACITY,
): SolveResult {
  const tubes = board.map((tube) => [...tube])
  const seen = new Set<number>()
  const path: Move[] = []
  let nodes = 0
  let exhausted = false

  function search(): boolean {
    if (isSolved(tubes, capacity)) return true
    if (nodes >= budget) {
      exhausted = true
      return false
    }
    const key = canonicalKey(tubes)
    if (seen.has(key)) return false
    seen.add(key)
    nodes++

    for (const move of candidateMoves(tubes, capacity)) {
      const source = tubes[move.from]
      const target = tubes[move.to]
      for (let i = 0; i < move.amount; i++) target.push(source.pop() as ColorId)
      path.push(move)
      if (search()) return true
      path.pop()
      for (let i = 0; i < move.amount; i++) source.push(target.pop() as ColorId)
      if (exhausted) return false
    }
    return false
  }

  const found = search()
  return { solution: found ? path.slice() : null, nodes }
}
