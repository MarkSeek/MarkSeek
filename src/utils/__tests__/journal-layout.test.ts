import { describe, expect, it } from 'vitest'
import {
  DIARY_DIR,
  diaryPathToYmd,
  filePathToYmd,
  ymdToDir,
  ymdToFilePath,
} from '../diaryPath'
import {
  JOURNALS_DIR,
  journalFilePath,
  monthDirPath,
} from '../../../shared/journal-layout.mjs'

// The frontend builds tab titles, calendar dots and diary routes from this
// layout while the backend (server/notes-fs.mjs) scans the very same tree for
// tasks. Both import shared/journal-layout.mjs now; these specs pin the
// behaviour the rest of the app relies on.
describe('diaryPath <-> shared journal layout', () => {
  it('uses the shared root folder', () => {
    expect(DIARY_DIR).toBe(JOURNALS_DIR)
  })

  it('builds the same file path as the shared builder', () => {
    for (const ymd of ['2026-01-01', '2026-09-03', '2026-12-31', '2026-03-05']) {
      expect(ymdToFilePath(ymd)).toBe(journalFilePath(ymd))
    }
  })

  it('builds the same month folder as the shared builder', () => {
    expect(ymdToDir('2026-09-03')).toBe(monthDirPath('2026-09'))
    expect(ymdToDir('2026-09-03')).toBe('Journals/2026/2026-09')
  })

  it('keeps the zero-padded day, so single-digit days resolve', () => {
    expect(ymdToFilePath('2026-09-03')).toBe('Journals/2026/2026-09/2026-09-03.md')
  })

  it('round-trips a journal path back to its date', () => {
    expect(filePathToYmd(ymdToFilePath('2026-12-31'))).toBe('2026-12-31')
    expect(diaryPathToYmd(ymdToFilePath('2026-12-31'))).toBe('2026-12-31')
  })

  it('refuses a date-looking note that is not a journal entry', () => {
    expect(diaryPathToYmd('Projects/2026-01-01.md')).toBeNull()
    expect(diaryPathToYmd('Journals/2026/2026-01-01.md')).toBeNull()
    expect(diaryPathToYmd('Journals/2026/2026-01/2026-01-01.md.bak')).toBeNull()
    // The loose helper still finds it — it is only used for display.
    expect(filePathToYmd('Projects/2026-01-01.md')).toBe('2026-01-01')
  })
})
