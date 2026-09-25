import { useState, useCallback, useEffect } from 'react'
import './App.css'
import LeftSidebar from './components/LeftSidebar'
import ContentWrapper from './components/ContentWrapper'
import RightPanel from './components/RightPanel'
import ResizableSplitter from './components/ResizableSplitter'
import VaultSetupWizard from './components/VaultSetupWizard'
import SearchDialog from './components/SearchDialog'
import { SHORTCUT_EVENTS } from './hooks/shortcutEvents'
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { SyncProvider } from './hooks/useSync'
import { getVaultKey, readSession, patchSession } from './utils/sessionStorage'
import { setLang } from './i18n'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { getElectron } from './api/electronBridge'
import { mockPlatformFromUrl } from './hooks/useWindowControls'

const LEFT_MIN = 160
const RIGHT_MIN = 160
const RIGHT_DEFAULT = 260

// Set the frameless-window CSS scope attribute as early as possible (module
// load, before React renders) so the `-webkit-app-region: drag` rules are
// already active on first paint. In a packaged Electron build `window.electron`
// is injected by the preload script before this module executes; falling back
// to the `?electron=win/linux` URL param keeps the browser test path working.
// Previously this ran only inside a mount effect, which could miss the preload
// timing window and leave the attribute as 'none' — breaking frameless drag.
;(function applyElectronPlatformAttr() {
  const electron = getElectron()
  const platform = electron?.platform ?? mockPlatformFromUrl() ?? 'none'
  if (!electron && !mockPlatformFromUrl()) {
    // In a packaged Electron build this message means the preload bridge failed
    // to inject (window.electron is missing), which also disables the window
    // controls and frameless dragging. Check that the preload script loads.
    console.error('[App] window.electron is NOT injected — preload likely failed to load. Window controls and drag will be disabled.')
  }
  document.documentElement.setAttribute('data-electron-platform', platform)
})()

