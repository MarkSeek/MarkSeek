import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspace, type Tab } from '../context/WorkspaceContext'
import { Icon, isIconName, type IconName } from './icons/Icon'
import { t } from '../i18n'
import { useWindowControls } from '../hooks/useWindowControls'
import { SHORTCUT_EVENTS } from '../hooks/shortcutEvents'
import { WindowControls } from './WindowControls'
import { getElectron } from '../api/electronBridge'
import { pluginManager } from '../plugins/PluginManager'
import { usePluginContributions } from '../plugins/usePluginContributions'

function getTabIcon(tab: Tab): IconName {
  // A file owned by a plugin's page renderer is still an ordinary file tab, so
  // the path — not the kind — tells them apart in the tab strip. The plugin
  // names the icon; unknown names fall back to the file icon.
  const icon = pluginManager.getPageRenderer(tab.path)?.icon
  if (icon && isIconName(icon)) return icon
  switch (tab.kind) {
    case 'diary': return 'diary-tab'
    case 'calendar': return 'calendar-tab'
    case 'liteapp': return 'liteapp'
    case 'settings': return 'settings-tab'
    case 'image': return 'image'
    default: return 'file'
  }
}

interface EditorTabsProps {
  leftOpen: boolean
  onToggleLeft: () => void
  rightOpen: boolean
  onToggleRight: () => void
}

/* ---- Tab context menu ---- */
interface TabCtxState {
  visible: boolean
  x: number
  y: number
  tabId: string
}

