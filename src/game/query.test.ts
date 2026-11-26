import { describe, expect, it } from 'vitest'
import { parseLevelJump } from './query'
import { MAX_LEVEL } from './levels'

// The jump follows MAX_LEVEL, so extending the curve needs no parser edit.
const MAX = MAX_LEVEL

describe('parseLevelJump', () => {
  it('reads a whole level number', () => {
    expect(parseLevelJump('?level=15', MAX)).toBe(15)
    expect(parseLevelJump('?level=1', MAX)).toBe(1)
    expect(parseLevelJump('?level=30', MAX)).toBe(30)
    expect(parseLevelJump('?level=40', MAX)).toBe(40)
    expect(parseLevelJump('?level=50', MAX)).toBe(50)
  })

  it('ignores a missing parameter', () => {
    expect(parseLevelJump('', MAX)).toBeNull()
    expect(parseLevelJump('?', MAX)).toBeNull()
    expect(parseLevelJump('?moves=3', MAX)).toBeNull()
  })

  it('reads the level beside other parameters', () => {
    expect(parseLevelJump('?level=15&x=1', MAX)).toBe(15)
    expect(parseLevelJump('?x=1&level=15', MAX)).toBe(15)
  })

  it('rejects junk instead of guessing', () => {
    expect(parseLevelJump('?level=abc', MAX)).toBeNull()
    expect(parseLevelJump('?level=15.7', MAX)).toBeNull()
    expect(parseLevelJump('?level=', MAX)).toBeNull()
    expect(parseLevelJump('?level', MAX)).toBeNull()
    expect(parseLevelJump('?LEVEL=15', MAX)).toBeNull()
  })

  it('clamps out-of-range numbers to the real board range', () => {
    expect(parseLevelJump('?level=0', MAX)).toBe(1)
    expect(parseLevelJump('?level=99999', MAX)).toBe(MAX)
    expect(parseLevelJump('?level=007', MAX)).toBe(7)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseLevelJump('?level=%2015%20', MAX)).toBe(15)
  })
})
