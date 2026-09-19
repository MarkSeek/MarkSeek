import { describe, expect, it } from 'vitest'
import { pad, dateToYmd, partsToYmd, monthKey } from '../date'
import { formatDiaryDate, formatDiaryWeekday, ymdToDate } from '../date'

describe('pad', () => {
  it('zero-pads single digits', () => {
    expect(pad(0)).toBe('00')
    expect(pad(9)).toBe('09')
  })

  it('leaves two-digit values alone', () => {
    expect(pad(10)).toBe('10')
    expect(pad(31)).toBe('31')
  })
})

describe('dateToYmd', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(dateToYmd(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(dateToYmd(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('zero-pads the month and the day', () => {
    expect(dateToYmd(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
})

describe('partsToYmd', () => {
  it('takes a 1-based day and a 0-based month', () => {
    expect(partsToYmd(2026, 0, 1)).toBe('2026-01-01')
    expect(partsToYmd(2026, 11, 31)).toBe('2026-12-31')
  })

  it('agrees with dateToYmd for the same day', () => {
    const d = new Date(2026, 6, 4)
    expect(partsToYmd(2026, 6, 4)).toBe(dateToYmd(d))
  })
})

describe('monthKey', () => {
  it('zero-pads the month', () => {
    expect(monthKey(2026, 0)).toBe('2026-01')
    expect(monthKey(2026, 11)).toBe('2026-12')
  })

  it('is the bucket of every day in that month', () => {
    expect(partsToYmd(2026, 2, 5).startsWith(monthKey(2026, 2))).toBe(true)
  })
})

describe('ymdToDate', () => {
  it('parses the parts as local time, not UTC', () => {
    // `new Date('2026-09-06')` is UTC midnight and lands on the previous day
    // for anyone west of Greenwich; the parts must be fed in explicitly.
    const d = ymdToDate('2026-09-06')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(8)
    expect(d!.getDate()).toBe(6)
  })

  it('keeps the leading zero of a padded date', () => {
    expect(ymdToDate('2026-03-01')!.getDate()).toBe(1)
  })

  it('rejects malformed strings', () => {
    expect(ymdToDate('2026-3-1')).toBeNull()
    expect(ymdToDate('not-a-date')).toBeNull()
    expect(ymdToDate('')).toBeNull()
  })

  it('rejects impossible dates instead of rolling them over', () => {
    // 2026 is not a leap year, so February has 28 days.
    expect(ymdToDate('2026-02-30')).toBeNull()
    expect(ymdToDate('2026-13-01')).toBeNull()
  })
})

describe('formatDiaryDate', () => {
  it('spells the date out under zh-CN', () => {
    expect(formatDiaryDate('2026-09-06', 'zh-CN')).toBe('2026年9月6日')
  })

  it('spells the date out under en', () => {
    expect(formatDiaryDate('2026-09-06', 'en')).toBe('September 6, 2026')
  })

  it('falls back to the raw ymd when the date is unusable', () => {
    expect(formatDiaryDate('nonsense', 'en')).toBe('nonsense')
  })
})

describe('formatDiaryWeekday', () => {
  it('returns the full weekday under zh-CN', () => {
    // 2026-09-06 is a Sunday.
    expect(formatDiaryWeekday('2026-09-06', 'zh-CN')).toBe('星期日')
  })

  it('returns the full weekday under en', () => {
    expect(formatDiaryWeekday('2026-09-06', 'en')).toBe('Sunday')
  })

  it('returns an empty string when the date is unusable', () => {
    expect(formatDiaryWeekday('nonsense', 'en')).toBe('')
  })
})
