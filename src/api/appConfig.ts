import type { AppConfig } from '../config/appConfig'

// Fetch the application-level config (carries the vault path).
export async function getAppConfig(): Promise<AppConfig> {
  const res = await fetch('/api/app-config')
  if (!res.ok) return {}
  return (await res.json()) as AppConfig
}

// Persist the application-level config.
export async function setAppConfig(cfg: AppConfig): Promise<void> {
  const res = await fetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('failed to save app config')
}

// Probe whether a vault path exists and is a directory on the server.
export async function probeVault(vaultPath: string): Promise<{ exists: boolean }> {
  const res = await fetch('/api/vault/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: vaultPath }),
  })
  if (!res.ok) return { exists: false }
  return (await res.json()) as { exists: boolean }
}
