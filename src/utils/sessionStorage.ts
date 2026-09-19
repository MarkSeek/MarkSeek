import { readJson, readRaw, writeJson } from './storage'
import { KEYS, LEGACY_WIDTH_KEYS } from './storageKeys'

// Session snapshot persistence (localStorage backed).
//
// The snapshot lets the app reopen into the exact workspace the user left:
// open tabs (order + active one), sidebar/panel visibility and widths, the
// expanded directories of the file tree and the right panel sub-view.
//
// Two rules shape the design:
//  1. Only identifiers are persisted, never file content. Restored tabs
//     re-read the latest bytes from disk, so an edited note always comes
//     back up to date and nothing bloats localStorage.
//  2. Snapshots are scoped per vault, so switching knowledge bases never
//     mixes sessions together.
//
// All writes go through a single module-level cache plus a debounced flush,
// which keeps the three independent writers (workspace context, app layout,
// right panel) from overwriting each other.

const SCHEMA_VERSION = 1
const MAX_VAULTS = 5
const FLUSH_DELAY = 300

export type SessionTabKind = 'file' | 'image' | 'diary' | 'calendar' | 'liteapp' | 'settings'

/** Persisted shape of a single tab: identifiers only, never content. */
export interface SessionTab {
  id: string
  path: string
  kind?: SessionTabKind
  /** Real .md path behind the diary virtual page. */
  filePath?: string
}

export interface SessionLayout {
  leftOpen: boolean
  /** `null` means "never saved yet", so the caller falls back to settings. */
  rightOpen: boolean | null
  leftWidth: number | null
  rightWidth: number | null
}

/** Sub-view rendered inside the right panel (Buddy). */
export type RightPanelView = 'chat' | 'relations'

// History is no longer a top-level view: it folds back into `chat`.
const RIGHT_PANEL_VIEWS: RightPanelView[] = ['chat', 'relations']

export interface SessionSnapshot {
  version: number
  savedAt: number
  tabs: SessionTab[]
  activeTabId: string | null
  expandedPaths: string[]
  selectedNodeId: string | null
  layout: SessionLayout
  rightPanel: {
    view: RightPanelView
    /** Kept in sync with `view` so older builds still restore correctly. */
    showRelations: boolean
  }
}

/** Partial update; the two nested objects are merged one level deep. */
export interface SessionPatch {
  tabs?: SessionTab[]
  activeTabId?: string | null
  expandedPaths?: string[]
  selectedNodeId?: string | null
  layout?: Partial<SessionLayout>
  rightPanel?: Partial<SessionSnapshot['rightPanel']>
}

const TAB_KINDS: SessionTabKind[] = ['file', 'image', 'diary', 'calendar', 'liteapp', 'settings']

// Cache of every vault snapshot, lazily hydrated from localStorage on first
// access. It is the single source of truth for both reads and writes.
let cache: Record<string, SessionSnapshot> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Widths used to be stored as standalone entries before the unified snapshot
 * existed. They are read once as a default and then folded into the snapshot.
 */
function readLegacyWidth(key: string): number | null {
  const raw = readRaw(key)
  if (!raw) return null
  return positiveNumber(Number(raw))
}

function defaultSnapshot(): SessionSnapshot {
  return {
    version: SCHEMA_VERSION,
    savedAt: 0,
    tabs: [],
    activeTabId: null,
    expandedPaths: [],
    selectedNodeId: null,
    layout: {
      leftOpen: true,
      rightOpen: null,
      // Fall back to the pre-session keys so existing users keep their widths.
      leftWidth: readLegacyWidth(LEGACY_WIDTH_KEYS.left),
      rightWidth: readLegacyWidth(LEGACY_WIDTH_KEYS.right),
    },
    rightPanel: { view: 'chat', showRelations: false },
  }
}

function normalizeTab(raw: unknown): SessionTab | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  if (typeof it.id !== 'string' || !it.id) return null
  if (typeof it.path !== 'string' || !it.path) return null
  return {
    id: it.id,
    path: it.path,
    kind: TAB_KINDS.includes(it.kind as SessionTabKind) ? (it.kind as SessionTabKind) : undefined,
    filePath: typeof it.filePath === 'string' && it.filePath ? it.filePath : undefined,
  }
}

