// Dictionary guardrails. These tests read the source tree, so a typo in a
// t('...') call or a key added to only one language fails the build instead of
// silently rendering a raw key in the UI.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectSources } from '../../test/collectSources'
import { en } from '../en'
import { zhCN } from '../zh-CN'

const T_CALL_RE = /\bt\(\s*(['"`])([^'"`]+)\1/g
const PLACEHOLDER_RE = /\{(\w+)\}/g

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort()
}

function usedKeys(): string[] {
  const keys = new Set<string>()
  for (const file of collectSources()) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(T_CALL_RE)) {
      const key = match[2]
      // Skip template literals such as `sync.${state}`: they are resolved at
      // runtime and cannot be checked statically.
      if (key.includes('${')) continue
      keys.add(key)
    }
  }
  return [...keys].sort()
}

const enKeys = Object.keys(en)
const zhKeys = Object.keys(zhCN)

describe('dictionary keys', () => {
  it('defines every key that the source asks for', () => {
    const missing = usedKeys().filter((key) => !(key in en))
    expect(missing).toEqual([])
  })

  it('never leaves a key untranslated in the fallback dictionary', () => {
    // `en` is the fallback, so a key missing there always renders raw.
    const orphan = zhKeys.filter((key) => !(key in en))
    expect(orphan).toEqual([])
  })

  it('keeps both dictionaries in sync', () => {
    // The `Record<keyof typeof en, string>` type on zhCN already enforces this
    // at compile time; kept here so `npm test` reports it too.
    expect(enKeys.filter((key) => !(key in zhCN))).toEqual([])
    expect(zhKeys.filter((key) => !(key in en))).toEqual([])
  })

  it('has no duplicate keys inside a dictionary file', () => {
    expect(new Set(enKeys).size).toBe(enKeys.length)
    expect(new Set(zhKeys).size).toBe(zhKeys.length)
  })
})

describe('dictionary values', () => {
  it('contains no empty translations', () => {
    const empty = [...enKeys, ...zhKeys].filter(
      (key) => (en[key] ?? '').trim() === '' || (zhCN[key] ?? '').trim() === '',
    )
    expect(empty).toEqual([])
  })

  it('uses the same interpolation placeholders in both languages', () => {
    const mismatched = zhKeys
      .filter((key) => key in en)
      .filter((key) => placeholders(en[key]).join() !== placeholders(zhCN[key]).join())
    expect(mismatched).toEqual([])
  })
})
