// Per-file Git history helpers, implemented standalone (outside the SyncProvider
// interface) so they can be mounted without touching the provider registry.
//
// Both functions take the vault directory `dir` plus the provider `config`
// (kept for signature parity with the provider methods), and the repo-relative
// `filepath`. They are pure isomorphic-git and need no system git binary.
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DEPTH = 50

/**
 * Normalize an incoming path (possibly absolute, OS-specific separators) to a
 * repo-relative, forward-slash path — what isomorphic-git expects everywhere.
 */
function toRepoPath(dir, filepath) {
  let rel = filepath
  if (path.isAbsolute(filepath)) rel = path.relative(dir, filepath)
  return rel.split(path.sep).join('/')
}

/**
 * Commit history of a single file (git log filtered by filepath).
 * @returns {Promise<{ initialized: boolean, history: Array<{
 *   hash: string, shortHash: string, message: string,
 *   author: string, email: string, date: string
 * }> }>}
 */
export async function getFileHistory(dir, config, filepath, opts = {}) {
  // Only a real repo has a history to walk.
  try {
    const stat = fs.statSync(path.join(dir, '.git'))
    if (!stat.isDirectory() && !stat.isFile()) {
      return { initialized: false, history: [] }
    }
  } catch {
    return { initialized: false, history: [] }
  }
  const repoPath = toRepoPath(dir, filepath)
  const depth = opts?.depth ?? DEFAULT_DEPTH
  try {
    const commits = await git.log({ fs, dir, filepath: repoPath, depth })
    const history = commits.map((c) => ({
      hash: c.oid,
      shortHash: c.oid.slice(0, 7),
      // Keep only the first line of the subject for the list row.
      message: String(c.commit.message || '').trim().split('\n')[0] || '(no message)',
      author: c.commit.author?.name || '',
      email: c.commit.author?.email || '',
      // author.timestamp is seconds since the Unix epoch.
      date: new Date((c.commit.author?.timestamp || 0) * 1000).toISOString(),
    }))
    return { initialized: true, history }
  } catch {
    // File absent at HEAD / not yet tracked / unreadable — not an error.
    return { initialized: true, history: [] }
  }
}

/**
 * Read a single file's content at a given commit.
 * @returns {Promise<{ content: string }>}
 */
export async function getFileAtCommit(dir, config, filepath, oid) {
  const repoPath = toRepoPath(dir, filepath)
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath: repoPath })
    return { content: Buffer.from(blob).toString('utf8') }
  } catch {
    // Renamed/removed at this commit, or non-UTF8 content: yield empty so the
    // preview never crashes.
    return { content: '' }
  }
}
