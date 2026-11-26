import { describe, expect, it } from 'vitest'
import { PACK } from './challenge-pack'
import { CHALLENGES, DRAW_ORDER, drawAt, normalisePosition } from './challenges'

/** The gate fits a 360×640 phone at these lengths (ticket 27 smoke). */
const PROMPT_MAX = 110
const OPTION_MAX = 28

describe('the question pack', () => {
  it('holds at least 280 questions across every planned topic', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(280)
    const counts = Object.fromEntries(PACK.map((topic) => [topic.topic, topic.entries.length]))
    expect(counts['Kings and queens']).toBeGreaterThanOrEqual(35)
    expect(counts['Artificial intelligence']).toBeGreaterThanOrEqual(25)
    for (const topic of PACK) expect(topic.entries.length, topic.topic).toBeGreaterThanOrEqual(10)
  })

  it('every prompt is unique', () => {
    const prompts = CHALLENGES.map((challenge) => challenge.prompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })

  it('every item is well-formed: four distinct options, one correct answer', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.prompt.trim().length, challenge.prompt).toBeGreaterThan(0)
      expect(challenge.options, challenge.prompt).toHaveLength(4)
      expect(new Set(challenge.options).size, challenge.prompt).toBe(4)
      for (const option of challenge.options) {
        expect(option.trim().length, challenge.prompt).toBeGreaterThan(0)
      }
      expect(Number.isInteger(challenge.answer), challenge.prompt).toBe(true)
      expect(challenge.answer, challenge.prompt).toBeGreaterThanOrEqual(0)
      expect(challenge.answer, challenge.prompt).toBeLessThan(4)
    }
  })

  it('the shown answer is the one written as correct in the pack', () => {
    const entries = PACK.flatMap((topic) => topic.entries)
    CHALLENGES.forEach((challenge, index) => {
      expect(challenge.options[challenge.answer], challenge.prompt).toBe(entries[index][1])
      expect([...challenge.options].sort(), challenge.prompt).toEqual([...entries[index].slice(1)].sort())
    })
  })

  it('fits the gate: prompt and option length limits', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.prompt.length, challenge.prompt).toBeLessThanOrEqual(PROMPT_MAX)
      for (const option of challenge.options) {
        expect(option.length, `${challenge.prompt} → ${option}`).toBeLessThanOrEqual(OPTION_MAX)
      }
    }
  })

  it('spreads the answer evenly: each of A–D is between 20% and 30%', () => {
    const slots = [0, 0, 0, 0]
    for (const challenge of CHALLENGES) slots[challenge.answer]++
    for (const [slot, count] of slots.entries()) {
      const share = count / CHALLENGES.length
      expect(share, `slot ${'ABCD'[slot]}`).toBeGreaterThanOrEqual(0.2)
      expect(share, `slot ${'ABCD'[slot]}`).toBeLessThanOrEqual(0.3)
    }
  })

  it('shows numeric options in ascending order', () => {
    const years = CHALLENGES.find((c) => c.prompt === 'In which year was Magna Carta sealed?')!
    expect(years.options).toEqual(['1066', '1215', '1265', '1314'])
    expect(years.options[years.answer]).toBe('1215')
  })
})

describe('the rotation', () => {
  it('the draw order is a permutation of the whole pack', () => {
    expect([...DRAW_ORDER].sort((a, b) => a - b)).toEqual(CHALLENGES.map((_, index) => index))
  })

  it('mixes topics rather than serving the pack in order', () => {
    const inOrder = DRAW_ORDER.filter((index, at) => index === at).length
    expect(inOrder).toBeLessThan(CHALLENGES.length / 10)
  })

  it('a full pass shows every question once, then repeats in the same order', () => {
    let position = 0
    const drawn: number[] = []
    for (let n = 0; n < CHALLENGES.length * 2; n++) {
      const { draw, next } = drawAt(position)
      expect(draw.challenge).toBe(CHALLENGES[draw.index])
      drawn.push(draw.index)
      position = next
    }
    const total = CHALLENGES.length
    for (let start = 0; start + total <= drawn.length; start++) {
      expect(new Set(drawn.slice(start, start + total)).size, `window at ${start}`).toBe(total)
    }
    expect(position).toBe(0)
  })

  it('normalises any stored position', () => {
    const total = CHALLENGES.length
    expect(normalisePosition(5)).toBe(5)
    expect(normalisePosition(total + 3)).toBe(3)
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '4', null, undefined, {}]) {
      expect(normalisePosition(bad), String(bad)).toBe(0)
    }
    expect(drawAt(-7)).toEqual(drawAt(0))
  })
})
