// Plugin discovery, enable/disable and static file serving.
//
// Plugins live in the global `pluginsDir` (Electron userData/plugins), injected
// through runtime.pluginsDir. Each plugin is a subfolder containing a
// `plugin.json` manifest and an ESM `entry` file; the enabled state is tracked
// in a `state.json` beside the manifests.
//
//   GET  /api/plugins                  -> list installed plugins + enabled flag
//   POST /api/plugins/:id/enable       -> enable a plugin (persists to state.json)
//   POST /api/plugins/:id/disable      -> disable a plugin
//   GET  /plugins/*                    -> serve plugin static assets (ESM + res)
//
// When runtime.pluginsDir is empty the list answers [] and the static handler
// is skipped, so the rest of the app behaves exactly as before.
import fs from 'node:fs'
import path from 'node:path'

import { runtime } from '../runtime.mjs'
import { safeJoin } from '../notes-fs.mjs'
import { serveFile } from '../http/static.mjs'
import { sendJson, forbidden } from '../http/respond.mjs'

const STATE_FILE = 'state.json'

// Resolve the directory that holds installed plugins. In Electron the main
// process injects an explicit `runtime.pluginsDir` (userData/plugins). In the
// Web dev server there is no main process, so fall back to the built plugin
// output under the project root — this lets `npm run dev` load plugins without
// any extra configuration or a server restart.
function getPluginsDir() {
  if (runtime.pluginsDir) return runtime.pluginsDir
  return path.join(process.cwd(), 'dist', 'plugins')
}

// Asset extensions a plugin may serve; anything else is rejected to avoid
// leaking arbitrary files from the plugins directory.
const ALLOWED_EXT = [
  '.mjs', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.map', '.woff', '.woff2', '.ttf', '.ico',
]

function readState() {
  const dir = getPluginsDir()
  if (!dir) return {}
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8')) || {}
  } catch {
    return {}
  }
}

function writeState(state) {
  const dir = getPluginsDir()
  if (!dir) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('write plugin state failed:', err)
  }
}

function listPlugins() {
  const dir = getPluginsDir()
  if (!dir) return []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const state = readState()
  const plugins = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const manifestPath = path.join(dir, ent.name, 'plugin.json')
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      // A folder without a valid manifest is not a plugin; ignore it.
      continue
    }
    const id = manifest.id || ent.name
    plugins.push({
      id,
      name: manifest.name || id,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      entry: manifest.entry || 'index.mjs',
      contributes: manifest.contributes || {},
      // Translations shipped by the plugin itself; the renderer picks the entry
      // matching the active language and falls back to name/description above.
      i18n: manifest.i18n || {},
      enabled: state[id] !== false,
    })
  }
  return plugins
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {boolean}
 */
export function handlePlugins(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'

  // GET /api/plugins -> list installed plugins with their enabled flag.
  if (pathname === '/api/plugins' && method === 'GET') {
    return sendJson(res, { plugins: listPlugins() })
  }

  // POST /api/plugins/:id/(enable|disable) -> toggle persisted state.
  const toggle = pathname.match(/^\/api\/plugins\/([^/]+)\/(enable|disable)$/)
  if (toggle && method === 'POST') {
    const id = decodeURIComponent(toggle[1])
    const enable = toggle[2] === 'enable'
    const state = readState()
    state[id] = enable
    writeState(state)
    return sendJson(res, { ok: true, id, enabled: enable })
  }

  // GET /plugins/* -> serve a plugin's static assets (ESM entry + resources).
  if (pathname.startsWith('/plugins/') && method === 'GET') {
    const rel = pathname.slice('/plugins/'.length)
    const filePath = safeJoin(getPluginsDir(), rel)
    if (!filePath) return forbidden(res)
    const ext = path.extname(filePath).toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) return forbidden(res)
    return serveFile(res, filePath)
  }

  return false
}
