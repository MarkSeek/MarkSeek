// End-to-end behavior of the git provider on a real temporary repository, using
// isomorphic-git (no system git binary). Skips gracefully if anything is off.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitSyncProvider } from '../sync/git.mjs'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'markseek-sync-'))
}

describe('GitSyncProvider', () => {
  let dir
  let provider

  beforeEach(() => {
    dir = tmpDir()
    provider = new GitSyncProvider()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports no-repo for a plain folder', async () => {
    const st = await provider.getStatus(dir, {})
    expect(st.initialized).toBe(false)
    expect(st.state).toBe('no-repo')
  })

  it('initializes, detects untracked files, commits, and becomes clean', async () => {
    await provider.init(dir, { branch: 'main' })
    fs.writeFileSync(path.join(dir, 'note.md'), '# Hello')

    const dirty = await provider.getStatus(dir, {})
    expect(dirty.initialized).toBe(true)
    expect(dirty.state).toBe('dirty')
    expect(dirty.untracked).toBeGreaterThanOrEqual(1)

    const result = await provider.commit(dir, {}, 'first commit')
    expect(result.committed).toBe(true)

    const clean = await provider.getStatus(dir, {})
    expect(clean.state).toBe('clean')
    expect(clean.lastCommit?.message).toContain('first commit')
  })

  it('is a no-op commit when there is nothing to commit', async () => {
    await provider.init(dir, { branch: 'main' })
    const result = await provider.commit(dir, {}, 'empty')
    expect(result.committed).toBe(false)
  })
})
