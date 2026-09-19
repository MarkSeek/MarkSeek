import { describe, expect, it } from 'vitest'
import { buildMonthGrid } from '../monthGrid'

describe('buildMonthGrid', () => {
  it('starts on Sunday by default and ends on a whole week', () => {
    const cells = buildMonthGrid(2026, 5) // June 2026: 1st is a Monday
    expect(cells).toHaveLength(35)
    expect(cells[0]).toEqual({ year: 2026, month: 4, day: 31, inMonth: false })
    expect(cells[1]).toEqual({ year: 2026, month: 5, day: 1, inMonth: true })
  })

  it('marks only the days of the requested month as inMonth', () => {
    const cells = buildMonthGrid(2026, 5)
    const days = cells.filter((c) => c.inMonth)
    expect(days).toHaveLength(30) // June has 30 days
    expect(days[0].day).toBe(1)
    expect(days[days.length - 1].day).toBe(30)
  })

  it('carries the year over when the trailing days reach January', () => {
    // December 2026 starts on a Tuesday and its grid spills into 2027.
    const cells = buildMonthGrid(2026, 11)
    const trailing = cells.filter((c) => !c.inMonth && c.month === 0)
    expect(trailing.length).toBeGreaterThan(0)
    expect(trailing[0].year).toBe(2027)
  })

  it('carries the year back when the leading days come from December', () => {
    // January 2027 starts on a Friday, so the grid borrows from December 2026.
    const cells = buildMonthGrid(2027, 0)
    expect(cells[0]).toEqual({ year: 2026, month: 11, day: 27, inMonth: false })
  })

  it('pads to at least minWeeks rows', () => {
    // February 2026 starts on a Sunday, so it needs no leading days: 28 days
    // fill exactly 4 weeks, but the mini-calendar always shows 6.
    const cells = buildMonthGrid(2026, 1, { minWeeks: 6 })
    expect(cells).toHaveLength(42)
    expect(buildMonthGrid(2026, 1)).toHaveLength(28)
  })

  it('honours a non-Sunday week start', () => {
    const sunday = buildMonthGrid(2026, 5)
    const monday = buildMonthGrid(2026, 5, { weekStartsOn: 1 })
    // Shifting the week start removes the single leading day of the 5-week grid.
    expect(monday).toHaveLength(35)
    expect(monday[0]).toEqual({ year: 2026, month: 5, day: 1, inMonth: true })
    expect(sunday[0].inMonth).toBe(false)
  })

  it('is consecutive: every cell is one day after the previous one', () => {
    const cells = buildMonthGrid(2026, 5, { minWeeks: 6 })
    for (let i = 1; i < cells.length; i++) {
      const prev = new Date(cells[i - 1].year, cells[i - 1].month, cells[i - 1].day)
      const cur = new Date(cells[i].year, cells[i].month, cells[i].day)
      expect((cur.getTime() - prev.getTime()) / 86_400_000).toBe(1)
    }
  })
})
