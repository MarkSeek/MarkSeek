// Frontend client for the generic /api/sync/* endpoints. Provider-agnostic:
// the UI only ever sees SyncStatus, never git specifics.

export type SyncState =
  | 'no-repo'
  | 'clean'
  | 'dirty'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'syncing'
  | 'error'

export interface SyncStatus {
  available: boolean
  initialized: boolean
  state: SyncState
  branch?: string
  ahead?: number
  behind?: number
  dirty?: number
  untracked?: number
  lastCommit?: { hash: string; message: string; date: string }
  error?: string
}

export interface ProviderInfo {
  id: string
  label: string
}

async function asJson<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(text || `HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

function post(path: string, body?: unknown): Promise<void> {
  return asJson<{ ok?: boolean }>(
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  ).then(() => undefined)
}

export const fetchSyncStatus = () => asJson<SyncStatus>(fetch('/api/sync/status'))
export const fetchProviders = () => asJson<{ providers: ProviderInfo[] }>(fetch('/api/sync/providers'))
export const syncInit = () => post('/api/sync/init')
export const syncCommit = (message: string) => post('/api/sync/commit', { message })
export const syncPush = () => post('/api/sync/push')
export const syncPull = () => post('/api/sync/pull')
// Manual "Sync Now" omits opts → backend defaults to a full commit+pull+push.
// The auto flow passes only the enabled steps (e.g. { commit, push }).
export const syncNow = (
  message?: string,
  opts?: { commit?: boolean; push?: boolean },
) => post('/api/sync/sync', { message, commit: opts?.commit, push: opts?.push })
