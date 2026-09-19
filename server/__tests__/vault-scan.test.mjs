// The whole-vault scanner is the one piece of shared infrastructure behind
// both the relation panel and note search, so its contract is pinned here:
// async, ordered, and cached per (vault root, on-disk state).
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import {
  collectMarkdownFiles,
  mapWithConcurrency,
  readAllVaultNotes,
  resetVaultNotesCache,
} from '../lib/vault-scan.mjs'
import {
  cleanupTmpVaults,
  makeTmpVault,
  writeVaultFile,
} from './helpers/tmp-vault.mjs'

afterEach(resetVaultNotesCache)
afterAll(cleanupTmpVaults)

describe('collectMarkdownFiles', () => {
  it('lists every markdown note, sorted, skipping dot-dirs and other files', async () => {
    const root = makeTmpVault({
      'b.md': '',
      'a.md': '',
      'nested/c.md': '',
      'notes.markdown': '',
      'image.png': '',
      '.hidden/skipped.md': '',
      'kept/.dotfile.md': '',
    })
    expect(await collectMarkdownFiles(root)).toEqual([
      'a.md',
      'b.md',
      'nested/c.md',
      'notes.markdown',
    ])
  })
})

describe('mapWithConcurrency', () => {
  it('keeps the input order and never runs more than the limit', async () => {
    const items = [50, 10, 30, 20, 40]
    let running = 0
    let peak = 0
    const out = await mapWithConcurrency(items, 2, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, n))
      running -= 1
      return n
    })
    expect(out).toEqual(items)
    expect(peak).toBe(2)
  })
})

describe('readAllVaultNotes', () => {
  it('returns path + content for every note', async () => {
    const root = makeTmpVault({ 'a.md': 'A body', 'nested/b.md': 'B body' })
    const notes = await readAllVaultNotes(root)
    expect(notes).toEqual([
      { path: 'a.md', content: 'A body' },
      { path: 'nested/b.md', content: 'B body' },
    ])
  })

  it('serves a second call from the cache without re-reading', async () => {
    const root = makeTmpVault({ 'a.md': 'A body' })
    const first = await readAllVaultNotes(root)
    const second = await readAllVaultNotes(root)
    expect(second).toBe(first)
  })

  it('re-reads after a note changes on disk', async () => {
    const root = makeTmpVault({ 'a.md': 'A body' })
    expect(await readAllVaultNotes(root)).toEqual([{ path: 'a.md', content: 'A body' }])
    writeVaultFile(root, 'a.md', 'A body, edited and longer')
    expect(await readAllVaultNotes(root)).toEqual([
      { path: 'a.md', content: 'A body, edited and longer' },
    ])
  })

  it('re-reads after a note is added', async () => {
    const root = makeTmpVault({ 'a.md': 'A body' })
    expect(await readAllVaultNotes(root)).toHaveLength(1)
    writeVaultFile(root, 'b.md', 'B body')
    expect(await readAllVaultNotes(root)).toEqual([
      { path: 'a.md', content: 'A body' },
      { path: 'b.md', content: 'B body' },
    ])
  })

  it('shares one scan between two callers that arrive together', async () => {
    const root = makeTmpVault({ 'a.md': 'A body' })
    const [first, second] = await Promise.all([
      readAllVaultNotes(root),
      readAllVaultNotes(root),
    ])
    expect(second).toBe(first)
  })

  it('never serves one vault’s notes to another', async () => {
    const a = makeTmpVault({ 'note.md': 'in a' })
    const b = makeTmpVault({ 'note.md': 'in b' })
    expect(await readAllVaultNotes(a)).toEqual([{ path: 'note.md', content: 'in a' }])
    expect(await readAllVaultNotes(b)).toEqual([{ path: 'note.md', content: 'in b' }])
  })
})
