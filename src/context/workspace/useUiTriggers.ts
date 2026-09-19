// One-shot UI signals.
//
// Each of these is a counter or a boolean that a distant component listens to
// ("open the search dialog", "switch the right panel to AI", "the tasks
// changed"). They are pure signals with no domain logic, which is why they can
// live on their own instead of bloating the workspace context.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { setTaskChangeNotifier } from '../../api/files'

export interface UiTriggersApi {
  /** Incremented by `bumpSearch()`; the sidebar opens its dialog on change. */
  searchTrigger: number
  bumpSearch: () => void
  /** Direct open/close state, preferred over the counter. */
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void
  /** Incremented by `bumpAiPanel()`; switches the right panel to AI. */
  aiPanelTrigger: number
  bumpAiPanel: () => void
  /** Bumped when a journal file is written, so the mini calendar refreshes. */
  taskVersion: number
  bumpTasks: () => void
}

export function useUiTriggers(): UiTriggersApi {
  const [searchTrigger, setSearchTrigger] = useState(0)
  const bumpSearch = useCallback(() => setSearchTrigger((n) => n + 1), [])

  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  const [aiPanelTrigger, setAiPanelTrigger] = useState(0)
  const bumpAiPanel = useCallback(() => setAiPanelTrigger((n) => n + 1), [])

  const [taskVersion, setTaskVersion] = useState(0)
  const bumpTasks = useCallback(() => setTaskVersion((n) => n + 1), [])

  // Writes coming from outside React (calendar drag) raise the same signal.
  useEffect(() => {
    setTaskChangeNotifier(() => setTaskVersion((n) => n + 1))
    return () => setTaskChangeNotifier(null)
  }, [])

  return useMemo(
    () => ({
      searchTrigger,
      bumpSearch,
      searchOpen,
      openSearch,
      closeSearch,
      aiPanelTrigger,
      bumpAiPanel,
      taskVersion,
      bumpTasks,
    }),
    [
      searchTrigger,
      bumpSearch,
      searchOpen,
      openSearch,
      closeSearch,
      aiPanelTrigger,
      bumpAiPanel,
      taskVersion,
      bumpTasks,
    ],
  )
}
