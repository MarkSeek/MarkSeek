// Single source of truth for the active vault root.
//
// Historically the vault path lived as a mutable module binding inside
// server/api.mjs (VAULT_DIR / NOTES_DIR / runtime.vaultDir). That made the
// value impossible to inject from tests and forced agent/config.mjs to import
// api.mjs back, creating a circular dependency.
//
// Keeping the state in this dependency-free leaf module lets every consumer
// (api.mjs, agent/config.mjs, agent/tools.mjs) read one mutable reference
// without pulling in the HTTP layer — and lets tests point the whole backend
// at a temporary directory.
import path from 'node:path'

// Fallback used when app-config.json carries no vaultPath (Web dev + prod).
const DEFAULT_VAULT_DIR = path.resolve(process.cwd(), 'notes')

let vaultDir = DEFAULT_VAULT_DIR

/**
 * @returns {string} absolute path of the currently active vault.
 */
export function getVaultDir() {
  return vaultDir
}

/**
 * Rebind the vault root. Ignores empty values so a bad config never wipes the
 * current location.
 * @param {string} [dir]
 */
export function setVaultDir(dir) {
  if (dir && typeof dir === 'string' && dir.trim()) vaultDir = path.resolve(dir)
}

/**
 * Restore the process-wide fallback (cwd/notes). Tests use this to undo a
 * temporary rebind.
 */
export function resetVaultDir() {
  vaultDir = DEFAULT_VAULT_DIR
}

export { DEFAULT_VAULT_DIR }
