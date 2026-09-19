import { useState } from 'react'
import { Icon } from '../../icons/Icon'
import type { IconName } from '../../icons/Icon'
import { t } from '../../../i18n'
import type { ToolActivity } from '../../../agent/types'

function activityIcon(status: ToolActivity['status']): IconName {
  if (status === 'confirm' || status === 'error') return 'alert'
  if (status === 'done') return 'file-result'
  return 'robot'
}

function activitySummary(activity: ToolActivity): string {
  if (activity.status === 'running') return '…'
  if (activity.status === 'confirm') return 'awaiting confirmation'
  return activity.result || ''
}

/** Collapsible log of the tool calls the current run made. */
export function ActivityLog({ activities }: { activities: ToolActivity[] }) {
  const [expanded, setExpanded] = useState(false)
  if (activities.length === 0) return null

  return (
    <div className="agent-activity-log">
      <button
        type="button"
        className="agent-activity-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
        <span>{t('chat.agentActivity')}</span>
        <span className="agent-activity-count">{activities.length}</span>
      </button>
      {expanded &&
        activities.map((a) => (
          <div key={a.id} className={`agent-activity agent-activity-${a.status}`}>
            <Icon name={activityIcon(a.status)} size={14} />
            <span className="agent-activity-name">{a.name}</span>
            <span className="agent-activity-summary">{activitySummary(a)}</span>
          </div>
        ))}
    </div>
  )
}
