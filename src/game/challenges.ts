/**
 * The earn gate's questions and their rotation. The content lives in
 * `challenge-pack.ts`; this module turns it into displayable challenges and
 * decides the order they are drawn in. The same gate serves undo earns and
 * spare growth, so nothing here knows what a correct answer is worth.
 *
 * Rotation (ticket 27): the pack is walked in one fixed, seeded permutation,
 * one step per draw. The position is a single number the caller persists
 * (`rotation.ts`), so a full pass shows every question exactly once before
 * any repeats — across reloads, not just within a session.
 */

import { PACK, type PackEntry } from './challenge-pack'

export interface Challenge {
  prompt: string
  options: string[]
  /** Index into `options` of the single correct answer. */
  answer: number
}

/** A leading number and the text after it, when an option reads as a quantity. */
function quantity(option: string): { value: number; unit: string } | null {
  const match = /^(£?)([−-]?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(option)
  if (!match) return null
  const value = Number(match[2].replace('−', '-').replace(/,/g, ''))
  return Number.isFinite(value) ? { value, unit: match[1] + '|' + match[3] } : null
}

/**
 * Lay out one entry: the correct answer goes in slot `slot`, the wrong ones
 * fill the rest in their written order. When all four options are plain
 * quantities of the same unit they are shown in ascending order instead,
 * which reads naturally and still leaves the answer wherever it falls.
 */
function toChallenge(entry: PackEntry, slot: number): Challenge {
  const [prompt, correct, ...wrong] = entry
  const options = [...wrong]
  options.splice(slot, 0, correct)
  const quantities = options.map(quantity)
  const sameUnit =
    quantities.every((q) => q !== null) && new Set(quantities.map((q) => q!.unit)).size === 1
  if (sameUnit) {
    const sorted = options
      .map((option, index) => ({ option, value: quantities[index]!.value }))
      .sort((a, b) => a.value - b.value)
      .map(({ option }) => option)
    return { prompt, options: sorted, answer: sorted.indexOf(correct) }
  }
  return { prompt, options, answer: slot }
}

/**
 * Every challenge in the pack, in pack order. Quantity questions are sorted,
 * so their answers cluster in the middle; every other question puts its
 * answer in whichever of A–D has been used least so far (ties go to the
 * next slot in turn), which keeps the four positions even.
 */
export const CHALLENGES: readonly Challenge[] = (() => {
  const used = [0, 0, 0, 0]
  return PACK.flatMap((topic) => topic.entries).map((entry, index) => {
    const preferred = index % 4
    const slot = [0, 1, 2, 3]
      .map((offset) => (preferred + offset) % 4)
      .reduce((best, candidate) => (used[candidate] < used[best] ? candidate : best))
    const challenge = toChallenge(entry, slot)
    used[challenge.answer]++
    return challenge
  })
})()

/** Seed of the draw order. Changing it reshuffles every player's rotation. */
const ORDER_SEED = 27

/** A small seeded PRNG (mulberry32): deterministic, no `Math.random`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The fixed draw order: a seeded Fisher–Yates permutation of pack indices,
 * so topics are mixed rather than served in blocks.
 */
export const DRAW_ORDER: readonly number[] = (() => {
  const order = CHALLENGES.map((_, index) => index)
  const random = mulberry32(ORDER_SEED)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
})()

/** What a draw hands back: the challenge and its pack index. */
export interface ChallengeDraw {
  /** Index into `CHALLENGES`. */
  index: number
  challenge: Challenge
}

/** Clamp any stored position onto the rotation: invalid becomes 0. */
export function normalisePosition(position: unknown): number {
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) return 0
  return position % DRAW_ORDER.length
}

/**
 * Draw at a rotation position: the challenge there and the position to store
 * for the next draw. A full pass of `CHALLENGES.length` draws shows every
 * question once; the pass then repeats in the same order, so no question
 * comes back within a window of the whole pack.
 */
export function drawAt(position: number): { draw: ChallengeDraw; next: number } {
  const at = normalisePosition(position)
  const index = DRAW_ORDER[at]
  return { draw: { index, challenge: CHALLENGES[index] }, next: (at + 1) % DRAW_ORDER.length }
}
