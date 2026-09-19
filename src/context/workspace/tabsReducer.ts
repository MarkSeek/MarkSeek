// Single source of truth for the open-tab state.
//
// Tab state used to be three separate `useState` values mirrored into four
// refs, each with its own hand-written update path — any path that forgot to
// sync a ref produced a stale read later on. Everything now goes through one
// reducer, so there is exactly one place where the shape of a tab can change.

/** Kinds of things that can occupy a tab: real notes, images and virtual pages. */
export type TabKind = 'file' | 'image' | 'diary' | 'calendar' | 'liteapp' | 'settings'

export interface Tab {
  id: string // file path for notes; a synthetic id for virtual pages
  name: string
  path: string // real file path for notes; the synthetic id for virtual pages
  content: string
  dirty: boolean
  kind?: TabKind // distinguishes real notes from virtual pages
  filePath?: string // real .md path behind the diary virtual page
  /**
   * Bumped only when the content is replaced by an OUTSIDE write (agent,
   * calendar task drag, diary page turn, ...). It is passed to the editor as
   * `contentVersion`, which swaps the document in place instead of remounting
   * — a remount leaves a blank frame that the browser may paint.
   */
  rev?: number
}

/** Virtual diary page: every date shares this single id. */
export const DIARY_PREFIX = '__diary__'

/** Virtual lite-app page id prefix. */
export const LITEAPP_PREFIX = '__liteapp__'

/** Folder holding the lite apps (dot-prefixed so the file tree hides it). */
export const LITEAPP_DIR = '.LiteApp'

/** Home virtual page id. */
export const HOME_ID = '__home__'

/** Calendar virtual page id. */
export const CALENDAR_ID = '__calendar__'

/** Settings virtual page id. */
export const SETTINGS_ID = '__settings__'

/**
 * Derive the tab title from a file path ('a/b/note.md' -> 'note').
 * Shared by `openFile` and session restore so both agree on the label.
 */
export function fileNameFromPath(path: string): string {
  let name = path.split('/').pop() || path
  if (name.endsWith('.md')) name = name.slice(0, -3)
  return name
}

export interface WorkspaceTabsState {
  tabs: Tab[]
  activeTabId: string | null
  selectedNodeId: string | null // single selected node in the tree (VSCode style)
}

export const initialTabsState: WorkspaceTabsState = {
  tabs: [],
  activeTabId: null,
  selectedNodeId: null,
}

export type TabAction =
  /** Append a tab. An existing id is treated as "activate it" and keeps its content. */
  | { type: 'open'; tab: Tab; activate?: boolean; select?: boolean }
  | { type: 'activate'; id: string; select?: boolean }
  /** Drop a tab, falling back to its neighbour when it was the active one. */
  | { type: 'close'; id: string }
  | { type: 'reorder'; from: number; to: number }
  /** Editor keystroke: buffer the new content and mark the tab dirty. */
  | { type: 'draft'; id: string; content: string }
  | { type: 'markSaved'; id: string }
  /**
   * Outside write (agent, calendar drag, diary page turn): swap the document
   * and bump `rev` so the editor replaces it in place. The buffered draft is
   * dropped by the caller, so `dirty` goes back to false.
   */
  | { type: 'replaceContent'; id: string; content: string; patch?: Partial<Tab> }
  /** Reload content without touching `dirty` or `rev` (used after a move). */
  | { type: 'setContent'; id: string; content: string }
  | { type: 'patchTab'; id: string; patch: Partial<Tab> }
  /** Move/rename: the tab id follows the file path. */
  | { type: 'remapTab'; from: string; to: string; patch?: Partial<Tab> }
  | { type: 'replaceAll'; tabs: Tab[]; activeTabId?: string | null; selectedNodeId?: string | null }
  /** Re-localise the virtual page titles after a language switch. */
  | { type: 'retitle'; titles: Record<string, string> }
  | { type: 'select'; id: string | null }

function mapTab(tabs: Tab[], id: string, fn: (tab: Tab) => Tab): Tab[] {
  return tabs.map((t) => (t.id === id ? fn(t) : t))
}

export function tabsReducer(state: WorkspaceTabsState, action: TabAction): WorkspaceTabsState {
  switch (action.type) {
    case 'open': {
      const exists = state.tabs.some((t) => t.id === action.tab.id)
      return {
        tabs: exists ? state.tabs : [...state.tabs, action.tab],
        activeTabId: action.activate === false ? state.activeTabId : action.tab.id,
        selectedNodeId: action.select ? action.tab.id : state.selectedNodeId,
      }
    }
    case 'activate': {
      if (!state.tabs.some((t) => t.id === action.id)) return state
      return {
        ...state,
        activeTabId: action.id,
        selectedNodeId: action.select ? action.id : state.selectedNodeId,
      }
    }
    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.id)
      if (idx === -1) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      // Closing the active tab hands over to the neighbour that took its place.
      const activeTabId =
        state.activeTabId === action.id
          ? tabs.length === 0
            ? null
            : tabs[Math.min(idx, tabs.length - 1)].id
          : state.activeTabId
      // The tree selection is left alone: the note stays selected in the sidebar
      // even after its tab is closed.
      return { ...state, tabs, activeTabId }
    }
    case 'reorder': {
      const next = [...state.tabs]
      if (action.from < 0 || action.from >= next.length) return state
      const [moved] = next.splice(action.from, 1)
      next.splice(Math.max(0, Math.min(action.to, next.length)), 0, moved)
      return { ...state, tabs: next }
    }
    case 'draft':
      return {
        ...state,
        tabs: mapTab(state.tabs, action.id, (t) => ({ ...t, content: action.content, dirty: true })),
      }
    case 'markSaved':
      return {
        ...state,
        tabs: mapTab(state.tabs, action.id, (t) => ({ ...t, dirty: false })),
      }
    case 'replaceContent':
      return {
        ...state,
        tabs: mapTab(state.tabs, action.id, (t) => ({
          ...t,
          ...action.patch,
          content: action.content,
          dirty: false,
          rev: (t.rev ?? 0) + 1,
        })),
      }
    case 'setContent':
      return {
        ...state,
        tabs: mapTab(state.tabs, action.id, (t) => ({ ...t, content: action.content })),
      }
    case 'patchTab':
      return {
        ...state,
        tabs: mapTab(state.tabs, action.id, (t) => ({ ...t, ...action.patch })),
      }
    case 'remapTab': {
      let activeTabId = state.activeTabId
      if (activeTabId === action.from) activeTabId = action.to
      return {
        ...state,
        tabs: mapTab(state.tabs, action.from, (t) => ({ ...t, id: action.to, ...action.patch })),
        activeTabId,
        selectedNodeId: state.selectedNodeId === action.from ? action.to : state.selectedNodeId,
      }
    }
    case 'replaceAll':
      return {
        tabs: action.tabs,
        activeTabId: action.activeTabId !== undefined ? action.activeTabId : state.activeTabId,
        selectedNodeId:
          action.selectedNodeId !== undefined ? action.selectedNodeId : state.selectedNodeId,
      }
    case 'retitle':
      return {
        ...state,
        tabs: state.tabs.map((t) => {
          const name = action.titles[t.id]
          return name ? { ...t, name } : t
        }),
      }
    case 'select':
      return { ...state, selectedNodeId: action.id }
    default:
      return state
  }
}
