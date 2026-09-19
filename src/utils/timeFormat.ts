// Human-friendly timestamps for the "recent notes" list.
//
// These used to live in `recentStorage.ts`, where they mixed storage concerns
// with i18n formatting. They are pure and i18n-aware, so they belong on their
// own.
import { t } from '../i18n'
import { pad } from './pad'

/**
 * Relative time with a coarse granularity (minutes -> hours -> days, then
 * months/years for very old items); anything under a minute reads "just now".
 * `now` can be injected so callers can force a refresh on a timer.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return t('recent.justNow')
  const min = Math.floor(diff / 60_000)
  if (min < 60) return t('recent.minutesAgo', { n: min })
  const hour = Math.floor(min / 60)
  if (hour < 24) return t('recent.hoursAgo', { n: hour })
  const day = Math.floor(hour / 24)
  if (day < 30) return t('recent.daysAgo', { n: day })
  const month = Math.floor(day / 30)
  if (month < 12) return t('recent.monthsAgo', { n: month })
  const year = Math.floor(month / 12)
  return t('recent.yearsAgo', { n: year })
}

/** Full absolute timestamp used as a hover tooltip (e.g. 2026-08-29 15:04:05). */
export function formatFullTime(ts: number): string {
  const d = new Date(ts)
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Compact absolute date (e.g. 2026-08-26). */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
