/**
 * Seeded level generator.
 *
 * Levels 1–100 are built by starting from the solved position and applying
 * legal *reverse* moves. Every reverse move is recorded as its forward
 * inverse, so replaying that list in reverse order solves the board by
 * construction.
 *
 * From `SHUFFLE_FROM` (ticket 25) a board is a seeded shuffle of full colour
 * tubes instead, and solvability is proven by verification: the bundled
 * solver (`solver.ts`) finds a solution at build time, and tests replay it to
 * a win. Difficulty is measured, not assumed — candidates are scored by
 * `difficulty.ts` and the one nearest the level's target is kept.
 *
 * Everything here is pure: no DOM, no storage, no clock and no `Math.random`.
 * The same level number yields the same board on every device.
 */
import {
  CLIMB_FROM,
  LATE_BOARD_MIN_MULTI,
  SCORE_MAX_STEPS,
  SCORE_PLAYOUTS,
  SHUFFLE_CANDIDATES,
  SHUFFLE_COLORS,
  SHUFFLE_FROM,
  SHUFFLE_MAX_DRAWS,
  SHUFFLE_SPARES,
  SOLVE_NODE_BUDGET,
  clampLevel,
  levelConfig,
  shuffleMix,
  shuffleTarget,
  type LevelConfig,
} from './levels'
import { mulberry32, randomWinRate } from './difficulty'
import { solve } from './solver'
import {
  DEFAULT_CAPACITY,
  isComplete,
  isWon,
  pour,
  topColor,
  topRun,
} from './rules'
import { createGame } from './state'
import type { ColorId, Move, Tube } from './types'

export interface Level {
  /** Starting tubes, bottom-first within each tube. */
  board: ColorId[][]
  /** Forward moves that solve the board, in order. */
  solution: Move[]
}

/** Attempts per config before easing the scramble. */
const ATTEMPTS = 64
/** How much easier the single fallback pass is. */
const EASIER_STEP = 2

/** Mix the level, its scramble and the attempt number into an attempt seed. */
function seedFor(level: number, scramble: number, attempt: number): number {
  let hash = Math.imul(Math.trunc(level) + 1, 0x9e3779b1)
  hash = Math.imul(hash ^ (Math.trunc(scramble) + 1), 0x85ebca6b)
  hash = Math.imul(hash ^ (attempt + 1), 0xc2b2ae35)
  return hash >>> 0
}

interface ReverseMove {
  from: number
  to: number
  amount: number
}

/**
 * Every legal reverse move: `amount` units of the top colour move from `from`
 * to `to`, and the forward inverse (`to` -> `from`) stays legal afterwards.
 *
 * The forward pour is legal only if the source keeps that colour on top after
 * the removal, or becomes empty. The destination must be empty or carry a
 * different top colour, and must have room for the whole run.
 */
function reverseMoves(tubes: readonly Tube[], capacity: number): ReverseMove[] {
  const moves: ReverseMove[] = []
  for (let from = 0; from < tubes.length; from++) {
    const source = tubes[from]
    const color = topColor(source)
    if (color === null) continue
    const run = topRun(source)
    for (let to = 0; to < tubes.length; to++) {
      if (to === from) continue
      const room = capacity - tubes[to].colors.length
      if (room <= 0) continue
      if (topColor(tubes[to]) === color) continue
      for (let amount = 1; amount <= run && amount <= room; amount++) {
        if (amount < run || amount === source.colors.length) {
          moves.push({ from, to, amount })
        }
      }
    }
  }
  return moves
}

/** Apply one reverse move in place. */
function applyReverse(tubes: Tube[], move: ReverseMove): void {
  for (let i = 0; i < move.amount; i++) {
    tubes[move.to].colors.push(tubes[move.from].colors.pop() as ColorId)
  }
}

function runCount(board: readonly (readonly ColorId[])[]): number {
  let runs = 0
  for (const tube of board) {
    for (let i = 0; i < tube.length; i++) {
      if (i === 0 || tube[i] !== tube[i - 1]) runs++
    }
  }
  return runs
}

/**
 * The quality gate: a finished, legal scramble must actually look mixed.
 *
 * No tube may start complete, the board must not already be won, and the
 * colour runs must reach `min(colors * capacity, colors + ceil(scramble / 3))`.
 */
