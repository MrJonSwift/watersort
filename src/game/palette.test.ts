import { describe, expect, it } from 'vitest'
import { PALETTE, darken, rgbOf, type RGB } from './palette'

type Lab = readonly [number, number, number]

/** sRGB (0–255) → CIELAB, D65. */
function toLab([r, g, b]: RGB): Lab {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047)
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722)
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hue = (x: number, y: number): number => {
    if (x === 0 && y === 0) return 0
    const h = Math.atan2(y, x) / rad
    return h < 0 ? h + 360 : h
  }
  const h1 = hue(a1p, b1)
  const h2 = hue(a2p, b2)
  const dL = L2 - L1
  const dC = C2p - C1p
  let dh = 0
  if (C1p * C2p !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad)
  const Lbar = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbar = h1 + h2
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) > 180) hbar += h1 + h2 < 360 ? 360 : -360
    hbar /= 2
  }
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2))
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7))
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(2 * dTheta * rad) * RC
  return Math.sqrt(
    (dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH),
  )
}

/** Deuteranopia simulation (Machado, Oliveira & Fernandes 2009, severity 1). */
function deuteranopia([r, g, b]: RGB): RGB {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const gam = (c: number): number => {
    const v = Math.min(1, Math.max(0, c))
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
  }
  const v = [lin(r), lin(g), lin(b)]
  const m = [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 1.04294],
  ]
  const [x, y, z] = m.map((row) => gam(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))
  return [x, y, z]
}

const de = (a: RGB, b: RGB): number => deltaE2000(toLab(a), toLab(b))

/** Smallest pairwise distance between `ids`, and the pair that set it. */
function closest(ids: number[], f: (a: RGB, b: RGB) => number): { d: number; pair: string } {
  let best = { d: Infinity, pair: '' }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const d = f(PALETTE[ids[i]], PALETTE[ids[j]])
      if (d < best.d) best = { d, pair: `${ids[i]}/${ids[j]}` }
    }
  return best
}

const PLAYABLE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Glass and background tones every colour must stand clear of. */
const CHROME: readonly RGB[] = [
  [11, 16, 32], // --bg
  [34, 39, 48], // HIDDEN_BASE: the concealed "?" slab
  [24, 30, 46], // empty glass over the background
]

describe('palette', () => {
  it('keeps twelve swatches and resolves every id', () => {
    expect(PALETTE).toHaveLength(12)
    for (let id = 0; id < 12; id++) expect(rgbOf(id)).toBe(PALETTE[id])
    expect(rgbOf(12)).toBe(PALETTE[0]) // existing wrap behaviour is unchanged
  })

  it('computes CIEDE2000 to the published reference values', () => {
    // Sharma, Wu & Dalal (2005), test pairs 1, 7, 17 and 25.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4)
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4)
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4)
    expect(deltaE2000([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(
      1.2644,
      4,
    )
  })

  it('has no easily confused pair among the playable colours (ticket 26)', () => {
    const { d, pair } = closest(PLAYABLE, de)
    expect(d, `closest pair ${pair}`).toBeGreaterThanOrEqual(25)
  })

  it('keeps the reserved twelfth colour clear of all eleven playable ones', () => {
    for (const id of PLAYABLE) {
      expect(de(PALETTE[11], PALETTE[id]), `11 vs ${id}`).toBeGreaterThanOrEqual(25)
    }
  })

  it('holds the deuteranopia minimum achieved in ticket 26', () => {
    // 13.09 at the time of picking; any edit that drops it must say why.
    const { d, pair } = closest(PLAYABLE, (a, b) => de(deuteranopia(a), deuteranopia(b)))
    expect(d, `closest deuteranopia pair ${pair}`).toBeGreaterThanOrEqual(13)
  })

  it('stands clear of the glass, background and "?" slab, even when shaded', () => {
    // The renderer darkens the bottom of each band by 0.3; that shade must
    // still separate from the darkest chrome.
    for (const [id, color] of PALETTE.entries()) {
      for (const chrome of CHROME) {
        expect(de(color, chrome), `colour ${id} vs ${chrome}`).toBeGreaterThanOrEqual(25)
        expect(de(darken(color, 0.3), chrome), `shaded ${id} vs ${chrome}`).toBeGreaterThanOrEqual(
          20,
        )
      }
    }
  })
})
