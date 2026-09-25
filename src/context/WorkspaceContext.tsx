import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { readFile, writeFile, type TreeNode } from '../api/files'
import { t, useTranslation } from '../i18n'
import { SHORTCUT_EVENTS } from '../hooks/shortcutEvents'
import type { RecentItem } from '../utils/recentStorage'
import { useSettings } from './SettingsContext'
import { useDraftAutosave } from './workspace/useDraftAutosave'
import { useFileOperations } from './workspace/useFileOperations'
import { useFileTree } from './workspace/useFileTree'
import { useRecentFiles } from './workspace/useRecentFiles'
import { useSessionSync } from './workspace/useSessionSync'
import { useTabState } from './workspace/useTabState'
import { useUiTriggers } from './workspace/useUiTriggers'
import { useVirtualPages } from './workspace/useVirtualPages'
import {
  CALENDAR_ID,
  DIARY_PREFIX,
  HOME_ID,
  LITEAPP_DIR,
  LITEAPP_PREFIX,
  SETTINGS_ID,
  type Tab,
} from './workspace/tabsReducer'

// Re-exported so existing importers keep working unchanged.
export type { Tab }
export { DIARY_PREFIX, LITEAPP_PREFIX, LITEAPP_DIR, HOME_ID, CALENDAR_ID, SETTINGS_ID }

