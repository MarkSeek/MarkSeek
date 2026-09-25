// Git sync provider — pure JavaScript, powered by isomorphic-git (no system
// git binary required). Works identically in Node and Electron.
//
// Status semantics: isomorphic-git's statusMatrix returns rows of
// [filepath, HEAD, WORKDIR, STAGE], where 0 = absent, 1 = present & unmodified,
// 2 = modified. A fully clean repo is therefore all-[1,1,1] rows.
import * as git from 'isomorphic-git'
// Custom undici-backed HTTP client: routes git traffic through the global
// dispatcher so it honors the unified proxy settings (see ./http-client.mjs).
import http from './http-client.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { SyncProvider } from './types.mjs'

const DEFAULT_BRANCH = 'main'

/**
 * Build the auth callback for HTTPS remotes. Token-based auth
 * (GitHub / GitLab / Gitee / …) uses the token as the password; the username
 * is cosmetic for most hosts, so we fall back to 'git' when only a token is set.
 * @param {{ token?: string, username?: string }} config
 */
function makeAuth(config) {
  const token = config?.token || ''
  const username = config?.username || (token ? 'git' : '')
  if (!token && !username) return undefined
  return () => ({ username: username || 'git', password: token })
}

/** Commit author; provider config may override the defaults. */
function author(config) {
  return {
    name: config?.authorName || 'MarkSeek',
    email: config?.authorEmail || 'markseek@local',
  }
}

export class GitSyncProvider extends SyncProvider {
  id = 'git'
  label = 'Git'

  isAvailable() {
    // isomorphic-git has no native dependencies, so git is always available.
    return true
  }

  async init(dir, config) {
    await git.init({ fs, dir, defaultBranch: config?.branch || DEFAULT_BRANCH })
  }

  async getStatus(dir, config) {
    let initialized = false
    try {
      // Treat the vault as a repo only when it owns a .git entry (file or dir),
      // not when some ancestor happens to be one.
      const stat = fs.statSync(path.join(dir, '.git'))
      initialized = stat.isDirectory() || stat.isFile()
    } catch {
      initialized = false
    }
    if (!initialized) {
      return { available: true, initialized: false, state: 'no-repo' }
    }
    try {
      const branch = (await git.currentBranch({ fs, dir })) || undefined
      const matrix = await git.statusMatrix({ fs, dir })
      let dirty = 0
      let untracked = 0
      for (const [, h, w, s] of matrix) {
        if (h === 1 && w === 1 && s === 1) continue
        dirty++
        if (h === 0 && s === 0) untracked++
      }

      let ahead = 0
      let behind = 0
      if (config?.remoteUrl && branch) {
        try {
          const res = await git.aheadBehind({ fs, dir, remote: 'origin', ref: branch })
          ahead = res.ahead
          behind = res.behind
        } catch {
          // Remote not fetched yet, or no upstream — treat as 0/0.
        }
      }

      let lastCommit
      try {
        const log = await git.log({ fs, dir, depth: 1 })
        if (log && log[0]) {
          lastCommit = {
            hash: log[0].oid,
            message: log[0].commit.message,
            date: new Date(log[0].commit.author.timestamp * 1000).toISOString(),
          }
        }
      } catch {
        // No commits yet.
      }

      let state
      if (ahead > 0 && behind > 0) state = 'diverged'
      else if (ahead > 0) state = 'ahead'
      else if (behind > 0) state = 'behind'
      else if (dirty > 0) state = 'dirty'
      else state = 'clean'

      return {
        available: true,
        initialized: true,
        state,
        branch,
        ahead,
        behind,
        dirty,
        untracked,
        lastCommit,
      }
    } catch (e) {
      return {
        available: true,
        initialized: true,
        state: 'error',
        error: String(e?.message || e),
      }
    }
  }

  async commit(dir, config, message) {
    // Prefer an explicit message; otherwise fall back to the configured default
    // (settings.git.commitMessage), then a hard-coded constant. Never a timestamp.
    const msg =
      message && message.trim()
        ? message.trim()
        : config?.commitMessage && config.commitMessage.trim()
          ? config.commitMessage.trim()
          : 'MarkSeek sync'
    const matrix = await git.statusMatrix({ fs, dir })
    const tasks = matrix.map(([filepath, , w]) =>
      w === 0 ? git.remove({ fs, dir, filepath }) : git.add({ fs, dir, filepath }),
    )
    await Promise.all(tasks)

    // Only commit if something is actually staged (index differs from HEAD or
    // working tree). Otherwise git.commit throws "nothing to commit".
    const after = await git.statusMatrix({ fs, dir })
    const hasChanges = after.some(([, h, w, s]) => h !== s || w !== s)
    if (!hasChanges) return { committed: false }

    await git.commit({ fs, dir, message: msg, author: author(config) })
    return { committed: true }
  }

  async push(dir, config) {
    const branch = config?.branch || (await git.currentBranch({ fs, dir })) || DEFAULT_BRANCH
    const remoteUrl = config?.remoteUrl
    if (!remoteUrl) throw new Error('remote url required')
    await git.setConfig({ fs, dir, path: 'remote.origin.url', value: remoteUrl }).catch(() => {})
    await git.push({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: branch,
      remoteRef: branch,
      onAuth: makeAuth(config),
    })
  }

  async pull(dir, config) {
    const branch = config?.branch || (await git.currentBranch({ fs, dir })) || DEFAULT_BRANCH
    const remoteUrl = config?.remoteUrl
    if (!remoteUrl) throw new Error('remote url required')
    await git.setConfig({ fs, dir, path: 'remote.origin.url', value: remoteUrl }).catch(() => {})
    await git.pull({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: branch,
      author: author(config),
      onAuth: makeAuth(config),
    })
  }

  // Combined sync. Each step is opt-in via `opts` so callers can run only a
  // subset (e.g. auto-commit without auto-push). Defaults run everything, which
  // keeps the manual "Sync Now" behavior (commit + pull + push) unchanged.
  async sync(dir, config, message, opts = {}) {
    const { commit = true, pull = true, push = true } = opts
    if (commit) await this.commit(dir, config, message)
    if (pull) await this.pull(dir, config)
    if (push) await this.push(dir, config)
  }
}
