import { normalisePosition } from './challenges'

/**
 * Device-local position in the question rotation (ticket 27), so a reload
 * carries on through the pack instead of starting it again. The
 * `progress.ts` pattern: missing or corrupt data falls back to the start.
 */

const STORAGE_KEY = 'watersort:quiz'

/** Load the saved rotation position, or 0 when missing or invalid. */
export function loadRotation(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { position?: unknown } | null
    return normalisePosition(parsed?.position)
  } catch {
    return 0
  }
}

/** Persist the rotation position. Silently ignores storage failures. */
export function saveRotation(position: number): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ position }))
  } catch {
    /* ignore */
  }
}
