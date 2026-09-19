import { useMemo } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { Icon, type IconName } from './icons/Icon'
import { t } from '../i18n'
import { SHORTCUT_EVENTS } from '../hooks/shortcutEvents'
import { isMac } from '../utils/platform'

/**
 * Quick-entry cards. Built inside the component (not at module scope) because
 * `t()` is resolved at build time — a module-level array would freeze the
 * strings in whatever language was active on first import.
 */
function useWalkthroughs(ctx: ReturnType<typeof useWorkspace>) {
  return useMemo(
    () => [
      {
        id: 'getting-started',
        icon: 'star',
        badge: 'NEW',
        title: t('home.wtGettingStarted'),
        desc: t('home.wtGettingStartedDesc'),
        onClick: () => ctx.openIntroNote(),
      },
      {
        id: 'ai-assistant',
        icon: 'robot',
        badge: 'NEW',
        title: t('home.wtAiAssistant'),
        desc: t('home.wtAiAssistantDesc'),
        onClick: () => ctx.bumpAiPanel(),
      },
    ],
    [ctx],
  )
}

export default function HomePage() {
  const ctx = useWorkspace()
  const {
    openTabs,
    openFile,
    createFile,
    openTodayNote,
  } = ctx

  // Most recently opened files (take the last 8 in tab order, dropping virtual pages like Home/Calendar)
  const recentFiles = useMemo(() => {
    const tabFiles = openTabs.filter((t) => !t.id.startsWith('__'))
    return tabFiles.slice(-8).reverse()
  }, [openTabs])

  const walkthroughs = useWalkthroughs(ctx)

  // Actions shown in the Start area
  const startActions: { id: string; icon: IconName; label: string; hint?: string; comingSoon?: boolean; onClick?: () => void }[] = [
    { id: 'new', icon: 'new-file', label: t('home.startNew'), hint: 'Ctrl + N', onClick: () => createFile() },
    { id: 'search', icon: 'search-simple', label: t('home.startSearch'), hint: isMac ? '⌘K / ⌘P' : 'Ctrl K / P', onClick: () => document.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.search)) },
    { id: 'today', icon: 'today', label: t('home.startToday'), hint: '', onClick: () => openTodayNote() },
    { id: 'connect', icon: 'cloud', label: t('home.startConnect'), hint: t('home.comingSoon'), comingSoon: true },
  ]

  return (
    <div className="start-page">
      <div className="start-page-inner">
        {/* Title area */}
        <div className="start-header">
          <h1 className="start-title">MarkSeek</h1>
          <p className="start-subtitle">{t('home.subtitle')}</p>
        </div>

        <div className="start-body">
          {/* ===== Left column ===== */}
          <div className="start-col start-col-left">
            {/* Start */}
            <div className="start-section">
              <h2 className="start-section-title">Start</h2>
              <ul className="start-action-list">
                {startActions.map((a) => (
                  <li key={a.id}>
                    <button
                      className={`start-action${a.comingSoon ? ' start-action-soon' : ''}`}
                      onClick={a.onClick}
                      disabled={a.comingSoon}
                    >
                      <span className="start-action-icon">
                        <Icon name={a.icon} size={18} />
                      </span>
                      <span className="start-action-label">{a.label}</span>
                      {a.hint && !a.comingSoon && (
                        <span className="start-action-hint">{a.hint}</span>
                      )}
                      {a.comingSoon && (
                        <span className="start-action-soon-tag">{t('home.comingSoon')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recent */}
            <div className="start-section">
              <h2 className="start-section-title">Recent</h2>
              {recentFiles.length === 0 ? (
                <div className="start-recent-empty">{t('home.noRecent')}</div>
              ) : (
                <ul className="start-recent-list">
                  {recentFiles.map((f) => {
                    const dir = f.path.includes('/')
                      ? f.path.substring(0, f.path.lastIndexOf('/'))
                      : ''
                    return (
                      <li key={f.id}>
                        <button
                          className="start-recent-item"
                          onClick={() => openFile(f.path)}
                        >
                          <span className="start-recent-name">{f.name}</span>
                          <span className="start-recent-path">{dir || '/'}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ===== Right column ===== */}
          <div className="start-col start-col-right">
            <h2 className="start-section-title">{t('home.quickEntry')}</h2>
            <ul className="start-walkthrough-list">
              {walkthroughs.map((w) => (
                <li key={w.id}>
                  <button
                    className="start-walkthrough-card"
                    onClick={w.onClick}
                  >
                    <div className="start-walkthrough-body">
                      <div className="start-walkthrough-head">
                        <span className="start-walkthrough-title">{w.title}</span>
                        {w.badge && <span className="start-walkthrough-badge">{w.badge}</span>}
                      </div>
                      <p className="start-walkthrough-desc">{w.desc}</p>
                    </div>
                    <span className="start-walkthrough-enter">→</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}