// One-shot promotion of renamed storage keys.
//
// Renaming a key is otherwise indistinguishable from clearing a user's data, so
// every rename is recorded in `LEGACY_KEYS` and promoted here once at startup,
// before React renders (see `main.tsx`). Readers also fall back individually
// through `readJsonMigrated`, so a key that only appears later is still
// recovered — this pass just makes the switch happen eagerly.
import { readRaw, removeRaw, writeRaw } from './storage'
import { LEGACY_KEYS } from './storageKeys'

/**
 * Copy each legacy key onto its replacement and drop the old one.
 *
 * Idempotent: once the value is promoted the legacy entry is gone, so a second
 * run has nothing to do. When both keys hold data the new one wins and the
 * stale copy is discarded.
 *
 * @returns the number of keys promoted (handy for tests and logging).
 */
export function runStorageMigrations(): number {
  let promoted = 0
  for (const [legacy, current] of Object.entries(LEGACY_KEYS)) {
    const value = readRaw(legacy)
    if (value === null) continue
    if (readRaw(current) !== null) {
      // The new key is already populated; the leftover is redundant.
      removeRaw(legacy)
      continue
    }
    if (writeRaw(current, value)) {
      removeRaw(legacy)
      promoted++
    }
  }
  return promoted
}
