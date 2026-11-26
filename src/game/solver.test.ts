import { describe, expect, it } from 'vitest'
import { solve } from './solver'
import { mulberry32 } from './difficulty'
import { shuffledBoard } from './generator'
import { DEFAULT_CAPACITY, isWon, pour } from './rules'
import { createGame } from './state'
import type { ColorId, Move } from './types'

const CAP = DEFAULT_CAPACITY

/** Play a solution through the real rules; every move must be legal and exact. */
function replays(board: ColorId[][], solution: readonly Move[]): boolean {
  let state = createGame(board)
  for (const move of solution) {
    const next = pour(state, move.from, move.to)
    if (next === state) return false
    if (next.history[next.history.length - 1].amount !== move.amount) return false
    state = next
  }
  return isWon(state)
}

/**
 * Reference: exhaustive breadth-first search through `rules.pour` with no
 * pruning and exact string keys. Only for tiny boards; it is the independent
 * witness that the solver's pruning and hashed memo never lose a solution.
 */
function bruteSolvable(board: ColorId[][]): boolean {
  const start = createGame(board)
  const seen = new Set<string>([JSON.stringify(start.tubes.map((t) => t.colors))])
  let frontier = [start]
  while (frontier.length > 0) {
    const next = []
    for (const state of frontier) {
      if (isWon(state)) return true
      for (let from = 0; from < state.tubes.length; from++) {
        for (let to = 0; to < state.tubes.length; to++) {
          const after = pour(state, from, to)
          if (after === state) continue
          const key = JSON.stringify(after.tubes.map((t) => t.colors))
          if (seen.has(key)) continue
          seen.add(key)
          next.push(after)
        }
      }
    }
    frontier = next
  }
  return false
}

/** Balanced, unsolvable, and it still has legal moves: the search must exhaust. */
const UNSOLVABLE: ColorId[][] = [[0, 1, 2, 1], [2, 1, 1, 0], [0, 0, 2], [2]]

describe('solve', () => {
  it('solves small known boards and the solution replays to a win', () => {
    const boards: ColorId[][][] = [
      [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2], []],
      [[0, 1, 0, 1], [1, 0, 1, 0], []],
      [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2], []],
      [[1, 1, 1], [1], [], []],
    ]
    for (const board of boards) {
      const { solution } = solve(board, 10_000)
      expect(solution, JSON.stringify(board)).not.toBeNull()
      expect(replays(board, solution as Move[]), JSON.stringify(board)).toBe(true)
    }
  })

  it('returns an empty solution for a board that is already won', () => {
    expect(solve([[0, 0, 0, 0], [], [1, 1, 1, 1]], 10)).toEqual({ solution: [], nodes: 0 })
  })

  it('solves full eleven-colour shuffles with two spares', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const board = shuffledBoard(11, 2, null, seed)
      const { solution, nodes } = solve(board, 20_000)
      expect(solution, `seed ${seed}`).not.toBeNull()
      expect(replays(board, solution as Move[]), `seed ${seed}`).toBe(true)
      expect(nodes).toBeLessThanOrEqual(20_000)
    }
  })

  it('returns null on a known unsolvable board, well inside its budget', () => {
    expect(bruteSolvable(UNSOLVABLE)).toBe(false)
    const start = createGame(UNSOLVABLE)
    const hasMove = start.tubes.some((_, from) =>
      start.tubes.some((_, to) => pour(start, from, to) !== start),
    )
    expect(hasMove).toBe(true)
    const result = solve(UNSOLVABLE, 10_000)
    expect(result.solution).toBeNull()
    expect(result.nodes).toBeGreaterThan(1)
    expect(result.nodes).toBeLessThan(10_000)
  })

  it('agrees with an unpruned brute-force search on small random boards', () => {
    const rng = mulberry32(25)
    let solvable = 0
    let unsolvable = 0
    for (let trial = 0; trial < 150; trial++) {
      const units = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]
      for (let k = units.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1))
        ;[units[k], units[j]] = [units[j], units[k]]
      }
      const board = [units.slice(0, 4), units.slice(4, 8), units.slice(8, 11), units.slice(11)]
      const expected = bruteSolvable(board)
      const { solution } = solve(board, 100_000)
      expect(solution !== null, JSON.stringify(board)).toBe(expected)
      if (solution) expect(replays(board, solution), JSON.stringify(board)).toBe(true)
      if (expected) solvable++
      else unsolvable++
    }
    // Both outcomes are exercised, so the agreement is not vacuous.
    expect(solvable).toBeGreaterThan(10)
    expect(unsolvable).toBeGreaterThan(10)
  })

  it('stops at its node budget and reports null rather than searching on', () => {
    const board = shuffledBoard(11, 2, null, 3)
    const result = solve(board, 5)
    expect(result.solution).toBeNull()
    expect(result.nodes).toBe(5)
  })

  it('is deterministic: the same board gives the same moves', () => {
    const board = shuffledBoard(11, 2, null, 99)
    const first = solve(board, 20_000)
    const second = solve(board.map((tube) => [...tube]), 20_000)
    expect(second).toEqual(first)
  })

  it('never mutates the board it is given', () => {
    const board = shuffledBoard(11, 2, null, 5)
    const copy = JSON.stringify(board)
    solve(board, 20_000)
    expect(JSON.stringify(board)).toBe(copy)
  })

  it('respects a smaller capacity', () => {
    const board: ColorId[][] = [[0, 1, 0], [1, 0, 1], []]
    const { solution } = solve(board, 1_000, 3)
    expect(solution).not.toBeNull()
    let state = createGame(board, 3)
    for (const move of solution as Move[]) state = pour(state, move.from, move.to)
    expect(isWon(state)).toBe(true)
    expect(CAP).toBe(4) // the shipped capacity; 3 here only exercises the parameter
  })
})