function passesQuality(
  board: ColorId[][],
  colors: number,
  scramble: number,
  capacity: number,
): boolean {
  const state = createGame(board, capacity)
  if (isWon(state)) return false
  if (state.tubes.some((tube) => isComplete(tube, capacity))) return false
  const threshold = Math.min(colors * capacity, colors + Math.ceil(scramble / 3))
  return runCount(board) >= threshold
}

interface Attempt {
  level: Level
  /** Passed the quality gate; a legal board always exists either way. */
  mixed: boolean
}

/**
 * Cut dead weight off the end of a solution.
 *
 * A reverse move may lift a whole single-colour run onto an empty tube: its
 * inverse then relocates an already-complete tube and is never needed, because
 * the board is won before it can be played. Replaying the inverses and stopping
 * at the first win keeps the recorded solution honest without changing the
 * board or the reverse-move rules.
 */
function trimSolution(board: ColorId[][], solution: Move[], capacity: number): Move[] {
  let state = createGame(board, capacity)
  for (let i = 0; i < solution.length; i++) {
    state = pour(state, solution[i].from, solution[i].to)
    if (isWon(state)) return solution.slice(0, i + 1)
  }
  return solution
}

/** One scramble attempt. Always returns a legal, solvable board when possible. */
function attempt(config: LevelConfig, seed: number): Attempt {
  const capacity = DEFAULT_CAPACITY
  const colors = Math.max(0, Math.trunc(config.colors))
  const emptyTubes = Math.max(0, Math.trunc(config.emptyTubes))
  const scramble = Math.max(0, Math.trunc(config.scramble))

  const tubes: Tube[] = []
  for (let color = 0; color < colors; color++) {
    tubes.push({ colors: Array.from({ length: capacity }, () => color) })
  }
  for (let i = 0; i < emptyTubes; i++) tubes.push({ colors: [] })

  const inverses: Move[] = []
  const rng = mulberry32(seed)
  let completed = true
  for (let step = 0; step < scramble; step++) {
    const moves = reverseMoves(tubes, capacity)
    if (moves.length === 0) {
      completed = false
      break
    }
    const pick = Math.min(moves.length - 1, Math.floor(rng() * moves.length))
    const move = moves[pick]
    applyReverse(tubes, move)
    inverses.push({ from: move.to, to: move.from, amount: move.amount })
  }

  const board = tubes.map((tube) => [...tube.colors])
  const solution = trimSolution(board, inverses.reverse(), capacity)
  return {
    level: { board, solution },
    mixed: completed && passesQuality(board, colors, scramble, capacity),
  }
}

/**
 * One seeded attempt at a scrambled, solvable board.
 *
 * Returns `null` when the attempt fails the quality gate (including a scramble
 * that ran out of legal reverse moves), so the caller can retry with a new seed.
 */
export function generateBoard(config: LevelConfig, seed: number): Level | null {
  const result = attempt(config, seed)
  return result.mixed ? result.level : null
}

interface Search {
  found: Level | null
  /** Last legal, solvable board seen, whether or not it was mixed enough. */
  last: Level | null
}

/**
 * Ticket 20's shape rule for the back-loaded climb. A gate-passing board is
 * only accepted from level 51 when one of its two generated spares is never a
 * solution destination and at least eleven tubes hold two or more units (level
 * 100's eleven concealed vials all have a home; the empty appended spare can
 * conceal nothing).
 *
 * This is a filter on which seed `search` returns, not a change to the reverse
 * moves or the quality gate. Levels 1–50 never call it, so their boards,
 * solutions and snapshots are byte-for-byte the shipped ones.
 */
function hasLateBoardShape(level: Level, config: LevelConfig): boolean {
  const spareStart = level.board.length - config.emptyTubes
  if (spareStart < 0) return false

  const used = new Set(level.solution.map((move) => move.to))
  let spareUnused = false
  for (let index = spareStart; index < level.board.length; index++) {
    if (!used.has(index)) {
      spareUnused = true
      break
    }
  }
  if (!spareUnused) return false

  let multiUnitTubes = 0
  for (const tube of level.board) {
    if (tube.length >= 2) multiUnitTubes++
  }
  return multiUnitTubes >= LATE_BOARD_MIN_MULTI
}

