// Tab state: the single source of truth for open tabs.
//
// Before the split, `openTabs` / `activeTabId` / `selectedNodeId` were three
// `useState` values that every callback re-read through its own mirror ref.
// Here the reducer owns the shape and one mirror (`stateRef`) is updated
// synchronously inside `dispatch`, so a callback can read the tab list in the
// same tick it changed it — without a second copy that could go stale.
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  initialTabsState,
  tabsReducer,
  type Tab,
  type TabAction,
  type WorkspaceTabsState,
} from './tabsReducer'

export interface TabStateApi {
  tabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  selectedNodeId: string | null
  /** Latest tabs, safe to call in the same tick as a `dispatch`. */
  getTabs: () => Tab[]
  getState: () => WorkspaceTabsState
  dispatch: (action: TabAction) => void
}

export function useTabState(): TabStateApi {
  const [state, setState] = useState<WorkspaceTabsState>(initialTabsState)
  const stateRef = useRef(state)

  const dispatch = useCallback((action: TabAction) => {
    const next = tabsReducer(stateRef.current, action)
    // The reducer returns the same object when nothing changed, which also
    // means no re-render.
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  const getState = useCallback(() => stateRef.current, [])
  const getTabs = useCallback(() => stateRef.current.tabs, [])

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) || null,
    [state.tabs, state.activeTabId],
  )

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    selectedNodeId: state.selectedNodeId,
    getTabs,
    getState,
    dispatch,
  }
}
