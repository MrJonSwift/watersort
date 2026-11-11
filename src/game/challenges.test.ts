import { describe, expect, it } from 'vitest'
import { CHALLENGES, drawChallenge } from './challenges'

describe('the challenge pack', () => {
  it('is a small placeholder pack the gate can rotate through', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(4)
    expect(CHALLENGES.length).toBeLessThanOrEqual(8)
  })

  it('every item is well-formed: a prompt, unique options, one correct answer', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.prompt.trim().length, challenge.prompt).toBeGreaterThan(0)
      expect(challenge.options.length, challenge.prompt).toBeGreaterThanOrEqual(2)
      const unique = new Set(challenge.options)
      expect(unique.size, challenge.prompt).toBe(challenge.options.length)
      expect(challenge.answer, challenge.prompt).toBeGreaterThanOrEqual(0)
      expect(challenge.answer, challenge.prompt).toBeLessThan(challenge.options.length)
    }
  })

  it('every option is a non-empty string', () => {
    for (const challenge of CHALLENGES) {
      for (const option of challenge.options) {
        expect(option.trim().length, challenge.prompt).toBeGreaterThan(0)
      }
    }
  })
})

describe('drawChallenge', () => {
  it('is deterministic for the same seed and used list', () => {
    expect(drawChallenge(3, [0, 2])).toEqual(drawChallenge(3, [0, 2]))
  })

  it('never draws a used challenge while fresh ones remain', () => {
    const total = CHALLENGES.length
    for (let seed = 0; seed < total * 2; seed++) {
      for (let usedIndex = 0; usedIndex < total; usedIndex++) {
        const draw = drawChallenge(seed, [usedIndex])
        expect(draw.index, `seed ${seed}, used [${usedIndex}]`).not.toBe(usedIndex)
        expect(draw.challenge).toBe(CHALLENGES[draw.index])
      }
    }
  })

  it('a session that records every draw keeps seeing new challenges', () => {
    const seen: number[] = []
    const prompts: string[] = []
    for (let draw = 0; draw < CHALLENGES.length; draw++) {
      const next = drawChallenge(draw, seen)
      expect(seen, `draw ${draw}`).not.toContain(next.index)
      seen.push(next.index)
      prompts.push(next.challenge.prompt)
    }
    expect(new Set(prompts).size).toBe(CHALLENGES.length)
  })

  it('recycles from the seed once every challenge has been seen', () => {
    const allSeen = CHALLENGES.map((_, index) => index)
    for (let seed = 0; seed < CHALLENGES.length; seed++) {
      const draw = drawChallenge(seed, allSeen)
      expect(draw.index).toBe(seed)
      expect(draw.challenge).toBe(CHALLENGES[seed])
    }
  })
})
