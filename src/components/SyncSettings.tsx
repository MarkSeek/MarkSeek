import { t } from '../i18n'
import type { GitConfig, SyncConfig } from '../config/syncConfig'

// Renders the nested sync configuration inside the Settings dialog. All sync
// *settings* (remote url, branch, token, auto-sync schedule) are edited here;
// the vault-side SyncDialog only shows status + manual actions. Changes are
// pushed back through `onChange`, which the settings layer persists.
export default function SyncSettings({
  value,
  onChange,
}: {
  value: SyncConfig
  onChange: (next: SyncConfig) => void
}) {
  const patch = (p: Partial<SyncConfig>) => onChange({ ...value, ...p })
  const patchGit = (p: Partial<GitConfig>) => onChange({ ...value, git: { ...value.git, ...p } })

  return (
    <div className="sync-settings">
      {/* Auto Sync */}
      <div className="sync-section">
        <div className="sync-section-title">{t('sync.section.autoSync')}</div>
        <div className="sync-toggle">
          <span className="sync-toggle-label">{t('sync.autoSync')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={value.autoSync}
            className={`setting-toggle ${value.autoSync ? 'is-on' : ''}`}
            onClick={() => patch({ autoSync: !value.autoSync })}
          >
            <span className="setting-toggle-knob" />
          </button>
        </div>

        {value.autoSync && (
          <>
            <div className="sync-toggle sync-toggle-sub">
              <span className="sync-toggle-label">{t('sync.autoCommit')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={value.autoCommit}
                className={`setting-toggle ${value.autoCommit ? 'is-on' : ''}`}
                onClick={() => patch({ autoCommit: !value.autoCommit })}
              >
                <span className="setting-toggle-knob" />
              </button>
            </div>
            <div className="sync-toggle sync-toggle-sub">
              <span className="sync-toggle-label">{t('sync.autoPush')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={value.autoPush}
                className={`setting-toggle ${value.autoPush ? 'is-on' : ''}`}
                onClick={() => patch({ autoPush: !value.autoPush })}
              >
                <span className="setting-toggle-knob" />
              </button>
            </div>

            <div className="sync-field">
              <div className="sync-field-text">
                <label className="sync-label">{t('sync.autoSyncMode')}</label>
                <div className="sync-desc">{t('sync.autoSyncModeDesc')}</div>
              </div>
              <select
                className="setting-control setting-select"
                value={value.autoSyncMode}
                onChange={(e) => patch({ autoSyncMode: e.target.value as 'interval' | 'onSave' })}
              >
                <option value="interval">{t('sync.autoSyncMode.interval')}</option>
                <option value="onSave">{t('sync.autoSyncMode.onSave')}</option>
              </select>
            </div>
            {value.autoSyncMode === 'interval' ? (
              <div className="sync-field">
                <div className="sync-field-text">
                  <label className="sync-label">{t('sync.autoSyncInterval')}</label>
                  <div className="sync-desc">{t('sync.autoSyncIntervalDesc')}</div>
                </div>
                <input
                  className="setting-control setting-number"
                  type="number"
                  min={1}
                  value={value.autoSyncInterval}
                  onChange={(e) => patch({ autoSyncInterval: Number(e.target.value) || 15 })}
                />
              </div>
            ) : (
              <div className="sync-field">
                <div className="sync-field-text">
                  <label className="sync-label">{t('sync.autoSyncDelay')}</label>
                  <div className="sync-desc">{t('sync.autoSyncDelayDesc')}</div>
                </div>
                <input
                  className="setting-control setting-number"
                  type="number"
                  min={1}
                  value={value.autoSyncDelay}
                  onChange={(e) => patch({ autoSyncDelay: Number(e.target.value) || 30 })}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Repository */}
      <div className="sync-section">
        <div className="sync-section-title">{t('sync.section.repository')}</div>
        <div className="sync-field">
          <div className="sync-field-text">
            <label className="sync-label">{t('sync.git.remoteUrl')}</label>
            <div className="sync-desc">{t('sync.git.remoteUrlDesc')}</div>
          </div>
          <input
            className="setting-control setting-input"
            type="text"
            placeholder={t('sync.remoteUrlPlaceholder')}
            value={value.git.remoteUrl}
            onChange={(e) => patchGit({ remoteUrl: e.target.value })}
          />
        </div>
        <div className="sync-field">
          <div className="sync-field-text">
            <label className="sync-label">{t('sync.git.branch')}</label>
            <div className="sync-desc">{t('sync.git.branchDesc')}</div>
          </div>
          <input
            className="setting-control setting-input"
            type="text"
            value={value.git.branch}
            onChange={(e) => patchGit({ branch: e.target.value })}
          />
        </div>
        <div className="sync-field">
          <div className="sync-field-text">
            <label className="sync-label">{t('sync.git.token')}</label>
            <div className="sync-desc">{t('sync.git.tokenHint')}</div>
          </div>
          <input
            className="setting-control setting-input"
            type="password"
            value={value.git.token}
            onChange={(e) => patchGit({ token: e.target.value })}
          />
        </div>
        <div className="sync-field">
          <div className="sync-field-text">
            <label className="sync-label">{t('sync.git.username')}</label>
            <div className="sync-desc">{t('sync.git.usernameDesc')}</div>
          </div>
          <input
            className="setting-control setting-input"
            type="text"
            value={value.git.username}
            onChange={(e) => patchGit({ username: e.target.value })}
          />
        </div>
      </div>

      {/* Commit */}
      <div className="sync-section">
        <div className="sync-section-title">{t('sync.section.commit')}</div>
        <div className="sync-field">
          <div className="sync-field-text">
            <label className="sync-label">{t('sync.git.commitMessage')}</label>
            <div className="sync-desc">{t('sync.git.commitMessageDesc')}</div>
          </div>
          <input
            className="setting-control setting-input"
            type="text"
            placeholder={t('sync.commitPlaceholder')}
            value={value.git.commitMessage}
            onChange={(e) => patchGit({ commitMessage: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
