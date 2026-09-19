// Settings-write routes: application config (vault location), AI provider
// config, and network proxy config.
//
// The two `apply*Config` helpers below are pure settings mergers: they coerce
// an untrusted payload so a malformed request can never poison settings.json.
// The resolver in ai/provider.mjs relies on the resulting types.
import fs from 'node:fs'
import path from 'node:path'

import { runtime, saveAppConfig } from '../runtime.mjs'
import { readSettings, updateSettings, readSettingsRaw, writeSettingsRaw } from '../settings.mjs'
import { validateProxyUrl, applyProxyFromSettings } from '../proxy.mjs'
import { sendJson, badRequest } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'
import { publicSettings, sanitizeProvider } from '../settings-schema.mjs'

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Merge an AI provider payload into settings.
 *
 * Two shapes are accepted: the multi-provider structure (VS Code chat.ml
 * style) and the legacy flat fields, which are still written by older clients.
 * Every field goes through the coercion table in settings-schema.mjs, so a
 * malformed request can never poison settings.json — and adding a field means
 * editing that table, not this function.
 * @param {Record<string, any>} settings
 * @param {Record<string, any>} body
 * @returns {Record<string, any>} the merged settings (mutated in place)
 */
function applyAiConfig(settings, { providers, activeProvider, apiKey, baseURL, model, models }) {
  if (Array.isArray(providers)) {
    const clean = providers.filter(isObject).map(sanitizeProvider)
    settings.aiProviders = clean
    // Pin aiActiveProvider to an id that actually exists.
    const ids = clean.map((p) => p.id)
    if (typeof activeProvider === 'string') {
      settings.aiActiveProvider = ids.includes(activeProvider) ? activeProvider : (ids[0] || '')
    } else if (clean.length && !ids.includes(settings.aiActiveProvider)) {
      settings.aiActiveProvider = ids[0]
    }
    return settings
  }

  // Legacy flat fields (a single provider written in one shot).
  if (typeof apiKey === 'string') settings.aiApiKey = apiKey
  if (typeof baseURL === 'string') settings.aiBaseURL = baseURL
  if (typeof model === 'string') settings.aiModel = model
  if (Array.isArray(models)) {
    settings.aiModels = models.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim())
  }
  return settings
}

/**
 * Merge a network proxy payload into settings.
 * @param {Record<string, any>} settings
 * @param {{ mode?: string, proxyUrl?: string }} body
 * @returns {Record<string, any>} the merged settings (mutated in place)
 */
function applyProxyConfig(settings, { mode, proxyUrl }) {
  // Network proxy mode (direct / system / custom). Default 'direct'.
  if (typeof mode === 'string') {
    settings.proxyMode = mode === 'system' || mode === 'custom' ? mode : 'direct'
  } else if (typeof settings.proxyMode !== 'string') {
    settings.proxyMode = 'direct'
  }
  if (typeof proxyUrl === 'string') {
    settings.proxyUrl = validateProxyUrl(proxyUrl) || proxyUrl
  }
  return settings
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleConfig(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'

  // GET /api/settings/public —— the secret-free subset of settings.json.
  //
  // Reads the first-paint script in index.html, which runs synchronously before
  // React mounts and therefore before any module or session exists. Routing it
  // through the API (instead of the old `/notes/settings.json` static read) is
  // what makes it work identically on all three hosts — the Electron adapter
  // never served that path, so the desktop app silently lost its saved theme
  // and zoom on every cold start.
  if (pathname === '/api/settings/public' && method === 'GET') {
    return sendJson(res, publicSettings(readSettings()))
  }

  // GET /api/app-config —— read application-level config (vault path)
  if (pathname === '/api/app-config' && method === 'GET') {
    return sendJson(res, runtime.config)
  }

  // POST /api/app-config —— persist application-level config (vault path)
  if (pathname === '/api/app-config' && method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    if (typeof body.vaultPath !== 'string' || !body.vaultPath.trim()) {
      return badRequest(res, 'invalid vaultPath')
    }
    const cfg = { vaultPath: body.vaultPath.trim() }
    saveAppConfig(cfg)
    Object.assign(runtime.config, cfg)
    return sendJson(res, { ok: true })
  }

  // POST /api/vault/probe —— check whether a path exists and is a directory
  if (pathname === '/api/vault/probe' && method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    const p = body && typeof body.path === 'string' ? body.path.trim() : ''
    if (!p) return sendJson(res, { exists: false })
    try {
      return sendJson(res, { exists: fs.statSync(path.resolve(p)).isDirectory() })
    } catch {
      return sendJson(res, { exists: false })
    }
  }

  // POST /api/ai/config -- AI configuration (multi-provider) is written by the backend to notes/settings.json
  if (pathname === '/api/ai/config' && method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    const { providers, activeProvider, apiKey, baseURL, model, models } = body || {}
    updateSettings((settings) =>
      applyAiConfig(settings, { providers, activeProvider, apiKey, baseURL, model, models }),
    )
    return sendJson(res, { ok: true })
  }

  // POST /api/proxy/config -- network proxy configuration (direct / system proxy / custom) is written by the backend to
  // notes/settings.json and applied immediately to the global dispatcher (affects all outbound fetch, not only AI).
  if (pathname === '/api/proxy/config' && method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    // validateProxyUrl() rejects anything that is not http/https, so a bad
    // custom url is refused instead of being silently persisted.
    const settings = applyProxyConfig(readSettings(), body || {})
    if (
      typeof body.proxyUrl === 'string' &&
      settings.proxyMode === 'custom' &&
      !validateProxyUrl(body.proxyUrl)
    ) {
      return badRequest(res, 'invalid proxy url (only http/https supported)')
    }
    updateSettings(() => settings)
    // Re-apply the proxy after config change so a mode switch takes effect
    // without a restart (Electron keeps runtime.proxyUrl for the 'system' mode).
    applyProxyFromSettings(settings, runtime.proxyUrl)
    return sendJson(res, { ok: true })
  }

  // GET /api/settings —— full settings document (trusted client-only endpoint).
  //
  // Settings are no longer stored as a note file inside the vault; they live in
  // the application data dir (one file per vault). The client must load/save
  // through this endpoint rather than reading <vault>/settings.json directly.
  if (pathname === '/api/settings' && method === 'GET') {
    return sendJson(res, readSettings())
  }

  // PUT /api/settings —— merge a partial settings object into the stored document
  // (theme, zoom, image rules, …). AI/proxy fields have dedicated endpoints and
  // should be routed there, but a partial merge here is harmless.
  if (pathname === '/api/settings' && method === 'PUT') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    if (!isObject(body)) return badRequest(res, 'invalid body')
    updateSettings((settings) => Object.assign(settings, body))
    return sendJson(res, { ok: true })
  }

  // GET /api/settings/raw —— the raw on-disk text of settings.json so the user
  // can edit the file manually in a text viewer.
  if (pathname === '/api/settings/raw' && method === 'GET') {
    return sendJson(res, { content: readSettingsRaw() })
  }

  // PUT /api/settings/raw —— replace settings.json with text edited by the user.
  // The payload is validated as JSON, so a malformed edit is rejected and the
  // stored file is left untouched.
  if (pathname === '/api/settings/raw' && method === 'PUT') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    if (typeof body.content !== 'string') return badRequest(res, 'invalid body')
    try {
      writeSettingsRaw(body.content)
    } catch {
      return badRequest(res, 'invalid json')
    }
    return sendJson(res, { ok: true })
  }

  return false
}
