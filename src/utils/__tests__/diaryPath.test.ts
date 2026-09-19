import { describe, expect, it } from 'vitest'
import {
  DIARY_DIR,
  diaryPathToYmd,
  filePathToYmd,
  ymdToDir,
  ymdToFilePath,
  ymdToTabName,
} from '../diaryPath'

describe('ymdToFilePath', () => {
  it('builds the nested journal path', () => {
    expect(ymdToFilePath('2026-03-05')).toBe(`${DIARY_DIR}/2026/2026-03/2026-03-05.md`)
  })

  it('keeps the zero padding of the stored date', () => {
    // A regression here used to drop the leading zero ('2026-03-1.md').
    expect(ymdToFilePath('2026-03-01')).toBe(`${DIARY_DIR}/2026/2026-03/2026-03-01.md`)
  })
})

describe('ymdToDir', () => {
  it('returns the month folder', () => {
    expect(ymdToDir('2026-03-05')).toBe(`${DIARY_DIR}/2026/2026-03`)
  })

  it('is the parent of the file path', () => {
    expect(ymdToFilePath('2026-03-05').startsWith(ymdToDir('2026-03-05') + '/')).toBe(true)
  })
})

describe('ymdToTabName', () => {
  it('uses the date as the title', () => {
    expect(ymdToTabName('2026-03-05')).toBe('2026-03-05')
  })
})

describe('filePathToYmd', () => {
  it('extracts the date from a journal path', () => {
    expect(filePathToYmd(`${DIARY_DIR}/2026/2026-03/2026-03-05.md`)).toBe('2026-03-05')
  })

  it('round-trips with ymdToFilePath', () => {
    expect(filePathToYmd(ymdToFilePath('2026-12-31'))).toBe('2026-12-31')
  })

  it('is loose: any path ending in a date matches', () => {
    // Deliberate: the recent list navigates by date regardless of the folder.
    expect(filePathToYmd('archive/2026-03-05.md')).toBe('2026-03-05')
  })

  it('returns null for a non-dated path', () => {
    expect(filePathToYmd('notes/todo.md')).toBeNull()
    expect(filePathToYmd(`${DIARY_DIR}/2026/2026-03/note.md`)).toBeNull()
  })
})

describe('diaryPathToYmd', () => {
  it('accepts the exact journal layout', () => {
    expect(diaryPathToYmd(`${DIARY_DIR}/2026/2026-03/2026-03-05.md`)).toBe('2026-03-05')
  })

  it('rejects a dated file outside the journal folders', () => {
    // This is what the loose filePathToYmd would happily accept.
    expect(diaryPathToYmd('archive/2026-03-05.md')).toBeNull()
    expect(diaryPathToYmd('2026-03-05.md')).toBeNull()
  })

  it('rejects a journal note in the wrong nesting depth', () => {
    expect(diaryPathToYmd(`${DIARY_DIR}/2026/2026-03-05.md`)).toBeNull()
    expect(diaryPathToYmd(`${DIARY_DIR}/2026/2026-03/2026-03-05.md.bak`)).toBeNull()
  })
})