export interface WorkspaceContextValue {
  fileTree: TreeNode[]
  loading: boolean
  openTabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  selectedNodeId: string | null // currently selected node in the tree (file or folder), VSCode-style single selection
  setSelectedNodeId: (id: string | null) => void
  loadFileTree: () => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (id: string, skipSave?: boolean) => Promise<void>
  switchTab: (id: string) => Promise<void>
  updateContent: (id: string, content: string) => void
  saveFile: (id: string) => Promise<void>
  createFile: (targetDir?: string, ext?: 'md' | 'excalidraw') => Promise<void>
  createFolder: (targetDir?: string) => Promise<void>
  deleteFile: (id: string) => Promise<void>
  moveFile: (id: string, targetDir?: string) => Promise<void>
  renameFile: (id: string, newName: string) => Promise<void>
  openCalendar: () => void
  openLiteApp: () => void
  openHome: () => void
  openSettings: () => void
  /** Open today's journal file */
  openTodayNote: () => Promise<void>
  /** Open the journal for a given date, ymd like 'YYYY-MM-DD', defaulting to today.
   *  Only emits a "jump request"; the actual read/save/paging is handled uniformly by
   *  DiaryPage, avoiding activeTab being rewritten early and misaligning ymd with content. */
  openDiary: (ymd?: string) => Promise<void>
  /** Update the current diary virtual page (follows the date on paging, also updating title, path/content/version) */
  updateDiaryTab: (ymd: string, content: string) => void
  /** The "jump to date" request consumed by DiaryPage (external entries send a signal uniformly) */
  pendingDiaryYmd: string | null
  /** Set the pending jump date (cleared after DiaryPage consumes it) */
  setPendingDiaryYmd: (ymd: string | null) => void
  /**
   * Reload the opened file's content from disk (refresh the editor after external edits, e.g.
   * calendar task dragging, agent writing files). The diary page and normal files share this
   * path, so no special-casing is needed.
   *
   * nextContent is optional: the writer often already holds the new content in memory, and passing
   * it skips the "write then read" disk round-trip and avoids a race where another write interleaves.
   */
  refreshOpenFile: (path: string, nextContent?: string) => Promise<void>
  /** Reorder tabs by dragging */
  reorderTabs: (fromIndex: number, toIndex: number) => void
  /** Insert a file/folder node locally into the file tree (avoiding a full refresh) */
  addFileTreeNode: (parentPath: string, node: TreeNode) => void
  /** Set of currently expanded directory paths (TreeList's expanded state lifted here for logic) */
  expandedPaths: Set<string>
  /** Toggle a directory's expand/collapse */
  toggleExpandedPath: (id: string) => void
  /** Update the expanded set locally (e.g. auto-expand parent when opening a file) */
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  /** After creating a diary file, insert locally only if its month directory is expanded; otherwise skip the tree refresh */
  addDiaryFile: (ymd: string) => void
  /** Counter: calling bumpSearch() opens the sidebar search dialog */
  searchTrigger: number
  bumpSearch: () => void
  /** Direct open/close state of the search dialog (alternative to bumpSearch, more reliable) */
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void
  /** Open the MarkSeek getting-started note (created if missing) */
  openIntroNote: () => Promise<void>
  /** Counter: calling bumpAiPanel() switches the right panel to the AI tab */
  aiPanelTrigger: number
  bumpAiPanel: () => void
  /** Task-change version counter: incremented after journal writes (task add/edit/delete) so the mini-calendar refreshes dots */
  taskVersion: number
  /** Explicitly trigger a task-data refresh (e.g. after a journal is saved, to update mini-calendar dots promptly) */
  bumpTasks: () => void
  /** Recently opened files (up to RECENT_MAX, persisted in localStorage) */
  recentFiles: RecentItem[]
  /** Append a recent-open record (dedupe by path and move to front) */
  addRecent: (item: RecentItem) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/**
 * Composition root of the workspace.
 *
 * The state itself lives in the hooks under `./workspace`; this component only
 * wires them together and exposes the one flat context the UI consumes. The
 * wiring order matters and is the reason the old `openDiaryRef` mirror could be
 * dropped: the diary opener is created before the session sync that calls it.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Language drives the titles of the virtual pages.
  const { lang } = useTranslation()
  // The vault path scopes the restored session, so each knowledge base reopens
  // with its own tabs.
  const { vaultPath } = useSettings()

  const tabState = useTabState()
  const { dispatch, getTabs } = tabState
  const tree = useFileTree()
  const ui = useUiTriggers()
  const recent = useRecentFiles()

  const markSaved = useCallback((id: string) => dispatch({ type: 'markSaved', id }), [dispatch])

  const autosave = useDraftAutosave({ getTabs, markSaved })

  const virtual = useVirtualPages({
    dispatch,
    getTabs,
    clearDraft: autosave.clearDraft,
    addDiaryFile: tree.addDiaryFile,
  })

  const files = useFileOperations({
    tabs: tabState,
    autosave,
    tree,
    addRecent: recent.addRecent,
  })

  const { restoreChecked } = useSessionSync({
    vaultPath,
    treeReady: !tree.loading,
    tabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    selectedNodeId: tabState.selectedNodeId,
    expandedPaths: tree.expandedPaths,
    dispatch,
    getTabs,
    openDiary: virtual.openDiary,
    setExpandedPaths: tree.setExpandedPaths,
  })

  // Reactive language: re-localise the virtual page titles on switch.
  useEffect(() => {
    dispatch({
      type: 'retitle',
      titles: {
        [CALENDAR_ID]: t('tab.calendar'),
        [SETTINGS_ID]: t('tab.settings'),
        [HOME_ID]: t('tab.home'),
        [LITEAPP_PREFIX]: t('tab.liteapp'),
      },
    })
  }, [dispatch, lang])

  /**
   * Editor keystroke: buffer the content (so a save never reads stale state)
   * and mark the tab dirty, then re-arm the debounced autosave.
   */
  const updateContent = useCallback(
    (id: string, content: string) => {
      // Picture tabs are read-only viewers: they hold no text to buffer.
      if (tabsRef.current.find((tab) => tab.id === id)?.kind === 'image') return
      autosave.setDraft(id, content)
      dispatch({ type: 'draft', id, content })
    },
    [autosave, dispatch],
  )

  const setSelectedNodeId = useCallback(
    (id: string | null) => dispatch({ type: 'select', id }),
    [dispatch],
  )

  /** Open the built-in getting-started note, creating it on first use. */
  const openIntroNote = useCallback(async () => {
    const path = `${t('doc.welcomeTitle')}.md`
    try {
      await readFile(path)
    } catch {
      await writeFile(path, t('doc.welcomeContent'))
      await tree.loadFileTree()
    }
    await files.openFile(path)
  }, [files.openFile, tree.loadFileTree])

  // A fresh workspace opens today's journal; a restored one keeps the user's tabs.
  const initialHomeRef = useRef(false)
  useEffect(() => {
    if (!restoreChecked || initialHomeRef.current) return
    initialHomeRef.current = true
    if (getTabs().length === 0) void virtual.openTodayNote()
  }, [getTabs, restoreChecked, virtual.openTodayNote])

