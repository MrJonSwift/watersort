import { describe, expect, it } from 'vitest'
import {
  generateBoard,
  generateLevel,
  type Level,
} from './generator'
import { LEVELS, MAX_LEVEL, SPARES_LOCK_FROM, levelConfig, type LevelConfig } from './levels'
import { DEFAULT_CAPACITY, isComplete, isWon } from './rules'
import { createGame, sealSpares, tap } from './state'
import type { GameState } from './types'

const CAP = DEFAULT_CAPACITY

/** Number of contiguous colour runs across the board. */
function runCount(board: readonly (readonly number[])[]): number {
  let runs = 0
  for (const tube of board) {
    for (let i = 0; i < tube.length; i++) {
      if (i === 0 || tube[i] !== tube[i - 1]) runs++
    }
  }
  return runs
}

function replayMoves(start: GameState, level: Level): GameState {
  let state = start
  for (const move of level.solution) {
    const before = state
    const selected = tap(state, move.from)
    // The source must be selectable, not empty and not already won.
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

function replay(level: Level): GameState {
  return replayMoves(createGame(level.board), level)
}

/**
 * Ticket 14's new quality bar: the solution still wins with every spare the
 * solution never touches held shut at `open = 0`. Sealing only those empties
 * makes this true by construction, so a lock can never be a toll on the path.
 */
function replaySealed(level: Level): GameState {
  return replayMoves(sealSpares(createGame(level.board), level.solution), level)
}

function expectHardRequirements(level: Level, config: LevelConfig): void {
  expect(level.board).toHaveLength(config.colors + config.emptyTubes)

  const counts = new Map<number, number>()
  for (const tube of level.board) {
    expect(tube.length).toBeLessThanOrEqual(CAP)
    for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  expect(counts.size).toBe(config.colors)
  for (let color = 0; color < config.colors; color++) {
    expect(counts.get(color)).toBe(CAP)
  }

  const state = createGame(level.board)
  expect(state.tubes.some((tube) => isComplete(tube, CAP))).toBe(false)
  expect(isWon(state)).toBe(false)

  const finished = replay(level)
  expect(isWon(finished)).toBe(true)
  expect(finished.moves).toBe(level.solution.length)

  // Ticket 14: the validated solution also wins with its unused empties
  // sealed. The original gate above stays exactly as strict as it was.
  expect(isWon(replaySealed(level))).toBe(true)
}

describe('generateBoard', () => {
  it('is deterministic for the same config and seed', () => {
    const config = LEVELS[2]
    const first = generateBoard(config, 12345)
    const second = generateBoard(config, 12345)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
  })

  it('produces legal, solvable boards that respect the quality gate', () => {
    // A representative spread of tiers rather than every row: the numbered
    // levels are covered by `generateLevel` below, and this proves the gate
    // holds at arbitrary seeds too.
    const configs: LevelConfig[] = [
      { colors: 2, emptyTubes: 2, scramble: 4 },
      { colors: 3, emptyTubes: 2, scramble: 6 },
      { colors: 5, emptyTubes: 2, scramble: 16 },
      { colors: 8, emptyTubes: 2, scramble: 36 },
    ]

    for (const config of configs) {
      const threshold = Math.min(
        config.colors * CAP,
        config.colors + Math.ceil(config.scramble / 3),
      )
      let produced = 0

      for (let seed = 0; seed < 120; seed++) {
        const level = generateBoard(config, seed)
        if (!level) continue
        produced++
        expectHardRequirements(level, config)
        expect(level.solution.length).toBeGreaterThan(0)
        expect(level.solution.length).toBeLessThanOrEqual(config.scramble)
        expect(runCount(level.board)).toBeGreaterThanOrEqual(threshold)
      }

      expect(produced).toBeGreaterThan(0)
    }
  })

  it('rejects a scramble it cannot finish', () => {
    // One colour, no spare tube: no valid reverse move can ever exist.
    expect(generateBoard({ colors: 1, emptyTubes: 0, scramble: 4 }, 7)).toBeNull()
  })
})

describe('generateLevel', () => {
  it('is deterministic for a level number', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(generateLevel(level)).toEqual(generateLevel(level))
    }
  })

  it('gives every level a legal, solvable board that clears the quality gate', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const config = levelConfig(level)
      const board = generateLevel(level)
      expectHardRequirements(board, config)

      // Measured against the configured scramble, never the generator's easier
      // retry: a level that only ships because the scramble was quietly eased
      // fails here instead of reaching the family.
      const threshold = Math.min(
        config.colors * CAP,
        config.colors + Math.ceil(config.scramble / 3),
      )
      expect(runCount(board.board)).toBeGreaterThanOrEqual(threshold)
    }
  })

  it('keeps the four boards the family has already played', () => {
    // Board identity, not just a move count: a change to `seedFor` or to the
    // reverse-move rules would silently re-roll the levels people have beaten.
    // These are snapshots of shipped boards — changing one is a product
    // decision, so say so in the ticket rather than editing the string.
    const shipped: Array<[number, string]> = [
      [1, '[[],[0,0],[2,2,2],[1,1,1],[2,1,0,0]]'],
      [2, '[[0,0,0,1],[],[2,1],[2,2,2,0],[1,1]]'],
      [3, '[[0,1,0,2],[1,2],[2,0],[1,1,2],[0]]'],
      [4, '[[0,0,0,2],[3,3],[2,2,2,0],[1,1,1],[1,3,3],[]]'],
    ]
    for (const [level, board] of shipped) {
      expect(JSON.stringify(generateLevel(level).board)).toBe(board)
    }
  })

  it('records only the moves needed to win', () => {
    // Pours actually needed, replayed through tap(); trailing relocations are
    // dropped so a solution can never contain a move after the win. The replay
    // in `expectHardRequirements` fails if a move lands after the win, because
    // a won game ignores taps.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const { solution } = generateLevel(level)
      expect(solution.length).toBeGreaterThan(0)
      expect(solution.length).toBeLessThanOrEqual(levelConfig(level).scramble)
    }
  })

  it('makes the late levels longer to solve than the warm-up', () => {
    const average = (from: number, to: number): number => {
      let total = 0
      for (let level = from; level <= to; level++) total += generateLevel(level).solution.length
      return total / (to - from + 1)
    }
    expect(average(20, 30)).toBeGreaterThan(average(1, 3))
  })

  it('gives every level a different board', () => {
    const boards = new Set(
      Array.from({ length: MAX_LEVEL }, (_, i) => JSON.stringify(generateLevel(i + 1).board)),
    )
    expect(boards.size).toBe(MAX_LEVEL)
  })

  it('clamps out-of-range level numbers', () => {
    expect(generateLevel(0)).toEqual(generateLevel(1))
    expect(generateLevel(999)).toEqual(generateLevel(MAX_LEVEL))
  })

  it('replays through a real lock when a solution leaves an empty unused', () => {
    // A board shaped like a locked level: the solution uses empty 2, leaves
    // empty 3 shut. This keeps the new gate non-vacuous even though every
    // shipped 20–30 board happens to use all of its empties.
    const level: Level = {
      board: [[1, 1, 1], [1], [], []],
      solution: [
        { from: 1, to: 2, amount: 1 },
        { from: 2, to: 0, amount: 1 },
      ],
    }
    expect(sealSpares(createGame(level.board), level.solution).tubes[3].open).toBe(0)
    expect(isWon(replaySealed(level))).toBe(true)
  })

  it('pins the board re-rolled to restore a padlock (ticket 15)', () => {
    // Owner-signed-off content change: level 23's scramble moved 22 → 11,
    // the only (level, scramble) pair in 20–30 that leaves a solution-unused
    // empty under the seeded attempt selection. Levels 20–22 stepped down to
    // 8/9/10 to keep the tier strictly increasing. Boards 1–4 above are
    // untouched; these four are the re-roll and must not drift again.
    const reRolled: Array<[number, string]> = [
      [20, '[[0,0,0],[1,1,1],[2,2,4],[3,3,3,0],[4,4,4,7],[5,5],[6,6,6],[7,7,7,6],[3,1],[2,2,5,5]]'],
      [21, '[[0,0],[1,1,1],[2,2,3,3],[3,3,5,5],[4,4,4],[5],[6,0,0],[7,7,2,2],[4,6,6,6],[1,7,7,5]]'],
      [22, '[[0,0,0],[1,3],[2,2],[3,3,3,2],[4,4,6,2],[5,4],[6,6,6,7],[7,7,7,4],[0,5,5,5],[1,1,1]]'],
      [23, '[[0,0,0,4],[2,2],[2,2],[3,5,5,7],[4,1,1,1],[5,5,0,4],[6,6,6,1],[7,7,7,4],[],[3,3,3,6]]'],
    ]
    for (const [level, board] of reRolled) {
      expect(JSON.stringify(generateLevel(level).board), `level ${level}`).toBe(board)
    }
  })

  it('puts a padlock on level 23 only', () => {
    // The shipped locked tier: level 23's solution never pours into empty 8,
    // so that spare stays sealed and carries one padlock per slot. Every other
    // level either has no empty or uses all of them. Recorded so a future
    // table or generator edit cannot silently move or remove the lock.
    const locked: number[] = []
    for (let level = SPARES_LOCK_FROM; level <= MAX_LEVEL; level++) {
      const { board, solution } = generateLevel(level)
      const sealed = sealSpares(createGame(board), solution)
      sealed.tubes.forEach((tube, index) => {
        if (tube.open === 0) locked.push(level * 100 + index)
      })
    }
    expect(locked).toEqual([2308])
  })
})
