// Proxy helper module shared by the Web backend and the Electron main process.
// Responsibilities:
//   1. Resolve the effective proxy URL from settings (direct / system / custom).
//   2. Validate the proxy URL (http/https only) to avoid SSRF / injection.
//   3. Apply the proxy to undici's global dispatcher so every outbound fetch
//      (AI chat + agent loop) inherits it without per-call changes.
//   4. Detect the Windows system proxy via the registry (Electron main only).
//
// Notes:
//   - Comments are English per project convention.
//   - No secrets (proxy credentials) are ever written to logs.

import { setGlobalDispatcher, ProxyAgent, getGlobalDispatcher } from 'undici'
import { execSync } from 'node:child_process'
import { logError } from './log.mjs'

/**
 * @typedef {'direct' | 'system' | 'custom'} ProxyMode
 */

/**
 * @typedef {Object} ProxySettings
 * @property {ProxyMode} [proxyMode]
 * @property {string} [proxyUrl]
 * @property {ProxyMode} [aiProxyMode]   @deprecated legacy alias, kept for migration
 * @property {string} [aiProxyUrl]       @deprecated legacy alias, kept for migration
 */

/**
 * Normalize the mode string into a valid ProxyMode. Unknown values fall back
 * to 'direct' so old settings keep working unchanged.
 * @param {string} [mode]
 * @returns {ProxyMode}
 */
export function normalizeProxyMode(mode) {
  if (mode === 'system' || mode === 'custom') return mode
  return 'direct'
}

/**
 * Validate a proxy URL: only http/https schemes are accepted.
 * @param {string} [url]
 * @returns {string | undefined} the safe url, or undefined if invalid.
 */
export function validateProxyUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return undefined
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    // A proxy must have a host to be usable.
    if (!u.hostname) return undefined
    return u.toString()
  } catch {
    return undefined
  }
}

/**
 * Read the Windows system proxy from the registry. Returns the proxy server
 * string (e.g. "127.0.0.1:7890" or "http=127.0.0.1:7890;https=...") or
 * undefined when no proxy is configured / not on Windows / query failed.
 * @returns {string | undefined}
 */
export function detectWindowsSystemProxy() {
  if (process.platform !== 'win32') return undefined
  try {
    const regPath =
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const out = execSync(`reg query "${regPath}"`, {
      encoding: 'utf-8',
      windowsHide: true,
    })
    let proxyEnabled = false
    let proxyServer = ''
    for (const line of out.split(/\r?\n/)) {
      const enabledMatch = line.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/)
      if (enabledMatch) {
        proxyEnabled = parseInt(enabledMatch[1], 16) !== 0
      }
      const serverMatch = line.match(/ProxyServer\s+REG_SZ\s+(.+)/)
      if (serverMatch) {
        proxyServer = serverMatch[1].trim()
      }
    }
    if (!proxyEnabled || !proxyServer) return undefined
    return proxyServer
  } catch {
    return undefined
  }
}

/**
 * Convert a raw Windows ProxyServer string into a single URL usable by
 * undici's ProxyAgent. Windows may store either a bare "host:port" or a
 * per-scheme list ("http=...;https=..."). We prefer an https entry, then an
 * http entry, then fall back to the bare host:port.
 * @param {string} raw
 * @returns {string | undefined}
 */
export function windowsProxyServerToUrl(raw) {
  if (!raw) return undefined
  const trimmed = raw.trim()
  // Per-scheme list form.
  if (trimmed.includes('=')) {
    const entries = trimmed.split(';')
    const pick = (scheme) => {
      const e = entries.find((x) => x.trim().startsWith(scheme + '='))
      return e ? e.split('=')[1].trim() : undefined
    }
    const https = pick('https') || pick('http') || pick('ftp')
    if (https) return toProxyUrl(https)
  }
  return toProxyUrl(trimmed)
}

