// Date <-> journal path helpers.
//
// The vault stores one note per day under `Journals/YYYY/YYYY-MM/YYYY-MM-DD.md`.
// Every conversion lives here so the tab logic, the diary page, the calendar
// and the file tree all agree on the same layout.
//
// These used to live in `context/workspace/diaryPaths.ts` while four other
// modules carried their own copy: `pad()` had seven copies and the path regex
// five, and the copies had already drifted (the tree matched the full layout
// while others matched a bare date anywhere in the path).
//
// The layout itself is NOT here: it lives in shared/journal-layout.mjs, which
// the backend (server/notes-fs.mjs) imports as well. A layout change is now
// impossible to apply to only one side.

import {
  JOURNALS_DIR,
  JOURNAL_PATH_RE,
  journalFilePath,
  monthDirPath,
} from '../../shared/journal-layout.mjs'

/** Root folder holding the journal notes. */
export const DIARY_DIR = JOURNALS_DIR

/** 'YYYY-MM-DD' -> 'Journals/YYYY/YYYY-MM/YYYY-MM-DD.md' */
export function ymdToFilePath(ymd: string): string {
  // `journalFilePath` validates the date; the callers here always pass a real
  // 'YYYY-MM-DD', so the null branch is unreachable in practice and the shared
  // builder is still the single definition of the layout.
  return journalFilePath(ymd) ?? ''
}

/** 'YYYY-MM-DD' -> the month folder 'Journals/YYYY/YYYY-MM' owning that day. */
export function ymdToDir(ymd: string): string {
  return monthDirPath(ymd.slice(0, 7))
}

/**
 * 'YYYY-MM-DD' -> tab title. The title is just the date; the calendar icon is
 * rendered by the tab bar.
 */
export function ymdToTabName(ymd: string): string {
  return ymd
}

/**
 * Extract 'YYYY-MM-DD' from any file path ending in a date, or null when it
 * does not match. Loose on purpose: used for display and for the recent list.
 */
export function filePathToYmd(filePath: string): string | null {
  const m = filePath.match(/(\d{4}-\d{2}-\d{2})\.md$/)
  return m ? m[1] : null
}

/**
 * Strict variant of filePathToYmd: only the real journal layout counts, so a
 * stray `2026-01-01.md` elsewhere in the vault is NOT opened as a diary entry.
 * @returns {string | null} the date, or null when the path is not a journal note.
 */
export function diaryPathToYmd(filePath: string): string | null {
  const m = filePath.match(JOURNAL_PATH_RE)
  return m ? m[1] : null
}
