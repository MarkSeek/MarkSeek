// File CRUD routes: list / read / write / delete / move / listdir / search /
// mkdir / upload.
//
// Every path goes through safeJoin() so a request can never escape the vault.
// Handlers return `true` as soon as a response has been written and `false`
// when the request is not one of these routes.
import fs from 'node:fs'
import path from 'node:path'

import { getVaultDir } from '../vault.mjs'
import {
  safeJoin as safeJoinInVault,
  scanDir as scanDirInVault,
  listDirDetailed as listDirDetailedInVault,
  searchNotes as searchNotesInVault,
} from '../notes-fs.mjs'
import { readSettings } from '../settings.mjs'
import { resolveImageDir } from '../image-rules.mjs'
import { sendJson, sendText, notFound, forbidden, badRequest, serverError } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'

/** Resolve a vault-relative path, blocking directory traversal. */
const safeJoin = (p) => safeJoinInVault(getVaultDir(), p)

/**
 * How a stored image is addressed from markdown.
 *
 * A leading "/" means the vault root, so a file saved under `images/` is
 * referenced as `/images/x.png` and a rule-controlled folder as
 * `/assets/2026/09/x.png`. The older `/images/xxx.png` links already written
 * into notes keep resolving through their own route, which is hardcoded to the
 * `images/` folder and must not change shape.
 * @param {string} relPath vault-relative file path
 * @returns {string} a URL the browser can request
 */
