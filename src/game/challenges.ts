/**
 * The offline challenge pack for the earn gate: a small set of questions the
 * session draws from where an advert would be. The pack ships in the bundle
 * and is deliberately tiny — replacing its content is a content ticket, not
 * plumbing. The same gate will serve other rewards later (ticket 09), so
 * nothing here knows what a correct answer is worth.
 *
 * Content rules (public repo, family fair): neutral, timeless trivia that
 * needs no game knowledge. Nothing stale, nothing personal.
 */

export interface Challenge {
  prompt: string
  options: string[]
  /** Index into `options` of the single correct answer. */
  answer: number
}

export const CHALLENGES: readonly Challenge[] = [
  { prompt: 'How many colours are in a rainbow?', options: ['5', '6', '7', '8'], answer: 2 },
  {
    prompt: 'Which planet is closest to the Sun?',
    options: ['Venus', 'Earth', 'Mars', 'Mercury'],
    answer: 3,
  },
  { prompt: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], answer: 1 },
  { prompt: 'What do bees make?', options: ['Honey', 'Milk', 'Silk', 'Wool'], answer: 0 },
  {
    prompt: 'How many minutes are in a quarter of an hour?',
    options: ['15', '20', '25', '30'],
    answer: 0,
  },
  { prompt: 'Which animal is the tallest?', options: ['Elephant', 'Giraffe', 'Horse', 'Lion'], answer: 1 },
]

/** What a draw hands back: the challenge and its pack index. */
export interface ChallengeDraw {
  /** Index into `CHALLENGES` — what a session records as seen. */
  index: number
  challenge: Challenge
}

/**
 * Pick the challenge for one draw of the gate.
 *
 * Deterministic, no `Math.random`: the pick starts at `seed % pack size` and
 * walks forward past everything in `used`, so a session that records each
 * drawn index never offers the same challenge twice in a row and the whole
 * sequence replays in tests. Once every challenge has been seen the cycle
 * restarts from the seed.
 */
export function drawChallenge(seed: number, used: number[]): ChallengeDraw {
  const total = CHALLENGES.length
  const at = (step: number) => ((((seed + step) % total) + total) % total)
  // All seen: the cycle restarts, so the seed itself is the pick.
  const seen = used.length >= total ? [] : used
  for (let step = 0; step < total; step++) {
    const index = at(step)
    if (!seen.includes(index)) return { index, challenge: CHALLENGES[index] }
  }
  return { index: at(0), challenge: CHALLENGES[at(0)] }
}
