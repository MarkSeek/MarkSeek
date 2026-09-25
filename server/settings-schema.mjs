// Canonical settings defaults and field coercion for <vault>/settings.json.
//
// Four places used to describe the same object:
//   * routes/config.mjs      — hand-written coercion for every AI field;
//   * electron/server-adapter.mjs — its own DEFAULT_SETTINGS (already drifted:
//                              theme 'light' vs the Web default 'warm');
//   * src/config/settingsSchema.ts — the UI schema (drives both the settings
//                              view and the defaults the browser writes back).
//
// This module is the server-side source of truth for the first two. The third
// keeps owning the labels/i18n, and `server/__tests__/settings-contract.test.mjs`
// asserts the two sides still agree on key names, default values and the
// provider/model field contract.

/** Theme ids the CSS (and the first-paint script) actually implement. */
export const THEMES = ['warm', 'light', 'dark']

/**
 * Defaults for every key the backend knows about. Read-only on purpose; use
 * `createDefaultSettings()` for a value you intend to mutate or persist.
 */
export const SETTINGS_DEFAULTS = Object.freeze({
  theme: 'warm',
  language: 'en',
  editorFontSize: 14,
  editorFont: '',
  // Interface zoom as an explicit percentage (50–200); never auto-derived.
  appZoom: 100,
  aiProviders: [],
  aiActiveProvider: '',
  proxyMode: 'direct',
  proxyUrl: '',
  leftWidth: 260,
  rightOpenDefault: true,
  autoSave: true,
  autoSaveDelay: 1,
  tabSize: 2,
  // Attachments: the folder used when no save rule matches, plus the ordered
  // list of "note path regex -> folder" rules. Resolved by image-rules.mjs.
  imageDefaultDir: 'images',
  imageRules: [],
  // Sync configuration. Provider-agnostic top-level flags, with each backend's
  // private config nested under its provider id (e.g. `git`). The sync layer
  // (server/sync/*) reads this; credentials never leave the server.
  sync: {
    provider: 'git',
    autoSync: false,
    autoSyncMode: 'interval',
    autoSyncInterval: 15,
    autoSyncDelay: 30,
    git: { remoteUrl: '', branch: 'main', token: '', username: '' },
  },
})

/**
 * A fresh, mutable settings object. Every array is re-created so pushing into
 * one seed can never leak into another.
 * @returns {Record<string, any>}
 */
export function createDefaultSettings() {
  return { ...SETTINGS_DEFAULTS, aiProviders: [], imageRules: [] }
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const bool = (v) => Boolean(v)
// Optional numbers: absent rather than null, so JSON.stringify drops the key
// and an unset limit is never sent to a provider as 0.
const optNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Field contract for one model entry. The key order is the persisted order.
 * @type {Record<string, (v: any) => any>}
 */
export const MODEL_FIELDS = {
  id: (v) => str(v),
  name: (v) => str(v),
  url: (v) => str(v),
  toolCalling: bool,
  vision: bool,
  maxInputTokens: optNum,
  maxOutputTokens: optNum,
}

/**
 * Field contract for one AI provider. The key order is the persisted order.
 * @type {Record<string, (v: any) => any>}
 */
export const PROVIDER_FIELDS = {
  id: (v) => str(v),
  name: (v) => str(v, 'Untitled'),
  vendor: (v) => str(v, 'customendpoint'),
  apiKey: (v) => str(v),
  apiType: (v) => str(v, 'chat-completions'),
  baseURL: (v) => str(v),
  model: (v) => str(v),
  models: (v) => (Array.isArray(v) ? v.filter(isObject).map(sanitizeModel) : []),
}

/**
 * Coerce an untrusted model payload into the persisted shape.
 * @returns {Record<string, any>}
 */
export function sanitizeModel(raw) {
  const out = {}
  for (const key of Object.keys(MODEL_FIELDS)) out[key] = MODEL_FIELDS[key](raw[key])
  return out
}

/**
 * Coerce an untrusted provider payload into the persisted shape.
 * @returns {Record<string, any>}
 */
export function sanitizeProvider(raw) {
  const out = {}
  for (const key of Object.keys(PROVIDER_FIELDS)) out[key] = PROVIDER_FIELDS[key](raw[key])
  return out
}

/**
 * Project settings onto the subset that may be handed to an unauthenticated
 * browser: every API key is removed.
 *
 * `/api/settings/public` answers the first-paint script in index.html, which
 * runs before React mounts — and before anything about the session is known.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function publicSettings(settings) {
  const out = { ...settings }
  delete out.aiApiKey
  out.aiProviders = (Array.isArray(settings.aiProviders) ? settings.aiProviders : []).map(
    ({ apiKey, ...rest }) => rest,
  )
  // Sync credentials (git token/username) must never reach the unauthenticated
  // first-paint script, exactly like AI API keys.
  if (out.sync && out.sync.git) {
    out.sync = { ...out.sync, git: { ...out.sync.git } }
    delete out.sync.git.token
    delete out.sync.git.username
  }
  return out
}
