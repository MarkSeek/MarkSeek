// The single entry point for localStorage.
//
// Three modules used to talk to localStorage directly, each with its own
// naming scheme and its own way of swallowing errors (silent / console.error /
// empty catch). Everything now goes through these helpers, so:
//   * a corrupt or unavailable store degrades to a fallback instead of throwing;
//   * failures are reported through one injectable handler (tests assert on it,
//     production stays quiet);
//   * renamed keys are migrated in exactly one place (see `readJsonMigrated`).

export type Validator<T> = (raw: unknown) => T | null

export type StorageErrorHandler = (error: unknown, key: string) => void

let errorHandler: StorageErrorHandler | null = null

/**
 * Install a handler for storage failures. Tests inject a spy here; the app
 * leaves it unset so a private-mode browser never floods the console.
 */
export function setStorageErrorHandler(fn: StorageErrorHandler | null): void {
  errorHandler = fn
}

function report(error: unknown, key: string): void {
  if (errorHandler) errorHandler(error, key)
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (e) {
    // Accessing localStorage itself throws in some private modes.
    report(e, key)
    return null
  }
}

function write(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (e) {
    // Quota exceeded or storage disabled.
    report(e, key)
    return false
  }
}

/** True when localStorage can actually be read and written. */
export function isStorageAvailable(): boolean {
  try {
    const probe = 'markseek.probe'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function readRaw(key: string): string | null {
  return read(key)
}

export function writeRaw(key: string, value: string): boolean {
  return write(key, value)
}

export function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch (e) {
    report(e, key)
  }
}

/** Parse a value, returning `undefined` when it is missing or unusable. */
function readParsed<T>(key: string, validate?: Validator<T>): T | undefined {
  const raw = read(key)
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!validate) return parsed as T
    return validate(parsed) ?? undefined
  } catch (e) {
    report(e, key)
    return undefined
  }
}

/**
 * Read a JSON value, falling back to `fallback` for anything unusable:
 * missing key, corrupt JSON or a value the validator rejects.
 */
export function readJson<T>(key: string, fallback: T, validate?: Validator<T>): T {
  const parsed = readParsed(key, validate)
  return parsed === undefined ? fallback : parsed
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return write(key, JSON.stringify(value))
  } catch (e) {
    // Non-serialisable payload (cycles, BigInt).
    report(e, key)
    return false
  }
}

/**
 * Read a key that has been renamed.
 *
 * The new key wins; when it is missing the legacy aliases are tried in order
 * and the first usable value is promoted — written under the new key and
 * removed from the old one. That makes the migration lazy, idempotent and
 * invisible to callers, so no data is lost by a rename.
 */
export function readJsonMigrated<T>(
  key: string,
  legacyKeys: readonly string[],
  fallback: T,
  validate?: Validator<T>,
): T {
  const current = readParsed(key, validate)
  if (current !== undefined) return current
  for (const legacy of legacyKeys) {
    const value = readParsed(legacy, validate)
    if (value === undefined) continue
    writeJson(key, value)
    removeRaw(legacy)
    return value
  }
  return fallback
}

/** Same promotion rules as `readJsonMigrated`, for plain string values. */
export function readRawMigrated(
  key: string,
  legacyKeys: readonly string[],
): string | null {
  const current = read(key)
  if (current !== null) return current
  for (const legacy of legacyKeys) {
    const value = read(legacy)
    if (value === null) continue
    writeRaw(key, value)
    removeRaw(legacy)
    return value
  }
  return null
}
