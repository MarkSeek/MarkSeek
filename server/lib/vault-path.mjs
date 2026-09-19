// Vault path safety — the one rule every filesystem helper shares.
//
// This lives in a leaf module on purpose: both `notes-fs.mjs` (which re-exports
// it for its existing importers) and `lib/vault-scan.mjs` need it, and a leaf
// keeps that dependency free of cycles.
import path from 'node:path'

/**
 * Resolve a vault-relative path, blocking directory traversal.
 * @returns {string | null} the absolute path, or null when it escapes `root`.
 */
export function safeJoin(root, p) {
  if (!root || !p) return null
  const filePath = path.resolve(root, p)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  return filePath
}
