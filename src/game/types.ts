/** Index into the color palette; renders as the CSS variable `--c-<id>`. */
export type ColorId = number

export interface Tube {
  /** Colors stacked bottom-first. Index 0 is the bottom of the tube. */
  colors: ColorId[]
  /**
   * Slots currently open, on a spare whose capacity is earned at the gate
   * (ticket 09). Undefined when every slot is open — the normal tube.
   */
  open?: number
  /**
   * Units concealed at the bottom of this tube (ticket 10): the tube shows
   * "?" for its lowest `hidden` blocks until they surface. Undefined or zero
   * when every block shows its colour. Rules never read it — it is pure
   * knowledge — but `pour` and `undo` keep it honest.
   */
  hidden?: number
}

export interface Move {
  from: number
  to: number
  /** Number of color units moved. */
  amount: number
}

export interface GameState {
  tubes: Tube[]
  /** How many units a single tube can hold. */
  capacity: number
  /** Index of the currently selected tube, or null when nothing is selected. */
  selected: number | null
  moves: number
  history: Move[]
  won: boolean
}

/**
 * A user or game action, used to drive presentation (animation, sound).
 * The controller builds these from a tap; the water stage and UI consume them.
 */
export type GameEvent =
  | { type: 'pour'; from: number; to: number; amount: number; color: ColorId }
  | { type: 'select'; index: number }
  | { type: 'deselect' }
  | { type: 'invalid'; index: number }
  /** A spare grew by one open slot at the earn gate. */
  | { type: 'grow'; index: number }
  | { type: 'undo' }
  | { type: 'new' }
  | { type: 'none' }
