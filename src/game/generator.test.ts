import { describe, expect, it } from 'vitest'
import {
  generateBoard,
  generateLevel,
  type Level,
} from './generator'
import {
  CLIMB_FROM,
  LATE_BOARD_MIN_MULTI,
  LEVELS,
  MAX_LEVEL,
  SPARES_LOCK_FROM,
  levelConfig,
  type LevelConfig,
} from './levels'
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

/** Compact identity for a board: a re-roll of any late level shows up here. */
function boardHash(board: readonly (readonly number[])[]): number {
  const text = JSON.stringify(board)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
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
    // Ticket 19: the derived expert tier is longer again than the 10-colour
    // end of the hand-tuned curve, from scramble alone.
    expect(average(41, 50)).toBeGreaterThan(average(36, 40))
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

  it('leaves no shipped locked-tier level needing a question to be won', () => {
    // Probe of levels 20–30 (ticket 14): every empty on those boards is a
    // solution destination, so solution-aware sealing leaves no padlock at
    // all. Ticket 15 probed a scramble re-roll again but the owner declined
    // the cost (four levels would become easier than level 19); this curve
    // stands. Ticket 17's probe of 31–40 found the same: 31 has no empty and
    // each of 32–40 has exactly one, used by the solution, so no padlock
    // appears on any shipped board even with ten colours. Recorded so a board
    // re-roll — a content decision — shows up. Ticket 18 appends a spare at
    // build time from level 30, so the controller shows a padlock without
    // changing any board or solution asserted here. Ticket 19's derived levels
    // keep the same property: each generated empty is a solution destination,
    // so the appended spare (41–45) is their only guaranteed padlock.
    for (let level = SPARES_LOCK_FROM; level <= MAX_LEVEL; level++) {
      const { board, solution } = generateLevel(level)
      const sealed = sealSpares(createGame(board), solution)
      expect(sealed.tubes.some((tube) => tube.open === 0), `level ${level}`).toBe(false)
    }
  })

  it('generation still ships exactly its configured colours and two spares', () => {
    // The ticket-18 spare is appended by the controller, never generated.
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const config = levelConfig(level)
      expect(generateLevel(level).board).toHaveLength(config.colors + config.emptyTubes)
    }
  })

  it('shapes every climb board for the optional lock and twelve hidden vials', () => {
    // Ticket 20's seed-selection rule, gated to 51+ so 1–50 never see it: a
    // gate-passing board is accepted only with a coloured, solution-unused
    // spare at index 12 or 13 and at least twelve multi-unit tubes.
    for (let level = CLIMB_FROM; level <= MAX_LEVEL; level++) {
      const { board, solution } = generateLevel(level)
      expect(board, `level ${level}`).toHaveLength(14)

      const used = new Set(solution.map((move) => move.to))
      const spares = [board.length - 2, board.length - 1]
      expect(
        spares.some((index) => board[index].length >= 2 && !used.has(index)),
        `level ${level} lockable spare`,
      ).toBe(true)

      const multi = board.filter((tube) => tube.length >= 2).length
      expect(multi, `level ${level} multi-unit tubes`).toBeGreaterThanOrEqual(
        LATE_BOARD_MIN_MULTI,
      )

      // The plain empty is always a solution destination, so it can never be
      // mistaken for the padlock target. Only a full spare is lockable.
      board.forEach((tube, index) => {
        if (tube.length === 0) expect(used.has(index), `level ${level} empty ${index}`).toBe(true)
      })
    }
  })

  it('pins the boards of the climb', () => {
    // A table or generator change that re-rolls a played late board is a
    // content decision, so the whole 51–100 range is fingerprinted here.
    const fingerprints = [
      939647397, 1521943897, 1371435723, 1473887523, 1536026407,
      2047833879, 2607242405, 1568599109, 2906388333, 719278825,
      2200720833, 4150724187, 712135067, 1642723397, 751712713,
      3248196649, 3373488153, 2816441011, 665171589, 1916113857,
      3935649395, 2109881329, 1723013447, 614620663, 169528423,
      2493276711, 2952658861, 3463480869, 3767841425, 3004309343,
      2956304051, 3870795353, 2332226747, 1119897469, 2722364057,
      684001051, 3141846701, 3134865465, 2200118745, 1064417121,
      517320057, 2041051645, 1428799705, 840055599, 3145047475,
      1306342975, 2668336381, 313949121, 1370988231, 3058227765,
    ]
    expect(fingerprints).toHaveLength(MAX_LEVEL - CLIMB_FROM + 1)
    for (let level = CLIMB_FROM; level <= MAX_LEVEL; level++) {
      expect(boardHash(generateLevel(level).board), `level ${level}`).toBe(
        fingerprints[level - CLIMB_FROM],
      )
    }
  })
})
