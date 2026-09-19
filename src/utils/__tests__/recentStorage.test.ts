import { beforeEach, describe, expect, it } from 'vitest'
import {
  RECENT_MAX,
  loadRecent,
  pushRecent,
  saveRecent,
  type RecentItem,
} from '../recentStorage'
import { formatDate, formatFullTime, formatRelativeTime } from '../timeFormat'
import { KEYS } from '../storageKeys'
import { setLang } from '../../i18n'

const KEY = KEYS.recent

function item(path: string, ts: number): RecentItem {
  return { path, name: path.replace(/\.md$/, ''), ts }
}

beforeEach(() => {
  setLang('en')
  localStorage.clear()
})

describe('pushRecent', () => {
  it('puts the newest item first', () => {
    const list = pushRecent([item('a.md', 1)], item('b.md', 2))
    expect(list.map((i) => i.path)).toEqual(['b.md', 'a.md'])
  })

  it('deduplicates by path and moves the match to the front', () => {
    const list = pushRecent([item('a.md', 1), item('b.md', 2), item('c.md', 3)], item('b.md', 9))
    expect(list.map((i) => i.path)).toEqual(['b.md', 'a.md', 'c.md'])
    expect(list[0].ts).toBe(9)
  })

  it(`trims the list to RECENT_MAX (${RECENT_MAX})`, () => {
    let list: RecentItem[] = []
    for (let i = 0; i < RECENT_MAX + 5; i++) list = pushRecent(list, item(`n${i}.md`, i))
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0].path).toBe(`n${RECENT_MAX + 4}.md`)
  })

  it('does not mutate the input array', () => {
    const input = [item('a.md', 1)]
    pushRecent(input, item('b.md', 2))
    expect(input).toHaveLength(1)
  })
})

describe('loadRecent', () => {
  it('round-trips through saveRecent', () => {
    saveRecent([item('a.md', 1), item('b.md', 2)])
    expect(loadRecent()).toEqual([item('a.md', 1), item('b.md', 2)])
  })

  it('returns [] for missing, malformed or non-array payloads', () => {
    expect(loadRecent()).toEqual([])
    localStorage.setItem(KEY, '{not json')
    expect(loadRecent()).toEqual([])
    localStorage.setItem(KEY, '{"nope":true}')
    expect(loadRecent()).toEqual([])
  })

  it('drops entries with missing or wrongly typed fields', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { path: 'a.md', name: 'a', ts: 1 },
        { path: 'b.md', name: 'b' },
        { path: 'c.md', ts: 3 },
        { name: 'd', ts: 4 },
        null,
      ]),
    )
    expect(loadRecent()).toEqual([{ path: 'a.md', name: 'a', ts: 1 }])
  })
})

describe('date formatting', () => {
  const ts = new Date(2026, 7, 29, 15, 4, 5).getTime()

  it('formats an absolute date as YYYY-MM-DD', () => {
    expect(formatDate(ts)).toBe('2026-08-29')
  })

  it('formats a full timestamp with zero-padded time', () => {
    expect(formatFullTime(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02 03:04:05')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 7, 29, 12, 0, 0).getTime()
  const at = (ms: number) => formatRelativeTime(now - ms, now)

  it('reports anything under a minute as "just now"', () => {
    expect(at(0)).toBe('Just now')
    expect(at(59_000)).toBe('Just now')
  })

  it('steps through minutes, hours, days, months and years', () => {
    expect(at(60_000)).toBe('1m ago')
    expect(at(59 * 60_000)).toBe('59m ago')
    expect(at(60 * 60_000)).toBe('1h ago')
    expect(at(23 * 60 * 60_000)).toBe('23h ago')
    expect(at(24 * 60 * 60_000)).toBe('1d ago')
    expect(at(29 * 24 * 60 * 60_000)).toBe('29d ago')
    expect(at(30 * 24 * 60 * 60_000)).toBe('1mo ago')
    expect(at(365 * 24 * 60 * 60_000)).toBe('1y ago')
  })

  it('follows the active language', () => {
    setLang('zh-CN')
    expect(at(5 * 60_000)).toBe('5分钟前')
    setLang('en')
    expect(at(5 * 60_000)).toBe('5m ago')
  })
})
