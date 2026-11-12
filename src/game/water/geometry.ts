/**
 * Pure geometry helpers for the water stage: where a tilted tube's spout is,
 * how a tube's pose maps local points into canvas space, and where the slot
 * boundaries sit inside the glass.
 *
 * Kept free of DOM access so the choreography math is testable and reusable.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Pose {
  dx: number
  dy: number
  rot: number
  scale: number
}

export const REST_POSE: Pose = { dx: 0, dy: 0, rot: 0, scale: 1 }

/** Map a point in a tube's untransformed local space through its pose. */
export function localToCanvas(rect: Rect, pose: Pose, px: number, py: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const sx = (px - cx) * pose.scale
  const sy = (py - cy) * pose.scale
  const cos = Math.cos(pose.rot)
  const sin = Math.sin(pose.rot)
  return {
    x: cx + pose.dx + sx * cos - sy * sin,
    y: cy + pose.dy + sx * sin + sy * cos,
  }
}

/**
 * The pouring lip: the top corner of the tube that sits lower once the tube is
 * tilted by `rot` (positive rotation swings the right side down).
 */
export function spoutLocal(rect: Rect, rot: number): { x: number; y: number } {
  return rot > 0 ? { x: rect.x + rect.w, y: rect.y } : { x: rect.x, y: rect.y }
}

/**
 * Y offsets from the top of the glass, one per internal slot boundary.
 *
 * These are the same boundaries the renderer fills liquid to: liquid is laid
 * out from the bottom (`bottom - units * unit`), so a guide struck at
 * `top + height * i / capacity` meets a resting liquid edge exactly. Kept
 * capacity-agnostic because the slot count will change; a capacity below two
 * has no internal boundary, and a height that is not positive and finite
 * cannot be split (a zero height is an unmeasured tube, not an empty one).
 */
export function unitBoundaryYs(height: number, capacity: number): number[] {
  if (!Number.isFinite(height) || height <= 0) return []
  if (!Number.isFinite(capacity) || capacity < 2) return []
  const boundaries: number[] = []
  for (let i = 1; i < capacity; i++) boundaries.push((height * i) / capacity)
  return boundaries
}

/**
 * Guide boundaries that actually exist on a partly open tube (ticket 09).
 *
 * Open slots fill from the bottom, so the sealed region is the top
 * `capacity - open` units; boundaries inside it are not drawn. The boundary at
 * the seal edge is drawn by the seal line, not here. `open` defaults to a
 * fully open tube, matching `Tube.open` being undefined for ordinary tubes.
 */
export function visibleBoundaryYs(height: number, capacity: number, open = capacity): number[] {
  if (!Number.isFinite(open)) return []
  const sealed = Math.max(0, capacity - Math.trunc(open))
  if (sealed <= 0) return unitBoundaryYs(height, capacity)
  return unitBoundaryYs(height, capacity).filter((_, index) => index + 1 > sealed)
}

/**
 * Distance from the top of the glass to the seal edge of a partly open tube,
 * or `null` when no slot is sealed. A wholly sealed spare seals at the bottom
 * (the veil covers everything); the renderer draws a line only when the seal
 * edge is above the bottom.
 */
export function sealLineY(height: number, capacity: number, open = capacity): number | null {
  if (!Number.isFinite(height) || height <= 0) return null
  if (!Number.isFinite(capacity) || capacity < 1) return null
  if (!Number.isFinite(open)) return null
  const sealed = Math.max(0, capacity - Math.trunc(open))
  if (sealed === 0) return null
  return (height * sealed) / capacity
}

/**
 * Distance from the top of the glass to the top edge of a tube's concealed
 * band (ticket 10): the bottom `hidden` units are painted as "?", so the band
 * reaches from the glass bottom up to this line. A fully concealed tube
 * reaches the glass top (0), which is a real edge, not "nothing to paint" —
 * only a count of zero is `null`. A count above the capacity clamps to the
 * glass rather than escaping it.
 */
export function concealedTopY(height: number, capacity: number, hidden = 0): number | null {
  if (!Number.isFinite(height) || height <= 0) return null
  if (!Number.isFinite(capacity) || capacity < 1) return null
  if (!Number.isFinite(hidden)) return null
  const concealed = Math.min(capacity, Math.max(0, Math.trunc(hidden)))
  if (concealed === 0) return null
  return (height * (capacity - concealed)) / capacity
}

/**
 * Pose that hovers `rect` above `target` so its spout pours into `target`:
 * the tube is lifted until the spout is `gap` px above the target's top edge,
 * and tilted by `tiltDeg` toward the board centre so the body stays on screen.
 */
export function hoverPose(
  rect: Rect,
  target: Rect,
  boardCenterX: number,
  tiltDeg: number,
  gap: number,
): Pose {
  const dir = target.x + target.w / 2 >= boardCenterX ? 1 : -1
  const rot = ((tiltDeg * dir) * Math.PI) / 180
  const spout = spoutLocal(rect, rot)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const sx = spout.x - cx
  const sy = spout.y - cy
  const rotatedX = sx * cos - sy * sin
  const rotatedY = sx * sin + sy * cos

  const targetX = target.x + target.w / 2
  const targetY = target.y - gap
  return {
    dx: targetX - cx - rotatedX,
    dy: targetY - cy - rotatedY,
    rot,
    scale: 1,
  }
}
