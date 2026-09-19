import { useState, useEffect } from 'react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { t } from '../../i18n'

export default function Dashboard() {
  const { fileTree, openTabs } = useWorkspace()
  const [stats, setStats] = useState({ totalFiles: 0, totalFolders: 0, openTabsCount: 0 })

  useEffect(() => {
    const count = (nodes: any[]) => {
      let files = 0, folders = 0
      for (const node of nodes) {
        if (node.type === 'folder') {
          folders++
          if (node.children) { const c = count(node.children); files += c.files; folders += c.folders }
        } else files++
      }
      return { files, folders }
    }
    const c = count(fileTree)
    setStats({ totalFiles: c.files, totalFolders: c.folders, openTabsCount: openTabs.length })
  }, [fileTree, openTabs])

  const recentTabs = openTabs.slice(-5).reverse()

  return (
    <div className="home-dashboard-inner">
      {/* Stats */}
        <div className="home-dash-block">
          <div className="home-dash-block-title">{t('dash.stats')}</div>
          <div className="home-dash-stats-grid">
            <div className="home-dash-stat-card">
              <span className="home-dash-stat-num">{stats.totalFiles}</span>
              <span className="home-dash-stat-lbl">{t('dash.notes')}</span>
            </div>
            <div className="home-dash-stat-card">
              <span className="home-dash-stat-num">{stats.totalFolders}</span>
              <span className="home-dash-stat-lbl">{t('dash.folders')}</span>
            </div>
            <div className="home-dash-stat-card">
              <span className="home-dash-stat-num">{stats.openTabsCount}</span>
              <span className="home-dash-stat-lbl">{t('dash.tabs')}</span>
            </div>
          </div>
        </div>

        {/* Recently opened */}
        <div className="home-dash-block">
          <div className="home-dash-block-title">{t('dash.recent')}</div>
          {recentTabs.length === 0 ? (
            <div className="home-dash-empty-text">{t('dash.empty')}</div>
        ) : (
          <div className="home-dash-recent-list">
            {recentTabs.map((tab) => (
              <div key={tab.id} className="home-dash-recent-item">
                <span className="home-dash-recent-dot" />
                <span className="home-dash-recent-name">{tab.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
