import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSettings } from '../context/SettingsContext'
import { ChatPanel } from './home/ChatPanel'
import { Icon } from './icons/Icon'
import { RelationIcon } from './icons/RelationIcon'
import RelationPanel from './RelationPanel'
import { t } from '../i18n'
import { useWindowControls } from '../hooks/useWindowControls'
import { WindowControls } from './WindowControls'
import {
  getVaultKey,
  readSession,
  patchSession,
  type RightPanelView,
} from '../utils/sessionStorage'
import { KEYS } from '../utils/storageKeys'

const CHAT_STORAGE_KEY = KEYS.chatBase.right

/* ======== Main component ======== */
export default function RightPanel() {
  const { aiPanelTrigger, activeTab } = useWorkspace()
  const { vaultPath } = useSettings()
  // Window controls live here (right panel is visible), only on frameless
  // Electron Windows/Linux builds; macOS keeps native traffic lights.
  const win = useWindowControls()
  const vaultKey = getVaultKey(vaultPath)

  // Restore which sub-view (chat / relations) was last shown.
  const [view, setView] = useState<RightPanelView>(() => readSession(vaultKey).rightPanel.view)

  // Persist the sub-view so it reopens the same way. `showRelations` is kept in
  // sync for snapshots shared with older builds.
  const setPanelView = useCallback(
    (next: RightPanelView) => {
      setView(next)
      patchSession(vaultKey, { rightPanel: { view: next, showRelations: next === 'relations' } })
    },
    [vaultKey],
  )

  // When the home "Use AI assistant" card fires, switch to the AI tab (the user may be on the
  // relations panel). A counter instead of a boolean so repeated clicks on the same card still re-trigger.
  useEffect(() => {
    if (aiPanelTrigger > 0) setPanelView('chat')
  }, [aiPanelTrigger, setPanelView])

  // Pass the currently opened note as agent context.
  // Both real file tabs and diary virtual pages hold a real .md; the diary
  // keeps its disk path in `filePath` while its tab `id` is the virtual prefix.
  // Memoized on primitives so unrelated renders do not invalidate the
  // relations scan that depends on this object's identity.
  const tabKind = activeTab?.kind
  const tabPath = activeTab?.path
  const tabFilePath = activeTab?.filePath
  const tabContent = activeTab?.content
  const currentNote = useMemo(() => {
    if (!tabPath) return undefined
    // Virtual pages (calendar / lite app / settings) map to no note.
    if (tabKind === 'calendar' || tabKind === 'liteapp' || tabKind === 'settings') return undefined
    const realPath = tabKind === 'diary' ? tabFilePath ?? tabPath : tabPath
    // Tabs restored from older sessions may carry no `kind` at all, so the
    // path decides: only real notes on disk have relations.
    if (!/\.(md|markdown)$/i.test(realPath)) return undefined
    return { path: realPath, content: tabContent ?? '' }
  }, [tabKind, tabPath, tabFilePath, tabContent])

  const segments: { id: RightPanelView; icon: ReactNode; label: string }[] = [
    { id: 'chat', icon: <Icon name="chat" size={14} />, label: t('panel.chat') },
    { id: 'relations', icon: <RelationIcon size={14} />, label: t('panel.relations') },
  ]

  return (
    <div className="right-panel-inner">
      <div className="rp-header">
        <div className="rp-segment" role="tablist" aria-label="Buddy">
          {segments.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={view === s.id}
              aria-label={s.label}
              className={`rp-segment-item${view === s.id ? ' is-active' : ''}`}
              title={s.label}
              onClick={() => setPanelView(s.id)}
            >
              <span className="rp-segment-icon">{s.icon}</span>
              <span className="rp-segment-label">{s.label}</span>
            </button>
          ))}
        </div>
        <span className="rp-header-spacer" />
        {win.visible && (
          <WindowControls
            maximized={win.maximized}
            onMinimize={win.minimize}
            onToggleMaximize={win.toggleMaximize}
            onClose={win.close}
          />
        )}
      </div>
      <div className="rp-content rp-content-chat">
        {/* ChatPanel is only hidden, never unmounted: its messages and active
            conversation live in component state and would be lost otherwise. */}
        <div className="rp-view-slot" hidden={view !== 'chat'}>
          <ChatPanel storageKey={CHAT_STORAGE_KEY} currentNote={currentNote} />
        </div>
        {view === 'relations' && <RelationPanel currentNote={currentNote} />}
      </div>
    </div>
  )
}
