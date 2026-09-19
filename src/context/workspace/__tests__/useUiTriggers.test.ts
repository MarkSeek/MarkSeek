// One-shot UI signals. The only non-obvious part is the bridge that lets a
// write coming from outside React (calendar drag) raise the same signal as the
// in-app actions.
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setTaskChangeNotifier } from '../../../api/files'
import { useUiTriggers } from '../useUiTriggers'

vi.mock('../../../api/files', () => ({
  setTaskChangeNotifier: vi.fn(),
}))

const setTaskChangeNotifierMock = vi.mocked(setTaskChangeNotifier)

describe('useUiTriggers', () => {
  it('starts with every signal at rest', () => {
    const { result } = renderHook(() => useUiTriggers())

    expect(result.current.searchTrigger).toBe(0)
    expect(result.current.aiPanelTrigger).toBe(0)
    expect(result.current.taskVersion).toBe(0)
    expect(result.current.searchOpen).toBe(false)
  })

  it('counts each bump separately', () => {
    const { result } = renderHook(() => useUiTriggers())

    act(() => {
      result.current.bumpSearch()
      result.current.bumpSearch()
      result.current.bumpAiPanel()
      result.current.bumpTasks()
    })

    expect(result.current.searchTrigger).toBe(2)
    expect(result.current.aiPanelTrigger).toBe(1)
    expect(result.current.taskVersion).toBe(1)
  })

  it('opens and closes the search dialog directly', () => {
    const { result } = renderHook(() => useUiTriggers())

    act(() => result.current.openSearch())
    expect(result.current.searchOpen).toBe(true)

    act(() => result.current.closeSearch())
    expect(result.current.searchOpen).toBe(false)
  })

  it('registers the outside-write bridge and clears it on unmount', () => {
    const { unmount } = renderHook(() => useUiTriggers())

    expect(setTaskChangeNotifierMock).toHaveBeenCalledWith(expect.any(Function))

    unmount()

    expect(setTaskChangeNotifierMock).toHaveBeenLastCalledWith(null)
  })

  it('raises taskVersion when a write comes from outside React', () => {
    const { result } = renderHook(() => useUiTriggers())
    const notifier = setTaskChangeNotifierMock.mock.calls[0][0]
    if (!notifier) throw new Error('the bridge was never registered')

    act(() => notifier())

    expect(result.current.taskVersion).toBe(1)
  })
})
