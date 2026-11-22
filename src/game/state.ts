import { DEFAULT_CAPACITY, canGrow, canPour, openSlots, pour } from './rules'
import type { ColorId, GameState, Move } from './types'

/*
 * Tubes are treated as immutable values: state changes either copy the tubes
 * they touch or reuse the untouched ones, and nothing mutates a Tube in place.
 * That is why `growBlock` and `sealSpares` may hand back unchanged references
 * while `pour` and `undo` deep-copy the pair they move water between.
 */

export function createGame(
  board: ColorId[][],
  capacity = DEFAULT_CAPACITY,
): GameState {
  return {
    tubes: board.map((colors) => ({ colors: [...colors] })),
    capacity,
    selected: null,
    moves: 0,
    history: [],
    won: false,
  }
}

/**
 * Seal the board's spare tubes that the level's validated solution never uses
 * (tickets 09 and 14). A sealed spare has no open slots until the player earns
 * them at the gate, one block per correct answer — but it is always optional:
 * because the solution never pours into a sealed tube, replaying it unchanged
 * wins with the sealed set held at `open = 0` forever.
 *
 * The generator scrambles into the spares, so a "spare" is not a fixed index:
 * it is whichever tube is empty on this board. An empty the solution pours
 * into (it is a `to` in any recorded move) stays fully open and is never
 * locked — sealing it would put a toll on the solution path. If the solution
 * uses every empty, no tube is sealed at all; that is recorded, deliberate,
 * and preferable to re-rolling a board people have already played.
 *
 * Tubes holding colours never carry `open`; rules never read the solution.
 */
export function sealSpares(state: GameState, solution: readonly Move[]): GameState {
  const used = new Set(solution.map((move) => move.to))
  return {
    ...state,
    tubes: state.tubes.map((tube, index) =>
      tube.colors.length === 0 && !used.has(index) ? { colors: [], open: 0 } : tube,
    ),
  }
}

/**
 * Append the guaranteed spare from `EXTRA_SPARE_FROM` (ticket 18). It is added
 * after generation, so every tube index in the validated solution stays valid
 * and never names this one. `sealSpares` therefore locks it while leaving the
 * level winnable without a question; a player who gets stuck can earn slots in
 * it through the gate. Pure: the incoming state is not mutated.
 */
export function addExtraSpare(state: GameState): GameState {
  return { ...state, tubes: [...state.tubes, { colors: [] }] }
}

/**
 * Grow a spare by one open slot — the reward a correct gate answer grants.
 * Pure: only a spare with room to grow changes. Since ticket 15 a spare may
 * keep growing while it holds colour; the new slot opens above what is poured.
 * Ordinary and fully open tubes are untouched.
 */
export function growBlock(state: GameState, index: number): GameState {
  const tube = state.tubes[index]
  if (!tube || !canGrow(tube, state.capacity)) return state
  return {
    ...state,
    tubes: state.tubes.map((t, i) =>
      i === index ? { colors: [...t.colors], open: openSlots(t, state.capacity) + 1 } : t,
    ),
  }
}

/**
 * Conceal the bottom blocks of the named tubes: a hidden tube shows "?" until
 * its segments surface at the top. Only tubes holding colours can hide
 * anything — an empty tube has nothing to conceal, which keeps the pick clear
 * of sealed spares.
 *
 * Since ticket 13 the top unit is always seen: a hidden tube of N units
 * conceals N−1 of them, so a one-unit tube hides nothing.
 */
export function hideBlocks(state: GameState, indices: readonly number[]): GameState {
  const picked = new Set(indices)
  return {
    ...state,
    tubes: state.tubes.map((tube, index) =>
      picked.has(index) && tube.colors.length > 1
        ? { colors: [...tube.colors], hidden: tube.colors.length - 1 }
        : tube,
    ),
  }
}

/** Handle a tap on a tube: select it, deselect it, or pour. */
export function tap(state: GameState, index: number): GameState {
  if (state.won) return state
  const tube = state.tubes[index]
  if (!tube) return state

  if (state.selected === null) {
    return tube.colors.length > 0 ? { ...state, selected: index } : state
  }

  if (state.selected === index) return { ...state, selected: null }

  if (canPour(state.tubes, state.selected, index, state.capacity)) {
    return pour(state, state.selected, index)
  }

  // The move is illegal: switch the selection to the tapped tube, or clear it.
  return tube.colors.length > 0
    ? { ...state, selected: index }
    : { ...state, selected: null }
}

/** Undo the most recent pour. */
export function undo(state: GameState): GameState {
  const last = state.history[state.history.length - 1]
  if (!last) return state

  // Earned slots survive an undo: they are session progress, not liquid.
  // Concealment (ticket 10) is knowledge, not liquid either: what was poured
  // has been seen and stays seen, so the counts ride along untouched.
  const tubes = state.tubes.map((tube) => ({
    colors: [...tube.colors],
    open: tube.open,
    hidden: tube.hidden,
  }))
  for (let i = 0; i < last.amount; i++) {
    tubes[last.from].colors.push(tubes[last.to].colors.pop() as ColorId)
  }

  return {
    ...state,
    tubes,
    selected: null,
    moves: state.moves - 1,
    history: state.history.slice(0, -1),
    won: false,
  }
}
