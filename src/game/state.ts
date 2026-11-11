import { DEFAULT_CAPACITY, canGrow, canPour, openSlots, pour } from './rules'
import type { ColorId, GameState } from './types'

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
 * Seal the board's spare tubes (ticket 09): every tube that starts empty is
 * the level's safety valve, and a sealed one has no open slots until the
 * player earns them at the gate, one block per correct answer.
 *
 * The generator scrambles into the spares, so a "spare" is not a fixed index:
 * it is whichever tube is empty on this board. A board with no empty tube has
 * no safety valve to earn and is left alone — those levels are already the
 * hardest, and sealing water would be nonsense. Tubes holding colours never
 * carry `open`.
 */
export function sealSpares(state: GameState): GameState {
  return {
    ...state,
    tubes: state.tubes.map((tube) =>
      tube.colors.length === 0 ? { colors: [], open: 0 } : tube,
    ),
  }
}

/**
 * Grow a spare by one open slot — the reward a correct gate answer grants.
 * Pure: only an empty tube with room to grow changes, so a partly filled
 * spare must be emptied before it can grow again (grow first, then pour).
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
  const tubes = state.tubes.map((tube) => ({ colors: [...tube.colors], open: tube.open }))
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
