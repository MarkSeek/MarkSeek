import { useRef, useState } from 'react'
import { useSettings } from '../context/SettingsContext'
import { probeVault } from '../api/appConfig'
import { t } from '../i18n'
import { pickDirectory } from '../api/electronBridge'

// Lightweight dialog to switch the Vault folder from within the app
// (triggered by clicking the vault path icon in the left sidebar).
export default function VaultSwitchDialog({ onClose }: { onClose: () => void }) {
  const { setVault, vaultPath } = useSettings()
  const [path, setPath] = useState(vaultPath ?? '')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && files[0].webkitRelativePath) {
      const dirName = files[0].webkitRelativePath.split('/')[0]
      setError('')
      if (!path.trim()) {
        setError(t('vault.pickHint', { name: dirName }))
      }
    }
  }

  const validateAndSubmit = async () => {
    const trimmed = path.trim()
    if (!trimmed) {
      setError(t('vault.empty'))
      return
    }
    setError('')
    setChecking(true)
    let exists = false
    try {
      const res = await probeVault(trimmed)
      exists = res.exists
    } catch {
      exists = false
    }
    setChecking(false)
    if (!exists) {
      setError(t('vault.notExist'))
      return
    }
    if (trimmed === vaultPath) {
      onClose()
      return
    }
    setSubmitting(true)
    try {
      await setVault(trimmed)
      window.location.reload()
    } catch (e) {
      console.error('Failed to save vault config', e)
      setError(t('vault.saveFailed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="vault-wizard-overlay" onClick={onClose}>
      <div className="vault-wizard-card" onClick={(e) => e.stopPropagation()}>
        <div className="vault-wizard-brand">
          <span className="vault-wizard-logo">MarkSeek</span>
          <span className="vault-wizard-tagline">{t('sidebar.tagline')}</span>
        </div>

        <h1 className="vault-wizard-title">{t('vault.switchTitle')}</h1>
        <p className="vault-wizard-desc">{t('vault.desc')}</p>

        <label className="vault-wizard-label" htmlFor="vault-switch-path">
          {t('vault.pathLabel')}
        </label>
        <div className="vault-wizard-input-row">
          <input
            id="vault-switch-path"
            className="vault-wizard-input"
            type="text"
            placeholder={t('vault.placeholder')}
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') validateAndSubmit()
            }}
          />
          <button
            type="button"
            className="vault-wizard-browse"
            onClick={() => {
              // Trigger synchronously so the folder dialog inherits the click's
              // user activation (required by showDirectoryPicker).
              pickDirectory(fileInputRef.current)
                .then((picked) => {
                  if (picked?.path) {
                    setPath(picked.path)
                    setError('')
                  } else if (picked?.name && !path.trim()) {
                    // Web mode only yields the folder name; the absolute path is
                    // unavailable, so guide the user to paste the real path.
                    setError(t('vault.pickHint', { name: picked.name }))
                  }
                })
                .catch((e) => {
                  console.error('Failed to open folder picker', e)
                  setError(t('vault.pickUnsupported'))
                })
            }}
          >
            {t('vault.browse')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            // @ts-expect-error non-standard attribute for folder selection
            webkitdirectory=""
            directory=""
            style={{ display: 'none' }}
            onChange={handlePick}
          />
        </div>

        {error && <div className="vault-wizard-error">{error}</div>}

        <div className="vault-switch-actions">
          <button type="button" className="vault-wizard-cancel" onClick={onClose}>
            {t('vault.cancel')}
          </button>
          <button
            type="button"
            className="vault-wizard-submit"
            disabled={!path.trim() || checking || submitting}
            onClick={validateAndSubmit}
          >
            {submitting ? t('vault.submitting') : checking ? t('vault.checking') : t('vault.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
