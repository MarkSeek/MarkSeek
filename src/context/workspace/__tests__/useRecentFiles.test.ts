// Recent notes list: dedupe by path, newest first, persisted through the
// shared storage layer (this spec deliberately drives the real localStorage
// rather than a stub, so the persistence round trip is covered too).
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  RECENT_MAX,
  loadRecent,
  saveRecent,
  type RecentItem,
} from '../../../utils/recentStorage'
import { KEYS } from '../../../utils/storageKeys'
import { useRecentFiles } from '../useRecentFiles'

function item(path: string, ts = 1): RecentItem {
  return { path, name: path.replace(/\.md$/, ''), ts }
}

/** Append entries one by one, the way opening notes does. */
function openAll(result: { current: { addRecent: (i: RecentItem) => void } }, paths: string[]) {
  act(() => {
    paths.forEach((path, index) => result.current.addRecent(item(path, index + 1)))
  })
}

describe('useRecentFiles', () => {
  it('starts empty when nothing was persisted', () => {
    const { result } = renderHook(() => useRecentFiles())

    expect(result.current.recentFiles).toEqual([])
  })

  it('starts from the persisted list', () => {
    saveRecent([item('a.md'), item('b.md')])

    const { result } = renderHook(() => useRecentFiles())

    expect(result.current.recentFiles).toEqual([item('a.md'), item('b.md')])
  })

  it('puts the newest entry first', () => {
    const { result } = renderHook(() => useRecentFiles())

    openAll(result, ['a.md', 'b.md'])

    expect(result.current.recentFiles.map((i) => i.path)).toEqual(['b.md', 'a.md'])
  })

  it('moves a repeated note to the front instead of listing it twice', () => {
    const { result } = renderHook(() => useRecentFiles())

    openAll(result, ['a.md', 'b.md', 'a.md'])

    expect(result.current.recentFiles.map((i) => i.path)).toEqual(['a.md', 'b.md'])
    expect(result.current.recentFiles[0].ts).toBe(3)
  })

  it('trims the list to RECENT_MAX', () => {
    const { result } = renderHook(() => useRecentFiles())
    const paths = Array.from({ length: RECENT_MAX + 3 }, (_, i) => `note-${i}.md`)

    openAll(result, paths)

    expect(result.current.recentFiles).toHaveLength(RECENT_MAX)
    expect(result.current.recentFiles[0].path).toBe(`note-${paths.length - 1}.md`)
  })

  it('persists the list so the next launch reads it back', () => {
    const { result } = renderHook(() => useRecentFiles())

    openAll(result, ['a.md', 'b.md'])

    expect(loadRecent().map((i) => i.path)).toEqual(['b.md', 'a.md'])
  })

  it('ignores a corrupt payload instead of throwing on mount', () => {
    localStorage.setItem(KEYS.recent, '{ not json')

    const { result } = renderHook(() => useRecentFiles())

    expect(result.current.recentFiles).toEqual([])
  })
})
