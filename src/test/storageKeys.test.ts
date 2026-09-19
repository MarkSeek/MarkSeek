// Storage key guardrails.
//
// Two rules are enforced here:
//  1. Every key literal lives under the `markseek.` prefix. The pre-unification
//     names survive only as legacy aliases, declared in `utils/storageKeys.ts`.
//  2. Nothing outside `utils/storage.ts` may call `localStorage` /
//     `sessionStorage` directly: corrupt JSON, private mode and quota errors
//     are handled in exactly one place.
import { describe, expect, it } from 'vitest'
import { readSources } from './collectSources'

// Literal keys passed to localStorage/sessionStorage, plus keys held in
// SCREAMING_CASE `*_KEY` / `*_PREFIX` constants.
const CALL_RE = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g
const CONST_RE = /\b[A-Z][A-Z0-9_]*(?:_KEY|_PREFIX)\s*=\s*'([^']+)'/g
const LEGACY_BRAND_RE = /['"`]markseek\./g
// A direct call on the web storage APIs (prose that merely mentions
// "localStorage." does not count).
const RAW_STORAGE_RE =
  /\b(?:window\.)?(?:local|session)Storage\s*\.\s*(?:getItem|setItem|removeItem|clear|key|length)\b/g

const ALLOWED_PREFIX = 'markseek.'
// Pre-session keys kept alive by the session snapshot migration.
const LEGACY_KEYS = new Set(['leftSidebarWidth', 'rightPanelWidth'])
// Compatibility reads of the pre-rename brand: tracked by the test below.
const LEGACY_BRAND_PREFIX = 'markseek.'
// SCREAMING_CASE constants that are not storage keys (virtual tab id prefixes).
const NOT_STORAGE_KEYS = new Set(['__diary__', '__liteapp__'])

// The only file allowed to touch the storage APIs directly.
const STORAGE_LAYER = 'src/utils/storage.ts'
// Legacy aliases are declared centrally; the lite-app page still re-publishes
// the old brand keys when it promotes them.
const LEGACY_BRAND_ALLOWLIST = [
  'src/utils/storageKeys.ts',
  'src/utils/storage.ts',
  'src/components/LiteAppPage.tsx',
]

function collectStorageKeys(): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = []
  for (const { file, source } of readSources()) {
    // Skip the guardrail tests themselves.
    if (file.includes('/src/test/')) continue
    for (const match of source.matchAll(CALL_RE)) found.push({ key: match[1], file })
    for (const match of source.matchAll(CONST_RE)) found.push({ key: match[1], file })
  }
  return found
}

describe('storage keys', () => {
  it('uses only the accepted key prefix', () => {
    const offenders = collectStorageKeys().filter(
      ({ key }) =>
        !key.startsWith(ALLOWED_PREFIX) &&
        !LEGACY_KEYS.has(key) &&
        !NOT_STORAGE_KEYS.has(key) &&
        !key.startsWith(LEGACY_BRAND_PREFIX),
    )
    expect(offenders).toEqual([])
  })

  it('keeps pre-rename brand keys inside the known allowlist', () => {
    const offenders: string[] = []
    for (const { file, source } of readSources()) {
      if (file.includes('/src/test/')) continue
      if (!LEGACY_BRAND_RE.test(source)) continue
      LEGACY_BRAND_RE.lastIndex = 0
      const relative = file.replace(process.cwd() + '/', '')
      if (!LEGACY_BRAND_ALLOWLIST.includes(relative)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })

  it('routes every read and write through the storage layer', () => {
    const offenders: string[] = []
    for (const { file, source } of readSources()) {
      // Test helpers and the guardrails themselves legitimately poke at storage.
      if (file.includes('/src/test/')) continue
      if (file.includes('__tests__')) continue
      const relative = file.replace(process.cwd() + '/', '')
      if (relative === STORAGE_LAYER) continue
      if (RAW_STORAGE_RE.test(source)) offenders.push(relative)
      RAW_STORAGE_RE.lastIndex = 0
    }
    expect(offenders).toEqual([])
  })
})
