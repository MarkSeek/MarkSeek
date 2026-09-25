// Generic sync routes. These are provider-agnostic: they resolve the active
// provider from settings (server/sync/index.mjs) and forward to its methods.
// Adding a new backend requires no change here.
//
// Network credentials live in settings (server-side); the request body only
// carries operation arguments (e.g. a commit message or a fresh clone target).
import { getVaultDir } from '../vault.mjs'
import { readSettings, updateSettings } from '../settings.mjs'
import { getProvider, listProviders } from '../sync/index.mjs'
import { sendJson, badRequest, serverError } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'

/**
 * Resolve the active provider and its config from settings.
 * @param {Record<string, any>} settings
 * @returns {{ provider: import('../sync/types.mjs').SyncProvider|null, config: Record<string, any>, id: string }}
 */
function resolve(settings) {
  const id = settings?.sync?.provider || 'git'
  const provider = getProvider(id)
  return { provider, config: provider ? settings?.sync?.[id] || {} : {}, id }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleSync(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'
  const vaultDir = getVaultDir()

  // GET /api/sync/providers —— list available providers (for the UI dropdown)
  if (pathname === '/api/sync/providers' && method === 'GET') {
    return sendJson(res, { providers: listProviders() })
  }

  // GET /api/sync/status —— unified status of the active provider
  if (pathname === '/api/sync/status' && method === 'GET') {
    const settings = readSettings()
    const { provider, config } = resolve(settings)
    if (!provider) {
      return sendJson(res, { available: false, initialized: false, state: 'no-repo', error: 'no provider' })
    }
    try {
      const status = await provider.getStatus(vaultDir, config)
      return sendJson(res, status)
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // POST /api/sync/init —— initialize the vault for the active provider
  if (pathname === '/api/sync/init' && method === 'POST') {
    const settings = readSettings()
    const { provider, config, id } = resolve(settings)
    if (!provider) return badRequest(res, 'no provider')
    try {
      await provider.init(vaultDir, config)
      updateSettings((s) => {
        s.sync = s.sync || {}
        s.sync.provider = id
      })
      return sendJson(res, { ok: true })
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // POST /api/sync/commit —— stage + commit local changes
  if (pathname === '/api/sync/commit' && method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch {
      /* optional body */
    }
    const settings = readSettings()
    const { provider, config } = resolve(settings)
    if (!provider) return badRequest(res, 'no provider')
    try {
      const r = await provider.commit(vaultDir, config, body?.message)
      return sendJson(res, r)
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // POST /api/sync/push
  if (pathname === '/api/sync/push' && method === 'POST') {
    const settings = readSettings()
    const { provider, config } = resolve(settings)
    if (!provider) return badRequest(res, 'no provider')
    try {
      await provider.push(vaultDir, config)
      return sendJson(res, { ok: true })
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // POST /api/sync/pull
  if (pathname === '/api/sync/pull' && method === 'POST') {
    const settings = readSettings()
    const { provider, config } = resolve(settings)
    if (!provider) return badRequest(res, 'no provider')
    try {
      await provider.pull(vaultDir, config)
      return sendJson(res, { ok: true })
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  // POST /api/sync/sync —— combined commit + pull + push
  if (pathname === '/api/sync/sync' && method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch {
      /* optional body */
    }
    const settings = readSettings()
    const { provider, config } = resolve(settings)
    if (!provider) return badRequest(res, 'no provider')
    try {
      // Manual "Sync Now" omits these flags → defaults to a full commit+pull+push.
      // The auto flow passes only the enabled steps (pull stays a manual action).
      await provider.sync(vaultDir, config, body?.message, {
        commit: body?.commit ?? true,
        pull: body?.pull ?? true,
        push: body?.push ?? true,
      })
      return sendJson(res, { ok: true })
    } catch (e) {
      return serverError(res, String(e?.message || e))
    }
  }

  return false
}
