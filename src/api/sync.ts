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

// Fire-and-forget broadcast after any operation that can change the git log
// (commit, full sync, pull). Views showing a note's history listen for it and
// re-fetch so their list never stays frozen on what was loaded at open time.
function broadcastLogChanged(): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('markseek:committed'))
}

export const fetchSyncStatus = () => asJson<SyncStatus>(fetch('/api/sync/status'))
export const fetchProviders = () => asJson<{ providers: ProviderInfo[] }>(fetch('/api/sync/providers'))
export const syncInit = () => post('/api/sync/init')
export const syncCommit = async (message: string) => {
  await post('/api/sync/commit', { message })
  broadcastLogChanged()
}
export const syncPush = () => post('/api/sync/push')
export const syncPull = async () => {
  await post('/api/sync/pull')
  broadcastLogChanged()
}
// Manual "Sync Now" omits opts → backend defaults to a full commit+pull+push.
// The auto flow passes only the enabled steps (e.g. { commit, push }).
export const syncNow = async (
  message?: string,
  opts?: { commit?: boolean; push?: boolean },
) => {
  await post('/api/sync/sync', { message, commit: opts?.commit, push: opts?.push })
  broadcastLogChanged()
}
