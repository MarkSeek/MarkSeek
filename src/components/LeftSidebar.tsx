import { useState, useEffect } from 'react'
import TreeList from './TreeList'
import { RecentList } from './RecentList'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSettings } from '../context/SettingsContext'
import { SHORTCUT_EVENTS } from '../hooks/shortcutEvents'
import { loadMonthTasks } from '../api/tasks'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import VaultSwitchDialog from './VaultSwitchDialog'
import { dateToYmd, partsToYmd } from '../utils/date'
import { buildMonthGrid, type MonthCell } from '../utils/monthGrid'

const WEEK_LABEL_KEYS = ['calendar.sun', 'calendar.mon', 'calendar.tue', 'calendar.wed', 'calendar.thu', 'calendar.fri', 'calendar.sat']
const MONTH_LABEL_KEYS = ['calendar.jan', 'calendar.feb', 'calendar.mar', 'calendar.apr', 'calendar.may', 'calendar.jun', 'calendar.jul', 'calendar.aug', 'calendar.sep', 'calendar.oct', 'calendar.nov', 'calendar.dec']

export default function LeftSidebar({
  leftOpen,
  onToggleLeft,
}: {
  leftOpen: boolean
  onToggleLeft: () => void
}) {
  const { openCalendar, openLiteApp, openTodayNote, openDiary, taskVersion } = useWorkspace()
  const { vaultPath } = useSettings()
  const [switchOpen, setSwitchOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  // collapse/expand state of each sidebar tree-label group
  const [collapsed, setCollapsed] = useState<{ recent: boolean; allNotes: boolean }>({
    recent: false,
    allNotes: false,
  })
  // the month currently shown in the mini calendar (based on the Date's year/month)
  const [calView, setCalView] = useState(() => {
    const t = new Date()
    return { y: t.getFullYear(), m: t.getMonth() }
  })
  // per-day task list (used to show a dot under each mini-calendar date)
  const [tasksByDate, setTasksByDate] = useState<Record<string, { text: string; done: boolean }[]>>({})

  // Load the current month's task data for the mini calendar (to show task dots); only the
  // visible month is fetched, not every historical file. Refreshes immediately when calView's
  // year/month changes or when taskVersion changes (diary task add/edit/delete).
  useEffect(() => {
    loadMonthTasks(calView.y, calView.m + 1)
      .then(setTasksByDate)
      .catch(console.error)
  }, [calView.y, calView.m, taskVersion])

  // Build the current month's grid (with leading/trailing days from adjacent months filled in).
  // Fixed at 6 rows so the height does not jump when switching months.
  const cells = buildMonthGrid(calView.y, calView.m, { minWeeks: 6 })

  const todayStr = dateToYmd(new Date())

  function shiftMonth(delta: number) {
    setCalView((v) => {
      const m = v.m + delta
      const y = v.y + Math.floor(m / 12)
      const nm = ((m % 12) + 12) % 12
      return { y, m: nm }
    })
  }

  function goToday() {
    const t = new Date()
    setCalView({ y: t.getFullYear(), m: t.getMonth() })
  }

  function pickDate(c: MonthCell) {
    openDiary(partsToYmd(c.year, c.month, c.day))
  }

  return (
    <div className="left-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button
            className={`top-icon-btn panel-toggle panel-left${leftOpen ? ' active' : ''}`}
            onClick={onToggleLeft}
            title={leftOpen ? t('tabs.collapseLeft') : t('tabs.expandLeft')}
          >
            <Icon name={leftOpen ? 'panel-left' : 'panel-left-collapsed'} size={16} />
          </button>
          <button
            className="sidebar-search-btn"
            onClick={() => document.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.search))}
            aria-label={t('sidebar.searchPlaceholder')}
            title={t('sidebar.searchPlaceholder')}
          >
              <Icon name="search" size={16} />
          </button>
        </div>
      </div>
      <div className="sidebar-shortcuts">
        <button className="shortcut-item" onClick={openTodayNote} title={t('tab.diary')}>
          <span className="shortcut-icon">
            <Icon name="diary" size={16} />
          </span>
          <span className="shortcut-label">{t('tab.diary')}</span>
        </button>
        <button className="shortcut-item" onClick={openCalendar} title={t('tab.calendar')}>
          <span
            className={`shortcut-icon cal-icon-trigger${calOpen ? ' cal-open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setCalOpen((v) => !v)
            }}
          >
            <Icon name="calendar" size={16} className="cal-icon-cal" />
            <Icon name="chevron-down" size={13} className="cal-icon-caret" />
          </span>
          <span className="shortcut-label">{t('tab.calendar')}</span>
        </button>
        {calOpen && (
          <div className="mini-cal">
            <div className="mini-cal-head">
              <button className="mini-cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
              <span className="mini-cal-title">{calView.y} {t(MONTH_LABEL_KEYS[calView.m])}</span>
              <button className="mini-cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
              <button className="mini-cal-today-btn" onClick={goToday}>{t('calendar.today')}</button>
            </div>
            <div className="mini-cal-weekdays">
              {WEEK_LABEL_KEYS.map((k) => (
                <span key={k} className="mini-cal-wd">{t(k)}</span>
              ))}
            </div>
            <div className="mini-cal-grid">
              {cells.map((c, i) => {
                const cellYmd = partsToYmd(c.year, c.month, c.day)
                const dayTasks = tasksByDate[cellYmd] ?? []
                const total = dayTasks.length
                const done = dayTasks.filter((t) => t.done).length
                // task-dot state: all=fully done (filled) / some=partially done (half-open) / none=not started (empty)
                const dotState =
                  total > 0 && done === total ? ' mini-cal-dot-all'
                  : done > 0 ? ' mini-cal-dot-some'
                  : total > 0 ? ' mini-cal-dot-none'
                  : ''
                const cls =
                  'mini-cal-cell' +
                  (c.inMonth ? '' : ' mini-cal-out') +
                  (cellYmd === todayStr ? ' mini-cal-today' : '')
                return (
                  <button
                    key={i}
                    className={cls}
                    onClick={() => pickDate(c)}
                  >
                    <span className="mini-cal-daynum">{c.day}</span>
                    {total > 0 && <span className={`mini-cal-dot${dotState}`} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <button className="shortcut-item" onClick={openLiteApp}>
          <span className="shortcut-icon">
            <Icon name="liteapp" size={16} />
          </span>
          <span className="shortcut-label">{t('tab.liteapp')}</span>
        </button>
      </div>
      <div className="tree-label tree-label-collapsible">
        <span className="tree-label-text">{t('sidebar.recent')}</span>
        <button
          type="button"
          className="tree-collapse-btn"
          aria-label={collapsed.recent ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed.recent ? t('sidebar.expand') : t('sidebar.collapse')}
          onClick={() => setCollapsed((v) => ({ ...v, recent: !v.recent }))}
        >
          <Icon name={collapsed.recent ? 'chevron-right' : 'chevron-down'} size={12} />
        </button>
      </div>
      {!collapsed.recent && <RecentList />}
      <div className="tree-label tree-label-collapsible">
        <span className="tree-label-text">{t('sidebar.allNotes')}</span>
        <button
          type="button"
          className="tree-collapse-btn"
          aria-label={collapsed.allNotes ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed.allNotes ? t('sidebar.expand') : t('sidebar.collapse')}
          onClick={() => setCollapsed((v) => ({ ...v, allNotes: !v.allNotes }))}
        >
          <Icon name={collapsed.allNotes ? 'chevron-right' : 'chevron-down'} size={12} />
        </button>
      </div>
      {!collapsed.allNotes && (
        <div className="sidebar-tree">
          <TreeList />
        </div>
      )}
      {/* Vault path footer: pinned to the bottom of the sidebar */}
      {vaultPath && (
          <div className="sidebar-vault-path" title={vaultPath}>
            <button
              type="button"
              className="sidebar-vault-icon"
              aria-label={t('vault.switchHint')}
              title={t('vault.switchHint')}
              onClick={() => setSwitchOpen(true)}
            >
              <Icon name="vault" size={16} />
            </button>
            <span className="sidebar-vault-name">{vaultPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}</span>
          </div>
      )}
      {switchOpen && <VaultSwitchDialog onClose={() => setSwitchOpen(false)} />}
    </div>
  )
}