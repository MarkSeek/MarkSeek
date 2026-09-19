// Static file serving shared by every host that embeds the MarkSeek backend:
// the Vite dev middleware (through routes/static.mjs), the production server
// (app/app.js) and the Electron adapter (electron/server-adapter.mjs).
//
// Those three hosts used to carry their own copy of the MIME table and their
// own `serveFile`; the copies had already drifted (`.js` was
// `application/javascript` in one and `text/javascript; charset=utf-8` in
// another), so adding a font type meant editing three files — and forgetting
// one of them silently broke an asset.
import fs from 'node:fs'
import path from 'node:path'

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/**
 * Write one file to the response.
 *
 * Always answers the request (an unreadable path is a 404), so route handlers
 * can `return serveFile(...)` without a fallthrough branch.
 * @param {import('http').ServerResponse} res
 * @param {string} filePath absolute path
 * @param {{ cache?: boolean, onError?: (err: unknown) => void }} [opts]
 * @returns {true}
 */
export function serveFile(res, filePath, { cache = false, onError } = {}) {
  try {
    const data = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', cache ? 'public, max-age=86400' : 'no-cache')
    res.end(data)
    return true
  } catch (err) {
    // Only the Electron adapter has a console the user can never see, so the
    // reason is handed back instead of being swallowed here.
    if (onError) onError(err)
    res.statusCode = 404
    res.end('Not Found')
    return true
  }
}
