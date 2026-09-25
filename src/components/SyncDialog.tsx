import { useState } from 'react'
import { useSync } from '../hooks/useSync'
import { t } from '../i18n'

// Render a commit date (ISO string from the server) as a readable local time.
function formatCommitDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

// Sync status + manual actions. All sync *configuration* (remote url, branch,
// token, auto-sync schedule) lives in Settings; this dialog is intentionally a
// read-only status view plus the buttons that trigger the server-side work.
export default function SyncDialog({ onClose }: { onClose: () => void }) {
  const { status, loading, error, commit, push, pull, sync, init, config } = useSync()
  const state = status?.state ?? 'no-repo'
  const [msg, setMsg] = useState(config.git.commitMessage || '')

  const dirty = (status?.dirty ?? 0) + (status?.untracked ?? 0) > 0

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="sync-card" onClick={(e) => e.stopPropagation()}>
        <div className="sync-header">
          <h2 className="sync-title">{t('sync.title')}</h2>
          <button type="button" className="sync-close" aria-label={t('sync.close')} onClick={onClose}>
            ×
          </button>
        </div>

        {/* Status */}
        <div className="sync-status">
          <span className={`sync-badge sync-badge-${state}`}>{t(`sync.state.${state}`)}</span>
          {status?.branch && (
            <span className="sync-meta">
              {t('sync.branch')}: <b>{status.branch}</b>
            </span>
          )}
          {status?.initialized && (
            <span className="sync-meta">
              ↑{status.ahead ?? 0} ↓{status.behind ?? 0} · {t('sync.dirty')}: {status.dirty ?? 0} ·{' '}
              {t('sync.untracked')}: {status.untracked ?? 0}
            </span>
          )}
        </div>
        {status?.lastCommit && (
          <div className="sync-commit">
            {t('sync.lastCommit')}: <code>{status.lastCommit.hash.slice(0, 7)}</code>{' '}
            {status.lastCommit.message}
            {status.lastCommit.date && (
              <span className="sync-commit-date"> · {formatCommitDate(status.lastCommit.date)}</span>
            )}
          </div>
        )}
        {error && <div className="sync-error">{error}</div>}

        {/* Initialize the vault as a local repository (one-time action) */}
        {!status?.initialized && (
          <div className="sync-actions">
            <button type="button" className="sync-btn" disabled={loading} onClick={() => init()}>
              {t('sync.init')}
            </button>
          </div>
        )}

        {/* Manual actions */}
        {status?.initialized && (
          <div className="sync-actions">
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={loading}
              onClick={() => sync(msg || undefined)}
            >
              {t('sync.sync')}
            </button>
            <button type="button" className="sync-btn" disabled={loading || !dirty} onClick={() => commit(msg)}>
              {t('sync.commit')}
            </button>
            <button type="button" className="sync-btn" disabled={loading} onClick={push}>
              {t('sync.push')}
            </button>
            <button type="button" className="sync-btn" disabled={loading} onClick={pull}>
              {t('sync.pull')}
            </button>
          </div>
        )}

        <div className="sync-field">
          <label className="sync-label" htmlFor="sync-msg">
            {t('sync.message')}
          </label>
          <input
            id="sync-msg"
            className="sync-input"
            type="text"
            placeholder={t('sync.commitPlaceholder')}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
        </div>

        <div className="sync-footer">
          <button type="button" className="sync-btn" onClick={onClose}>
            {t('sync.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
