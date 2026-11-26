/**
 * Seeded level generator (ticket 29: one path for every level).
 *
 * A board is a seeded shuffle of full colour tubes plus two empty spares.
 * Solvability is proven by verification: the bundled solver (`solver.ts`)
 * finds a solution at build time, and tests replay it to a win. Difficulty is
 * measured, not assumed: candidates are scored by `difficulty.ts` and the one
 * nearest the level's target is kept. If no candidate solves inside the
 * solver's budget, a tiny reverse-scramble helper makes a board that is
 * solvable by construction, so a build never hangs and never ships an
 * unsolvable board.
 *
 * Everything here is pure: no DOM, no storage, no clock and no `Math.random`.
 * The same level number yields the same board on every device.
 */
import {
  LEVEL_CANDIDATES,
  LEVEL_SPARES,
  MAX_DRAWS,
  SCORE_MAX_STEPS,
  SCORE_PLAYOUTS,
  SOLVE_NODE_BUDGET,
  clampLevel,
  levelColors,
  levelMix,
  levelTarget,
} from './levels'
import { mulberry32, randomWinRate } from './difficulty'
import { solve } from './solver'
import { DEFAULT_CAPACITY, isWon, pour, topColor, topRun } from './rules'
import { createGame } from './state'
import type { ColorId, Move } from './types'

export interface Level {
  /** Starting tubes, bottom-first within each tube. */
  board: ColorId[][]
  /** Forward moves that solve the board, in order. */
  solution: Move[]
}

/** Build the board for a numbered level. Same level, same board. */
export function generateLevel(level: number): Level {
  return buildLevel(level).level
}

/** How a level was built: what the probe and the budget tests read. */
export interface BuildReport {
  level: Level
  /** Transpositions used, `null` for a full shuffle. */
  mix: number | null
  /** Random-win score of the kept board (absent on the fallback). */
  score?: number
  /** Boards drawn, including ones rejected for a complete tube. */
  draws: number
  /** Candidates handed to the solver. */
  solves: number
  /** Solver states expanded across those candidates. */
  nodes: number
  /** True when no candidate solved and the reverse-scramble helper was used. */
  fallback: boolean
}

/** The level-number ramp a build reads. Tests and probes may swap it. */
export interface Ramp {
  colors: (level: number) => number
  mix: (level: number) => number | null
  target: (level: number) => number
}

export const SHIPPED_RAMP: Ramp = {
  colors: levelColors,
  mix: levelMix,
  target: levelTarget,
}

/**
 * Build a level and say how. Draw boards with no complete tube until
 * `LEVEL_CANDIDATES` are scored, then try them nearest-the-target first and
 * keep the first one the solver proves. On the plateau the target sits below
 * most candidates, so "nearest" is the hardest. A candidate the solver cannot
 * finish within its budget is skipped; if none solves, `fallbackLevel` builds
 * one by reverse scramble.
 *
 * `solveBudget` exists so a test can starve the solver and prove the
 * fallback; the game always uses the pinned `SOLVE_NODE_BUDGET`.
 */
export function buildLevel(
  level: number,
  solveBudget: number = SOLVE_NODE_BUDGET,
  ramp: Ramp = SHIPPED_RAMP,
): BuildReport {
  const safeLevel = clampLevel(level)
  const capacity = DEFAULT_CAPACITY
  const colors = ramp.colors(safeLevel)
  const mix = ramp.mix(safeLevel)
  const target = ramp.target(safeLevel)

  const candidates: { board: ColorId[][]; score: number; distance: number }[] = []
  let draws = 0
  while (candidates.length < LEVEL_CANDIDATES && draws < MAX_DRAWS) {
    const seed = shuffleSeed(safeLevel, draws)
    draws++
    const board = shuffledBoard(colors, LEVEL_SPARES, mix, seed, capacity)
    if (hasCompleteTube(board, capacity)) continue
    const score = randomWinRate(board, {
      playouts: SCORE_PLAYOUTS,
      maxSteps: SCORE_MAX_STEPS,
      seed,
      capacity,
    })
    candidates.push({ board, score, distance: targetDistance(score, target) })
  }

  // Nearest first; ties go to the harder board, then to the earlier draw.
  const order = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((a, b) => a.distance - b.distance || a.score - b.score || a.index - b.index)

  let solves = 0
  let nodes = 0
  for (const candidate of order) {
    solves++
    const result = solve(candidate.board, solveBudget, capacity)
    nodes += result.nodes
    if (result.solution) {
      return {
        level: { board: candidate.board, solution: result.solution },
        mix,
        score: candidate.score,
        draws,
        solves,
        nodes,
        fallback: false,
      }
    }
  }

  return {
    level: fallbackLevel(safeLevel, colors, capacity),
    mix,
    draws,
    solves,
    nodes,
    fallback: true,
  }
}

/** Reverse moves the fallback applies, and the seeds it may try. */
const FALLBACK_SCRAMBLE = 40
const FALLBACK_SEEDS = 16

