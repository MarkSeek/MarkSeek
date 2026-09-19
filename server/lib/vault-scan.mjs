// Whole-vault scanning: an async concurrency pool plus a one-entry content
// cache.
//
// Shared by the relation analysis (server/relations.mjs) and by note search
// (server/notes-fs.mjs). Both need "read every markdown note in the vault",
// which is the most expensive thing this server does, so there is exactly one
// implementation — and one cache — instead of two that can drift apart.
//
// Two rules keep this module honest:
//   1. `fs/promises` only, never the sync API in a loop. This Node process
//      serves every other API too, so a synchronous scan would stall
//      /api/files/*, the relation panel and the agent.
//   2. No module-level state that cannot be reset — tests point the backend at
//      temporary vaults and must be able to drop a cached scan.
import fs from 'node:fs/promises'
import path from 'node:path'

import { safeJoin } from './vault-path.mjs'

/** How many files are read / stat-ed at the same time. */
export const DEFAULT_CONCURRENCY = 12

/**
 * Every markdown path in the vault, as vault-relative `a/b.md` strings.
 * Mirrors the frontend's `collectMarkdownPaths`: same extensions, dot-files
 * skipped, async so a big tree never blocks the event loop.
 * @param {string} root absolute vault directory
 * @returns {Promise<string[]>}
 */
export async function collectMarkdownFiles(root) {
  const out = []
  const walk = async (dir) => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        out.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }
  await walk(root)
  return out.sort()
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 * Results keep the input order so a caller can zip them back.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Read every markdown note in the vault.
 * A note that cannot be read (permissions, vanished between the walk and the
 * read) is skipped rather than failing the whole scan.
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function readVaultNotes(root, files, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const read = await mapWithConcurrency(files, concurrency, async (rel) => {
    const full = safeJoin(root, rel)
    if (!full) return null
    try {
      return { path: rel, content: await fs.readFile(full, 'utf-8') }
    } catch {
      return null
    }
  })
  return read.filter((n) => n !== null)
}

/**
 * One string describing the current on-disk state of every note.
 * Cheap (stat only) compared with reading the files, and enough to tell whether
 * a cached scan is still usable: any edit changes an mtime or a size.
 */
export async function vaultSnapshot(root, files, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const parts = await mapWithConcurrency(files, concurrency, async (rel) => {
    const full = safeJoin(root, rel)
    if (!full) return `${rel}:missing`
    try {
      const st = await fs.stat(full)
      return `${rel}:${st.mtimeMs}:${st.size}`
    } catch {
      return `${rel}:missing`
    }
  })
  return parts.join('|')
}

// The last full scan. Keyed by BOTH the vault root and the snapshot: tests swap
// the root between specs, and a root-less key would happily serve one vault's
// notes to another.
let cached = null // { root, signature, notes }
let inflight = null // { root, signature, promise }

/** Drop the cached scan and any scan still running. Tests call this. */
export function resetVaultNotesCache() {
  cached = null
  inflight = null
}

/**
 * Every markdown note in the vault, read at most once per on-disk state.
 *
 * Switching notes — or typing another search keyword — inside an unchanged
 * vault therefore costs a few hundred `stat` calls and zero file reads. Two
 * callers that arrive while the first scan is still running share one promise
 * instead of each reading the whole vault.
 *
 * @param {string} root absolute vault directory
 * @param {{ concurrency?: number }} [options]
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function readAllVaultNotes(root, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const files = await collectMarkdownFiles(root)
  const signature = await vaultSnapshot(root, files, { concurrency })

  if (cached && cached.root === root && cached.signature === signature) return cached.notes
  if (inflight && inflight.root === root && inflight.signature === signature) return inflight.promise

  const promise = readVaultNotes(root, files, { concurrency })
    .then((notes) => {
      cached = { root, signature, notes }
      inflight = null
      return notes
    })
    .catch((err) => {
      inflight = null
      throw err
    })
  inflight = { root, signature, promise }
  return promise
}
