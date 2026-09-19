// Month grid construction for the calendar views.
//
// The sidebar mini-calendar and the full calendar page used to build their grid
// with two separate copy-pasted loops. One function covers both: they differ
// only in how many rows they insist on (the mini-calendar always shows six so it
// does not jump in height when paging between months of different lengths).
export interface MonthCell {
  year: number
  /** 0-based, matching Date#getMonth. */
  month: number
  day: number
  /** False for the leading/trailing days borrowed from a neighbouring month. */
  inMonth: boolean
}

/**
 * Build the cells of one month, always as whole weeks starting on
 * `weekStartsOn` (0 = Sunday).
 *
 * Day/month/year overflow is delegated to `new Date(...)`, so no manual
 * December -> January carry is needed.
 * @param {number} year
 * @param {number} month0 0-based month
 * @param {{ weekStartsOn?: number, minWeeks?: number }} [opts]
 */
export function buildMonthGrid(
  year: number,
  month0: number,
  { weekStartsOn = 0, minWeeks = 0 }: { weekStartsOn?: number; minWeeks?: number } = {},
): MonthCell[] {
  const first = new Date(year, month0, 1)
  const leading = (first.getDay() - weekStartsOn + 7) % 7
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const prevMonthDays = new Date(year, month0, 0).getDate()

  const cells: MonthCell[] = []

  for (let i = leading; i > 0; i--) {
    // Note the `month0 - 1`: the day numbers come from the previous month, so
    // building the Date in the current month would overflow into the next one.
    const d = new Date(year, month0 - 1, prevMonthDays - i + 1)
    cells.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), inMonth: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month: month0, day: d, inMonth: true })
  }

  let nextDay = 1
  while (cells.length % 7 !== 0 || cells.length < minWeeks * 7) {
    const d = new Date(year, month0 + 1, nextDay++)
    cells.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), inMonth: false })
  }

  return cells
}
