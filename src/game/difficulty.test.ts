import { describe, expect, it } from 'vitest'
import { mulberry32, randomWinRate } from './difficulty'
import { shuffledBoard } from './generator'
import type { ColorId } from './types'

const OPTIONS = { playouts: 200, maxSteps: 300, seed: 1 }

describe('mulberry32', () => {
  it('is a fixed sequence for a seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('randomWinRate', () => {
  it('scores a won board as 1', () => {
    expect(randomWinRate([[0, 0, 0, 0], [1, 1, 1, 1], []], OPTIONS)).toBe(1)
  })

  it('scores a board with no legal move as 0', () => {
    expect(randomWinRate([[0, 1, 0, 1], [1, 0, 1, 0]], OPTIONS)).toBe(0)
  })

  it('scores a board one pour from solved as 1: every path forward wins', () => {
    // Only legal first moves: 1→0 (wins) or 0→1 (which leads back to a win).
    const board: ColorId[][] = [[0, 0, 0], [0], [1, 1, 1, 1]]
    expect(randomWinRate(board, OPTIONS)).toBe(1)
  })

  it('counts a playout that runs out of steps as a loss', () => {
    // One pour is needed to win; with zero steps allowed nothing is played.
    const board: ColorId[][] = [[0, 0, 0], [0], []]
    expect(randomWinRate(board, { ...OPTIONS, maxSteps: 0 })).toBe(0)
    expect(randomWinRate(board, { ...OPTIONS, maxSteps: 1 })).toBeGreaterThan(0)
  })

  it('is deterministic for a board and seed, and the seed matters', () => {
    const board = shuffledBoard(11, 2, 12, 7)
    const a = randomWinRate(board, OPTIONS)
    expect(randomWinRate(board.map((t) => [...t]), OPTIONS)).toBe(a)
    const others = [2, 3, 4, 5].map((seed) => randomWinRate(board, { ...OPTIONS, seed }))
    expect(others.some((score) => score !== a)).toBe(true)
  })

  it('ignores tube order', () => {
    const board = shuffledBoard(11, 2, 12, 9)
    const reversed = [...board].reverse()
    // Same positions are recognised as seen, so only move order differs; the
    // rates agree closely rather than exactly.
    const a = randomWinRate(board, { ...OPTIONS, playouts: 1000 })
    const b = randomWinRate(reversed, { ...OPTIONS, playouts: 1000 })
    expect(Math.abs(a - b)).toBeLessThan(0.08)
  })

  it('ranks a lightly mixed board above a full shuffle on average', () => {
    let light = 0
    let full = 0
    for (let seed = 1; seed <= 12; seed++) {
      light += randomWinRate(shuffledBoard(11, 2, 6, seed), OPTIONS)
      full += randomWinRate(shuffledBoard(11, 2, null, seed), OPTIONS)
    }
    expect(light / 12).toBeGreaterThan(0.3)
    expect(full / 12).toBeLessThan(0.1)
  })

  it('never mutates the board it is given', () => {
    const board = shuffledBoard(11, 2, null, 4)
    const copy = JSON.stringify(board)
    randomWinRate(board, OPTIONS)
    expect(JSON.stringify(board)).toBe(copy)
  })
})
