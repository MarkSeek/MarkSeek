import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { handleRelations } from '../routes/relations.mjs'
import { resetRelationsCache } from '../relations.mjs'
import { getVaultDir, resetVaultDir, setVaultDir } from '../vault.mjs'
import { fakeReq, fakeRes, apiUrl } from './helpers/http.mjs'
import { cleanupTmpVaults, makeTmpVault, writeVaultFile } from './helpers/tmp-vault.mjs'

const VAULT_FILES = {
  'a.md': '# A\n\nlinks to [[b]] and [c](./c.md)\n\n- [ ] todo one\n- [x] todo two\n\n#tagX\n',
  'b.md': '# B\n\nsee [[a]] for details\n',
  'c.md': 'plain note\n\n#tagX\n',
}

let root

beforeEach(() => {
  root = makeTmpVault(VAULT_FILES)
  setVaultDir(root)
  resetRelationsCache()
})

afterEach(() => {
  resetRelationsCache()
  resetVaultDir()
})

afterAll(cleanupTmpVaults)

/** Drive the route the way the dev middleware / app.js does. */
async function postRelations(body) {
  const res = fakeRes()
  const handled = await handleRelations(
    fakeReq({ url: '/api/relations', method: 'POST', body }),
    res,
    apiUrl('/api/relations'),
  )
  return { handled, res }
}

describe('POST /api/relations', () => {
  it('returns the same shape the panel used to compute in the browser', async () => {
    const { handled, res } = await postRelations({ path: 'a.md' })
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)

    const result = res.json()
    expect(Object.keys(result).sort()).toEqual(['backLinks', 'outLinks', 'tags', 'tasks'])

    // b.md writes [[a]], so it is the only backlink.
    expect(result.backLinks.map((b) => b.path)).toEqual(['b.md'])
    expect(result.backLinks[0].snippet).toContain('[[a]]')

    // a.md links out to c.md (markdown) and to b (wikilink).
    expect(result.outLinks.map((o) => o.path).sort()).toEqual(['b', 'c.md'])

    // #tagX is shared with c.md.
    expect(result.tags).toEqual([{ tag: 'tagX', others: [{ path: 'c.md', name: 'c' }] }])

    expect(result.tasks).toEqual([
      { done: false, text: 'todo one' },
      { done: true, text: 'todo two' },
    ])
  })

  it('prefers the posted content over the file on disk', async () => {
    const { res } = await postRelations({
      path: 'a.md',
      content: '- [ ] brand new task\n\nsee [[c]]\n',
    })
    const result = res.json()
    expect(result.tasks).toEqual([{ done: false, text: 'brand new task' }])
    expect(result.outLinks.map((o) => o.path)).toEqual(['c'])
    // Nothing on disk links to the unsaved text, so no backlink appeared.
    expect(result.backLinks.map((b) => b.path)).toEqual(['b.md'])
  })

  it('rejects a missing path and a path that escapes the vault', async () => {
    const missing = await postRelations({ content: 'x' })
    expect(missing.res.statusCode).toBe(400)

    const escaping = await postRelations({ path: '../outside.md' })
    expect(escaping.res.statusCode).toBe(403)
  })

  it('answers 400 for a malformed body', async () => {
    const res = fakeRes()
    const handled = await handleRelations(
      fakeReq({ url: '/api/relations', method: 'POST', body: 'not json' }),
      res,
      apiUrl('/api/relations'),
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it('ignores anything that is not POST /api/relations', async () => {
    const res = fakeRes()
    const handled = await handleRelations(
      fakeReq({ url: '/api/relations', method: 'GET' }),
      res,
      apiUrl('/api/relations'),
    )
    expect(handled).toBe(false)
    expect(res.ended).toBe(false)
  })

  it('picks up a new note instead of serving a stale cached scan', async () => {
    const first = await postRelations({ path: 'a.md' })
    expect(first.res.json().backLinks.map((b) => b.path)).toEqual(['b.md'])

    writeVaultFile(root, 'd.md', 'another one pointing at [[a]]\n')
    const second = await postRelations({ path: 'a.md' })
    expect(second.res.json().backLinks.map((b) => b.path).sort()).toEqual(['b.md', 'd.md'])
  })

  it('serves a repeated request from the cache without re-reading files', async () => {
    const first = await postRelations({ path: 'a.md' })
    const second = await postRelations({ path: 'a.md' })
    expect(second.res.json()).toEqual(first.res.json())
  })

  it('reads notes that live in subdirectories', async () => {
    writeVaultFile(root, 'nested/deep/e.md', 'deep note linking to [[a]]\n')
    const { res } = await postRelations({ path: 'a.md' })
    expect(res.json().backLinks.map((b) => b.path).sort()).toEqual(['b.md', 'nested/deep/e.md'])
  })
})

describe('vault resolution', () => {
  it('follows the active vault directory', async () => {
    expect(getVaultDir()).toBe(root)
    const { res } = await postRelations({ path: 'c.md' })
    // c.md is linked from a.md, so a.md shows up as its only backlink.
    expect(res.json().backLinks.map((b) => b.path)).toEqual(['a.md'])
  })
})
