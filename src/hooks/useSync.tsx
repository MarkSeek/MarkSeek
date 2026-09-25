// Global sync state + actions. Wraps the whole app (see App.tsx) so the sidebar
// can show live status and the SyncDialog can drive it. Server-side owns the
// actual sync work; this hook only polls status and triggers operations.
//
// Sync triggers:
//   * manual  — commit/push/pull/sync buttons (or init)
//   * auto     — when config.autoSync is on, a timer runs sync() periodically
//                (autoSyncMode 'interval') or debounced after saves ('onSave')
//
// The sync *configuration* (remote url, branch, token, auto-sync schedule) lives
// in the global Settings system (see settingsSchema.ts / SyncSettings.tsx), so
// this hook reads it from SettingsContext and never writes it back itself.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import * as api from '../api/sync'
import { useSettings } from '../context/SettingsContext'
import { DEFAULT_SYNC_CONFIG, type SyncConfig } from '../config/syncConfig'

interface SyncContextValue {
  status: api.SyncStatus | null
  config: SyncConfig
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  commit: (message: string) => Promise<void>
  push: () => Promise<void>
  pull: () => Promise<void>
  sync: (message?: string) => Promise<void>
  init: () => Promise<void>
  /** Debounced hook for the 'onSave' auto mode (call after an editor save). */
  notifySaved: () => void
}

const SyncContext = createContext<SyncContextValue | null>(null)

function mergeConfig(raw: Partial<SyncConfig> | undefined): SyncConfig {
  const base = raw || {}
  const git = { ...DEFAULT_SYNC_CONFIG.git, ...(base.git || {}) }
  return {
    provider: base.provider || DEFAULT_SYNC_CONFIG.provider,
    autoSync: !!base.autoSync,
    autoCommit: base.autoCommit ?? DEFAULT_SYNC_CONFIG.autoCommit,
    autoPush: base.autoPush ?? DEFAULT_SYNC_CONFIG.autoPush,
    autoSyncMode: base.autoSyncMode || DEFAULT_SYNC_CONFIG.autoSyncMode,
    autoSyncInterval: Number(base.autoSyncInterval) || DEFAULT_SYNC_CONFIG.autoSyncInterval,
    autoSyncDelay: Number(base.autoSyncDelay) || DEFAULT_SYNC_CONFIG.autoSyncDelay,
    git,
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { values } = useSettings()
  // The live sync config comes from Settings, so edits there apply immediately.
  const config = mergeConfig((values as Record<string, unknown>).sync as Partial<SyncConfig> | undefined)

  const [status, setStatus] = useState<api.SyncStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const busyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = await api.fetchSyncStatus()
      setStatus(st)
      setError(null)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }, [])

  // Poll status so the sidebar color stays fresh.
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  // Run an action while showing the transient 'syncing' state.
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busyRef.current) return
      busyRef.current = true
      setStatus((s) => (s ? { ...s, state: 'syncing' } : s))
      setLoading(true)
      setError(null)
      try {
        await fn()
        await refresh()
      } catch (e: any) {
        setError(String(e?.message || e))
        setStatus((s) => (s ? { ...s, state: 'error' } : s))
      } finally {
        setLoading(false)
        busyRef.current = false
      }
    },
    [refresh],
  )

  const commit = useCallback((m: string) => run(() => api.syncCommit(m)), [run])
  const push = useCallback(() => run(() => api.syncPush()), [run])
  const pull = useCallback(() => run(() => api.syncPull()), [run])
  const sync = useCallback((m?: string) => run(() => api.syncNow(m)), [run])
  const init = useCallback(() => run(() => api.syncInit()), [run])

  // Auto flow: run only the enabled steps (commit/push), no pull. Used by both
  // the 'onSave' debounce and the 'interval' timer so the two toggles drive it.
  const syncAuto = useCallback(() => {
    const c = configRef.current
    if (!c.autoCommit && !c.autoPush) return
    run(() => api.syncNow(undefined, { commit: c.autoCommit, push: c.autoPush }))
  }, [run])

  // ---- Auto sync timer ----
  const notifySaved = useCallback(() => {
    if (!configRef.current.autoSync || configRef.current.autoSyncMode !== 'onSave') return
    if (!configRef.current.autoCommit && !configRef.current.autoPush) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      syncAuto()
    }, Math.max(1, configRef.current.autoSyncDelay) * 1000)
  }, [run, syncAuto])

  // 'onSave' auto mode: triggered by the editor autosave (useDraftAutosave
  // dispatches this event after a successful write).
  useEffect(() => {
    const onSaved = () => {
      notifySaved() // maintains the 'onSave' auto-sync schedule
      refresh() // refresh status immediately so the dirty badge updates on save
    }
    document.addEventListener('markseek:note-saved', onSaved)
    return () => document.removeEventListener('markseek:note-saved', onSaved)
  }, [notifySaved, refresh])

  useEffect(() => {
    if (!config.autoSync || config.autoSyncMode !== 'interval') return
    if (!config.autoCommit && !config.autoPush) return
    const ms = Math.max(1, config.autoSyncInterval) * 60_000
    // Run once immediately when auto-sync is enabled, then on the interval.
    syncAuto()
    const timer = setInterval(() => syncAuto(), ms)
    return () => clearInterval(timer)
  }, [config.autoSync, config.autoSyncMode, config.autoSyncInterval, config.autoCommit, config.autoPush, syncAuto])

  const value: SyncContextValue = {
    status,
    config,
    loading,
    error,
    refresh,
    commit,
    push,
    pull,
    sync,
    init,
    notifySaved,
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within a SyncProvider')
  return ctx
}
