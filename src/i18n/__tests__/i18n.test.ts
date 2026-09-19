import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LANG, getLang, setLang, t } from '..'
import { en } from '../en'
import { zhCN } from '../zh-CN'
import { KEYS } from '../../utils/storageKeys'

beforeEach(() => {
  setLang('en')
})

describe('t', () => {
  it('translates into the active language', () => {
    setLang('en')
    expect(t('recent.justNow')).toBe('Just now')
    setLang('zh-CN')
    expect(t('recent.justNow')).toBe('刚刚')
  })

  it('interpolates named variables', () => {
    setLang('en')
    expect(t('recent.minutesAgo', { n: 5 })).toBe('5m ago')
    setLang('zh-CN')
    expect(t('recent.minutesAgo', { n: 5 })).toBe('5分钟前')
  })

  it('replaces every occurrence of a variable', () => {
    setLang('en')
    expect(t('vault.pickHint', { name: 'Notes' })).toBe(
      'Selected folder "Notes". Please enter its full absolute path in the box above, then confirm.',
    )
  })

  it('falls back to English when the active dictionary misses a key', () => {
    const key = 'sidebar.brand'
    const dict = zhCN as Record<string, string>
    const backup = dict[key]
    delete dict[key]
    try {
      setLang('zh-CN')
      expect(t(key)).toBe(en[key])
    } finally {
      dict[key] = backup
    }
  })

  it('returns the key itself for an unknown key', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})

describe('setLang / getLang', () => {
  it('persists the language so a reload keeps the choice', () => {
    setLang('zh-CN')
    expect(getLang()).toBe('zh-CN')
    expect(localStorage.getItem(KEYS.lang)).toBe('zh-CN')
  })

  it('writes the language under the shared key namespace', () => {
    setLang('en')
    expect(KEYS.lang.startsWith('markseek.')).toBe(true)
  })

  it('exposes English as the default language', () => {
    expect(DEFAULT_LANG).toBe('en')
  })
})
