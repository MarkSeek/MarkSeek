import { useEffect, useState } from 'react'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import { formatFullTime } from '../utils/timeFormat'

/** One commit touching the current note, as returned by /api/sync/file-history. */
interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  email: string
  date: string
}

interface HistoryViewProps {
  notePath: string
  commit: CommitInfo
  onClose: () => void
  onRestore: (content: string) => void
}

/** Full content of a note at a given commit (for the preview / restore flow). */
async function fetchFileAtCommit(path: string, oid: string): Promise<{ content: string }> {
  const res = await fetch(
    `/api/sync/file-at-commit?path=${encodeURIComponent(path)}&oid=${encodeURIComponent(oid)}`,
  )
  if (!res.ok) throw new Error('Failed to load file at commit')
  return res.json()
}

/**
 * Modal that previews a single historical version of the note. The content is
 * fetched lazily (only when the modal opens), and "Restore" hands the text back
 * to the caller, which writes it into the editor and triggers autosave.
 */
export default function HistoryView({ notePath, commit, onClose, onRestore }: HistoryViewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchFileAtCommit(notePath, commit.hash)
      .then((res) => {
        if (cancelled) return
        setContent(res.content)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [notePath, commit.hash])

  const doRestore = () => {
    if (content === null) return
    onRestore(content)
  }

  return (
    <div className="hv-overlay" onClick={onClose} role="presentation">
      <div className="hv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="hv-header">
          <span className="hv-title">{t('relations.preview')}</span>
          <button type="button" className="rpp-icon-btn" title={t('chat.back')} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="hv-meta">
          <div className="hv-meta-row">
            <span className="hv-meta-key">{t('relations.commitHash')}</span>
            <span className="hv-meta-val">{commit.shortHash}</span>
          </div>
          <div className="hv-meta-row">
            <span className="hv-meta-key">{t('relations.author')}</span>
            <span className="hv-meta-val">{commit.author || commit.email}</span>
          </div>
          <div className="hv-meta-row">
            <span className="hv-meta-key">{t('relations.commitDate')}</span>
            <span className="hv-meta-val">{formatFullTime(new Date(commit.date).getTime())}</span>
          </div>
          <div className="hv-meta-row hv-message">
            <span className="hv-meta-val">{commit.message}</span>
          </div>
        </div>

        <div className="hv-content">
          {loading ? (
            <div className="hv-placeholder">{t('relations.loadingHistory')}</div>
          ) : failed ? (
            <div className="hv-placeholder">{t('relations.historyEmpty')}</div>
          ) : (
            <textarea className="hv-textarea" readOnly value={content ?? ''} spellCheck={false} />
          )}
        </div>

        <div className="hv-footer">
          <button type="button" className="rpp-btn" onClick={onClose}>
            {t('chat.back')}
          </button>
          <button
            type="button"
            className="rpp-btn is-primary"
            onClick={doRestore}
            disabled={loading || failed || content === null}
          >
            <Icon name="history" size={13} />
            <span className="rpp-btn-label">{t('relations.restore')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
