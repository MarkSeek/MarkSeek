// Pure date helpers shared by every date formatter in the app.
//
// `pad()` used to be copy-pasted into seven files, which is how "one copy drops
// the leading zero" bugs get introduced. Everything that builds a 'YYYY-MM-DD'
// string goes through here.
import { pad } from './pad'

export { pad }

/** Date -> 'YYYY-MM-DD' (local time, matching how the journal is named). */
export function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Calendar cell (1-based day, 0-based month) -> 'YYYY-MM-DD'. */
export function partsToYmd(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

/** Month bucket 'YYYY-MM' of a 0-based month. Used as a cache key per month. */
export function monthKey(year: number, month0: number): string {
  return `${year}-${pad(month0 + 1)}`
}

/**
 * 'YYYY-MM-DD' -> a LOCAL Date, or null when the string is not that shape.
 *
 * The parts are fed to the Date constructor explicitly: `new Date('2026-09-06')`
 * parses as UTC midnight, which renders as the previous day west of Greenwich.
 */
export function ymdToDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const year = Number(m[1])
  const month0 = Number(m[2]) - 1
  const day = Number(m[3])
  const d = new Date(year, month0, day)
  // Reject impossible dates such as '2026-02-31', which would roll over.
  if (d.getFullYear() !== year || d.getMonth() !== month0 || d.getDate() !== day) return null
  return d
}

/**
 * 'YYYY-MM-DD' -> the long-form diary header date (e.g. 'September 6, 2026').
 *
 * Delegated to Intl so the date is spelled correctly for every locale
 * without the app keeping its own month names.
 */
export function formatDiaryDate(ymd: string, lang: string): string {
  const d = ymdToDate(ymd)
  if (!d) return ymd
  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

/** 'YYYY-MM-DD' -> the full localized weekday name (e.g. 'Sunday'). */
export function formatDiaryWeekday(ymd: string, lang: string): string {
  const d = ymdToDate(ymd)
  if (!d) return ''
  return new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d)
}
