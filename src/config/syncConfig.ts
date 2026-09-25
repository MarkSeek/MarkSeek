// Sync configuration types + defaults. The shape is provider-agnostic at the
// top level; each backend keeps its private config nested under its id
// (e.g. `git`). Stored in <app-data>/settings.json under the `sync` key.

export interface GitConfig {
  remoteUrl: string
  branch: string
  token: string
  username: string
  // Default commit message used when none is provided (manual commit with an
  // empty box, or any auto-sync). Kept as a fixed, human-readable string — never
  // a timestamp — so history stays readable.
  commitMessage: string
}

export interface SyncConfig {
  provider: string
  autoSync: boolean
  // When autoSync is on, auto-commit stages + commits local changes on trigger.
  autoCommit: boolean
  // When autoSync is on, auto-push sends commits to the remote on trigger.
  autoPush: boolean
  // 'interval' = run every autoSyncInterval minutes; 'onSave' = debounce after a save
  autoSyncMode: 'interval' | 'onSave'
  autoSyncInterval: number // minutes, used by 'interval'
  autoSyncDelay: number // seconds, used by 'onSave'
  git: GitConfig
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  provider: 'git',
  autoSync: false,
  autoCommit: true,
  autoPush: false,
  autoSyncMode: 'interval',
  autoSyncInterval: 15,
  autoSyncDelay: 30,
  git: { remoteUrl: '', branch: 'main', token: '', username: '', commitMessage: 'MarkSeek sync' },
}
