// Relation route: the right-hand panel asks for one note's relations and gets
// the finished result back. The whole-vault scan runs here, in Node, instead of
// on the UI thread.
import { getVaultDir } from '../vault.mjs'
import { safeJoin as safeJoinInVault } from '../notes-fs.mjs'
import { analyzeRelationsInVault } from '../relations.mjs'
import { sendJson, badRequest, forbidden, serverError } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'

/**
 * POST /api/relations
 * Body: { path: string, content?: string }
 *   path    – vault-relative path of the note being looked at.
 *   content – the editor's current text. Optional; when present it is used
 *             instead of the on-disk copy so unsaved edits are reflected.
 * Answers the same shape the panel rendered before: { backLinks, outLinks,
 * tags, tasks }.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleRelations(req, res, url) {
  if (url.pathname !== '/api/relations' || req.method !== 'POST') return false

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return badRequest(res, 'invalid body')
  }

  const notePath = body && typeof body.path === 'string' ? body.path : ''
  if (!notePath) return badRequest(res, 'missing path')
  // Same guard as every other route: a path may never escape the vault.
  if (!safeJoinInVault(getVaultDir(), notePath)) return forbidden(res)

  const content = body && typeof body.content === 'string' ? body.content : undefined

  try {
    const result = await analyzeRelationsInVault(getVaultDir(), { path: notePath, content })
    return sendJson(res, result)
  } catch (e) {
    console.error('Relation computation failed:', e)
    return serverError(res, 'relations failed')
  }
}
