// Whole-vault relation analysis for the Node backend.
//
// The browser used to do this itself: it fetched the file tree, issued one
// HTTP request per note and then ran the regex scan synchronously on the UI
// thread. Everything expensive now happens here — one request in, one result
// out — so the panel never blocks rendering.
//
// The vault scan itself is not this module's business any more: it lives in
// `lib/vault-scan.mjs`, which note search uses too, so there is one async,
// cached implementation instead of two.
import { analyzeRelations } from '../shared/relations.mjs'
import {
  DEFAULT_CONCURRENCY,
  readAllVaultNotes,
  resetVaultNotesCache,
} from './lib/vault-scan.mjs'

/**
 * The note the caller is looking at.
 * The editor's in-memory text wins: it may hold unsaved edits (a task just
 * ticked, a link just typed) and those are exactly what the panel must show.
 * Only when no content is supplied does the on-disk copy get used.
 */
function resolveCurrentNote(root, currentPath, content, notes) {
  if (typeof content === 'string') return { path: currentPath, content }
  const onDisk = notes.find((n) => n.path === currentPath)
  return onDisk ? { path: onDisk.path, content: onDisk.content } : { path: currentPath, content: '' }
}

/**
 * Analyze one note against the whole vault.
 *
 * @param {string} root absolute vault directory
 * @param {{ path: string, content?: string, concurrency?: number }} options
 * @returns {Promise<{ backLinks: object[], outLinks: object[], tags: object[], tasks: object[] }>}
 */
export async function analyzeRelationsInVault(root, { path: currentPath, content, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const notes = await readAllVaultNotes(root, { concurrency })
  const current = resolveCurrentNote(root, currentPath, content, notes)
  return analyzeRelations(current, notes)
}

/**
 * Drop the cached scan. Tests call this so no state leaks between specs.
 * The cache is shared with note search, so this resets both.
 */
export function resetRelationsCache() {
  resetVaultNotesCache()
}
