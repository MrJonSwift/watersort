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
  it('grows to twelve colours without moving the original eight', () => {
    expect(PALETTE).toHaveLength(12)
    expect(PALETTE.slice(0, 8)).toEqual(SHIPPED)
    // Tickets 17 and 19 each added two; their pins stay byte-for-byte.
    expect(PALETTE[8]).toEqual([64, 216, 255])
    expect(PALETTE[9]).toEqual([230, 70, 220])
  })

  it('resolves every id, including the four added ones', () => {
    expect(rgbOf(8)).toBe(PALETTE[8])
    expect(rgbOf(9)).toBe(PALETTE[9])
    expect(rgbOf(10)).toBe(PALETTE[10])
    expect(rgbOf(11)).toBe(PALETTE[11])
    expect(rgbOf(12)).toBe(PALETTE[0]) // existing wrap behaviour is unchanged
  })

  it('keeps the added colours distinct at a glance (tickets 17 and 19)', () => {
    // The constraint is legibility on a phone beside the shipped colours, the
    // dark glass and the gradient background — not hue variety for its own
    // sake. 60 is roughly the closest existing pair's separation.
    const chrome: RGB[] = [
      [11, 16, 32], // --bg
      [34, 39, 48], // HIDDEN_BASE / glass dark
      [255, 255, 255], // crest / chrome white
    ]
    for (const id of [8, 9, 10, 11]) {
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
