import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import type { ConfirmRequest } from '../../../agent/types'

/**
 * The Allow / Decline card for a paused write.
 *
 * `index` / `total` are set only when the run paused on more than one write, so
 * a single card stays clean while a queue shows its position.
 */
export function ConfirmCard({
  request,
  index,
  total,
  onResolve,
}: {
  request: ConfirmRequest
  index?: number
  total?: number
  onResolve: (approved: boolean) => void
}) {
  return (
    <div className="agent-confirm-card">
      <div className="agent-confirm-card-head">
        <Icon name="alert" size={14} />
        <span>{t('chat.confirmWriteTitle')}</span>
        {index !== undefined && total !== undefined && (
          <span className="agent-confirm-card-count">
            {index}/{total}
          </span>
        )}
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
