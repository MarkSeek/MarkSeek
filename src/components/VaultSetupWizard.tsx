import { useRef, useState } from 'react'
import { useSettings } from '../context/SettingsContext'
import { probeVault } from '../api/appConfig'
import { t } from '../i18n'
import { pickDirectory } from '../api/electronBridge'

// First-run setup wizard: let the user choose a Vault (notes root) folder.
// Supports both a native folder picker (Electron / File System Access API) and
// manual absolute path input (the authoritative source, due to browser limits).
export default function VaultSetupWizard() {
  const { setVault } = useSettings()
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && files[0].webkitRelativePath) {
      // Browser only exposes the relative path; the entered text remains the
      // authoritative absolute path the user must confirm.
      const dirName = files[0].webkitRelativePath.split('/')[0]
      setError('')
      if (!path.trim()) {
        // No absolute path yet: remind the user to enter the full path.
        setError(t('vault.pickHint', { name: dirName }))
      }
    }
  }

  const handleBrowse = () => {
    // Trigger synchronously so the browser's "select folder" dialog inherits
    // the click's user activation (required by showDirectoryPicker).
    pickDirectory(fileInputRef.current)
      .then((picked) => {
        if (picked?.path) {
          // Electron returns a real absolute path.
          setPath(picked.path)
          setError('')
        } else if (picked?.name) {
          // Web mode (File System Access API) returns only the folder name — the
          // absolute path is intentionally hidden by the browser for security.
          // Never stuff the bare name into the path field (it isn't a valid path
          // and would fail validation); instead show clear instructions to paste
          // the real path.
          console.warn('[VaultSetupWizard] web folder picker returned only a name (no absolute path):', picked.name)
          setError(t('vault.pickHint', { name: picked.name }))
        }
      })
      .catch((e) => {
        // e.g. SecurityError when the folder picker can't be opened: tell the
        // user to enter the path manually instead of silently showing "upload".
        console.error('Failed to open folder picker', e)
        setError(t('vault.pickUnsupported'))
      })
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
    setSubmitting(true)
    try {
      await setVault(trimmed)
      // Reload to re-init WorkspaceContext against the new vault root.
      window.location.reload()
    } catch (e) {
      console.error('Failed to save vault config', e)
      setError(t('vault.saveFailed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="vault-wizard-overlay">
      <div className="vault-wizard-card">
        <div className="vault-wizard-brand">
          <span className="vault-wizard-logo">MarkSeek</span>
          <span className="vault-wizard-tagline">{t('sidebar.tagline')}</span>
        </div>

        <h1 className="vault-wizard-title">{t('vault.title')}</h1>
        <p className="vault-wizard-desc">{t('vault.desc')}</p>

        <label className="vault-wizard-label" htmlFor="vault-path">
          {t('vault.pathLabel')}
        </label>
        <div className="vault-wizard-input-row">
          <input
            id="vault-path"
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
            onClick={handleBrowse}
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
  )
}