/**
 * The never-hang fallback: start from the sorted board (`colors` full tubes and
 * two empties) and apply seeded legal *reverse* moves, recording each forward
 * inverse, so replaying them in reverse order solves the board by
 * construction. Seeds are tried until one starts with no complete tube; the
 * last board is kept otherwise, because solvable matters more than mixed. It
 * runs only when the solver proves no candidate, which the probe records as
 * never in 1–1000.
 */
export function fallbackLevel(
  level: number,
  colors: number,
  capacity: number = DEFAULT_CAPACITY,
): Level {
  let last: Level = { board: [], solution: [] }
  for (let attempt = 0; attempt < FALLBACK_SEEDS; attempt++) {
    const tubes: ColorId[][] = []
    for (let color = 0; color < colors; color++) tubes.push(Array(capacity).fill(color))
    for (let i = 0; i < LEVEL_SPARES; i++) tubes.push([])
    const rng = mulberry32(shuffleSeed(level, MAX_DRAWS + attempt))
    const inverses: Move[] = []
    for (let step = 0; step < FALLBACK_SCRAMBLE; step++) {
      const moves = reverseMoves(tubes, capacity)
      if (moves.length === 0) break
      const move = moves[Math.floor(rng() * moves.length)]
      for (let k = 0; k < move.amount; k++) tubes[move.to].push(tubes[move.from].pop() as ColorId)
      inverses.push({ from: move.to, to: move.from, amount: move.amount })
    }
    const board = tubes.map((tube) => [...tube])
    last = { board, solution: trimSolution(board, inverses.reverse(), capacity) }
    if (!hasCompleteTube(board, capacity) && last.solution.length > 0) return last
  }
  return last
}

interface ReverseMove {
  from: number
  to: number
  amount: number
}

/**
 * Every legal reverse move: `amount` units of the top colour move from `from`
 * to `to`, and the forward inverse (`to` -> `from`) stays legal afterwards.
 */
function reverseMoves(tubes: readonly ColorId[][], capacity: number): ReverseMove[] {
  const moves: ReverseMove[] = []
  for (let from = 0; from < tubes.length; from++) {
    const source = { colors: tubes[from] }
    const color = topColor(source)
    if (color === null) continue
    const run = topRun(source)
    for (let to = 0; to < tubes.length; to++) {
      if (to === from) continue
      const room = capacity - tubes[to].length
      if (room <= 0) continue
      if (topColor({ colors: tubes[to] }) === color) continue
      for (let amount = 1; amount <= run && amount <= room; amount++) {
        if (amount < run || amount === tubes[from].length) moves.push({ from, to, amount })
      }
    }
  }
  return moves
}

/** Stop the recorded solution at its first win (a reverse move can be dead weight). */
function trimSolution(board: ColorId[][], solution: Move[], capacity: number): Move[] {
  let state = createGame(board, capacity)
  for (let i = 0; i < solution.length; i++) {
    state = pour(state, solution[i].from, solution[i].to)
    if (isWon(state)) return solution.slice(0, i + 1)
  }
  return solution
}

/** Seed for draw `index` of a level. */
function shuffleSeed(level: number, index: number): number {
  let hash = Math.imul(Math.trunc(level) + 1, 0x27d4eb2f)
  hash = Math.imul(hash ^ 0x5bd1e995, 0x85ebca6b)
  hash = Math.imul(hash ^ (index + 1), 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * One seeded shuffled board: `colors` full tubes mixed by `mix` transpositions
 * (each swaps two units in different tubes), or a full Fisher–Yates shuffle
 * when `mix` is `null`, followed by `spares` empty tubes.
 */
export function shuffledBoard(
  colors: number,
  spares: number,
  mix: number | null,
  seed: number,
  capacity: number = DEFAULT_CAPACITY,
): ColorId[][] {
  const units: ColorId[] = []
  for (let color = 0; color < colors; color++) {
    for (let k = 0; k < capacity; k++) units.push(color)
  }
  const rng = mulberry32(seed)
  const total = units.length
  if (mix === null) {
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[units[i], units[j]] = [units[j], units[i]]
    }
  } else if (colors > 1) {
    for (let step = 0; step < mix; step++) {
      const a = Math.floor(rng() * total)
      // Pick b among the units outside a's tube.
      let b = Math.floor(rng() * (total - capacity))
      const tubeA = Math.floor(a / capacity)
      if (Math.floor(b / capacity) >= tubeA) b += capacity
      ;[units[a], units[b]] = [units[b], units[a]]
    }
  }
  const board: ColorId[][] = []
  for (let tube = 0; tube < colors; tube++) {
    board.push(units.slice(tube * capacity, (tube + 1) * capacity))
  }
  for (let i = 0; i < spares; i++) board.push([])
  return board
}

function hasCompleteTube(board: readonly (readonly ColorId[])[], capacity: number): boolean {
  return board.some(
    (tube) => tube.length === capacity && tube.every((color) => color === tube[0]),
  )
}

/** Distance from the target in log space, so 0.02 vs 0.01 counts like 0.5 vs 0.25. */
function targetDistance(score: number, target: number): number {
  const floor = 1 / SCORE_PLAYOUTS
  return Math.abs(Math.log(Math.max(score, floor) / Math.max(target, floor)))
}