/**
 * Normalize a bare "host:port" or "scheme://host:port" into a proxy URL.
 * @param {string} value
 * @returns {string | undefined}
 */
function toProxyUrl(value) {
  const v = value.trim()
  if (!v) return undefined
  if (/^https?:\/\//i.test(v)) return validateProxyUrl(v)
  // Bare host:port — assume http proxy.
  return validateProxyUrl('http://' + v)
}

/**
 * Resolve the effective proxy URL from settings + an optional runtime-injected
 * system proxy (already detected in the Electron main process).
 *
 * Reads settings.proxyMode / settings.proxyUrl. For backward compatibility the
 * legacy aiProxyMode / aiProxyUrl keys are still honored when the new keys are
 * absent, allowing a smooth settings migration.
 * @param {ProxySettings} settings
 * @param {string} [runtimeProxyUrl] proxy url injected by the main process for
 *   the 'system' mode (so the server module stays platform-agnostic).
 * @returns {string | undefined} validated proxy url, or undefined for direct.
 */
export function resolveProxyUrl(settings = {}, runtimeProxyUrl) {
  const s = settings || {}
  const mode = normalizeProxyMode(
    s.proxyMode !== undefined ? s.proxyMode : s.aiProxyMode,
  )
  if (mode === 'custom') {
    const raw =
      s.proxyUrl !== undefined && s.proxyUrl !== ''
        ? s.proxyUrl
        : (s.aiProxyUrl || '')
    return validateProxyUrl(raw)
  }
  if (mode === 'system') {
    // Prefer the main-process-detected system proxy. On non-Electron or when
    // detection failed, fall back to the HTTPS_PROXY / HTTP_PROXY env vars.
    const injected = validateProxyUrl(runtimeProxyUrl)
    if (injected) return injected
    const env = validateProxyUrl(
      process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy,
    )
    return env
  }
  return undefined
}

/**
 * The dispatcher undici installed before we ever touched it. `getGlobalDispatcher()`
 * returns the CURRENT dispatcher, so re-applying it after a proxy was installed
 * would be a no-op and leave the process stuck on the old proxy. Restoring this
 * captured instance is what actually switches back to a direct connection.
 */
const DIRECT_DISPATCHER = getGlobalDispatcher()

/**
 * Hide proxy credentials before a url reaches a log or an SSE frame.
 * @param {string} [url]
 * @returns {string}
 */
export function maskProxyUrl(url) {
  if (!url) return '(direct)'
  return url.replace(/\/\/.*@/, '//***@')
}

/**
 * Apply a proxy url to the global undici dispatcher. Passing undefined (or an
 * invalid url) restores the default direct dispatcher.
 * @param {string | undefined} proxyUrl
 * @returns {{ applied: boolean, mode: 'direct' | 'proxy', host?: string }}
 */
export function applyProxyDispatcher(proxyUrl) {
  const safe = validateProxyUrl(proxyUrl)
  if (!safe) {
    restoreDirectDispatcher()
    return { applied: false, mode: 'direct' }
  }
  try {
    setGlobalDispatcher(new ProxyAgent(safe))
    const u = new URL(safe)
    return { applied: true, mode: 'proxy', host: u.host }
  } catch (e) {
    restoreDirectDispatcher()
    logError('[markseek][proxy] failed to build ProxyAgent, falling back to DIRECT:', e && e.message)
    return { applied: false, mode: 'direct' }
  }
}

function restoreDirectDispatcher() {
  setGlobalDispatcher(DIRECT_DISPATCHER)
}

/**
 * Convenience: resolve from settings then apply. Used by the server backend
 * on startup / config change. Returns the result of applyProxyDispatcher.
 * @param {ProxySettings} settings
 * @param {string} [runtimeProxyUrl]
 */
export function applyProxyFromSettings(settings = {}, runtimeProxyUrl) {
  return applyProxyDispatcher(resolveProxyUrl(settings, runtimeProxyUrl))
}