function AppLayout() {
  const { ready, values, vaultPath } = useSettings()
  // The search dialog is mounted outside the left sidebar: when the sidebar collapses,
  // the container becomes opacity:0 + overflow:hidden, so if placed inside the sidebar
  // the dialog would render but stay invisible.
  const [searchOpen, setSearchOpen] = useState(false)

  // Listen for the global "open search" event (used by shortcuts, home cards, sidebar/tab buttons)
  useEffect(() => {
    const onOpen = () => setSearchOpen(true)
    document.addEventListener(SHORTCUT_EVENTS.search, onOpen)
    return () => document.removeEventListener(SHORTCUT_EVENTS.search, onOpen)
  }, [])

  // Language takes effect immediately: the module-level currentLang must be synced during render
  // (not in an effect), otherwise child components already rendered with the default 'en' this frame
  // and changing currentLang afterwards won't trigger a re-render.
  const lang = ((values.language as string) || 'en') as 'zh-CN' | 'en'
  setLang(lang)

  // Sync <html lang> / data-lang attributes (DOM side effects go in an effect)
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang)
    document.documentElement.setAttribute('data-lang', lang)
  }, [lang])

  // Mark the platform for frameless-window CSS scoping. 'none' in the browser so
  // the custom title-bar styles never apply outside Electron. A `?electron=win`
  // (or `=linux`) URL param can simulate the platform for browser testing without
  // packaging Electron.
  useEffect(() => {
    const platform = getElectron()?.platform ?? mockPlatformFromUrl() ?? 'none'
    document.documentElement.setAttribute('data-electron-platform', platform)
  }, [])
  // Layout state is rehydrated from the per-vault session snapshot so the
  // workspace reopens with the same panel visibility and widths.
  const vaultKey = getVaultKey(vaultPath)
  // Right panel visibility is driven entirely by the per-vault snapshot: the
  // last explicit state the user left it in. A `null` snapshot means the user
  // never toggled it this session, which resolves to "closed" (false) — NOT the
  // settings default. This keeps the first paint and the authoritative rehydrate
  // effect identical, so a closed panel never flashes open on reload.
  const [rightOpen, setRightOpen] = useState<boolean>(
    () => readSession(vaultKey).layout.rightOpen ?? false,
  )
  // Left panel visibility is rehydrated from the per-vault snapshot, exactly
  // like the other layout fields. The first paint reads the snapshot directly
  // so a previously collapsed sidebar reopens collapsed — no flash to "open".
  // Declared after `vaultKey` above so its lazy initializer can read it.
  const [leftOpen, setLeftOpen] = useState(() => readSession(vaultKey).layout.leftOpen)
  const [leftWidth, setLeftWidth] = useState(() => {
    const w = readSession(vaultKey).layout.leftWidth
    return w != null ? w : Number(values.leftWidth)
  })
  const [rightWidth, setRightWidth] = useState(() => {
    const w = readSession(vaultKey).layout.rightWidth
    return w != null ? w : RIGHT_DEFAULT
  })

  // Theme takes effect immediately: driven by the data-theme attribute for CSS overrides (see App.css).
  // Only applied after settings finish loading (ready), to avoid the default 'warm' theme
  // overriding the dark theme set by index.html's inline script before the first frame (causing a flash).
  useEffect(() => {
    if (!ready) return
    document.documentElement.setAttribute('data-theme', String(values.theme || 'warm'))
  }, [values.theme, ready])

  // Editor font size takes effect immediately
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--editor-font-size',
      `${values.editorFontSize}px`,
    )
    if (values.editorFont) {
      document.documentElement.style.setProperty('--editor-font', String(values.editorFont))
    } else {
      document.documentElement.style.removeProperty('--editor-font')
    }
  }, [values.editorFontSize, values.editorFont])

  // Overall UI zoom takes effect immediately. Layout uses CSS zoom(var(--app-zoom-scale))
  // (see App.css .app-layout), a layout-level zoom where text/SVG/hairlines are re-typeset on the
  // device pixel grid, so nothing gets blurry. The editor's virtual cursor (src/utils/virtualCursor.ts)
  // reads --app-zoom-scale to compensate the zoom, staying aligned with text at any zoom level.
  useEffect(() => {
    if (!ready) return
    const raw = Number(values.appZoom)
    const z = Number.isFinite(raw) ? Math.min(200, Math.max(50, raw)) : 100
    document.documentElement.style.setProperty('--app-zoom', `${z}%`)
    document.documentElement.style.setProperty('--app-zoom-scale', String(z / 100))
  }, [values.appZoom, ready])

  // Reapply the layout snapshot when the vault key changes (e.g. switching
  // vaults at runtime). On the very first mount `vaultPath` is already the real
  // path (AppGate only mounts us after `vaultReady`), so the lazy `useState`
  // initialisers above and this effect read the same authoritative snapshot —
  // no open/close flash on reload. For `rightOpen` a `null` snapshot resolves
  // to "closed" (false), matching the first paint. Widths still fall back to
  // the settings defaults when the snapshot has no recorded value.
  useEffect(() => {
    const snap = readSession(vaultKey).layout
    setLeftOpen(snap.leftOpen)
    setRightOpen(snap.rightOpen ?? false)
    setLeftWidth(snap.leftWidth != null ? snap.leftWidth : Number(values.leftWidth))
    setRightWidth(snap.rightWidth != null ? snap.rightWidth : RIGHT_DEFAULT)
  }, [vaultKey, values.leftWidth])

  const handleLeftResize = useCallback(
    (deltaX: number) => {
      setLeftWidth((prev) => {
        const next = Math.max(LEFT_MIN, prev + deltaX)
        // Width writes are debounced inside patchSession; the state itself
        // still updates per frame so the drag stays smooth.
        patchSession(vaultKey, { layout: { leftWidth: next } })
        return next
      })
    },
    [vaultKey],
  )

  const handleRightResize = useCallback(
    (deltaX: number) => {
      setRightWidth((prev) => {
        const next = Math.max(RIGHT_MIN, prev - deltaX)
        patchSession(vaultKey, { layout: { rightWidth: next } })
        return next
      })
    },
    [vaultKey],
  )

  // Right panel visibility is controlled solely by rightOpen (the AI panel is always enabled)
  const rightVisible = rightOpen === true

  const handleToggleRight = useCallback(() => {
    setRightOpen((v) => {
      const next = !v
      patchSession(vaultKey, { layout: { rightOpen: next } })
      return next
    })
  }, [vaultKey])

  const handleToggleLeft = useCallback(() => {
    setLeftOpen((v) => {
      const next = !v
      patchSession(vaultKey, { layout: { leftOpen: next } })
      return next
    })
  }, [vaultKey])

  // Global keyboard shortcuts (inside WorkspaceProvider so it can read the latest ctx)
  const ctx = useWorkspace()
  useGlobalShortcuts(
    () => ctx,
    { onToggleLeft: handleToggleLeft, onToggleRight: handleToggleRight },
  )

  return (
    <div className="app-layout">
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="app-container">
        <div
          className={`left-sidebar${leftOpen ? '' : ' left-sidebar-collapsed'}`}
          style={leftOpen ? { width: leftWidth, minWidth: leftWidth } : {}}
        >
          <LeftSidebar leftOpen={leftOpen} onToggleLeft={handleToggleLeft} />
        </div>
        <ResizableSplitter onResize={handleLeftResize} hidden={!leftOpen} />
        <ContentWrapper
          leftOpen={leftOpen}
          onToggleLeft={handleToggleLeft}
          rightOpen={rightVisible}
          onToggleRight={handleToggleRight}
        />
        <ResizableSplitter onResize={handleRightResize} hidden={!rightVisible} />
        <div
          className={`right-panel${rightVisible ? '' : ' right-panel-collapsed'}`}
          style={rightVisible ? { width: rightWidth, minWidth: rightWidth, maxWidth: rightWidth } : {}}
        >
          <RightPanel />
        </div>
      </div>
    </div>
  )
}

// Gateway: show the setup wizard until a Vault is configured.
// WorkspaceProvider always wraps the tree so hooks like useWorkspace
// are never evaluated outside a provider (avoids HMR/concurrent crashes).
function AppGate() {
  const { vaultReady, vaultPath } = useSettings()
  // Wait until the vault config has loaded before mounting the workspace.
  // Otherwise AppLayout's first paint would read the '__default__' session
  // snapshot (vaultPath is still null on the first render), then flip to the
  // real vault's snapshot once getAppConfig resolves — causing panels to flash
  // open/closed on every reload. Mounting only after `vaultReady` makes the
  // lazy useState initialisers read the authoritative snapshot from frame one.
  if (!vaultReady) return null
  return (
    <SyncProvider>
      <WorkspaceProvider>
        {vaultPath ? <AppLayout /> : <VaultSetupWizard />}
      </WorkspaceProvider>
    </SyncProvider>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <AppGate />
    </SettingsProvider>
  )
}
