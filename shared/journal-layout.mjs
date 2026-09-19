// Journal (diary) layout: one note per day, stored as
//
//   <vault>/Journals/YYYY/YYYY-MM/YYYY-MM-DD.md
//
// The backend walks this tree to collect tasks (server/notes-fs.mjs,
// server/agent/tools.mjs) while the frontend derives tab titles, calendar dots
// and diary routes from it (src/utils/diaryPath.ts). Both sides import this
// file, so changing the layout can never update only one of them — the bug
// that made the calendar and the diary disagree about where a day lives.
//
// Plain ESM (.mjs) on purpose: the backend is plain Node and the frontend is
// TypeScript, and this is the only format both can import without a build step.
//
// The regexes are module-level constants. They carry no `g` flag, so `match`
// never touches `lastIndex` and sharing one instance is safe.

/** Root folder holding the journal notes. */
export const JOURNALS_DIR = 'Journals'

/** One day's file name: 'YYYY-MM-DD.md'. */
export const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/

/** A year folder name: 'YYYY'. */
export const YEAR_RE = /^\d{4}$/

/** A month folder name: 'YYYY-MM'. */
export const MONTH_RE = /^\d{4}-\d{2}$/

/** A full journal path, capturing the 'YYYY-MM-DD' part. */
export const JOURNAL_PATH_RE = new RegExp(
  `^${JOURNALS_DIR}/\\d{4}/\\d{4}-\\d{2}/(\\d{4}-\\d{2}-\\d{2})\\.md$`,
)

/** 'YYYY-MM' -> 'Journals/YYYY/YYYY-MM' */
export function monthDirPath(yyyyMm) {
  return `${JOURNALS_DIR}/${yyyyMm.slice(0, 4)}/${yyyyMm}`
}

/**
 * 'YYYY-MM-DD' -> 'Journals/YYYY/YYYY-MM/YYYY-MM-DD.md'.
 * The captures are already zero-padded, so day 01-09 keeps its leading zero.
 * @returns {string | null} null when the input is not a plausible date.
 */
export function journalFilePath(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return null
  const [, y, mo, d] = m
  if (Number(mo) < 1 || Number(mo) > 12) return null
  if (Number(d) < 1 || Number(d) > 31) return null
  return `${monthDirPath(`${y}-${mo}`)}/${y}-${mo}-${d}.md`
}
