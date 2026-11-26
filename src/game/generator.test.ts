import { describe, expect, it } from 'vitest'
import {
  buildLevel,
  generateBoard,
  generateLevel,
  shuffledBoard,
  type BuildReport,
  type Level,
} from './generator'
import {
  CLIMB_FROM,
  CLIMB_LAST,
  LATE_BOARD_MIN_MULTI,
  LEVELS,
  MAX_LEVEL,
  MAX_TWO_ROW_TUBES,
  SHUFFLE_CANDIDATES,
  SHUFFLE_COLORS,
  SHUFFLE_FROM,
  SHUFFLE_SPARES,
  SOLVE_NODE_BUDGET,
  SPARES_LOCK_FROM,
  hiddenTubeCount,
  levelConfig,
  type LevelConfig,
} from './levels'
import { pickHiddenTubes } from './hidden'
import { DEFAULT_CAPACITY, isComplete, isWon } from './rules'
import { addExtraSpare, createGame, hideBlocks, sealSpares, tap } from './state'
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
  // The pre-climb rule: this helper checks the generator's own invariant. The
  // appended-empty seal on real 51+ boards is asserted separately below.
  return replayMoves(
    sealSpares(createGame(level.board), level.solution, CLIMB_FROM - 1),
    level,
  )
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
    for (let level = 1; level <= CLIMB_LAST; level++) {
      expect(generateLevel(level)).toEqual(generateLevel(level))
    }
  })

  it('gives every level a legal, solvable board that clears the quality gate', () => {
    for (let level = 1; level <= CLIMB_LAST; level++) {
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
    for (let level = 1; level <= CLIMB_LAST; level++) {
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
      Array.from({ length: CLIMB_LAST }, (_, i) => JSON.stringify(generateLevel(i + 1).board)),
    )
    expect(boards.size).toBe(CLIMB_LAST)
  })

  it('clamps out-of-range level numbers', () => {
    expect(generateLevel(0)).toEqual(generateLevel(1))
    expect(generateLevel(MAX_LEVEL + 50)).toEqual(generateLevel(MAX_LEVEL))
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
    expect(
      sealSpares(createGame(level.board), level.solution, CLIMB_FROM - 1).tubes[3].open,
    ).toBe(0)
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
    // so the appended spare (41–50) is their only guaranteed padlock. Ticket
    // 24's probe of 46–50 found the same at 11 colours, so generation alone
    // still shows no lock; the controller's appended spare is what seals. From
    // 51 the lock deliberately lands on that appended empty spare; that is
    // asserted separately below.
    for (let level = SPARES_LOCK_FROM; level < CLIMB_FROM; level++) {
      const { board, solution } = generateLevel(level)
      const sealed = sealSpares(createGame(board), solution, level)
      expect(sealed.tubes.some((tube) => tube.open === 0), `level ${level}`).toBe(false)
    }
  })

  it('generation still ships exactly its configured colours and two spares', () => {
    // The ticket-18 spare is appended by the controller, never generated.
    for (let level = 1; level <= CLIMB_LAST; level++) {
      const config = levelConfig(level)
      expect(generateLevel(level).board).toHaveLength(config.colors + config.emptyTubes)
    }
  })

  it('shapes every climb board for the optional lock and eleven hidden vials', () => {
    // Ticket 20's seed-selection rule, gated to 51+ so 1–50 never see it: a
    // gate-passing board is accepted only with a solution-unused spare and at
    // least eleven multi-unit tubes. At 11 colours (ticket 24) the generated
    // board is 13 tubes; the controller appends the empty 14th.
    for (let level = CLIMB_FROM; level <= CLIMB_LAST; level++) {
      const { board, solution } = generateLevel(level)
      expect(board, `level ${level}`).toHaveLength(MAX_TWO_ROW_TUBES - 1)

      const used = new Set(solution.map((move) => move.to))
      const spares = [board.length - 2, board.length - 1]
      expect(
        spares.some((index) => !used.has(index)),
        `level ${level} unused spare`,
      ).toBe(true)

      const multi = board.filter((tube) => tube.length >= 2).length
      expect(multi, `level ${level} multi-unit tubes`).toBeGreaterThanOrEqual(
        LATE_BOARD_MIN_MULTI,
      )

      // Every generated empty is a solution destination, so the only spare the
      // padlock can land on is the empty tube appended after generation.
      board.forEach((tube, index) => {
        if (tube.length === 0) expect(used.has(index), `level ${level} empty ${index}`).toBe(true)
      })
    }
  })

  it('locks the appended empty spare on every climb board and still wins without a question', () => {
    // Ticket 24 supersedes ticket 22's coloured padding: from level 51 the
    // padlock sits on the empty spare appended after generation. Unlocking it
    // reveals an empty tube, and a clean solve wins with it still shut.
    for (let level = CLIMB_FROM; level <= CLIMB_LAST; level++) {
      const { board, solution } = generateLevel(level)
      const withSpare = addExtraSpare(createGame(board))
      const appended = withSpare.tubes.length - 1
      const sealed = sealSpares(withSpare, solution, level, appended)

      const locks = sealed.tubes
        .map((tube, index) => ({ tube, index }))
        .filter(({ tube }) => tube.open === 0)
      expect(locks, `level ${level} lock count`).toHaveLength(1)
      expect(locks[0].index, `level ${level} lock is the appended spare`).toBe(appended)
      expect(locks[0].tube, `level ${level} lock is empty`).toEqual({ colors: [], open: 0 })

      // At least one plain empty remains, and the solution uses it.
      const plain = sealed.tubes
        .map((tube, index) => ({ tube, index }))
        .filter(({ tube, index }) => index !== appended && tube.colors.length === 0)
      expect(plain.length, `level ${level} plain empties`).toBeGreaterThanOrEqual(1)
      expect(
        plain.some(({ index }) => solution.some((move) => move.to === index)),
        `level ${level} plain empty is solution-used`,
      ).toBe(true)

      // Concealment never picks the empty lock; level 100 hosts all eleven.
      const hidden = pickHiddenTubes(level, sealed.tubes)
      expect(hidden, `level ${level} hidden picks`).toHaveLength(hiddenTubeCount(level))
      expect(hidden, `level ${level} lock not hidden`).not.toContain(appended)
      if (level === CLIMB_LAST) expect(hidden).toHaveLength(11)

      const withHidden = hideBlocks(sealed, hidden)
      const finished = replayMoves(withHidden, { board, solution })
      expect(isWon(finished), `level ${level} question-free win`).toBe(true)
      expect(finished.tubes[appended], `level ${level} lock ends empty`).toEqual({
        colors: [],
        open: 0,
      })
    }
  })

  it('pins the boards from level 46 to 100', () => {
    // A table or generator change that re-rolls a played late board is a
    // content decision, so the whole re-rolled range is fingerprinted here.
    // Ticket 24 extends the pin down to 46, where the 11-colour tier starts.
    const fingerprints = [
      2096607095, 2584817389, 4087411265, 3657156195, 2814478443,
      3943831085, 2935250561, 3693630055, 2935818805, 1967059147,
      957977025, 3394823399, 1903867179, 3423314979, 3359557273,
      1417481505, 2439773561, 1288901993, 4137035931, 1543617553,
      2484008931, 1214199979, 3507996735, 2461474487, 1149538155,
      256931677, 3596101741, 576492813, 3539829923, 1821611917,
      3195068655, 3678384671, 632062833, 1673364877, 2759188737,
      3429732519, 3673491273, 4167734845, 4123627717, 1312299431,
      4223426163, 2486346957, 4049888829, 3703095411, 3517091525,
      1546036077, 1863821541, 3517617095, 282612027, 1034879865,
      2421887273, 1028740209, 3106196581, 1601882599, 1395019001,
    ]
    const first = 46
    expect(fingerprints).toHaveLength(CLIMB_LAST - first + 1)
    for (let level = first; level <= CLIMB_LAST; level++) {
      expect(boardHash(generateLevel(level).board), `level ${level}`).toBe(
        fingerprints[level - first],
      )
    }
  })
})

