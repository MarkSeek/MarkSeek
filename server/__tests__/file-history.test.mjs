// Per-file history helpers backed by isomorphic-git. These live in
// server/sync/fileHistory.mjs (standalone) and do not require the provider.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitSyncProvider } from '../sync/git.mjs'
import { getFileHistory, getFileAtCommit } from '../sync/fileHistory.mjs'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'markseek-fh-'))
}

describe('file history helpers', () => {
  let dir
  let provider

  beforeEach(() => {
    dir = tmpDir()
    provider = new GitSyncProvider()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns no history for a non-repo folder', async () => {
    const res = await getFileHistory(dir, {}, 'note.md')
    expect(res.initialized).toBe(false)
    expect(res.history).toEqual([])
  })

  it('reads per-file history and content at a given commit', async () => {
    await provider.init(dir, { branch: 'main' })
    fs.writeFileSync(path.join(dir, 'note.md'), '# Hello')
    await provider.commit(dir, {}, 'first version')

    fs.writeFileSync(path.join(dir, 'note.md'), '# Hello world')
    await provider.commit(dir, {}, 'second version')

    const res = await getFileHistory(dir, {}, 'note.md')
    expect(res.initialized).toBe(true)
    // Newest commit first.
    expect(res.history).toHaveLength(2)
    expect(res.history[0].message).toBe('second version')
    expect(res.history[1].message).toBe('first version')
    expect(res.history[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect(res.history[0].shortHash).toHaveLength(7)
    expect(res.history[0].author).toBeTruthy()
    expect(res.history[0].date).toBeTruthy()

    const first = await getFileAtCommit(dir, {}, 'note.md', res.history[1].hash)
    expect(first.content).toBe('# Hello')

    const second = await getFileAtCommit(dir, {}, 'note.md', res.history[0].hash)
    expect(second.content).toBe('# Hello world')
  })

  it('returns empty history for a file that was never committed', async () => {
    await provider.init(dir, { branch: 'main' })
    fs.writeFileSync(path.join(dir, 'untracked.md'), 'draft')
    const res = await getFileHistory(dir, {}, 'untracked.md')
    expect(res.initialized).toBe(true)
    expect(res.history).toEqual([])
  })
})
