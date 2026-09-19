// Electron backend adapter: hosts the shared MarkSeek API (server/api.mjs)
// inside the Electron main process, plus serves the Vite-built static app.
//
// Design notes:
// - server/api.mjs keeps its Web backend untouched. We bind it explicitly to the
//   desktop config/vault via its `initBackend` hook (no chdir / cwd reliance).
// - On first run we auto-initialize a default Vault under the user's Documents
//   directory (MarkSeek/) and persist its path into userData/app-config.json.
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createDefaultSettings } from '../server/settings-schema.mjs'
import { setAppDataDir, settingsDir, vaultSlug } from '../server/appdata.mjs'
import { serveFile } from '../server/http/static.mjs'
import { monthDirPath } from '../shared/journal-layout.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_NAME = 'MarkSeek'

// Month folder seeded into a brand-new vault, so the file tree is not empty.
const SEED_MONTH = '2026-08'

/**
 * Read app-config.json from userData. Does NOT auto-create a Vault; first-launch
 * Vault selection is handled interactively in the main process (dialog), so the
 * user explicitly chooses (or accepts a default for) the Vault folder.
 * @param {object} opts
 * @param {string} opts.userDataDir  Electron app.getPath('userData')
 * @returns {{ vaultPath: string|null, configDir: string }}
 */
export function ensureAppConfig({ userDataDir }) {
  const configDir = userDataDir
  const configPath = path.join(configDir, 'app-config.json')
  let cfg = {}
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {}
  } catch {
    cfg = {}
  }

  // Only trust an existing, valid Vault path. Otherwise the caller must prompt
  // the user to pick a folder (first launch) before initializing anything.
  const vaultPath = cfg.vaultPath && safeIsDir(cfg.vaultPath) ? cfg.vaultPath : null
  return { vaultPath, configDir }
}

/**
 * Suggest a sensible default Vault location for the first-launch dialog.
 * @param {object} opts
 * @param {string} opts.documentsDir Electron app.getPath('documents')
 * @returns {string}
 */
export function suggestVaultPath({ documentsDir }) {
  return path.join(documentsDir, APP_NAME)
}

/**
 * Initialize a Vault at the user-chosen (or accepted-default) path and persist
 * it into app-config.json. Creates the folder tree and seed files if absent.
 * @param {string} vaultPath  Absolute path chosen by the user.
 * @param {object} opts
 * @param {string} opts.configDir Directory holding app-config.json (userData).
 * @returns {{ vaultPath: string, configDir: string }}
 */
export function initVault(vaultPath, { configDir }) {
  const resolved = path.resolve(vaultPath)
  fs.mkdirSync(resolved, { recursive: true })
  // Seed a minimal default structure so the tree is non-empty on first run.
  const journalsDir = path.join(resolved, monthDirPath(SEED_MONTH))
  fs.mkdirSync(journalsDir, { recursive: true })
  const readmePath = path.join(resolved, 'README.md')
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      `# ${APP_NAME} Vault\n\nThis is your local knowledge base. All notes are stored as Markdown files.\n`,
      'utf-8',
    )
  }
  // Default note-level settings live OUTSIDE the vault (in the app-data dir) so
  // they are never scanned as a note and never expose keys inside the user's
  // notes. Any legacy in-vault settings.json is migrated out and removed.
  setAppDataDir(configDir)
  const sp = path.join(settingsDir(), `${vaultSlug(resolved)}.json`)
  if (!fs.existsSync(sp)) {
    const legacy = path.join(resolved, 'settings.json')
    let initial
    if (fs.existsSync(legacy)) {
      try {
        initial = JSON.parse(fs.readFileSync(legacy, 'utf-8'))
      } catch {
        initial = createDefaultSettings()
      }
      try {
        fs.unlinkSync(legacy)
      } catch {
        // keep the legacy copy if it cannot be removed; the migrated file is authoritative
      }
    } else {
      initial = createDefaultSettings()
    }
    fs.mkdirSync(path.dirname(sp), { recursive: true })
    fs.writeFileSync(sp, JSON.stringify(initial, null, 2), 'utf-8')
  }
  const configPath = path.join(configDir, 'app-config.json')
  let cfg = {}
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {}
  } catch {
    cfg = {}
  }
  cfg.vaultPath = resolved
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  return { vaultPath: resolved, configDir }
}

function safeIsDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Serve one built asset, logging the reason on failure (no visible console). */
function serveStatic(res, filePath) {
  return serveFile(res, filePath, {
    onError: (e) => console.error('[server-adapter] static serve failed:', e && e.message),
  })
}

/**
 * Start the embedded HTTP server. The caller imports server/api.mjs once and
 * passes the module, plus the resolved desktop config dir / vault path, so the
 * backend is bound explicitly (no chdir, single module instance).
 * @param {object} opts
 * @param {object} opts.apiModule     Imported server/api.mjs module
 * @param {string} opts.distDir      Absolute path to Vite build output (dist/)
 * @param {string} opts.appConfigDir Directory holding app-config.json (userData)
 * @param {string} opts.vaultPath    Absolute path to the chosen Vault
 * @param {string} [opts.proxyUrl]   System-detected proxy url for the 'system'
 *   proxy mode, injected into the backend's global dispatcher.
 * @param {string} [opts.pluginsDir] Absolute path to the global plugins dir
 *   (userData/plugins), injected into the backend so it can discover/serve them.
 * @param {number} [opts.port]       Preferred port (falls back from here)
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
export function startServer({ apiModule, distDir, appConfigDir, vaultPath, proxyUrl, pluginsDir, port = 9000 }) {
  const { handleApi, initBackend } = apiModule
  // Explicitly point the backend at the desktop config/vault dirs so it no
  // longer relies on process.cwd() timing or module-load caching.
  if (initBackend && typeof initBackend === 'function') {
    initBackend({ appConfigDir, vaultPath, proxyUrl, pluginsDir })
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')

      const handled = await handleApi(req, res, url)
      if (handled === true) return

      const pathname = url.pathname
      const distPath = path.join(distDir, pathname === '/' ? 'index.html' : pathname)
      if (fs.existsSync(distPath) && fs.statSync(distPath).isFile()) {
        return serveStatic(res, distPath)
      }
      // SPA fallback
      serveStatic(res, path.join(distDir, 'index.html'))
    })

    const tryListen = (p) => {
      server.listen(p, '127.0.0.1', () => {
        resolve({ server, port: p })
      })
    }
    server.on('error', (err) => {
      // Port in use: try the next one (up to +10).
      if (err.code === 'EADDRINUSE' && port < 9010) {
        tryListen(port + 1)
      } else {
        reject(err)
      }
    })
    tryListen(port)
  })
}