  // Shortcut bus: actions are looked up from the latest closures here, so the
  // global key handler stays decoupled and HMR cannot leave it half-updated.
  // The tab list is read through refs, which keeps the listeners from being
  // torn down and re-registered on every tab change.
  const tabsRef = useRef(tabState.tabs)
  tabsRef.current = tabState.tabs
  const activeIdRef = useRef(tabState.activeTabId)
  activeIdRef.current = tabState.activeTabId

  const {
    openSettings,
    openTodayNote,
    openDiary,
    openCalendar,
    openLiteApp,
  } = virtual
  const { createFile, createFolder, saveFile, closeTab, switchTab } = files

  useEffect(() => {
    const cycleTab = (delta: number) => {
      const list = tabsRef.current
      if (list.length === 0) return
      const idx = list.findIndex((tab) => tab.id === activeIdRef.current)
      const next = (idx + delta + list.length) % list.length
      void switchTab(list[next].id)
    }
    const handlers: Partial<Record<string, (e: CustomEvent) => void>> = {
      [SHORTCUT_EVENTS.openSettings]: () => openSettings(),
      [SHORTCUT_EVENTS.newNote]: () => void createFile(),
      [SHORTCUT_EVENTS.newFolder]: () => void createFolder(),
      [SHORTCUT_EVENTS.save]: (e) => {
        const id = e.detail as string
        if (id) void saveFile(id)
      },
      [SHORTCUT_EVENTS.closeTab]: (e) => {
        const id = e.detail as string
        if (id) void closeTab(id)
      },
      [SHORTCUT_EVENTS.nextTab]: () => cycleTab(1),
      [SHORTCUT_EVENTS.prevTab]: () => cycleTab(-1),
      [SHORTCUT_EVENTS.todayNote]: () => void openTodayNote(),
      [SHORTCUT_EVENTS.prevDiary]: (e) => void openDiary(e.detail as string),
      [SHORTCUT_EVENTS.nextDiary]: (e) => void openDiary(e.detail as string),
      [SHORTCUT_EVENTS.openCalendar]: () => openCalendar(),
      [SHORTCUT_EVENTS.openLiteApp]: () => openLiteApp(),
    }
    Object.entries(handlers).forEach(([type, h]) =>
      document.addEventListener(type, h as EventListener),
    )
    return () =>
      Object.entries(handlers).forEach(([type, h]) =>
        document.removeEventListener(type, h as EventListener),
      )
  }, [openSettings, createFile, createFolder, saveFile, closeTab, switchTab, openTodayNote, openDiary, openCalendar, openLiteApp])

  const value: WorkspaceContextValue = {
    fileTree: tree.fileTree,
    loading: tree.loading,
    openTabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    activeTab: tabState.activeTab,
    selectedNodeId: tabState.selectedNodeId,
    setSelectedNodeId,
    loadFileTree: tree.loadFileTree,
    openFile: files.openFile,
    closeTab: files.closeTab,
    switchTab: files.switchTab,
    updateContent,
    saveFile: files.saveFile,
    createFile: files.createFile,
    createFolder: files.createFolder,
    deleteFile: files.deleteFile,
    moveFile: files.moveFile,
    renameFile: files.renameFile,
    openCalendar: virtual.openCalendar,
    openHome: virtual.openHome,
    openLiteApp: virtual.openLiteApp,
    openSettings: virtual.openSettings,
    openTodayNote: virtual.openTodayNote,
    openDiary: virtual.openDiary,
    updateDiaryTab: virtual.updateDiaryTab,
    pendingDiaryYmd: virtual.pendingDiaryYmd,
    setPendingDiaryYmd: virtual.setPendingDiaryYmd,
    refreshOpenFile: files.refreshOpenFile,
    reorderTabs: files.reorderTabs,
    addFileTreeNode: tree.addFileTreeNode,
    expandedPaths: tree.expandedPaths,
    toggleExpandedPath: tree.toggleExpandedPath,
    setExpandedPaths: tree.setExpandedPaths,
    addDiaryFile: tree.addDiaryFile,
    searchTrigger: ui.searchTrigger,
    bumpSearch: ui.bumpSearch,
    searchOpen: ui.searchOpen,
    openSearch: ui.openSearch,
    closeSearch: ui.closeSearch,
    openIntroNote,
    aiPanelTrigger: ui.aiPanelTrigger,
    bumpAiPanel: ui.bumpAiPanel,
    taskVersion: ui.taskVersion,
    bumpTasks: ui.bumpTasks,
    recentFiles: recent.recentFiles,
    addRecent: recent.addRecent,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return ctx
}
