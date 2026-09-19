// Recent files storage (localStorage backed).
//
// Thin wrapper over the shared storage layer: this module owns the shape of a
// recent item, the trimming rule and nothing else.
import { readJsonMigrated, writeJson } from './storage'
import { KEYS } from './storageKeys'

export interface RecentItem {
  path: string // file path used as unique key
  name: string // display name (filename without .md)
  ts: number // opened timestamp (Date.now())
}

export const RECENT_MAX = 20

// Max number of recent docs shown in the sidebar "Recent" group
export const RECENT_DISPLAY_MAX = 8

function isRecentItem(raw: unknown): raw is RecentItem {
  if (!raw || typeof raw !== 'object') return false
  const it = raw as Record<string, unknown>
  return typeof it.path === 'string' && typeof it.name === 'string' && typeof it.ts === 'number'
}

function toRecentList(raw: unknown): RecentItem[] | null {
  return Array.isArray(raw) ? raw.filter(isRecentItem) : null
}

/**
 * Load the recent list. An unusable payload (missing key, corrupt JSON, wrong
 * shape) reads back as an empty list instead of throwing.
 */
export function loadRecent(): RecentItem[] {
  return readJsonMigrated(KEYS.recent, [], [], toRecentList)
}

/** Persist the list; a write failure (private mode, quota) is ignored. */
export function saveRecent(items: RecentItem[]): void {
  writeJson(KEYS.recent, items)
}

/** Build a fresh recent list: move path to front, dedupe, trim to RECENT_MAX. */
export function pushRecent(items: RecentItem[], next: RecentItem): RecentItem[] {
  const filtered = items.filter((it) => it.path !== next.path)
  return [next, ...filtered].slice(0, RECENT_MAX)
}