/**
 * The shuffled tier (ticket 25). Levels from `SHUFFLE_FROM` are seeded full
 * shuffles proven solvable by the bundled solver; these tests replay each
 * returned solution through the real rules.
 */
describe('shuffled tier', () => {
  /** 101–130, every 50th level to 1000, and the last level. */
  const SAMPLE: number[] = []
  for (let level = SHUFFLE_FROM; level <= 130; level++) SAMPLE.push(level)
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

  it('keeps the first four shuffled boards', () => {
    // Snapshots of the first boards past the frozen range. A change to the
    // mix, seed stream, scorer or selection rule re-rolls them: a content
    // decision, made in a ticket with this test updated in the same commit.
    const shipped: Array<[number, string]> = [
      [101, '[[0,1,0,0],[1,1,6,1],[9,2,2,2],[3,3,3,7],[4,8,4,4],[5,5,9,5],[8,6,10,6],[7,3,7,7],[0,8,8,2],[9,9,5,4],[10,10,10,6],[],[]]'],
      [102, '[[0,0,7,0],[1,1,1,5],[10,4,2,2],[3,8,3,3],[4,9,4,2],[5,5,5,7],[6,6,2,6],[0,1,7,7],[8,6,8,3],[9,4,9,9],[8,10,10,10],[],[]]'],
      [103, '[[0,8,0,3],[6,1,9,1],[2,2,2,9],[3,0,3,3],[4,4,5,4],[5,4,5,9],[6,6,1,6],[2,7,10,7],[8,8,8,0],[9,5,7,1],[7,10,10,10],[],[]]'],
      [104, '[[0,7,0,0],[7,1,3,1],[2,2,2,9],[3,3,3,5],[4,2,4,8],[5,5,5,1],[10,6,6,6],[7,0,7,1],[8,10,8,8],[9,4,9,9],[10,6,4,10],[],[]]'],
    ]
    for (const [level, board] of shipped) {
      expect(JSON.stringify(generateLevel(level).board), `level ${level}`).toBe(board)
    }
  })

  it('is deterministic on the sample', () => {
    for (const level of SAMPLE) {
      expect(buildLevel(level), `level ${level}`).toEqual(report(level))
    }
  })

  it('ships eleven full colour tubes, two empties and no complete tube, solved by replay', () => {
    for (const level of SAMPLE) {
      const { level: built, fallback } = report(level)
      const { board, solution } = built
      expect(fallback, `level ${level} fallback`).toBe(false)
      expect(board, `level ${level}`).toHaveLength(SHUFFLE_COLORS + SHUFFLE_SPARES)
      expect(board.slice(0, SHUFFLE_COLORS).every((tube) => tube.length === CAP)).toBe(true)
      expect(board.slice(SHUFFLE_COLORS).every((tube) => tube.length === 0)).toBe(true)
      expectHardRequirements(built, levelConfig(level))

      // The solver ran on the 13 generated tubes, so it never names the
      // appended spare the controller adds as the 14th.
      for (const move of solution) {
        expect(move.from, `level ${level}`).toBeLessThan(board.length)
        expect(move.to, `level ${level}`).toBeLessThan(board.length)
      }
    }
  })

  it('locks the appended empty spare and still wins with eleven hidden vials and no question', () => {
    // Ticket 24's no-toll promise, extended to the shuffled tier: the level
    // wins with the padlock sealed, every colour tube concealed, and the lock
    // ending as it started.
    for (const level of SAMPLE) {
      const { board, solution } = report(level).level
      const withSpare = addExtraSpare(createGame(board))
      const appended = withSpare.tubes.length - 1
      expect(withSpare.tubes).toHaveLength(MAX_TWO_ROW_TUBES)
      const sealed = sealSpares(withSpare, solution, level, appended)

      const locks = sealed.tubes.filter((tube) => tube.open === 0)
      expect(locks, `level ${level} lock count`).toHaveLength(1)
      expect(sealed.tubes[appended]).toEqual({ colors: [], open: 0 })

      const hidden = pickHiddenTubes(level, sealed.tubes)
      expect(hiddenTubeCount(level)).toBe(11)
      expect(hidden, `level ${level} hidden picks`).toHaveLength(11)
      expect(hidden).not.toContain(appended)
      const concealed = hideBlocks(sealed, hidden)
      // Full tubes: three concealed units under each seen top, 33 in all.
      expect(concealed.tubes.reduce((sum, tube) => sum + (tube.hidden ?? 0), 0)).toBe(33)

      const finished = replayMoves(concealed, { board, solution })
      expect(isWon(finished), `level ${level} question-free win`).toBe(true)
      expect(finished.tubes[appended]).toEqual({ colors: [], open: 0 })
    }
  })

  it('stays inside its solver budget without a fallback across the sample', () => {
    for (const level of SAMPLE) {
      const { nodes, solves, draws } = report(level)
      expect(solves, `level ${level}`).toBeGreaterThanOrEqual(1)
      expect(nodes as number, `level ${level}`).toBeLessThanOrEqual(
        (solves as number) * SOLVE_NODE_BUDGET,
      )
      expect(draws as number, `level ${level}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('builds any sampled level in under 60ms (the per-level build budget)', () => {
    // Node is the reference; a phone is roughly 3–5× slower, and a build runs
    // on start/next, never per frame. The probe's warm worst case over
    // 101–1000 was well under half this budget.
    buildLevel(SHUFFLE_FROM) // warm the JIT, as a running app would be
    let worst = 0
    for (const level of SAMPLE) {
      const start = performance.now()
      buildLevel(level)
      worst = Math.max(worst, performance.now() - start)
    }
    expect(worst).toBeLessThan(60)
  })

  it('falls back to the level-100 reverse scramble when no candidate solves', () => {
    // Starve the solver: every candidate is skipped, and the level still ships
    // a solvable, gate-shaped board seeded by its own number instead of hanging.
    for (const level of [SHUFFLE_FROM, 777]) {
      const starved = buildLevel(level, 0)
      expect(starved.fallback, `level ${level}`).toBe(true)
      expect(starved.solves).toBe(SHUFFLE_CANDIDATES)
      expectHardRequirements(starved.level, levelConfig(level))
      expect(starved.level.board).toHaveLength(MAX_TWO_ROW_TUBES - 1)
      expect(starved.level).toEqual(buildLevel(level, 0).level)
    }
    // Different levels fall back to different boards.
    expect(buildLevel(SHUFFLE_FROM, 0).level).not.toEqual(buildLevel(777, 0).level)
  })

  it('mixes a sorted board by transposition and keeps every unit', () => {
    const sorted = shuffledBoard(3, 2, 0, 1)
    expect(sorted).toEqual([[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [], []])
    for (const mix of [1, 5, null] as const) {
      const board = shuffledBoard(11, 2, mix, 17)
      const counts = new Map<number, number>()
      for (const tube of board) for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1)
      expect([...counts.values()].every((count) => count === CAP)).toBe(true)
      expect(board.slice(0, 11).every((tube) => tube.length === CAP)).toBe(true)
    }
    // One transposition moves exactly two units between two different tubes.
    const once = shuffledBoard(11, 2, 1, 23)
    const changed = once.filter((tube, index) => tube.some((color) => color !== index))
    expect(changed).toHaveLength(2)
  })
})
