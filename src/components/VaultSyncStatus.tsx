import { useState } from 'react'
import { t } from '../i18n'

// Purely presentational sync-status badge shown next to the vault path.
// Real sync is not implemented yet; the default state is "unconfigured".
export type SyncState = 'unconfigured' | 'synced' | 'syncing' | 'pending' | 'error'

export default function VaultSyncStatus() {
  // Sync is not wired up yet; show "unconfigured" by default.
  const [state] = useState<SyncState>('unconfigured')

  const label = t(`sync.${state}`)

  return (
    <span className={`vault-sync vault-sync-${state}`} title={label}>
      {state === 'syncing' ? (
        <span className="vault-sync-spinner" aria-hidden="true" />
      ) : (
        <span className="vault-sync-dot" aria-hidden="true" />
      )}
      <span className="vault-sync-label">{label}</span>
    </span>
  )
}