/** Up to `ATTEMPTS` seeds for one config. */
function search(config: LevelConfig, level: number): Search {
  let last: Level | null = null
  for (let index = 0; index < ATTEMPTS; index++) {
    const result = attempt(config, seedFor(level, config.scramble, index))
    if (result.level.board.length > 0) last = result.level
    if (
      result.mixed &&
      (level < CLIMB_FROM || hasLateBoardShape(result.level, config))
    ) {
      return { found: result.level, last }
    }
  }
  return { found: null, last }
}

/**
 * Build the board for a numbered level. Seeds are derived from the level
 * number, so the same level is always the same board: levels 1–100 by reverse
 * scramble (`buildReverse`), from `SHUFFLE_FROM` by seeded shuffle and solver
 * (`buildShuffled`).
 */
export function generateLevel(level: number): Level {
  return buildLevel(level).level
}

/** How a level was built — what the probe and the budget tests read. */
export interface BuildReport {
  level: Level
  /** Transpositions used, `null` for a full shuffle; absent below `SHUFFLE_FROM`. */
  mix?: number | null
  /** Random-win score of the kept board (shuffled tier only). */
  score?: number
  /** Boards drawn, including ones rejected for a complete tube. */
  draws?: number
  /** Candidates handed to the solver. */
  solves?: number
  /** Solver states expanded across those candidates. */
  nodes?: number
  /** True when no candidate solved and the reverse-scramble fallback was used. */
  fallback?: boolean
}

/**
 * Build a level and say how. `generateLevel` is the game's entry point; this
 * variant also reports the shuffled tier's choices for tests and the probe.
 * `solveBudget` exists so a test can starve the solver and prove the fallback;
 * the game always uses the pinned `SOLVE_NODE_BUDGET`.
 */
export function buildLevel(
  level: number,
  solveBudget: number = SOLVE_NODE_BUDGET,
): BuildReport {
  const safeLevel = clampLevel(level)
  if (safeLevel >= SHUFFLE_FROM) return buildShuffled(safeLevel, solveBudget)
  return { level: buildReverse(safeLevel) }
}

/**
 * The reverse-scramble path (levels 1–100, and the shuffled tier's fallback).
 *
 * If no attempt passes the mixing gate, the whole search runs once more with
 * `scramble - 2`: a slightly easier level beats a hang. If that also fails, the
 * last legal, solvable board is returned rather than throwing — solvability is
 * a hard requirement, how well mixed a board looks is not.
 */
function buildReverse(safeLevel: number): Level {
  const config = levelConfig(safeLevel)

  const primary = search(config, safeLevel)
  if (primary.found) return primary.found

  const easier: LevelConfig = {
    ...config,
    scramble: Math.max(0, config.scramble - EASIER_STEP),
  }
  const secondary = search(easier, safeLevel)
  if (secondary.found) return secondary.found

  const fallback = secondary.last ?? primary.last
  if (fallback) return fallback

  // Degenerate config (no colours, no spare tubes): nothing can be built.
  return { board: [], solution: [] }
}

/** Seed for draw `index` of a shuffled level; a different stream from `seedFor`. */
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

/**
 * The shuffled tier (ticket 25): draw boards with no complete tube until
 * `SHUFFLE_CANDIDATES` are scored, then try them nearest-the-target first and
 * keep the first one the solver proves. On the plateau the target sits below
 * most candidates, so "nearest" is the hardest. A candidate the solver cannot
 * finish within its budget is skipped; if none solves, the level falls back to
 * the level-100 reverse-scramble config with this level's seed — never a hang,
 * never an unsolvable board.
 */
function buildShuffled(safeLevel: number, solveBudget: number): BuildReport {
  const capacity = DEFAULT_CAPACITY
  const mix = shuffleMix(safeLevel)
  const target = shuffleTarget(safeLevel)

  const candidates: { board: ColorId[][]; score: number; distance: number }[] = []
  let draws = 0
  while (candidates.length < SHUFFLE_CANDIDATES && draws < SHUFFLE_MAX_DRAWS) {
    const seed = shuffleSeed(safeLevel, draws)
    draws++
    const board = shuffledBoard(SHUFFLE_COLORS, SHUFFLE_SPARES, mix, seed, capacity)
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
    level: buildReverse(safeLevel),
    mix,
    draws,
    solves,
    nodes,
    fallback: true,
  }
}
