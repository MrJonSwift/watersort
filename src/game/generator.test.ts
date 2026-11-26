import { describe, expect, it } from 'vitest'
import {
  buildLevel,
  fallbackLevel,
  generateLevel,
  shuffledBoard,
  type BuildReport,
  type Level,
} from './generator'
import {
  EXTRA_SPARE_FROM,
  LEVEL_CANDIDATES,
  LEVEL_SPARES,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  SOLVE_NODE_BUDGET,
  hiddenTubeCount,
  levelColors,
} from './levels'
import { pickHiddenTubes } from './hidden'
import { DEFAULT_CAPACITY, isComplete, isWon } from './rules'
import { addExtraSpare, createGame, hideBlocks, sealSpares, tap } from './state'
import type { GameState } from './types'

const CAP = DEFAULT_CAPACITY

/** Compact identity for a board: a re-roll of any sampled level shows up here. */
function boardHash(board: readonly (readonly number[])[]): number {
  const text = JSON.stringify(board)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Replay a solution through real taps, checking every move lands as recorded. */
function replayMoves(start: GameState, level: Level): GameState {
  let state = start
  for (const move of level.solution) {
    const before = state
    const selected = tap(state, move.from)
    expect(selected).not.toBe(before)
    expect(selected.selected).toBe(move.from)
    state = tap(selected, move.to)
    expect(state.moves).toBe(before.moves + 1)
    expect(state.history[state.history.length - 1]).toEqual({
      from: move.from,
      to: move.to,
      amount: move.amount,
    })
  }
  return state
}

/** Every colour exactly once per slot, no complete starting tube, replays to a win. */
function expectHardRequirements(level: Level, colors: number): void {
  expect(level.board).toHaveLength(colors + LEVEL_SPARES)
  const counts = new Map<number, number>()
  for (const tube of level.board) {
    expect(tube.length).toBeLessThanOrEqual(CAP)
    for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  expect(counts.size).toBe(colors)
  for (let color = 0; color < colors; color++) expect(counts.get(color)).toBe(CAP)

  const state = createGame(level.board)
  expect(state.tubes.some((tube) => isComplete(tube, CAP))).toBe(false)
  expect(isWon(state)).toBe(false)

  const finished = replayMoves(state, level)
  expect(isWon(finished)).toBe(true)
  expect(finished.moves).toBe(level.solution.length)
}

/** 1–130 every level, every 50th to 1000, and the last level. */
const SAMPLE: number[] = []
for (let level = 1; level <= 130; level++) SAMPLE.push(level)
for (let level = 150; level <= 1000; level += 50) SAMPLE.push(level)
SAMPLE.push(MAX_LEVEL)

const built = new Map<number, BuildReport>()
function report(level: number): BuildReport {
  let found = built.get(level)
  if (!found) {
    found = buildLevel(level)
    built.set(level, found)
  }
  return found
}

describe('generateLevel (one generator for every level)', () => {
  it('keeps the boards of levels 1–4 and 101–104', () => {
    // Snapshots. A change to the ramp, seed stream, scorer or selection rule
    // re-rolls them: a content decision, made in a ticket with this test
    // updated in the same commit.
    const shipped: Array<[number, string]> = [
      [1, '[[0,0,0,2],[2,1,1,1],[1,0,2,2],[],[]]'],
      [2, '[[0,1,0,2],[0,1,1,2],[1,2,0,2],[],[]]'],
      [3, '[[1,2,1,0],[1,1,0,0],[2,2,2,0],[],[]]'],
      [4, '[[0,0,1,1],[1,0,3,0],[1,2,2,2],[2,3,3,3],[],[]]'],
      [101, '[[4,0,0,8],[7,1,9,4],[2,6,2,2],[5,5,1,3],[4,0,3,1],[7,4,5,5],[6,2,6,6],[3,7,8,10],[0,1,8,8],[3,9,9,9],[10,10,7,10],[],[]]'],
      [102, '[[4,0,0,10],[1,1,1,9],[10,2,2,2],[5,3,3,3],[4,4,7,4],[5,6,5,5],[3,6,6,6],[7,0,8,7],[8,8,7,8],[9,2,9,9],[0,10,10,1],[],[]]'],
      [103, '[[3,3,0,0],[2,1,9,0],[10,2,0,7],[5,4,3,6],[4,4,3,8],[5,5,5,1],[1,6,6,6],[7,7,2,7],[4,8,10,8],[1,9,9,9],[2,10,10,8],[],[]]'],
      [104, '[[0,0,3,0],[1,5,7,8],[2,3,2,6],[10,3,0,3],[4,4,10,4],[5,5,9,7],[6,6,2,4],[1,8,7,7],[5,8,1,8],[9,9,1,9],[10,6,10,2],[],[]]'],
    ]
    for (const [level, board] of shipped) {
      expect(JSON.stringify(generateLevel(level).board), `level ${level}`).toBe(board)
    }
  })

  it('pins board fingerprints on a sample', () => {
    const shipped: Record<number, number> = {
      1: 1887208115,
      10: 1538838375,
      15: 2468548079,
      30: 3734081521,
      41: 3390728781,
      60: 190048429,
      100: 187759145,
      250: 1624238735,
      400: 1642102687,
      600: 3614300481,
      1000: 3907565213,
      9999: 3741971889,
    }
    const actual: Record<number, number> = {}
    for (const level of Object.keys(shipped).map(Number)) {
      actual[level] = boardHash(generateLevel(level).board)
    }
    expect(actual).toEqual(shipped)
  })

  it('is deterministic on the sample', () => {
    for (const level of SAMPLE) {
      expect(buildLevel(level), `level ${level}`).toEqual(report(level))
    }
  })

  it('ships full colour tubes, two empties and no complete tube, solved by replay', () => {
    for (const level of SAMPLE) {
      const { level: board, fallback } = report(level)
      const colors = levelColors(level)
      expect(fallback, `level ${level} fallback`).toBe(false)
      expect(board.board.slice(0, colors).every((tube) => tube.length === CAP)).toBe(true)
      expect(board.board.slice(colors).every((tube) => tube.length === 0)).toBe(true)
      expectHardRequirements(board, colors)
      for (const move of board.solution) {
        expect(move.from).toBeLessThan(board.board.length)
        expect(move.to).toBeLessThan(board.board.length)
      }
    }
  })

  it('gives every level a different board and clamps out-of-range numbers', () => {
    const seen = new Set(SAMPLE.map((level) => JSON.stringify(report(level).level.board)))
    expect(seen.size).toBe(SAMPLE.length)
    expect(generateLevel(0)).toEqual(generateLevel(1))
    expect(generateLevel(MAX_LEVEL + 100)).toEqual(generateLevel(MAX_LEVEL))
  })

  it('makes the late levels longer to solve than the warm-up', () => {
    const length = (from: number, to: number): number => {
      let total = 0
      for (let level = from; level <= to; level++) total += report(level).level.solution.length
      return total / (to - from + 1)
    }
    expect(length(101, 130)).toBeGreaterThan(length(1, 10) * 2)
  })

  it('stays inside its solver budget across the sample', () => {
    for (const level of SAMPLE) {
      const { nodes, solves, draws } = report(level)
      expect(solves, `level ${level}`).toBeGreaterThanOrEqual(1)
      expect(nodes).toBeLessThanOrEqual(solves * SOLVE_NODE_BUDGET)
      expect(draws).toBeGreaterThanOrEqual(LEVEL_CANDIDATES)
    }
  })

  it('builds any sampled level in under 60ms (the per-level build budget)', () => {
    // Node is the reference; a phone is roughly 3–5× slower, and a build runs
    // on start/next, never per frame. The probe's warm worst case over 1–1000
    // is recorded in the ticket.
    buildLevel(200) // warm the JIT, as a running app would be
    let worst = 0
    for (const level of SAMPLE) {
      const start = performance.now()
      buildLevel(level)
      worst = Math.max(worst, performance.now() - start)
    }
    expect(worst).toBeLessThan(60)
  })

  it('falls back to a reverse scramble, solvable by construction, when no candidate solves', () => {
    for (const level of [1, 15, 60, 777]) {
      const starved = buildLevel(level, 0)
      expect(starved.fallback, `level ${level}`).toBe(true)
      expect(starved.solves).toBe(LEVEL_CANDIDATES)
      expectHardRequirements(starved.level, levelColors(level))
      expect(starved.level).toEqual(buildLevel(level, 0).level)
      expect(starved.level).toEqual(fallbackLevel(level, levelColors(level)))
    }
    expect(buildLevel(101, 0).level).not.toEqual(buildLevel(777, 0).level)
  })

  it('mixes a sorted board by transposition and keeps every unit', () => {
    expect(shuffledBoard(3, 2, 0, 1)).toEqual([[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [], []])
    for (const mix of [1, 5, null] as const) {
      const board = shuffledBoard(11, 2, mix, 17)
      const counts = new Map<number, number>()
      for (const tube of board) for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1)
      expect([...counts.values()].every((count) => count === CAP)).toBe(true)
      expect(board.slice(0, 11).every((tube) => tube.length === CAP)).toBe(true)
    }
    const once = shuffledBoard(11, 2, 1, 23)
    expect(once.filter((tube, index) => tube.some((color) => color !== index))).toHaveLength(2)
  })
})

describe('the padlock is never a toll (decision 31, half 1)', () => {
  /** 30–130 every level, every 50th to 1000, and the last level. */
  const LOCKED = SAMPLE.filter((level) => level >= EXTRA_SPARE_FROM)

  it('wins every padlocked level with the lock sealed, hidden vials and no question', () => {
    for (const level of LOCKED) {
      const { board, solution } = report(level).level
      const withSpare = addExtraSpare(createGame(board))
      expect(withSpare.tubes.length).toBeLessThanOrEqual(MAX_TWO_ROW_TUBES)
      const appended = withSpare.tubes.length - 1
      const sealed = sealSpares(withSpare, solution, appended)

      // Exactly one lock, on the appended empty spare; generated spares plain.
      expect(sealed.tubes.filter((tube) => tube.open === 0), `level ${level}`).toHaveLength(1)
      expect(sealed.tubes[appended]).toEqual({ colors: [], open: 0 })

      const hidden = pickHiddenTubes(level, sealed.tubes)
      expect(hidden, `level ${level} hidden`).toHaveLength(hiddenTubeCount(level))
      expect(hidden).not.toContain(appended)
      const concealed = hideBlocks(sealed, hidden)

      const finished = replayMoves(concealed, { board, solution })
      expect(isWon(finished), `level ${level} question-free win`).toBe(true)
      expect(finished.tubes[appended]).toEqual({ colors: [], open: 0 })
    }
  })

  it('shows no padlock before the appended spare', () => {
    for (let level = 1; level < EXTRA_SPARE_FROM; level++) {
      const { board, solution } = report(level).level
      const state = sealSpares(createGame(board), solution)
      expect(state.tubes.some((tube) => tube.open !== undefined), `level ${level}`).toBe(false)
    }
  })
})