function imageUrl(relPath) {
  // A leading "/" means the vault root, so a saved image under `images/` is
  // referenced as `/images/x.png` rather than `/vault/images/x.png`.
  return '/' + relPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

/**
 * Pick the destination folder for an upload, falling back to the built-in one
 * when the resolved path would escape the vault (a hostile or typo'd rule).
 * @param {string | undefined} notePath vault-relative path of the edited note
 * @returns {{ dir: string, ruleId: string, ruleName: string }}
 */
function pickImageDir(notePath) {
  const picked = resolveImageDir({ notePath, settings: readSettings() })
  return safeJoin(picked.dir) ? picked : { dir: 'images', ruleId: '', ruleName: '' }
}

/**
 * Read a JSON body once, answering 400 when it is malformed.
 * @returns {Promise<Record<string, any> | null>} null when the response was sent.
 */
async function readBodyOrBadRequest(req, res) {
  try {
    return await readJsonBody(req)
  } catch {
    badRequest(res, 'invalid body')
    return null
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleFiles(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'

  // GET /api/files/list
  if (pathname === '/api/files/list' && method === 'GET') {
    const rootName = path.basename(getVaultDir()) || 'Knowledge Base'
    return sendJson(res, [{
      id: '',
      name: rootName,
      type: 'folder',
      children: scanDirInVault(getVaultDir(), getVaultDir(), getVaultDir(), false),
      expanded: true,
    }])
  }

  // GET /api/files/read
  if (pathname === '/api/files/read' && method === 'GET') {
    const p = url.searchParams.get('path')
    if (!p) return badRequest(res, 'missing path')
    const fp = safeJoin(p)
    if (!fp) return forbidden(res)
    try {
      return sendText(res, fs.readFileSync(fp, 'utf-8'))
    } catch {
      return notFound(res)
    }
  }

  // POST /api/files/write
  if (pathname === '/api/files/write' && method === 'POST') {
    const body = await readBodyOrBadRequest(req, res)
    if (!body) return true
    const { path: p, content } = body
    if (!p || typeof content !== 'string') return badRequest(res, 'invalid body')
    const fp = safeJoin(p)
    if (!fp) return forbidden(res)
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, content, 'utf-8')
      return sendJson(res, { ok: true })
    } catch {
      return serverError(res, 'write failed')
    }
  }

  // DELETE /api/files/delete
  if (pathname === '/api/files/delete' && method === 'DELETE') {
    const p = url.searchParams.get('path')
    if (!p) return badRequest(res, 'missing path')
    const fp = safeJoin(p)
    if (!fp) return forbidden(res)
    try {
      fs.rmSync(fp, { recursive: true, force: true })
      return sendJson(res, { ok: true })
    } catch {
      return serverError(res, 'delete failed')
    }
  }

  // POST /api/files/move
  if (pathname === '/api/files/move' && method === 'POST') {
    const body = await readBodyOrBadRequest(req, res)
    if (!body) return true
    const { from, to } = body
    if (!from || !to) return badRequest(res, 'invalid body')
    const fromPath = safeJoin(from)
    const toPath = safeJoin(to)
    if (!fromPath || !toPath) return forbidden(res)
    try {
      fs.mkdirSync(path.dirname(toPath), { recursive: true })
      fs.renameSync(fromPath, toPath)
      return sendJson(res, { ok: true })
    } catch {
      return serverError(res, 'move failed')
    }
  }

  // GET /api/files/listdir
  if (pathname === '/api/files/listdir' && method === 'GET') {
    const p = url.searchParams.get('path') || ''
    // An empty path means "the vault root"; safeJoin() rejects '' so handle it
    // explicitly instead of answering 403 for the default case.
    const dirPath = p ? safeJoin(p) : getVaultDir()
    if (!dirPath) return forbidden(res)
    return sendJson(res, listDirDetailedInVault(getVaultDir(), dirPath))
  }

  // GET /api/files/search
  if (pathname === '/api/files/search' && method === 'GET') {
    const q = url.searchParams.get('q')
    if (!q) return badRequest(res, 'missing q')
    try {
      // Async on purpose: the whole-vault scan shares a cached read with the
      // relation panel and must never block the other API routes.
      return sendJson(res, await searchNotesInVault(getVaultDir(), q.toLowerCase()))
    } catch (e) {
      console.error('Note search failed:', e)
      return serverError(res, 'search failed')
    }
  }

  // POST /api/files/mkdir
  if (pathname === '/api/files/mkdir' && method === 'POST') {
    const body = await readBodyOrBadRequest(req, res)
    if (!body) return true
    const { path: p } = body
    if (!p) return badRequest(res, 'missing path')
    const dirPath = safeJoin(p)
    if (!dirPath) return forbidden(res)
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      return sendJson(res, { ok: true })
    } catch {
      return serverError(res, 'mkdir failed')
    }
  }

  // POST /api/files/upload
  //
  // `notePath` (optional) is the vault-relative path of the note the image is
  // being dropped into. It selects the destination folder through the user's
  // save rules; without it the default folder is used, which is what every
  // caller before rules existed relied on.
  if (pathname === '/api/files/upload' && method === 'POST') {
    const body = await readBodyOrBadRequest(req, res)
    if (!body) return true
    const { data, ext, notePath } = body
    if (!data || !ext || !/^[a-z0-9]+$/i.test(ext)) return badRequest(res, 'invalid body')
    try {
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { dir, ruleId, ruleName } = pickImageDir(typeof notePath === 'string' ? notePath : '')
      const targetDir = safeJoin(dir)
      if (!targetDir) return forbidden(res)
      fs.mkdirSync(targetDir, { recursive: true })
      const relPath = `${dir}/${name}`
      fs.writeFileSync(path.join(targetDir, name), Buffer.from(data, 'base64'))
      return sendJson(res, { path: relPath, dir, ruleId, ruleName, url: imageUrl(relPath) })
    } catch (e) {
      console.error('Image upload failed:', e)
      return serverError(res, 'upload failed')
    }
  }

  // POST /api/files/resolve-image-dir
  //
  // Dry run of the rule engine above, used by the settings page's "test this
  // path" box. It answers instead of writing so the UI can show the exact
  // folder a paste into that note would use — same module, same answer.
  if (pathname === '/api/files/resolve-image-dir' && method === 'POST') {
    const body = await readBodyOrBadRequest(req, res)
    if (!body) return true
    const { notePath, imageRules, imageDefaultDir } = body
    // The settings page previews rules it has not persisted yet (its write is
    // debounced), so it sends the live values. Anything omitted falls back to
    // the stored settings, so a caller may also dry-run what is on disk.
    const stored = readSettings()
    const settings = {
      ...stored,
      imageRules: Array.isArray(imageRules) ? imageRules : stored.imageRules,
      imageDefaultDir:
        typeof imageDefaultDir === 'string' ? imageDefaultDir : stored.imageDefaultDir,
    }
    const { dir, ruleId, ruleName } = resolveImageDir({
      notePath: typeof notePath === 'string' ? notePath : '',
      settings,
    })
    if (!safeJoin(dir)) return badRequest(res, 'invalid target dir')
    return sendJson(res, { dir, ruleId, ruleName })
  }

  return false
}
