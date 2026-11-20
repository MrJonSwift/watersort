import { describe, expect, it } from 'vitest'
import { advanceDraw, CHALLENGES, drawChallenge } from './challenges'

describe('the challenge pack', () => {
  it('is a grown pack so a four-block unlock run never repeats', () => {
    // Ticket 16 grew this from the original 6. Adding more content later is a
    // content decision; the no-repeat tests below track the actual length.
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(20)
  })

  it('every prompt is unique', () => {
    const prompts = CHALLENGES.map((challenge) => challenge.prompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })

  it('every item is well-formed: four distinct options, one correct answer', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.prompt.trim().length, challenge.prompt).toBeGreaterThan(0)
      expect(challenge.options, challenge.prompt).toHaveLength(4)
      const unique = new Set(challenge.options)
      expect(unique.size, challenge.prompt).toBe(challenge.options.length)
      expect(Number.isInteger(challenge.answer), challenge.prompt).toBe(true)
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

  it('no question repeats within any window of one full pack', () => {
    // A session carries the seen list forward and restarts the cycle when the
    // pack is exhausted. Whatever the seed, every window of CHALLENGES.length
    // consecutive draws is all-distinct — in particular the four draws of one
    // vial's unlock run, and not just the first pass through the pack.
    const total = CHALLENGES.length
    for (let seed = 0; seed < total; seed++) {
      let used: number[] = []
      const draws: number[] = []
      for (let n = 0; n < total * 3; n++) {
        const { draw, nextUsed } = advanceDraw(seed, used)
        used = nextUsed
        draws.push(draw.index)
      }
      for (let start = 0; start + total <= draws.length; start++) {
        const window = draws.slice(start, start + total)
        expect(new Set(window).size, `seed ${seed}, window at ${start}`).toBe(total)
      }
    }
  })

  it('a fresh cycle starts from the seed, then walks forward again', () => {
    const total = CHALLENGES.length
    let used: number[] = []
    for (let n = 0; n < total; n++) {
      used = advanceDraw(7, used).nextUsed
    }
    expect(used).toHaveLength(total)

    const first = advanceDraw(7, used)
    expect(first.draw.index).toBe(7 % total) // seed question restarts the cycle
    expect(first.nextUsed).toEqual([7 % total])

    const second = advanceDraw(7, first.nextUsed)
    expect(second.draw.index).toBe((7 + 1) % total)
    expect(new Set([first.draw.index, second.draw.index]).size).toBe(2)
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
