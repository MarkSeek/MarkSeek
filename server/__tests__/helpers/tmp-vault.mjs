// Shared helpers for backend specs. Not a spec itself (no .test.mjs suffix).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const created = []

/**
 * Create a throwaway vault directory, optionally pre-seeded with files.
 * Tests use REAL directories instead of mocking fs, so the specs cover the
 * actual path/sort/traversal behaviour of the backend.
 * @param {Record<string, string>} [files] relative path -> content
 * @returns {string} absolute path of the temp vault
 */
export function makeTmpVault(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markseek-vault-'))
  created.push(root)
  for (const [rel, content] of Object.entries(files)) {
    writeVaultFile(root, rel, content)
  }
  return root
}

export function writeVaultFile(root, rel, content) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  return full
}

export function readVaultFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8')
}

export function vaultExists(root, rel) {
  return fs.existsSync(path.join(root, rel))
}

/** Remove every temp vault created by this module instance. */
export function cleanupTmpVaults() {
  while (created.length) {
    fs.rmSync(created.pop(), { recursive: true, force: true })
  }
}
