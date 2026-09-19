// Tab state container: the mirror inside `dispatch` is what lets a callback
// read the tab list in the same tick it changed it. These specs pin that
// contract, because every file operation depends on it.
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { initialTabsState, tabsReducer, type Tab, type WorkspaceTabsState } from '../tabsReducer'
import { useTabState } from '../useTabState'

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, name: id, path: id, content: '', dirty: false, ...extra }
}

describe('useTabState', () => {
  it('starts from the empty tabs state', () => {
    const { result } = renderHook(() => useTabState())

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabId).toBeNull()
    expect(result.current.activeTab).toBeNull()
    expect(result.current.selectedNodeId).toBeNull()
  })

  it('opens a tab and makes it active', () => {
    const { result } = renderHook(() => useTabState())

    act(() => {
      result.current.dispatch({ type: 'open', tab: tab('a.md') })
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['a.md'])
    expect(result.current.activeTabId).toBe('a.md')
    expect(result.current.activeTab).toMatchObject({ id: 'a.md' })
  })

  it('getTabs sees the new tab in the same tick as the dispatch', () => {
    const { result } = renderHook(() => useTabState())
    let seen: Tab[] = []

    act(() => {
      result.current.dispatch({ type: 'open', tab: tab('a.md') })
      // No re-render has happened yet: only the mirror can answer this.
      seen = result.current.getTabs()
    })

    expect(seen.map((t) => t.id)).toEqual(['a.md'])
  })

  it('keeps two sequential dispatches in one tick consistent', () => {
    const { result } = renderHook(() => useTabState())

    act(() => {
      result.current.dispatch({ type: 'open', tab: tab('a.md') })
      result.current.dispatch({ type: 'open', tab: tab('b.md') })
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['a.md', 'b.md'])
    expect(result.current.activeTabId).toBe('b.md')
  })

  it('hands the active tab to its neighbour when it is closed', () => {
    const { result } = renderHook(() => useTabState())

    act(() => {
      result.current.dispatch({ type: 'open', tab: tab('a.md') })
      result.current.dispatch({ type: 'open', tab: tab('b.md') })
    })
    act(() => {
      result.current.dispatch({ type: 'close', id: 'b.md' })
    })

    expect(result.current.activeTabId).toBe('a.md')
    expect(result.current.tabs.map((t) => t.id)).toEqual(['a.md'])
  })

  it('does not re-render when the reducer returns the same state', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useTabState()
    })
    const afterMount = renders

    // Activating an id that is not open is a no-op in the reducer.
    act(() => {
      result.current.dispatch({ type: 'activate', id: 'missing.md' })
    })

    expect(renders).toBe(afterMount)
  })

  it('stays in sync with the pure reducer', () => {
    const { result } = renderHook(() => useTabState())
    let expected: WorkspaceTabsState = initialTabsState

    const actions = [
      { type: 'open', tab: tab('a.md'), select: true },
      { type: 'open', tab: tab('b.md') },
      { type: 'draft', id: 'a.md', content: 'hello' },
      { type: 'markSaved', id: 'a.md' },
      { type: 'reorder', from: 0, to: 1 },
      { type: 'close', id: 'b.md' },
    ] as const

    act(() => {
      for (const action of actions) {
        result.current.dispatch(action)
        expected = tabsReducer(expected, action)
      }
    })

    expect(result.current.getState()).toEqual(expected)
  })
})
