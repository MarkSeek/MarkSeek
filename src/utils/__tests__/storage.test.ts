import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isStorageAvailable,
  readJson,
  readJsonMigrated,
  readRaw,
  readRawMigrated,
  removeRaw,
  setStorageErrorHandler,
  writeJson,
  writeRaw,
} from '../storage'

beforeEach(() => {
  setStorageErrorHandler(null)
  localStorage.clear()
})

afterEach(() => {
  setStorageErrorHandler(null)
})

describe('readRaw / writeRaw / removeRaw', () => {
  it('round-trips a string value', () => {
    expect(writeRaw('k', 'v')).toBe(true)
    expect(readRaw('k')).toBe('v')
    removeRaw('k')
    expect(readRaw('k')).toBeNull()
  })

  it('returns null for a missing key', () => {
    expect(readRaw('nope')).toBeNull()
  })

  it('reports a failure and returns null when storage throws', () => {
    const errors: unknown[] = []
    setStorageErrorHandler((e) => errors.push(e))
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readRaw('k')).toBeNull()
    expect(errors).toHaveLength(1)
    spy.mockRestore()
  })

  it('returns false when a write is rejected', () => {
    const errors: unknown[] = []
    setStorageErrorHandler((e) => errors.push(e))
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(writeRaw('k', 'v')).toBe(false)
    expect(errors).toHaveLength(1)
    spy.mockRestore()
  })
})

describe('isStorageAvailable', () => {
  it('is true in jsdom', () => {
    expect(isStorageAvailable()).toBe(true)
  })

  it('is false when writes throw', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(isStorageAvailable()).toBe(false)
    spy.mockRestore()
  })
})

describe('readJson', () => {
  it('parses a stored value', () => {
    writeJson('k', { a: 1 })
    expect(readJson('k', null)).toEqual({ a: 1 })
  })

  it('falls back when the key is missing', () => {
    expect(readJson('nope', [] as string[])).toEqual([])
  })

  it('falls back on corrupt JSON instead of throwing', () => {
    const errors: unknown[] = []
    setStorageErrorHandler((e) => errors.push(e))
    localStorage.setItem('k', '{broken')
    expect(readJson('k', 'fallback')).toBe('fallback')
    expect(errors).toHaveLength(1)
  })

  it('falls back when the validator rejects the payload', () => {
    writeJson('k', { nope: true })
    expect(readJson('k', [], (raw) => (Array.isArray(raw) ? (raw as string[]) : null))).toEqual([])
  })

  it('keeps a payload the validator accepts', () => {
    writeJson('k', ['a'])
    expect(readJson('k', [], (raw) => (Array.isArray(raw) ? (raw as string[]) : null))).toEqual(['a'])
  })

  it('reports non-serialisable payloads instead of throwing', () => {
    const errors: unknown[] = []
    setStorageErrorHandler((e) => errors.push(e))
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(writeJson('k', cyclic)).toBe(false)
    expect(errors).toHaveLength(1)
  })
})

describe('readJsonMigrated', () => {
  it('prefers the current key', () => {
    writeJson('new', 'current')
    writeJson('old', 'legacy')
    expect(readJsonMigrated('new', ['old'], 'fallback')).toBe('current')
    // The legacy entry stays until somebody reads it through the old path.
    expect(readRaw('old')).not.toBeNull()
  })

  it('promotes a legacy value and drops the old key', () => {
    writeJson('old', 'legacy')
    expect(readJsonMigrated('new', ['old'], 'fallback')).toBe('legacy')
    expect(readRaw('new')).toBe('"legacy"')
    expect(readRaw('old')).toBeNull()
  })

  it('is idempotent', () => {
    writeJson('old', 'legacy')
    expect(readJsonMigrated('new', ['old'], 'fallback')).toBe('legacy')
    expect(readJsonMigrated('new', ['old'], 'fallback')).toBe('legacy')
  })

  it('tries the aliases in order', () => {
    writeJson('oldest', 'from-oldest')
    writeJson('older', 'from-older')
    expect(readJsonMigrated('new', ['older', 'oldest'], 'fallback')).toBe('from-older')
    expect(readRaw('older')).toBeNull()
    expect(readRaw('oldest')).not.toBeNull()
  })

  it('skips an alias holding corrupt data', () => {
    const errors: unknown[] = []
    setStorageErrorHandler((e) => errors.push(e))
    localStorage.setItem('older', '{broken')
    writeJson('oldest', 'good')
    expect(readJsonMigrated('new', ['older', 'oldest'], 'fallback')).toBe('good')
    expect(errors).toHaveLength(1)
  })

  it('falls back when nothing is usable', () => {
    expect(readJsonMigrated('new', ['old'], 'fallback')).toBe('fallback')
  })
})

describe('readRawMigrated', () => {
  it('promotes a plain string value', () => {
    writeRaw('old', 'run')
    expect(readRawMigrated('new', ['old'])).toBe('run')
    expect(readRaw('new')).toBe('run')
    expect(readRaw('old')).toBeNull()
  })

  it('returns null when no key holds a value', () => {
    expect(readRawMigrated('new', ['old'])).toBeNull()
  })
})