// Rebuild a trusted snapshot out of untrusted JSON. Anything unexpected falls
// back to the default for that field instead of throwing.
function normalize(raw: unknown): SessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  if (it.version !== SCHEMA_VERSION) return null
  const base = defaultSnapshot()
  const layout = (it.layout ?? {}) as Record<string, unknown>
  const rightPanel = (it.rightPanel ?? {}) as Record<string, unknown>
  const showRelations = rightPanel.showRelations === true
  // Snapshots written before the 3-state switch only carry `showRelations`.
  const storedView = rightPanel.view
  const view: RightPanelView = RIGHT_PANEL_VIEWS.includes(storedView as RightPanelView)
    ? (storedView as RightPanelView)
    : showRelations
      ? 'relations'
      : 'chat'
  return {
    version: SCHEMA_VERSION,
    savedAt: typeof it.savedAt === 'number' ? it.savedAt : 0,
    tabs: Array.isArray(it.tabs)
      ? it.tabs.map(normalizeTab).filter((tab): tab is SessionTab => tab !== null)
      : [],
    activeTabId: typeof it.activeTabId === 'string' ? it.activeTabId : null,
    expandedPaths: Array.isArray(it.expandedPaths)
      ? it.expandedPaths.filter((p): p is string => typeof p === 'string')
      : [],
    selectedNodeId: typeof it.selectedNodeId === 'string' ? it.selectedNodeId : null,
    layout: {
      leftOpen: typeof layout.leftOpen === 'boolean' ? layout.leftOpen : base.layout.leftOpen,
      rightOpen: typeof layout.rightOpen === 'boolean' ? layout.rightOpen : null,
      leftWidth: positiveNumber(layout.leftWidth) ?? base.layout.leftWidth,
      rightWidth: positiveNumber(layout.rightWidth) ?? base.layout.rightWidth,
    },
    rightPanel: { view, showRelations: view === 'relations' },
  }
}

function loadStore(): Record<string, SessionSnapshot> {
  const parsed = readJson<unknown>(KEYS.session, null)
  if (!parsed || typeof parsed !== 'object') return {}
  const out: Record<string, SessionSnapshot> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const snap = normalize(value)
    if (snap) out[key] = snap
  }
  return out
}

function ensureCache(): Record<string, SessionSnapshot> {
  if (!cache) cache = loadStore()
  return cache
}

// Snapshots are keyed by vault so each knowledge base keeps its own session.
export function getVaultKey(vaultPath: string | null): string {
  const trimmed = typeof vaultPath === 'string' ? vaultPath.trim() : ''
  return trimmed || '__default__'
}

/**
 * Read the snapshot for a vault. Always returns a usable object, even when
 * nothing was persisted yet, so callers can skip null checks.
 */
export function readSession(vaultKey: string): SessionSnapshot {
  const store = ensureCache()
  const existing = store[vaultKey]
  if (existing) return existing
  const created = defaultSnapshot()
  store[vaultKey] = created
  return created
}

/** Merge a partial update into the cached snapshot and schedule a flush. */
export function patchSession(vaultKey: string, patch: SessionPatch): void {
  const store = ensureCache()
  const prev = store[vaultKey] ?? defaultSnapshot()
  store[vaultKey] = {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    tabs: patch.tabs ?? prev.tabs,
    activeTabId: patch.activeTabId !== undefined ? patch.activeTabId : prev.activeTabId,
    expandedPaths: patch.expandedPaths ?? prev.expandedPaths,
    selectedNodeId: patch.selectedNodeId !== undefined ? patch.selectedNodeId : prev.selectedNodeId,
    layout: { ...prev.layout, ...patch.layout },
    rightPanel: { ...prev.rightPanel, ...patch.rightPanel },
  }
  scheduleFlush()
}

/** Drop the snapshot of a vault (used when its notes are gone). */
export function clearSession(vaultKey: string): void {
  const store = ensureCache()
  if (!(vaultKey in store)) return
  delete store[vaultKey]
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushSession, FLUSH_DELAY)
}

/** Write the cached snapshots to localStorage immediately. */
export function flushSession(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!cache) return
  // Keep only the most recently used vaults so the entry cannot grow forever.
  const entries = Object.entries(cache)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_VAULTS)
  cache = Object.fromEntries(entries)
  writeJson(KEYS.session, cache)
}

// Persist pending changes when the page goes away. `visibilitychange` is the
// reliable signal on mobile, `pagehide` covers the rest.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSession)
  window.addEventListener('beforeunload', flushSession)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSession()
  })
}
