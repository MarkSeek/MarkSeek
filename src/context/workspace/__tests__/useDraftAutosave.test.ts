// Draft buffering and the debounced autosave.
//
// The dangerous part of this hook is the timer: a save that fires late (or not
// at all) silently loses the user's last edits, and one that fires with the
// wrong path writes the diary into its own virtual id. Both are covered here.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from '../../../api/files'
import { DIARY_PREFIX, type Tab } from '../tabsReducer'
import { AUTO_SAVE_DELAY, useDraftAutosave } from '../useDraftAutosave'

vi.mock('../../../api/files', () => ({
  writeFile: vi.fn(),
}))

const writeFileMock = vi.mocked(writeFile)

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, name: id, path: id, content: '', dirty: false, ...extra }
}

interface Harness {
  getTabs: () => Tab[]
  markSaved: (id: string) => void
  saved: string[]
}

function setup(tabs: Tab[] = [tab('a.md')]) {
  const marked: string[] = []
  const options: Harness = {
    getTabs: () => tabs,
    markSaved: (id) => marked.push(id),
    saved: marked,
  }
  const view = renderHook(() => useDraftAutosave(options))
  return { ...view, marked }
}

/** Run the debounce out, letting the pending promise settle. */
async function advance(ms = AUTO_SAVE_DELAY) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

describe('useDraftAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeFileMock.mockResolvedValue(undefined)
  })

  it('has no draft until the editor reports one', () => {
    const { result } = setup()

    expect(result.current.hasDraft('a.md')).toBe(false)
  })

  it('writes the buffered draft once the debounce elapses', async () => {
    const { result } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))
    expect(writeFileMock).not.toHaveBeenCalled()

    await advance()

    expect(writeFileMock).toHaveBeenCalledWith('a.md', 'typed text')
    expect(result.current.hasDraft('a.md')).toBe(false)
  })

  it('writes a diary draft to the real date file, not to the virtual id', async () => {
    const diary = tab(DIARY_PREFIX, {
      kind: 'diary',
      filePath: 'Journals/2026/2026-01/2026-01-02.md',
    })
    const { result } = setup([diary])

    act(() => result.current.setDraft(DIARY_PREFIX, 'today'))
    await advance()

    expect(writeFileMock).toHaveBeenCalledWith('Journals/2026/2026-01/2026-01-02.md', 'today')
  })

  it('marks the tab saved only after the write succeeds', async () => {
    writeFileMock.mockRejectedValueOnce(new Error('disk full'))
    const { result, marked } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))
    await advance()

    expect(marked).toEqual([])
    // The draft is kept so the next attempt can still flush it.
    expect(result.current.hasDraft('a.md')).toBe(true)
  })

  it('saveFile is a no-op when nothing was buffered', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.saveFile('a.md')
    })

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('saveFile is a no-op for a tab that no longer exists', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.saveFile('gone.md')
    })

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('clearDraft drops the pending timer so nothing is written later', async () => {
    const { result } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))
    act(() => result.current.clearDraft('a.md'))
    await advance()

    expect(writeFileMock).not.toHaveBeenCalled()
    expect(result.current.hasDraft('a.md')).toBe(false)
  })

  it('cancelTimer keeps the buffer but stops the automatic save', async () => {
    const { result } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))
    act(() => result.current.cancelTimer('a.md'))
    await advance()

    expect(writeFileMock).not.toHaveBeenCalled()
    // Still buffered: an explicit saveFile can flush it.
    expect(result.current.hasDraft('a.md')).toBe(true)

    await act(async () => {
      await result.current.saveFile('a.md')
    })
    expect(writeFileMock).toHaveBeenCalledWith('a.md', 'typed text')
  })

  it('cancelTimer only touches the timer belonging to its own tab', async () => {
    const { result } = setup([tab('a.md'), tab('b.md')])

    act(() => {
      result.current.setDraft('a.md', 'first')
      result.current.setDraft('b.md', 'second')
    })
    // Cancelling `a` must not take `b`'s pending save down with it: the timer
    // belongs to `b`, which is the one armed last.
    act(() => result.current.cancelTimer('a.md'))
    await advance()

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock).toHaveBeenCalledWith('b.md', 'second')
  })

  it('flushDirty writes every buffered draft immediately', async () => {
    const { result } = setup([tab('a.md'), tab('b.md')])

    act(() => {
      result.current.setDraft('a.md', 'one')
      result.current.setDraft('b.md', 'two')
      // Cancel both timers so only flushDirty can be responsible for the writes.
      result.current.cancelTimer('a.md')
      result.current.cancelTimer('b.md')
    })

    act(() => result.current.flushDirty())
    await act(async () => {
      await Promise.resolve()
    })

    expect(writeFileMock).toHaveBeenCalledTimes(2)
    expect(writeFileMock).toHaveBeenCalledWith('a.md', 'one')
    expect(writeFileMock).toHaveBeenCalledWith('b.md', 'two')
    expect(result.current.hasDraft('a.md')).toBe(false)
    expect(result.current.hasDraft('b.md')).toBe(false)
  })

  it('flushDirty is a no-op when nothing is buffered', () => {
    const { result } = setup()

    act(() => result.current.flushDirty())

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('flushes when the page is hidden or unloaded', async () => {
    const { result } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })

    expect(writeFileMock).toHaveBeenCalledWith('a.md', 'typed text')
  })

  it('stops flushing after unmount', async () => {
    const { result, unmount } = setup()

    act(() => result.current.setDraft('a.md', 'typed text'))
    unmount()
    await advance()

    expect(writeFileMock).not.toHaveBeenCalled()
  })
})
