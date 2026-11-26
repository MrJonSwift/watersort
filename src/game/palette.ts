/**
 * The single source of truth for game colours.
 *
 * The CSS custom properties `--c-<n>` are generated from this table at boot
 * (`applyPaletteToCss`), so DOM styling and canvas painting can never drift.
 */
export type RGB = readonly [number, number, number]

/**
 * Re-picked in ticket 26 so no two colours are easily confused: every pair
 * among the playable IDs 0–10 is at least ΔE2000 25 apart (closest 28.4), ID 11
 * clears 25 against all of them, and the deuteranopia-simulated minimum is
 * pinned in `palette.test.ts`. Hues are spread and lightness is spread too
 * (deep blue vs light sky; lime vs the deep green). Boards store IDs, so the
 * IDs keep their slots; the name beside each is only what it looks like.
 */
export const PALETTE: readonly RGB[] = [
  [211, 25, 66], // 0 red
  [0, 121, 215], // 1 blue
  [15, 133, 129], // 2 teal
  [255, 210, 11], // 3 yellow
  [86, 0, 245], // 4 violet
  [255, 145, 187], // 5 pink
  [138, 217, 113], // 6 lime
  [231, 121, 2], // 7 orange
  [76, 219, 255], // 8 sky
  [254, 253, 255], // 9 white
  [123, 69, 0], // 10 brown
  [54, 113, 2], // 11 deep green (reserved for ticket 28)
] as const

export function rgbOf(id: number): RGB {
  return PALETTE[Math.abs(Math.trunc(id)) % PALETTE.length]
}

export function rgbCss([r, g, b]: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

/** Lighter variant of a palette colour (used for crests and highlights). */
export function lighten(color: RGB, t: number): RGB {
  return mix(color, WHITE, t)
}

/** Darker variant of a palette colour (used for depth shading). */
export function darken(color: RGB, t: number): RGB {
  return mix(color, BLACK, t)
}

/** Publish the palette as CSS custom properties `--c-0 … --c-11`. */
export function applyPaletteToCss(root: HTMLElement = document.documentElement): void {
  PALETTE.forEach((color, id) => {
    root.style.setProperty(`--c-${id}`, rgbCss(color))
  })
}
