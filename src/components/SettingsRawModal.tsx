import { useEffect, useState } from 'react'
import TextFileViewer from './TextFileViewer'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import { useSettings } from '../context/SettingsContext'
import { fetchSettingsRaw, saveSettingsRaw } from '../api/settingsClient'

interface SettingsRawModalProps {
  onClose: () => void
}

/**
 * Opens settings.json (stored outside the vault, in the app-data directory)
 * inside a TextFileViewer so the user can manually edit the raw config file.
 */
export function SettingsRawModal({ onClose }: SettingsRawModalProps) {
  const { reload } = useSettings()
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchSettingsRaw()
      .then((content) => {
        if (cancelled) return
        setDraft(content)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(e?.message || t('settings.loading'))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async () => {
    setError(null)
    try {
      JSON.parse(draft)
    } catch {
      setError(t('settings.invalidJson'))
      return
    }
    setSaving(true)
    try {
      await saveSettingsRaw(draft)
      await reload()
      onClose()
    } catch (e: any) {
      setError(e?.message || t('settings.invalidJson'))
      setSaving(false)
    }
  }

  return (
    <div className="settings-raw-overlay" onMouseDown={onClose}>
      <div
        className="settings-raw-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="settings-raw-header">
          <span className="settings-raw-title">
            <Icon name="file" size={16} /> settings.json
          </span>
          <button className="settings-raw-close" onClick={onClose} aria-label="close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="settings-raw-hint">{t('settings.editRawHint')}</p>
        <div className="settings-raw-body">
          {loading ? (
            <div className="settings-raw-state">{t('settings.loading')}</div>
          ) : loadError ? (
            <div className="settings-raw-state settings-raw-error">{loadError}</div>
          ) : (
            <TextFileViewer value={draft} onChange={setDraft} path="settings.json" />
          )}
        </div>
        {error && <div className="settings-raw-error settings-raw-error-bar">{error}</div>}
        <div className="settings-raw-footer">
          <button
            className="settings-raw-btn settings-raw-cancel"
            onClick={onClose}
            disabled={saving}
          >
            {t('common.cancel')}
          </button>
          <button
            className="settings-raw-btn settings-raw-save"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
