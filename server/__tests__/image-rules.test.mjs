// Specs for the attachment save-rule engine.
//
// The module is pure (no fs, no clock, no settings read), so every case is a
// plain input/output assertion — which is what lets the settings page's
// "test this path" box give the same answer as a real paste.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_DIR,
  compilePattern,
  expandTarget,
  normalizeRelPath,
  resolveImageDir,
  sanitizeImageRules,
  sanitizeRelDir,
} from '../image-rules.mjs'

const NOW = new Date('2026-09-03T10:00:00Z')
const rule = (over = {}) => ({
  id: 'r1',
  name: 'Journals',
  pattern: '^Journals/',
  target: 'assets/journals',
  enabled: true,
  ...over,
})

describe('normalizeRelPath', () => {
  it('strips a leading ./ and / and flips windows separators', () => {
    expect(normalizeRelPath('./Journals/a.md')).toBe('Journals/a.md')
    expect(normalizeRelPath('/Journals/a.md')).toBe('Journals/a.md')
    expect(normalizeRelPath('Journals\\2026\\a.md')).toBe('Journals/2026/a.md')
  })
})

describe('sanitizeRelDir', () => {
  it('accepts a plain nested folder', () => {
    expect(sanitizeRelDir('assets/2026/09')).toBe('assets/2026/09')
  })

  it('rejects anything absolute or traversing', () => {
    expect(sanitizeRelDir('/etc')).toBe('')
    expect(sanitizeRelDir('C:\\Windows')).toBe('')
    expect(sanitizeRelDir('../outside')).toBe('')
    expect(sanitizeRelDir('assets/../../outside')).toBe('')
    expect(sanitizeRelDir('assets//img')).toBe('')
  })

  it('rejects non-strings and blank input', () => {
    expect(sanitizeRelDir('')).toBe('')
    expect(sanitizeRelDir('   ')).toBe('')
    expect(sanitizeRelDir(undefined)).toBe('')
    expect(sanitizeRelDir(42)).toBe('')
  })
})

describe('expandTarget', () => {
  it('fills in the date placeholders', () => {
    expect(expandTarget('assets/{year}/{month}', { now: NOW })).toBe('assets/2026/09')
    expect(expandTarget('assets/{year}-{month}-{day}', { now: NOW })).toBe('assets/2026-09-03')
  })

  it('uses the note file name without its extension', () => {
    expect(expandTarget('Journals/{noteName}/img', { notePath: 'Journals/2026/09-03.md' })).toBe(
      'Journals/09-03/img',
    )
  })

  it('leaves an unknown placeholder alone so the typo is visible, not silent', () => {
    expect(expandTarget('assets/{nope}', { now: NOW })).toBe('assets/{nope}')
  })
})

describe('compilePattern', () => {
  it('returns null for an empty or broken regex instead of throwing', () => {
    expect(compilePattern('')).toBeNull()
    expect(compilePattern('   ')).toBeNull()
    expect(compilePattern('^Journals/(')).toBeNull()
  })

  it('compiles a usable pattern', () => {
    expect(compilePattern('^Journals/')?.test('Journals/a.md')).toBe(true)
  })
})

describe('sanitizeImageRules', () => {
  it('fills in missing fields and drops non-objects', () => {
    const rules = sanitizeImageRules([null, 'nope', { pattern: '^a' }])
    expect(rules).toHaveLength(3)
    expect(rules[2]).toEqual({
      id: 'r_2',
      name: '',
      pattern: '^a',
      target: '',
      enabled: true,
    })
  })

  it('treats a missing rules list as empty', () => {
    expect(sanitizeImageRules(undefined)).toEqual([])
    expect(sanitizeImageRules('nope')).toEqual([])
  })
})

describe('resolveImageDir', () => {
  it('falls back to the built-in folder when there is nothing to match', () => {
    expect(resolveImageDir({ settings: {} }).dir).toBe(DEFAULT_IMAGE_DIR)
    // No note path at all: matching is impossible, so rules are not consulted.
    expect(
      resolveImageDir({ settings: { imageRules: [rule()] }, now: NOW }).dir,
    ).toBe(DEFAULT_IMAGE_DIR)
  })

  it('uses the configured default folder when no rule matches', () => {
    const settings = { imageDefaultDir: 'attachments', imageRules: [rule()] }
    expect(resolveImageDir({ notePath: 'Projects/a.md', settings, now: NOW })).toEqual({
      dir: 'attachments',
      ruleId: '',
      ruleName: '',
    })
  })

  it('ignores an unusable default folder rather than writing outside the vault', () => {
    const settings = { imageDefaultDir: '../../tmp' }
    expect(resolveImageDir({ notePath: 'Projects/a.md', settings, now: NOW }).dir).toBe(
      DEFAULT_IMAGE_DIR,
    )
  })

  it('reports which rule matched', () => {
    const settings = { imageRules: [rule()] }
    expect(resolveImageDir({ notePath: 'Journals/2026/09-03.md', settings, now: NOW })).toEqual({
      dir: 'assets/journals',
      ruleId: 'r1',
      ruleName: 'Journals',
    })
  })

  it('takes the first match in array order — the array order is the priority', () => {
    const settings = {
      imageRules: [
        rule({ id: 'a', target: 'first' }),
        rule({ id: 'b', target: 'second' }),
      ],
    }
    expect(resolveImageDir({ notePath: 'Journals/a.md', settings, now: NOW }).dir).toBe('first')
  })

  it('skips disabled rules', () => {
    const settings = { imageRules: [rule({ enabled: false })] }
    expect(resolveImageDir({ notePath: 'Journals/a.md', settings, now: NOW }).ruleId).toBe('')
  })

  it('skips a rule whose regex does not compile', () => {
    const settings = { imageRules: [rule({ pattern: '^Journals/(' })] }
    expect(resolveImageDir({ notePath: 'Journals/a.md', settings, now: NOW }).ruleId).toBe('')
  })

  it('skips a rule whose target is unsafe and falls through to the next one', () => {
    const settings = {
      imageRules: [
        rule({ id: 'bad', target: '../escape' }),
        rule({ id: 'good', target: 'assets/ok' }),
      ],
    }
    expect(resolveImageDir({ notePath: 'Journals/a.md', settings, now: NOW })).toEqual({
      dir: 'assets/ok',
      ruleId: 'good',
      ruleName: 'Journals',
    })
  })

  it('expands placeholders against the note being edited', () => {
    const settings = {
      imageRules: [rule({ target: 'assets/{year}/{month}/{noteName}' })],
    }
    expect(resolveImageDir({ notePath: 'Journals/2026/09-03.md', settings, now: NOW }).dir).toBe(
      'assets/2026/09/09-03',
    )
  })

  it('normalizes a windows-style note path before matching', () => {
    const settings = { imageRules: [rule()] }
    expect(resolveImageDir({ notePath: 'Journals\\2026\\a.md', settings, now: NOW }).ruleId).toBe(
      'r1',
    )
  })
})
