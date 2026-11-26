import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHALLENGES, drawAt } from './challenges'
import { loadRotation, saveRotation } from './rotation'

function createStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

const KEY = 'watersort:quiz'

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

describe('the saved rotation', () => {
  it('starts at 0 with nothing saved', () => {
    expect(loadRotation()).toBe(0)
  })

  it('round-trips a position', () => {
    saveRotation(42)
    expect(loadRotation()).toBe(42)
  })

  it('falls back to 0 for corrupt or invalid data', () => {
    for (const raw of ['not json', 'null', '{}', '{"position":-3}', '{"position":2.5}', '{"position":"7"}']) {
      localStorage.setItem(KEY, raw)
      expect(loadRotation(), raw).toBe(0)
    }
  })

  it('wraps a position past the end of a smaller pack', () => {
    localStorage.setItem(KEY, JSON.stringify({ position: CHALLENGES.length + 5 }))
    expect(loadRotation()).toBe(5)
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadRotation()).toBe(0)
    expect(() => saveRotation(3)).not.toThrow()
  })

  it('a full pass shows every question once, with a reload before every draw', () => {
    const seen: number[] = []
    for (let n = 0; n < CHALLENGES.length; n++) {
      const { draw, next } = drawAt(loadRotation()) // a fresh page load each time
      saveRotation(next)
      seen.push(draw.index)
    }
    expect(new Set(seen).size).toBe(CHALLENGES.length)
    expect(drawAt(loadRotation()).draw.index).toBe(seen[0])
  })
})
