// Vault-level settings read/write helpers.
//
// This is the only module that knows the file name and its JSON encoding, so
// routes and resolvers never repeat the "try/catch around JSON.parse" dance.
// The vault root is always an explicit argument (defaulting to the active
// vault) so specs can point it at a temporary directory.
//
// IMPORTANT: by default settings now live OUTSIDE the vault, under the
// application data dir (one file per vault, keyed by a stable slug). That keeps
// the file out of the note tree and out of any cloud-sync of the user's notes,
// so API keys never ride along with the markdown. A legacy in-vault
// `settings.json` is migrated out automatically on first read.
import fs from 'node:fs'
import path from 'node:path'

// Read-only accessor for the active vault root, imported lazily through this
// module to keep `vault.mjs` the single mutable source of the vault path.
import { getVaultDir } from './vault.mjs'
import { getAppDataDir, settingsDir, vaultSlug } from './appdata.mjs'

export const SETTINGS_FILE = 'settings.json'

/**
 * Absolute path of the settings file for `root`.
 *
 * - Explicit `root`: legacy in-vault location `<root>/settings.json`. Kept for
 *   backwards compatibility and for specs that read a specific vault on disk.
 * - Default (no `root`): a per-vault file under the application data dir, keyed
 *   by the vault slug, so settings live OUTSIDE the vault — they are never
 *   scanned as a note and never expose API keys inside the user's note folder.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function settingsPath(root) {
  if (root !== undefined) return path.join(root, SETTINGS_FILE)
  return path.join(settingsDir(), `${vaultSlug(getVaultDir())}.json`)
}

/** Legacy in-vault settings path; only kept to migrate away from it. */
function legacySettingsPath() {
  return path.join(getVaultDir(), SETTINGS_FILE)
}

/**
 * One-time migration: if the per-vault app-data file is missing but an old
 * in-vault `settings.json` exists, move it out of the vault. The legacy copy is
 * removed so it stops showing up in the note tree and stops being synced with
 * the user's notes.
 */
function migrateIfNeeded() {
  const target = settingsPath()
  if (fs.existsSync(target)) return
  const legacy = legacySettingsPath()
  if (!fs.existsSync(legacy)) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(legacy, target)
  try {
    fs.unlinkSync(legacy)
  } catch {
    // The new file is already authoritative; ignore a failure to delete the
    // legacy copy (e.g. a read-only vault).
  }
}

/**
 * Read settings. Missing / unreadable / malformed files all resolve to an
 * empty object so callers can safely read any key. With no `root` the per-vault
 * app-data file is used (and a legacy in-vault file is migrated out first).
 * @param {string} [root]
 * @returns {Record<string, any>}
 */
export function readSettings(root) {
  if (root === undefined) migrateIfNeeded()
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(root), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Overwrite settings.
 * @param {Record<string, any>} settings
 * @param {string} [root]
 */
export function writeSettings(settings, root) {
  const p = settingsPath(root)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Read-modify-write in one step. Every route that persists settings merges into
 * the existing object (never replaces it), so this is the shape they all want.
 * @param {(settings: Record<string, any>) => Record<string, any> | void} mutate
 *   receives the current settings; may mutate it in place or return a new object.
 * @param {string} [root]
 * @returns {Record<string, any>} the persisted settings
 */
export function updateSettings(mutate, root) {
  const settings = readSettings(root)
  const next = mutate(settings) || settings
  writeSettings(next, root)
  return next
}

/**
 * Read the raw, on-disk text of the per-vault settings file so the user can
 * edit it manually (the "edit settings.json" feature). Falls back to a
 * pretty-printed default document when the file does not exist yet.
 * @returns {string}
 */
export function readSettingsRaw() {
  try {
    migrateIfNeeded()
  } catch {
    // Migration is best-effort; a missing file is handled below.
  }
  const p = settingsPath()
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  return JSON.stringify(readSettings(), null, 2)
}

/**
 * Overwrite the per-vault settings file with arbitrary text edited by the user.
 * The payload is validated as JSON first, so a malformed manual edit can never
 * corrupt the on-disk settings file.
 * @param {string} text
 */
export function writeSettingsRaw(text) {
  JSON.parse(text) // throws on invalid JSON — surfaced to the caller
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text, 'utf-8')
}
