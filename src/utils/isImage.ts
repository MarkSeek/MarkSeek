// Image detection and vault image URLs.
//
// The extension list mirrors SERVABLE_IMAGE_EXTS in server/routes/static.mjs:
// those are exactly the files the /vault/* route is willing to serve, so every
// path accepted here can also be rendered by the browser. Keeping the two lists
// in sync is what stops a binary file from being read as UTF-8 text.
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
])

/** Lower-cased extension without the dot ('' when the path has none). */
export function imageExtOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** True when the path points at an image the browser can render. */
export function isImageFile(path: string): boolean {
  return IMAGE_EXTS.has(imageExtOf(path))
}

/**
 * URL of a vault image, served directly by the /vault/* static route.
 *
 * Each segment is encoded on its own (same as the backend's imageUrl()) so
 * names containing spaces, '#' or '?' still resolve, while '/' stays a
 * separator.
 */
export function vaultImageUrl(path: string): string {
  const segments = path.split('/').filter(Boolean).map(encodeURIComponent)
  return `/vault/${segments.join('/')}`
}
