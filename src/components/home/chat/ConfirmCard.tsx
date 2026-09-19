import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import type { ConfirmRequest } from '../../../agent/types'

/**
 * The Allow / Decline card for a paused write.
 *
 * Rendered only in agent mode: ask mode blocks writes outright, so it can never
 * pause on one.
 */
export function ConfirmCard({
  request,
  onResolve,
}: {
  request: ConfirmRequest
  onResolve: (approved: boolean) => void
}) {
  return (
    <div className="agent-confirm-card">
      <div className="agent-confirm-card-head">
        <Icon name="alert" size={14} />
        <span>{t('chat.confirmWriteTitle')}</span>
      </div>
      <div className="agent-confirm-card-path">
        {request.op} → {request.path}
      </div>
      <pre className="agent-confirm-card-preview">{request.preview}</pre>
      <div className="agent-confirm-card-actions">
        <button
          type="button"
          className="agent-confirm-card-allow"
          onClick={() => onResolve(true)}
        >
          {t('chat.confirmWrite')}
        </button>
        <button
          type="button"
          className="agent-confirm-card-deny"
          onClick={() => onResolve(false)}
        >
          {t('chat.declineWrite')}
        </button>
      </div>
    </div>
  )
}
