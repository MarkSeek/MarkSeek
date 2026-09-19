import { t } from '../../i18n'

const quickActions: { id: string; labelKey: string; promptKey: string; descKey: string; icon: string }[] = [
  { id: 'summarize', labelKey: 'quick.summarize.label', promptKey: 'quick.summarize.prompt', descKey: 'quick.summarize.desc', icon: '📝' },
  { id: 'weekly', labelKey: 'quick.weekly.label', promptKey: 'quick.weekly.prompt', descKey: 'quick.weekly.desc', icon: '📋' },
  { id: 'brainstorm', labelKey: 'quick.brainstorm.label', promptKey: 'quick.brainstorm.prompt', descKey: 'quick.brainstorm.desc', icon: '💡' },
  { id: 'writing', labelKey: 'quick.writing.label', promptKey: 'quick.writing.prompt', descKey: 'quick.writing.desc', icon: '✍️' },
  { id: 'translate', labelKey: 'quick.translate.label', promptKey: 'quick.translate.prompt', descKey: 'quick.translate.desc', icon: '🌐' },
  { id: 'analyze', labelKey: 'quick.analyze.label', promptKey: 'quick.analyze.prompt', descKey: 'quick.analyze.desc', icon: '🔍' },
  { id: 'outline', labelKey: 'quick.outline.label', promptKey: 'quick.outline.prompt', descKey: 'quick.outline.desc', icon: '📐' },
  { id: 'code_review', labelKey: 'quick.codeReview.label', promptKey: 'quick.codeReview.prompt', descKey: 'quick.codeReview.desc', icon: '🔧' },
]

interface QuickActionsProps {
  onAction: (prompt: string) => void
}

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="home-quick-actions-inner">
      <div className="home-panel-header">
        <span className="home-panel-icon">⚡</span>
        <span className="home-panel-title">{t('home.quickActions')}</span>
      </div>
      <div className="home-quick-actions-list">
        {quickActions.map((action) => (
          <button
            key={action.id}
            className="home-quick-action-btn"
            onClick={() => onAction(t(action.promptKey))}
            title={t(action.descKey)}
          >
            <span className="home-quick-action-icon">{action.icon}</span>
            <span className="home-quick-action-label">{t(action.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
