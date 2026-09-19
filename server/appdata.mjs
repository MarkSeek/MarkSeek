// Application-level data directory.
//
// Settings now live OUTSIDE the vault (under this dir) so they are never scanned
// as notes and never expose API keys inside the user's note folder. The Web
// server defaults this to process.cwd(); Electron overrides it with userData.
import path from 'node:path'

let _dir = process.cwd()

/** Override the application data directory (Electron: userData dir). */
export function setAppDataDir(dir) {
  if (dir) _dir = dir
}

/** Absolute path of the application data directory. */
export function getAppDataDir() {
  return _dir
}

/**
 * Stable, filename-safe slug for a vault path. Encoding the resolved absolute
 * path as hex is a bijection, so distinct vaults never map to the same slug and
 * each vault keeps its own settings file.
 * @param {string} absVaultPath
 * @returns {string}
 */
export function vaultSlug(absVaultPath) {
  return Buffer.from(path.resolve(absVaultPath)).toString('hex')
}

/** Directory holding the per-vault settings files. */
export function settingsDir() {
  return path.join(getAppDataDir(), '.markseek', 'vaults')
}
