// Mutable runtime state shared by every route module.
//
// Extracted from api.mjs so the routes stay pure request handlers: they read
// the config / vault / proxy through this module instead of closing over a
// local `runtime` object.
//
// The vault root itself still lives in vault.mjs (the single mutable source);
// this module only owns "where is app-config.json" and "what did it say".
import fs from 'node:fs'
import path from 'node:path'

import { getVaultDir, setVaultDir, DEFAULT_VAULT_DIR } from './vault.mjs'
import { readSettings } from './settings.mjs'
import { setAppDataDir } from './appdata.mjs'
import { applyProxyFromSettings } from './proxy.mjs'
import { setLogDir } from './log.mjs'

// Fallback vault used when app-config.json carries no vaultPath.
export const NOTES_DIR = DEFAULT_VAULT_DIR

export const runtime = {
  appConfigPath: path.resolve(process.cwd(), 'app-config.json'),
  config: {},
  vaultDir: NOTES_DIR,
  // Proxy url injected by the Electron main process for the 'system' mode,
  // so the shared backend stays platform-agnostic.
  proxyUrl: undefined,
  // Global plugins directory (Electron userData/plugins), injected through
  // initBackend() so the shared backend stays platform-agnostic. When empty,
  // plugin routes are skipped gracefully.
  pluginsDir: undefined,
}

function loadAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(runtime.appConfigPath, 'utf-8')) || {}
  } catch {
    return {}
  }
}

/** Point the backend at `vaultPath` and mirror its log directory. */
function bindVault(vaultPath) {
  setVaultDir(vaultPath)
  runtime.vaultDir = getVaultDir()
  setLogDir(path.join(runtime.vaultDir, 'logs'))
}

/**
 * Persist app-config.json. Changing the vault re-binds the vault root and the
 * log directory immediately, so no restart is needed.
 * @param {{ vaultPath?: string }} cfg
 */
export function saveAppConfig(cfg) {
  fs.writeFileSync(runtime.appConfigPath, JSON.stringify(cfg, null, 2))
  if (cfg.vaultPath) bindVault(cfg.vaultPath)
}

/**
 * Electron entry point: bind config/vault locations explicitly so the backend
 * does not depend on process.cwd() at module-load time. Safe to call once at
 * startup; keeps the shared backend usable from both Web and Desktop.
 * @param {{ appConfigDir?: string, vaultPath?: string, proxyUrl?: string, pluginsDir?: string }} [opts]
 */
export function initBackend({ appConfigDir, vaultPath, proxyUrl, pluginsDir } = {}) {
  if (appConfigDir) {
    runtime.appConfigPath = path.resolve(appConfigDir, 'app-config.json')
    setAppDataDir(appConfigDir)
  }
  // Reload from the explicit config path so the cached config is fresh.
  runtime.config = loadAppConfig()
  if (vaultPath) {
    runtime.config.vaultPath = vaultPath
    bindVault(vaultPath)
  } else {
    runtime.vaultDir = getVaultDir()
  }
  // The Electron main process may pass an already-detected system proxy url;
  // for the Web backend this is undefined and 'system' mode falls back to env vars.
  if (typeof proxyUrl === 'string') runtime.proxyUrl = proxyUrl
  // Global plugins directory, injected by the Electron main process. The Web
  // backend leaves it undefined and plugin routes degrade to an empty list.
  if (typeof pluginsDir === 'string') runtime.pluginsDir = pluginsDir
  applyProxyFromSettings(readSettings(), runtime.proxyUrl)
}

// Bind the vault once at load time so the Web dev server and the production
// server work without an explicit initBackend() call.
runtime.config = loadAppConfig()
bindVault(runtime.config.vaultPath ? path.resolve(runtime.config.vaultPath) : DEFAULT_VAULT_DIR)
