// MarkSeek production static server.
// Shares server/api.mjs with vite.config.ts so dev and prod APIs stay consistent.
// Note: package.json has "type":"module", so this file uses ESM syntax.
import http from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { handleApi } from '../server/api.mjs'
import { serveFile } from '../server/http/static.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../dist')
const ASSETS_DIR = path.join(__dirname, 'assets')

http.createServer(async function (req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const pathname = url.pathname

  // Hand off to the shared API handler (includes /api/*, /liteapp/*, /images/*)
  const handled = await handleApi(req, res, url)
  if (handled === true) return

  // Static assets (production build output)
  if (/^\/static\//.test(pathname)) {
    return serveFile(res, path.join(ASSETS_DIR, pathname))
  }

  const distPath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname)
  if (fs.existsSync(distPath) && fs.statSync(distPath).isFile()) {
    return serveFile(res, distPath)
  }

  // SPA fallback
  serveFile(res, path.join(DIST_DIR, 'index.html'))
}).listen(9000)

console.log('Server running at http://127.0.0.1:9000/')
