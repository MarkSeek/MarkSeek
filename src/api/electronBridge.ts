// Type-safe bridge to the Electron preload API. Exposes only the lightweight
// UI operations handled in the main process (file IO still goes through the
// embedded same-origin backend). Safe to import in the browser: returns
// undefined when not running inside Electron.
export interface ElectronBridge {
  platform: 'win32' | 'darwin' | 'linux'
  getAppVersion(): Promise<string>
  chooseDirectory(): Promise<string | { path: string; name: string } | null>
  openExternal(url: string): Promise<void>
  ready(): void
  // Frameless window controls (Windows/Linux). macOS keeps native traffic lights.
  window: {
    minimize(): void
    toggleMaximize(): void
    isMaximized(): Promise<boolean>
    close(): void
  }
  // Subscribe to native window state (maximized/fullscreen). Returns unsubscribe.
  onWindowState(cb: (state: { maximized: boolean }) => void): () => void
}

declare global {
  interface Window {
    electron?: ElectronBridge
  }
}

export function getElectron(): ElectronBridge | undefined {
  return typeof window !== 'undefined' ? window.electron : undefined
}

export const isElectron = (): boolean => getElectron() !== undefined

// True only inside Electron on Windows or Linux, where we render custom
// window-control buttons (macOS keeps its native traffic lights).
export function isWinOrLinux(): boolean {
  const e = getElectron()
  return !!e && (e.platform === 'win32' || e.platform === 'linux')
}

export interface PickedDirectory {
  // Absolute path on disk (only available inside Electron).
  path?: string
  // Directory name, always available from any picker.
  name: string
}

// Pick a directory the right way for the current runtime:
//   1. Electron -> native folder dialog (real absolute path).
//   2. Browser with File System Access API -> native "select folder" dialog
//      (no "upload" semantics, unlike <input webkitdirectory>).
//   3. Fallback -> trigger the given <input webkitdirectory> element.
// Returns null when the user cancels.
export async function pickDirectory(
  fileInput?: HTMLInputElement | null,
): Promise<PickedDirectory | null> {
  const electron = getElectron()
  if (electron) {
    // The main process returns either a plain absolute path string (older
    // builds) or a { path, name } object (current builds). Normalize both so
    // the caller always receives a usable absolute path.
    const res = await electron.chooseDirectory()
    if (!res) return null
    const path = typeof res === 'string' ? res : res.path
    if (!path) return null
    const name = (typeof res === 'string' ? null : res.name) ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path
    return { path, name }
  }

  // Browser: prefer the native "select folder" dialog (File System Access API).
  // Must be invoked within the click's user activation, so callers should
  // trigger this synchronously from the button's onClick handler.
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>
      }).showDirectoryPicker()
      return { name: handle.name }
    } catch (e) {
      // AbortError = user cancelled. Any other error (e.g. SecurityError on a
      // non-secure context) is surfaced so the UI can inform the user instead
      // of silently falling back to the "upload" styled webkitdirectory input.
      if ((e as DOMException)?.name === 'AbortError') return null
      throw e
    }
  }

  // Last resort: webkitdirectory file input (shows "upload" styled dialog on
  // some platforms, but is the only remaining option).
  fileInput?.click()
  return null
}
