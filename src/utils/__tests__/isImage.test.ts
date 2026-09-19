import { describe, expect, it } from 'vitest'
import { imageExtOf, isImageFile, vaultImageUrl } from '../isImage'

describe('isImageFile', () => {
  it('accepts every extension the /vault route serves', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']) {
      expect(isImageFile(`images/shot.${ext}`)).toBe(true)
    }
  })

  it('ignores case', () => {
    expect(isImageFile('images/Shot.PNG')).toBe(true)
    expect(isImageFile('images/SHOT.JpEg')).toBe(true)
  })

  it('rejects notes and other binaries', () => {
    expect(isImageFile('notes/idea.md')).toBe(false)
    expect(isImageFile('assets/app.js')).toBe(false)
    expect(isImageFile('assets/archive.zip')).toBe(false)
    // "png" is only the extension when it follows the last dot.
    expect(isImageFile('images/png')).toBe(false)
  })

  it('never mistakes a dotted folder for an extension', () => {
    expect(isImageFile('my.photos/notes.md')).toBe(false)
    expect(isImageFile('my.photos/cover.png')).toBe(true)
  })
})

describe('imageExtOf', () => {
  it('returns the lower-cased extension', () => {
    expect(imageExtOf('a/b/Cover.WebP')).toBe('webp')
  })

  it('returns an empty string without an extension', () => {
    expect(imageExtOf('a/b/cover')).toBe('')
    expect(imageExtOf('')).toBe('')
  })
})

describe('vaultImageUrl', () => {
  it('points at the vault static route', () => {
    expect(vaultImageUrl('images/shot.png')).toBe('/vault/images/shot.png')
  })

  it('encodes each segment but keeps the separators', () => {
    // Spaces, '#' and '?' must not break the request, '/' must stay a separator.
    expect(vaultImageUrl('我的 图片/#cover?.png')).toBe(
      '/vault/%E6%88%91%E7%9A%84%20%E5%9B%BE%E7%89%87/%23cover%3F.png',
    )
  })

  it('drops empty segments', () => {
    expect(vaultImageUrl('/images//shot.png')).toBe('/vault/images/shot.png')
  })
})