function TabContextMenu({ menu, onClose, onCloseTab, onCloseOthers, onCloseRight }: {
  menu: TabCtxState
  /** Dismiss the menu itself */
  onClose: () => void
  /** Close the tab the menu was opened on */
  onCloseTab: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseRight: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!menu.visible) return null

  const items = [
    { label: t('tabs.close'), action: () => { onCloseTab(menu.tabId); onClose() } },
    { label: t('tabs.closeOthers'), action: () => { onCloseOthers(menu.tabId); onClose() } },
    { label: t('tabs.closeRight'), action: () => { onCloseRight(menu.tabId); onClose() } },
  ]

  return createPortal(
    <div
      ref={ref}
      className="tab-context-menu-anchor"
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 2000 }}
    >
      {/* Fixed anchor has no `zoom` so left/top map 1:1 to the cursor; the inner
          wrapper keeps `zoom` for visual scale consistency with the app. */}
      <div className="tab-context-menu">
        {items.map((item, i) => (
          <div key={i} className="tab-context-item" onClick={item.action}>{item.label}</div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/** Settings icon: gear */
export default function EditorTabs({ leftOpen, onToggleLeft, rightOpen, onToggleRight }: EditorTabsProps) {
  const { openTabs, activeTabId, switchTab, closeTab, reorderTabs, openSettings } = useWorkspace()
  const win = useWindowControls()
  // Tab icons may come from a plugin's page renderer, so re-render once the
  // plugins have registered their contributions.
  usePluginContributions()
  // tabs-overflow dropdown (tab list)
  const [tabsDropdownOpen, setTabsDropdownOpen] = useState(false)
  const [tabsDropdownPos, setTabsDropdownPos] = useState({ top: 0, right: 0 })
  const tabsDropdownRef = useRef<HTMLDivElement>(null)
  const tabsMoreBtnRef = useRef<HTMLButtonElement>(null)
  // actions dropdown (settings / help / bug feedback)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionsPos, setActionsPos] = useState({ top: 0, right: 0 })
  const actionsDropdownRef = useRef<HTMLDivElement>(null)
  const actionsBtnRef = useRef<HTMLButtonElement>(null)
  const tabsContainerRef = useRef<HTMLDivElement>(null)

  const [tabCtx, setTabCtx] = useState<TabCtxState>({ visible: false, x: 0, y: 0, tabId: '' })

  /* ---- Tab dragging ---- */
  const [dragState, setDragState] = useState<{ dragId: string | null; overId: string | null; side: 'left' | 'right' | null }>({
    dragId: null, overId: null, side: null,
  })

  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData('text/plain', tabId)
    e.dataTransfer.effectAllowed = 'move'
    setDragState({ dragId: tabId, overId: null, side: null })
  }, [])

  const handleTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    // do not allow dropping onto itself
    if (tabId === dragState.dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // decide whether to insert on the left or right based on the cursor position over the element
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side = e.clientX < midX ? 'left' : 'right'
    setDragState((prev) => {
      if (prev.overId === tabId && prev.side === side) return prev
      return { ...prev, overId: tabId, side }
    })
  }, [dragState.dragId])

  const handleTabDragLeave = useCallback(() => {
    setDragState((prev) => ({ ...prev, overId: null, side: null }))
  }, [])

  const handleTabDrop = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    const fromId = e.dataTransfer.getData('text/plain')
    if (!fromId || fromId === tabId) {
      setDragState({ dragId: null, overId: null, side: null })
      return
    }
    const fromIdx = openTabs.findIndex((t) => t.id === fromId)
    let toIdx = openTabs.findIndex((t) => t.id === tabId)
    if (fromIdx === -1 || toIdx === -1) {
      setDragState({ dragId: null, overId: null, side: null })
      return
    }
    // if the drop target is after the source, the real insert index must be adjusted (the source index shifts after removal)
    if (dragState.side === 'right') toIdx += 1
    if (fromIdx < toIdx) toIdx -= 1
    reorderTabs(fromIdx, toIdx)
    setDragState({ dragId: null, overId: null, side: null })
  }, [openTabs, reorderTabs, dragState.side])

  const handleTabDragEnd = useCallback(() => {
    setDragState({ dragId: null, overId: null, side: null })
  }, [])

  // close dropdowns when clicking outside (tabs list and actions menu)
  useEffect(() => {
    const closeIfOutside = (
      e: MouseEvent,
      ref: React.RefObject<HTMLDivElement>,
      btnRef: React.RefObject<HTMLButtonElement>,
      close: () => void,
    ) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        close()
      }
    }
    const handler = (e: MouseEvent) => {
      closeIfOutside(e, tabsDropdownRef, tabsMoreBtnRef, () => setTabsDropdownOpen(false))
      closeIfOutside(e, actionsDropdownRef, actionsBtnRef, () => setActionsOpen(false))
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // when the active tab changes, auto-scroll it into view
  useEffect(() => {
    if (!activeTabId) return
    const container = tabsContainerRef.current
    if (!container) return
    const activeEl = container.querySelector('.tab.active') as HTMLElement | null
    if (!activeEl) return

    const cRect = container.getBoundingClientRect()
    const tRect = activeEl.getBoundingClientRect()

    if (tRect.left < cRect.left || tRect.right > cRect.right) {
      const target = container.scrollLeft + (tRect.left - cRect.left) - 8
      container.scrollTo({
        left: Math.max(0, target),
        behavior: 'smooth',
      })
    }
  }, [activeTabId])

  const handleActionsClick = useCallback(() => {
    if (actionsBtnRef.current) {
      const rect = actionsBtnRef.current.getBoundingClientRect()
      setActionsPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }
    setActionsOpen((v) => !v)
  }, [])

  const handleTabsMoreClick = useCallback(() => {
    if (tabsMoreBtnRef.current) {
      const rect = tabsMoreBtnRef.current.getBoundingClientRect()
      setTabsDropdownPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }
    setTabsDropdownOpen((v) => !v)
  }, [])

  // Open an external URL: prefer Electron's openExternal, fall back to
  // window.open in the browser. Wrapped in try/catch so a failure never
  // interrupts the menu interaction.
  const openExternalUrl = useCallback((url: string) => {
    const electron = getElectron()
    if (electron?.openExternal) {
      electron.openExternal(url).catch((e) =>
        console.error('[EditorTabs] openExternal failed:', e),
      )
    } else {
      window.open(url, '_blank', 'noopener')
    }
  }, [])

  // Action menu shown when clicking the more button.
  const HELP_URL = 'https://github.com/MarkSeek/MarkSeek#readme'
  const BUG_FEEDBACK_URL = 'https://github.com/MarkSeek/MarkSeek/issues'

  const actionMenuItems: { key: string; label: string; icon: IconName; onClick: () => void }[] = [
    { key: 'settings', label: t('actions.settings'), icon: 'settings', onClick: () => { openSettings(); setActionsOpen(false) } },
    { key: 'help', label: t('actions.help'), icon: 'book', onClick: () => { openExternalUrl(HELP_URL); setActionsOpen(false) } },
    { key: 'bug', label: t('actions.bugFeedback'), icon: 'alert', onClick: () => { openExternalUrl(BUG_FEEDBACK_URL); setActionsOpen(false) } },
  ]

  const handleDropdownTab = useCallback(
    (id: string) => {
      switchTab(id)
      setTabsDropdownOpen(false)
    },
    [switchTab]
  )

  const handleDropdownClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      closeTab(id)
    },
    [closeTab]
  )

  /** Tab right-click */
  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setTabCtx({ visible: true, x: e.clientX, y: e.clientY, tabId })
  }, [])

  const closeTabCtx = useCallback(() => setTabCtx(prev => ({ ...prev, visible: false })), [])

  const handleCloseTab = useCallback((id: string) => {
    void closeTab(id)
  }, [closeTab])

  const handleCloseOthers = useCallback(async (id: string) => {
    // close one by one asynchronously; after each await the ref updates, avoiding index drift
    const tabs = [...openTabs]
    for (const t of tabs) {
      if (t.id !== id) {
        await closeTab(t.id, true)
      }
    }
    switchTab(id)
  }, [openTabs, closeTab, switchTab])

  const handleCloseRight = useCallback(async (id: string) => {
    const tabs = [...openTabs]
    const idx = tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    for (let i = tabs.length - 1; i > idx; i--) {
      await closeTab(tabs[i].id, true)
    }
  }, [openTabs, closeTab])

  return (
    <div className={`editor-tabs-bar${win.visible && !rightOpen ? ' with-window-controls' : ''}`}>
      <div className="editor-tabs-group">
        {/* When the left sidebar is collapsed, its header buttons are relocated
            here so they stay at the very left of the editor tabs bar. */}
        {!leftOpen && (
          <div className="collapsed-left-actions">
            <button
              className="top-icon-btn panel-toggle panel-left"
              onClick={onToggleLeft}
              title={t('tabs.expandLeft')}
            >
              <Icon name="panel-left-collapsed" size={16} />
            </button>
            <button
              className="top-icon-btn sidebar-search-btn"
              onClick={() => document.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.search))}
              aria-label={t('sidebar.searchPlaceholder')}
              title={t('sidebar.searchPlaceholder')}
            >
              <Icon name="search" size={16} />
            </button>
          </div>
        )}
        <div className="editor-tabs" ref={tabsContainerRef}>
          {openTabs.map((tab) => {
            const isOver = dragState.overId === tab.id
            const overClass = isOver
              ? (dragState.side === 'left' ? ' drag-over-left' : ' drag-over-right')
              : ''
            return (
              <div
                key={tab.id}
                className={`tab${tab.id === activeTabId ? ' active' : ''}${overClass}`}
                onClick={() => switchTab(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                draggable
                onDragStart={(e) => handleTabDragStart(e, tab.id)}
                onDragOver={(e) => handleTabDragOver(e, tab.id)}
                onDragLeave={handleTabDragLeave}
                onDrop={(e) => handleTabDrop(e, tab.id)}
                onDragEnd={handleTabDragEnd}
                title={tab.kind === 'diary' ? t('tab.diary') : tab.kind === 'calendar' ? t('tab.calendar') : tab.path}
              >
                <span className="tab-icon"><Icon name={getTabIcon(tab)} size={14} /></span>
                <span className="tab-name">{tab.name}<span style={{ visibility: tab.dirty ? 'visible' : 'hidden' }}> •</span></span>
                <span
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                ><Icon name="close" size={12} /></span>
              </div>
            )
          })}
          {openTabs.length > 1 && (
            <div className="tabs-more-wrap">
              <button className="tabs-more-btn" ref={tabsMoreBtnRef} onClick={handleTabsMoreClick} title={t('tabs.more')}>
                <Icon name="more-dots-vertical" size={14} />
              </button>
            </div>
          )}
          {openTabs.length === 0 && (
            <div className="tab" style={{ opacity: 0.5, cursor: 'default' }}>
              <span className="tab-name">{t('tabs.untitled')}</span>
            </div>
          )}
        </div>
        <TabContextMenu
          menu={tabCtx}
          onClose={closeTabCtx}
          onCloseTab={handleCloseTab}
          onCloseOthers={handleCloseOthers}
          onCloseRight={handleCloseRight}
        />
        {tabsDropdownOpen && openTabs.length > 1 && createPortal(
          <div className="tabs-dropdown-anchor" style={{ position: 'fixed', top: tabsDropdownPos.top, right: tabsDropdownPos.right }}>
            <div className="tabs-dropdown" ref={tabsDropdownRef}>
              {openTabs.map(tab => (
              <div
                key={tab.id}
                className={`tabs-dropdown-item${tab.id === activeTabId ? ' active' : ''}`}
                onClick={() => handleDropdownTab(tab.id)}
              >
                <Icon name={getTabIcon(tab)} size={14} />
                <span className="tabs-dropdown-name">{tab.name}<span style={{ visibility: tab.dirty ? 'visible' : 'hidden' }}> •</span></span>
                <span
                  className="tabs-dropdown-close"
                  onClick={(e) => handleDropdownClose(e, tab.id)}
                >×</span>
              </div>
            ))}
            </div>
          </div>,
          document.body
        )}
        {actionsOpen && createPortal(
          <div className="actions-dropdown-anchor" style={{ position: 'fixed', top: actionsPos.top, right: actionsPos.right }}>
            <div className="actions-dropdown" ref={actionsDropdownRef}>
              {actionMenuItems.map(item => (
              <div
                key={item.key}
                className="actions-dropdown-item"
                onClick={item.onClick}
              >
                <Icon name={item.icon} size={16} />
                <span className="actions-dropdown-label">{item.label}</span>
              </div>
            ))}
            </div>
          </div>,
          document.body
        )}
      </div>
      <div className="editor-tabs-actions">
        <button className={`top-icon-btn${actionsOpen ? ' active' : ''}`} ref={actionsBtnRef} onClick={handleActionsClick} title={t('tabs.more')}>
          <Icon name="more-dots-horizontal" size={16} />
        </button>
        <button className={`top-icon-btn panel-toggle panel-right${rightOpen ? ' active' : ''}`} onClick={onToggleRight} title={rightOpen ? t('tabs.collapseRight') : t('tabs.expandRight')}>
          <Icon name={rightOpen ? 'panel-right' : 'panel-right-collapsed'} size={16} />
        </button>
        {/* Frameless window controls: only when there is no right panel to host them. */}
        {win.visible && !rightOpen && (
          <WindowControls
            maximized={win.maximized}
            onMinimize={win.minimize}
            onToggleMaximize={win.toggleMaximize}
            onClose={win.close}
          />
        )}
      </div>
    </div>
  )
}
