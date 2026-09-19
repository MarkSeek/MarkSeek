// Preload script: exposes a minimal, controlled bridge to the renderer.
// Written as CommonJS (.cjs) because Electron loads preload scripts most
// reliably as CJS — this avoids asar/ESM resolution quirks that can cause the
// bridge to silently fail to inject inside packaged builds.
const { contextBridge, ipcRenderer } = require('electron')

const bridge = {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  // Notify main process that the renderer finished its first paint (optional).
  ready: () => ipcRenderer.send('app:ready'),
  // Frameless window controls (Windows/Linux). macOS keeps native traffic lights.
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    close: () => ipcRenderer.send('window:close'),
  },
  // Subscribe to native window state changes (maximized/fullscreen) pushed from
  // the main process. Returns an unsubscribe function.
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  },
}

contextBridge.exposeInMainWorld('electron', bridge)
