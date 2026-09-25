// Generic sync provider contract.
//
// A "provider" is one concrete sync backend (git, webdav, ...). The route layer
// (server/routes/sync.mjs) talks ONLY to this interface, so adding a new sync
// backend never touches the HTTP layer or the frontend — only a new file under
// server/sync/ plus a registerProvider() call is required.
//
// Every method receives the vault directory `dir` and the provider-specific
// config object (e.g. settings.sync.git). Network credentials live server-side
// in settings, never in the request body, so the frontend never sees tokens.

/**
 * @typedef {Object} SyncStatus
 * @property {boolean} available    provider is usable for this vault (deps/config ready)
 * @property {boolean} initialized  repo / remote already set up for this vault
 * @property {'no-repo'|'clean'|'dirty'|'ahead'|'behind'|'diverged'|'error'} state
 * @property {string}  [branch]
 * @property {number}  [ahead]
 * @property {number}  [behind]
 * @property {number}  [dirty]       files with uncommitted local changes
 * @property {number}  [untracked]   files not yet tracked by the backend
 * @property {{hash:string,message:string,date:string}} [lastCommit]
 * @property {string}  [error]
 * @property {Object}  [details]     provider-specific extras
 */

export class SyncProvider {
  /** @type {string} unique id, e.g. 'git' */
  id = 'base'
  /** @type {string} human-readable label */
  label = 'Base'

  /** Is this provider usable for the given vault right now? */
  // eslint-disable-next-line no-unused-vars
  isAvailable(config) {
    return true
  }

  /** Initialize the backend for the vault (e.g. git init). */
  // eslint-disable-next-line no-unused-vars
  async init(dir, config) {
    throw new Error('not implemented')
  }

  /** Clone a remote into the vault. */
  // eslint-disable-next-line no-unused-vars
  async clone(dir, config) {
    throw new Error('not implemented')
  }

  /** Compute the unified status object. */
  // eslint-disable-next-line no-unused-vars
  async getStatus(dir, config) {
    throw new Error('not implemented')
  }

  /** Stage + commit local changes (no-op when nothing changed). */
  // eslint-disable-next-line no-unused-vars
  async commit(dir, config, message) {
    throw new Error('not implemented')
  }

  /** Push to remote. */
  // eslint-disable-next-line no-unused-vars
  async push(dir, config) {
    throw new Error('not implemented')
  }

  /** Pull from remote. */
  // eslint-disable-next-line no-unused-vars
  async pull(dir, config) {
    throw new Error('not implemented')
  }

  /**
   * Commit history of a single file (filtered by filepath).
   * @param {string} dir
   * @param {object} config
   * @param {string} filepath  path relative to the vault root
   * @param {{ depth?: number }} [opts]
   * @returns {Promise<{ initialized: boolean, history: Array<{
   *   hash: string, shortHash: string, message: string,
   *   author: string, email: string, date: string
   * }> }>}
   */
  // eslint-disable-next-line no-unused-vars
  async getFileHistory(dir, config, filepath, opts) {
    throw new Error('not implemented')
  }

  /**
   * Read a single file's content at a given commit.
   * @param {string} dir
   * @param {object} config
   * @param {string} filepath  path relative to the vault root
   * @param {string} oid       commit SHA to read from
   * @returns {Promise<{ content: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async getFileAtCommit(dir, config, filepath, oid) {
    throw new Error('not implemented')
  }

  /**
   * Combined operation. Default strategy: commit local changes (if any),
   * then pull (fast-forward), then push — minimizing divergence.
   * @param {string} [message]
   */
  async sync(dir, config, message) {
    await this.commit(dir, config, message)
    await this.pull(dir, config)
    await this.push(dir, config)
  }
}
