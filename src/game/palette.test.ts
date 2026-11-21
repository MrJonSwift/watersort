import { describe, expect, it } from 'vitest'
import { PALETTE, rgbOf, type RGB } from './palette'

/** The eight colours already in the hands of the family — never re-roll them. */
const SHIPPED: readonly RGB[] = [
  [255, 77, 94],
  [61, 139, 255],
  [23, 217, 158],
  [255, 210, 63],
  [176, 108, 240],
  [255, 127, 176],
  [126, 217, 87],
  [255, 154, 61],
]

const distance = (a: RGB, b: RGB): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('palette', () => {
  it('adds two colours without moving the original eight', () => {
    expect(PALETTE).toHaveLength(10)
    expect(PALETTE.slice(0, 8)).toEqual(SHIPPED)
  })

  it('resolves every id, including the two new ones', () => {
    expect(rgbOf(8)).toBe(PALETTE[8])
    expect(rgbOf(9)).toBe(PALETTE[9])
    expect(rgbOf(10)).toBe(PALETTE[0]) // existing wrap behaviour is unchanged
  })

  it('keeps the new colours distinct at a glance (ticket 17)', () => {
    // The constraint is legibility on a phone beside the shipped colours, the
    // dark glass and the gradient background — not hue variety for its own
    // sake. 60 is roughly the closest existing pair's separation.
    const chrome: RGB[] = [
      [11, 16, 32], // --bg
      [34, 39, 48], // HIDDEN_BASE / glass dark
      [255, 255, 255], // crest / chrome white
    ]
    for (const id of [8, 9]) {
      const color = PALETTE[id]
      const nearest = PALETTE.filter((_, other) => other !== id)
      for (const other of nearest) {
        expect(distance(color, other), `colour ${id} too close to ${JSON.stringify(other)}`)
          .toBeGreaterThanOrEqual(60)
      }
      for (const other of chrome) {
        expect(distance(color, other), `colour ${id} too close to chrome ${JSON.stringify(other)}`)
          .toBeGreaterThanOrEqual(120)
      }
    }
  })
})
