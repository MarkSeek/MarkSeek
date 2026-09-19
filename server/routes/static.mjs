// Static asset routes: the vault-hosted images/ folder, files inside the vault
// referenced by /vault/*, and the .LiteApp bundle.
//
// Behaviour is unchanged from api.mjs; only the ownership moved here. The
// actual byte-serving (and the MIME table) lives in http/static.mjs, shared
// with the production server and the Electron adapter.
import path from 'node:path'
import fs from 'node:fs'

import { getVaultDir } from '../vault.mjs'
import { safeJoin as safeJoinInVault } from '../notes-fs.mjs'
import { forbidden } from '../http/respond.mjs'
import { serveFile } from '../http/static.mjs'

/** Resolve a vault-relative path, blocking directory traversal. */
const safeJoin = (p) => safeJoinInVault(getVaultDir(), p)

// Re-exported through api.mjs for the hosts that still import it from there.
export { MIME } from '../http/static.mjs'

/**
 * Extensions the /vault/* route is willing to hand out.
 *
 * The route has to accept arbitrary paths — image save rules can point at any
 * folder — but the vault root also holds settings.json, which carries every
 * AI provider's API key. So the allowlist is what keeps "serve my attachments"
 * from turning into "serve my secrets": only image types go out.
 */
const SERVABLE_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
])

/**
 * GET /liteapp/*            -- static assets for lite apps (maps to notes/.LiteApp/*)
 * GET /images/*             -- the vault's images/ directory (legacy note links, immutable semantics)
 * GET /vault/*              -- any image inside the vault (legacy link compatibility, may point anywhere)
 * GET /* (image extension)  -- image links rooted at the vault (where screenshots are saved),
 *                              "/" is the note root; only returned when the extension is an image
 *                              and the file actually exists in the vault, otherwise deferred to
 *                              the upper layer (SPA / public assets).
 * @returns {boolean} false when the request is not a static asset route.
 */
export function handleStatic(req, res, url) {
  const pathname = url.pathname

  if (pathname.startsWith('/liteapp/')) {
    const relPath = decodeURIComponent(pathname.replace('/liteapp/', ''))
    const fp = safeJoin('.LiteApp/' + relPath)
    if (!fp) return forbidden(res)
    return serveFile(res, fp)
  }

  if (pathname.startsWith('/images/')) {
    const fp = safeJoin('images/' + pathname.replace('/images/', ''))
    if (!fp) return forbidden(res)
    return serveFile(res, fp, { cache: true })
  }

  if (pathname.startsWith('/vault/')) {
    // Decode first, then gate on the extension: an encoded `..` must not sneak
    // past the allowlist by looking like a path that ends in `.png`.
    const relPath = decodeURIComponent(pathname.replace('/vault/', ''))
    const ext = path.extname(relPath).toLowerCase()
    if (!SERVABLE_IMAGE_EXTS.has(ext)) return forbidden(res)
    const fp = safeJoin(relPath)
    if (!fp) return forbidden(res)
    return serveFile(res, fp, { cache: true })
  }

  // Vault-rooted image links: a leading "/" means the vault root, e.g.
  // /images/x.png or /assets/2026/09/x.png. Same image-only allowlist as
  // /vault/*, and we only answer when the file genuinely exists in the vault —
  // anything else (index.html, /vite.svg, unrelated paths) falls through so the
  // host keeps serving the SPA and public assets.
  const ext = path.extname(pathname).toLowerCase()
  if (SERVABLE_IMAGE_EXTS.has(ext)) {
    const relPath = decodeURIComponent(pathname.replace(/^\/+/, ''))
    const fp = safeJoin(relPath)
    if (fp && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return serveFile(res, fp, { cache: true })
    }
  }

  return false
}
