// File-history routes: per-note Git commit history and historical file content.
// Mounted by server/api.mjs (handleFileHistory). Deliberately decoupled from the
// SyncProvider registry so the feature can ship without touching git.mjs.
import { getVaultDir } from '../vault.mjs'
import { readSettings } from '../settings.mjs'
import { getProvider } from '../sync/index.mjs'
import { sendJson, badRequest, serverError } from '../http/respond.mjs'
import { getFileHistory, getFileAtCommit } from '../sync/fileHistory.mjs'

// Only the git provider keeps per-file history; others return empty gracefully.
const PROVIDERS_WITH_HISTORY = new Set(['git'])

function resolveSettings() {
  const settings = readSettings()
  const id = settings?.sync?.provider || 'git'
  const provider = getProvider(id)
  const config = provider ? settings?.sync?.[id] || {} : {}
  return { provider, id, config }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleFileHistory(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'
  const vaultDir = getVaultDir()

  // GET /api/sync/file-history?path=<repo-relative path>
  if (pathname === '/api/sync/file-history' && method === 'GET') {
    const filePath = url.searchParams.get('path') || ''
    if (!filePath) return badRequest(res, 'path required')
    const { provider, id, config } = resolveSettings()
    if (!provider || !PROVIDERS_WITH_HISTORY.has(id)) {
      return sendJson(res, { initialized: false, history: [] })
    }
    try {
      const result = await getFileHistory(vaultDir, config, filePath, { depth: 50 })
      return sendJson(res, result)
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // GET /api/sync/file-at-commit?path=<repo-relative path>&oid=<commit sha>
  if (pathname === '/api/sync/file-at-commit' && method === 'GET') {
    const filePath = url.searchParams.get('path') || ''
    const oid = url.searchParams.get('oid') || ''
    if (!filePath || !oid) return badRequest(res, 'path and oid required')
    const { provider, id, config } = resolveSettings()
    if (!provider || !PROVIDERS_WITH_HISTORY.has(id)) {
      return sendJson(res, { content: '' })
    }
    try {
      const result = await getFileAtCommit(vaultDir, config, filePath, oid)
      return sendJson(res, result)
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  return false
}
