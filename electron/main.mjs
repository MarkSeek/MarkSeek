// MarkSeek Electron main process.
// Strategy (industry-standard): the main process hosts the shared Node backend
// (server/api.mjs) inside an embedded HTTP server and the renderer loads it via
// a same-origin loadURL. All front-end /api/* calls are reused unchanged.
import { app, BrowserWindow, dialog, shell, ipcMain, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { startServer } from './server-adapter.mjs'
// File-backed diagnostics so Electron users (no main-process console) can read
// them in the logs dir. The default writes to cwd/app/logs; whenReady sets it
// to userData/logs (always writable) and the shared backend switches to the
// vault logs dir once the vault is known.
import { setLogDir, logError } from '../server/log.mjs'

// ESM modules have no __dirname; derive it from the module URL.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// True only for a packaged/made app. Electron-forge start (`npm run start:electron`)
// leaves this false, so we serve the project's own `dist/` instead of the bundled one.
const isPackaged = app.isPackaged

// On first launch there is no Vault yet. Unlike the previous behavior (which
// opened a native folder dialog before any window existed), we now mirror the
// `npm run dev` flow: the app boots into the VaultSetupWizard background UI and
// the user picks a folder from there. So this helper only reads a previously
// saved Vault path; it never opens a dialog.
async function resolveVaultPath({ userDataDir }) {
  const { ensureAppConfig } = await import('./server-adapter.mjs')
  const { vaultPath, configDir } = ensureAppConfig({ userDataDir })
  // Return null vaultPath on first launch so the renderer shows the wizard.
  return { vaultPath: vaultPath || null, configDir }
}

// Single-instance lock prevents duplicate launches (and port conflicts).
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
let serverPort = 9000

function createWindow() {
  // No native title bar: the in-app top bars (sidebar-header / editor-tabs-bar /
  // rp-header) act as the title bar. On macOS we keep the system traffic lights
  // via titleBarOverlay; on Windows/Linux the window is fully frameless.
  const windowOptions = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MarkSeek',
    // Use the app icon (derived from public/markseek.svg) in the title bar instead
    // of the default Electron icon.
    icon: path.join(__dirname, '..', 'app', 'assets', 'static', 'markseek.png'),
    backgroundColor: '#f0f2f5',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Electron >= 9 enables the Chromium spell checker by default, which draws
      // red squiggles in the editor. Markdown here is full of code and
      // mixed-language text, so turn it off entirely for this window.
      spellcheck: false,
    },
  }
  // macOS: keep native traffic lights but hide the rest of the title bar.
  if (process.platform === 'darwin') {
    windowOptions.titleBarOverlay = {
      color: '#f0f2f5',
      symbolColor: '#333333',
      height: 38,
    }
  }
  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`)

  // Prevent navigation away from the embedded app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (target.host !== `127.0.0.1:${serverPort}`) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Open/toggle DevTools via Ctrl+Shift+I (Windows/Linux) or Cmd+Shift+I (macOS).
  // A frameless window with no application menu does not get this shortcut for
  // free, so we bind it explicitly to the focused web contents.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Toggle DevTools on Ctrl+Shift+I (Windows/Linux) or Cmd+Shift+I (macOS).
    if (input.key.toLowerCase() === 'i' && (input.control || input.meta) && input.shift) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools()
        } else {
          mainWindow.webContents.openDevTools({ mode: 'detach' })
        }
        event.preventDefault()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Push native maximize/fullscreen state to the renderer so the in-app
  // maximize/restore button icon stays in sync with the real window state.
  const pushWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:state', {
        maximized: mainWindow.isMaximized() || mainWindow.isFullScreen(),
      })
    }
  }
  mainWindow.on('maximize', pushWindowState)
  mainWindow.on('unmaximize', pushWindowState)
  mainWindow.on('enter-full-screen', pushWindowState)
  mainWindow.on('leave-full-screen', pushWindowState)
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    // Windows/Linux: hide the menu bar entirely (no File/Edit/View/Window/Help).
    Menu.setApplicationMenu(null)
    return
  }
  // macOS requires an app menu; keep a minimal template.
  const template = [
    { role: 'appMenu', label: 'MarkSeek' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://github.com/MarkSeek/MarkSeek#readme'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf-8'))
  } catch {
    return null
  }
}

/** Compare dotted version strings; returns > 0 when `a` is newer. */
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * True when `dst` should be (re)written from `src`: it is missing, or it holds
 * an older build of the very same plugin. A folder carrying a different plugin
 * id — or an equal/newer version — is left untouched, so user-installed and
 * user-toggled plugins are never clobbered.
 */
function shouldSeed(src, dst) {
  const srcManifest = readManifest(src)
  if (!srcManifest) return false
  const dstManifest = readManifest(dst)
  if (!dstManifest) return true
  if (dstManifest.id !== srcManifest.id) return false
  return compareVersions(srcManifest.version, dstManifest.version) > 0
}

// Copy built-in plugin folders from `sourceDir` into `destDir` whenever the
// target is missing or older than the shipped build. Shipped plugins therefore
// appear on first launch AND get upgraded on later ones (a stale copy used to
// stay forever, which is how a rebuilt plugin never reached the app).
function seedBuiltinPlugins(destDir, sourceDir) {
  let names = []
  try {
    names = fs.readdirSync(sourceDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    // No built-in plugins available (e.g. dev build without `dist/plugins`).
    return
  }
  for (const name of names) {
    const src = path.join(sourceDir, name)
    const dst = path.join(destDir, name)
    if (!shouldSeed(src, dst)) continue
    // Replace wholesale: merging would keep files the new build dropped.
    fs.rmSync(dst, { recursive: true, force: true })
    copyDir(src, dst)
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dst, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const documents = app.getPath('documents')

  // Mirror backend diagnostics to a file Electron users can open (the main
  // process console is not visible). Write into userData/logs, which is always
  // writable. The shared backend later sets the vault logs dir via initBackend.
  setLogDir(path.join(userData, 'logs'))

  // Resolve the Vault path. On first launch this is null, so the renderer boots
  // into the VaultSetupWizard (same flow as `npm run dev`) instead of a bare
  // native folder dialog. The backend is still initialized so the wizard's
  // background UI and its API (e.g. /api/app-config) work normally.
  const { vaultPath, configDir } = await resolveVaultPath({
    userDataDir: userData,
    documentsDir: documents,
  })

  // Global plugins directory: <userData>/plugins. Seeded from the packaged
  // built-in plugins (production) or the Vite build output (dev) on first run,
  // so the shipped examples appear without the user installing anything.
  const pluginsDir = path.join(userData, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  const builtinPluginsSource = isPackaged
    ? path.join(process.resourcesPath, 'plugins')
    : path.resolve(__dirname, '..', 'dist', 'plugins')
  seedBuiltinPlugins(pluginsDir, builtinPluginsSource)

  // Import the shared backend once and bind it to the desktop locations.
  const apiModule = await import('../server/api.mjs')

  // Detect the OS system proxy (Windows registry today; other platforms rely
  // on env vars handled inside the shared backend). The resolved url is passed
  // to initBackend so the 'system' proxy mode uses it.
  let systemProxyUrl
  try {
    const { detectWindowsSystemProxy, windowsProxyServerToUrl } = await import('../server/proxy.mjs')
    const raw = detectWindowsSystemProxy()
    systemProxyUrl = windowsProxyServerToUrl(raw)
  } catch (e) {
    logError('[markseek][proxy] system proxy detection failed, falling back to direct:', e && e.message)
  }

  const { server, port } = await startServer({
    apiModule,
    distDir: isPackaged
      ? path.join(process.resourcesPath, 'dist')
      : path.resolve(__dirname, '..', 'dist'),
    appConfigDir: configDir,
    // Pass the saved path when present; on first launch this is null so the
    // wizard drives Vault selection and submits it via /api/app-config.
    vaultPath: vaultPath || undefined,
    proxyUrl: systemProxyUrl,
    pluginsDir,
    port: 9000,
  })
  serverPort = port
  app.server = server

  buildMenu()
  createWindow()

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---- IPC: lightweight UI bridge ----
ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('dialog:chooseDirectory', async () => {
  if (!mainWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select MarkSeek Vault Folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled || !filePaths.length) return null
  const chosen = filePaths[0]
  // Return the absolute path + name. Initialization is deferred to the wizard's
  // "confirm" step (setVault) so picking a folder has no side effects and the
  // returned value is always the path the user actually chose.
  const name = chosen.split(/[\\/]/).filter(Boolean).pop() ?? chosen
  return { path: chosen, name }
})

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url === 'string') await shell.openExternal(url)
})

// ---- IPC: window controls (frameless title bar) ----
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.handle('window:isMaximized', () => {
  if (!mainWindow) return false
  return mainWindow.isMaximized() || mainWindow.isFullScreen()
})

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close()
})
