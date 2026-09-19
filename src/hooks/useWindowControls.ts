import { useEffect, useState, useCallback } from 'react'
import { isWinOrLinux, getElectron } from '../api/electronBridge'

// Browser-only mock switch for testing the frameless title-bar scenario without
// packaging Electron. Append `?electron=win` (or `?electron=linux`) to the URL to
// force the custom controls and drag styling on. This is a dev/testing aid and is
// ignored inside real Electron (where the bridge decides everything).
export function mockPlatformFromUrl(): 'win32' | 'linux' | null {
  if (typeof window === 'undefined' || getElectron()) return null
  const p = new URLSearchParams(window.location.search).get('electron')
  if (p === 'win' || p === 'win32') return 'win32'
  if (p === 'linux') return 'linux'
  return null
}

// True when we should render custom window-control buttons: inside real
// Electron on Windows/Linux, or in the browser when the `?electron=win`/`linux`
// mock param is present. macOS (native traffic lights) and plain browser => false.
// Derived synchronously from the bridge so it is stable across re-renders and
// not affected by StrictMode mount/unmount double-invocation (a previous bug
// where the cleanup function flipped `visible` back to false and hid the buttons).
function shouldShowControls(): boolean {
  const mock = mockPlatformFromUrl()
  return isWinOrLinux() || mock !== null
}

// Provides window-control actions and the current maximized state. Only active
// inside Electron on Windows/Linux (where custom buttons are rendered); on
// macOS (native traffic lights) and in the browser, `visible` is false and the
// returned actions are no-ops. A `?electron=win` URL param can simulate the
// Windows/Linux scenario in the browser for quick visual testing.
export function useWindowControls() {
  // `visible` is derived once and never toggled by effect cleanup, so the
  // buttons stay rendered for the whole component lifetime.
  const [visible] = useState(shouldShowControls)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!visible) return
    const electron = getElectron()

    // Real Electron: read native state + subscribe to native changes.
    if (electron) {
      electron.window.isMaximized().then(setMaximized).catch(() => setMaximized(false))
      const unsubscribe = electron.onWindowState((state) => setMaximized(state.maximized))
      return () => unsubscribe()
    }

    // Browser mock mode: no real window ops, just toggle local state so the UI
    // (buttons, icon, drag region) can be exercised.
    return () => {}
  }, [visible])

  const minimize = useCallback(() => {
    const e = getElectron()
    if (e) {
      e.window.minimize()
      return
    }
    // Browser mock: nothing to minimize, just inform.
    console.info('[mock] window.minimize()')
  }, [])

  const toggleMaximize = useCallback(() => {
    const e = getElectron()
    if (e) {
      e.window.toggleMaximize()
      return
    }
    // Browser mock: toggle local state so the icon/button reflect the scenario.
    setMaximized((m) => !m)
  }, [])

  const close = useCallback(() => {
    const e = getElectron()
    if (e) {
      e.window.close()
      return
    }
    // Browser mock: never close the page, just log.
    console.info('[mock] window.close()')
  }, [])

  return { visible, maximized, minimize, toggleMaximize, close }
}
