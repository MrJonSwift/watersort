import { describe, expect, it } from 'vitest'
import {
  concealedTopY,
  hoverPose,
  localToCanvas,
  sealLineY,
  spoutLocal,
  unitBoundaryYs,
  visibleBoundaryYs,
} from './geometry'

const rect = { x: 100, y: 100, w: 50, h: 120 }
const target = { x: 300, y: 320, w: 50, h: 120 }

describe('localToCanvas', () => {
  it('is identity for a rest pose', () => {
    const p = localToCanvas(rect, { dx: 0, dy: 0, rot: 0, scale: 1 }, 110, 120)
    expect(p).toEqual({ x: 110, y: 120 })
  })

  it('applies translation', () => {
    const p = localToCanvas(rect, { dx: 5, dy: -3, rot: 0, scale: 1 }, 110, 120)
    expect(p).toEqual({ x: 115, y: 117 })
  })

  it('rotates around the rect centre', () => {
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    const p = localToCanvas(rect, { dx: 0, dy: 0, rot: Math.PI / 2, scale: 1 }, center.x, center.y)
    expect(p.x).toBeCloseTo(center.x, 5)
    expect(p.y).toBeCloseTo(center.y, 5)
  })
})

describe('spoutLocal', () => {
  it('picks the right top corner when tilting right', () => {
    expect(spoutLocal(rect, 0.5)).toEqual({ x: rect.x + rect.w, y: rect.y })
  })

  it('picks the left top corner when tilting left', () => {
    expect(spoutLocal(rect, -0.5)).toEqual({ x: rect.x, y: rect.y })
  })
})

describe('unitBoundaryYs', () => {
  it('splits a four-unit tube into equal slots', () => {
    expect(unitBoundaryYs(120, 4)).toEqual([30, 60, 90])
  })

  it('follows the capacity rather than assuming four slots', () => {
    expect(unitBoundaryYs(120, 5)).toEqual([24, 48, 72, 96])
  })

  it('starts one slot down from the top and ends one slot up from the bottom', () => {
    const ys = unitBoundaryYs(120, 4)
    const slot = 120 / 4
    expect(ys[0]).toBe(slot)
    expect(ys[ys.length - 1]).toBe(120 - slot)
  })

  it('returns nothing for a capacity below two', () => {
    expect(unitBoundaryYs(120, 1)).toEqual([])
    expect(unitBoundaryYs(120, 0)).toEqual([])
  })

  it('returns nothing for a height it cannot divide', () => {
    // Height 0 is a tube the stage has not measured yet, not an empty one:
    // three zero-length guide lines would just be stroke spam.
    expect(unitBoundaryYs(Number.NaN, 4)).toEqual([])
    expect(unitBoundaryYs(0, 4)).toEqual([])
    expect(unitBoundaryYs(-120, 4)).toEqual([])
  })

  it('returns nothing for a capacity it cannot count', () => {
    expect(unitBoundaryYs(120, Number.POSITIVE_INFINITY)).toEqual([])
  })
})

describe('visibleBoundaryYs', () => {
  it('returns every boundary when nothing is sealed', () => {
    expect(visibleBoundaryYs(120, 4)).toEqual([30, 60, 90])
    expect(visibleBoundaryYs(120, 4, 4)).toEqual([30, 60, 90])
  })

  it('drops boundaries inside the sealed top region', () => {
    // open 1: only the bottom slot exists; its top edge is the seal line.
    expect(visibleBoundaryYs(120, 4, 1)).toEqual([])
    // open 2: one boundary between the two open slots.
    expect(visibleBoundaryYs(120, 4, 2)).toEqual([90])
    // open 3: two boundaries in the open region.
    expect(visibleBoundaryYs(120, 4, 3)).toEqual([60, 90])
  })

  it('has no guides at all for a wholly sealed spare', () => {
    expect(visibleBoundaryYs(120, 4, 0)).toEqual([])
  })

  it('clamps an out-of-range open count instead of guessing', () => {
    expect(visibleBoundaryYs(120, 4, 9)).toEqual([30, 60, 90])
    expect(visibleBoundaryYs(120, 4, -3)).toEqual([])
    expect(visibleBoundaryYs(120, 4, Number.NaN)).toEqual([])
  })
})

describe('sealLineY', () => {
  it('is absent for a fully open tube', () => {
    expect(sealLineY(120, 4)).toBeNull()
    expect(sealLineY(120, 4, 4)).toBeNull()
  })

  it('sits at the edge of the sealed top region', () => {
    expect(sealLineY(120, 4, 3)).toBe(30)
    expect(sealLineY(120, 4, 2)).toBe(60)
    expect(sealLineY(120, 4, 1)).toBe(90)
  })

  it('sits at the bottom for a wholly sealed spare', () => {
    expect(sealLineY(120, 4, 0)).toBe(120)
  })

  it('is absent for a height it cannot divide', () => {
    expect(sealLineY(0, 4, 2)).toBeNull()
    expect(sealLineY(Number.NaN, 4, 2)).toBeNull()
  })
})

describe('concealedTopY', () => {
  it('measures the top edge of the bottom hidden units from the glass top', () => {
    expect(concealedTopY(120, 4, 1)).toBe(90) // bottom quarter concealed
    expect(concealedTopY(120, 4, 3)).toBe(30)
    expect(concealedTopY(120, 4, 4)).toBe(0) // fully concealed reaches the top
  })

  it('is absent when nothing is concealed', () => {
    expect(concealedTopY(120, 4, 0)).toBeNull()
    expect(concealedTopY(120, 4)).toBeNull()
    expect(concealedTopY(120, 4, undefined)).toBeNull()
  })

  it('clamps an out-of-range count to the glass instead of escaping it', () => {
    expect(concealedTopY(120, 4, 9)).toBe(0)
    expect(concealedTopY(120, 4, -2)).toBeNull()
  })

  it('is absent for a height it cannot divide', () => {
    expect(concealedTopY(0, 4, 2)).toBeNull()
    expect(concealedTopY(Number.NaN, 4, 2)).toBeNull()
  })
})

describe('hoverPose', () => {
  it('places the spout gap-px above the target top', () => {
    const pose = hoverPose(rect, target, 200, 30, 20)
    const spout = spoutLocal(rect, pose.rot)
    const at = localToCanvas(rect, pose, spout.x, spout.y)
    expect(at.x).toBeCloseTo(target.x + target.w / 2, 5)
    expect(at.y).toBeCloseTo(target.y - 20, 5)
  })

  it('tilts toward the board centre for a right-hand target', () => {
    const pose = hoverPose(rect, target, 200, 30, 20)
    expect(pose.rot).toBeGreaterThan(0)
  })

  it('tilts the other way for a left-hand target', () => {
    const leftTarget = { x: 10, y: 320, w: 50, h: 120 }
    const pose = hoverPose(rect, leftTarget, 200, 30, 20)
    expect(pose.rot).toBeLessThan(0)
  })
})
