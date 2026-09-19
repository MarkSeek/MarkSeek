import { useEffect, useState } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { RECENT_DISPLAY_MAX } from '../utils/recentStorage'
import { formatFullTime, formatRelativeTime } from '../utils/timeFormat'
import { filePathToYmd } from '../utils/diaryPath'
import { t, useTranslation } from '../i18n'
import { Icon } from './icons/Icon'
import { fileIconName } from '../utils/fileIcon'

// Ticking clock that keeps relative timestamps up to date.
// Refreshes once per minute, which is the finest granularity displayed.
function useNowTick(newestTs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!newestTs) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [newestTs])

  return now
}

// Recent files list rendered in the left sidebar "Recent" group
export function RecentList() {
  const { recentFiles, openFile, openDiary, activeTabId } = useWorkspace()
  // keep relative-time strings in sync with the active language
  useTranslation()

  // show at most RECENT_DISPLAY_MAX most recent docs
  const visible = recentFiles.slice(0, RECENT_DISPLAY_MAX)
  const newestTs = visible.length ? Math.max(...visible.map((it) => it.ts)) : 0
  const now = useNowTick(newestTs)

  // Diary file paths look like Journals/YYYY/YYYY-MM/YYYY-MM-DD.md; clicking one jumps to its
  // date's diary virtual page (which you can keep browsing via paging/calendar) instead of opening
  // it as an ordinary file.
  const openRecent = (path: string) => {
    const ymd = filePathToYmd(path)
    if (ymd) void openDiary(ymd)
    else void openFile(path)
  }

  if (visible.length === 0) {
    return <div className="recent-empty">{t('sidebar.noRecent')}</div>
  }

  return (
    <div className="recent-list">
      {visible.map((item) => {
        const active = item.path === activeTabId
        // The icon mirrors the file type, the same way the tree does.
        const icon = fileIconName(item.path)
        return (
          <button
            key={item.path}
            type="button"
            className={`recent-item${active ? ' active' : ''}`}
            title={`${item.path}\n${formatFullTime(item.ts)}`}
            onClick={() => openRecent(item.path)}
          >
            <span className="recent-icon">
              <Icon name={icon} size={14} />
            </span>
            <span className="recent-name">{item.name}</span>
            <span className="recent-time">{formatRelativeTime(item.ts, now)}</span>
          </button>
        )
      })}
    </div>
  )
}
