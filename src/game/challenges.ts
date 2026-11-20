/**
 * The offline challenge pack for the earn gate: a rotating set of questions the
 * session draws from where an advert would be. The pack ships in the bundle —
 * replacing its content is a content ticket, not plumbing. The same gate serves
 * undo earns and spare growth, so nothing here knows what a correct answer is
 * worth.
 *
 * Content rules (public repo, family fair): neutral, timeless trivia that
 * needs no game knowledge. Nothing stale, nothing personal. Every prompt has
 * four distinct options and exactly one correct answer.
 *
 * The pack grew to 24 in ticket 16 so a vial's four-block unlock run never
 * shows a repeat. The drafted questions are content the product owner reviews
 * before the ticket is merged.
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
  { prompt: 'How many days are in a week?', options: ['5', '6', '7', '8'], answer: 2 },
  {
    prompt: 'What is the largest ocean on Earth?',
    options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    answer: 3,
  },
  { prompt: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], answer: 1 },
  {
    prompt: 'Which shape has three sides?',
    options: ['Square', 'Triangle', 'Circle', 'Pentagon'],
    answer: 1,
  },
  {
    prompt: 'Which gas do plants absorb from the air?',
    options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'],
    answer: 2,
  },
  { prompt: 'How many hours are in a day?', options: ['12', '24', '36', '48'], answer: 1 },
  {
    prompt: 'Which is the largest planet in our solar system?',
    options: ['Earth', 'Jupiter', 'Saturn', 'Neptune'],
    answer: 1,
  },
  { prompt: 'What is the opposite of hot?', options: ['Warm', 'Cold', 'Bright', 'Heavy'], answer: 1 },
  { prompt: 'What colour is an emerald?', options: ['Blue', 'Green', 'Red', 'Yellow'], answer: 1 },
  {
    prompt: 'How many zeroes are in the number one thousand?',
    options: ['1', '2', '3', '4'],
    answer: 2,
  },
  {
    prompt: 'What do you call a young dog?',
    options: ['Cub', 'Puppy', 'Kitten', 'Calf'],
    answer: 1,
  },
  { prompt: 'How many continents are there on Earth?', options: ['5', '6', '7', '8'], answer: 2 },
  { prompt: 'Which of these is a prime number?', options: ['4', '6', '9', '11'], answer: 3 },
  {
    prompt: 'What is the capital of France?',
    options: ['Lyon', 'Marseille', 'Paris', 'Nice'],
    answer: 2,
  },
  {
    prompt: 'What is the largest mammal on Earth?',
    options: ['Elephant', 'Blue whale', 'Giraffe', 'Great white shark'],
    answer: 1,
  },
  {
    prompt: 'Which direction does the Sun rise in?',
    options: ['East', 'West', 'North', 'South'],
    answer: 0,
  },
  {
    prompt: 'How many strings does a standard guitar have?',
    options: ['4', '5', '6', '7'],
    answer: 2,
  },
  {
    prompt: 'What is the hardest natural substance?',
    options: ['Diamond', 'Granite', 'Steel', 'Quartz'],
    answer: 0,
  },
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
 *
 * `used` is session state: a page reload resets it, so the first draw after a
 * reload is the seed question again. That is the accepted caveat from ticket
 * 16 — if it still shows in play, the escape hatch is a session nonce injected
 * as a port, a separate follow-up. For the no-repeat-window guarantee across
 * a whole session, callers use `advanceDraw`, which restarts the cycle at the
 * boundary; this walk-forward alone pins the seed once the pack is exhausted.
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

/**
 * One draw for a session: the challenge plus the seen list to carry forward.
 *
 * `drawChallenge` alone pins the seed forever once `used` grows past the pack
 * size — every later draw re-triggers its "all seen" reset. The no-repeat
 * window is a lie after the first pass unless the cycle boundary is explicit,
 * so the session clears the seen list when a full pack has been offered and
 * `drawChallenge` starts the fresh cycle from the seed. This is the one piece
 * of plumbing the bigger pack needs; the walk-forward does the rest.
 */
export function advanceDraw(
  seed: number,
  used: number[],
): { draw: ChallengeDraw; nextUsed: number[] } {
  const fresh = used.length >= CHALLENGES.length ? [] : used
  const draw = drawChallenge(seed, fresh)
  return { draw, nextUsed: [...fresh, draw.index] }
}
