import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { handleApi, initBackend, MIME } from '../api.mjs'
import { setVaultDir, resetVaultDir, getVaultDir } from '../vault.mjs'
import { setLogDir } from '../log.mjs'
import { fakeReq, fakeRes, apiUrl } from './helpers/http.mjs'
import {
  makeTmpVault,
  readVaultFile,
  writeVaultFile,
  vaultExists,
  cleanupTmpVaults,
} from './helpers/tmp-vault.mjs'
import { readSettings, writeSettings } from '../settings.mjs'
import { setAppDataDir } from '../appdata.mjs'

// Placeholder expansion happens server-side against the real clock, so the
// expected folder is derived the same way here.
const NOW = new Date()
const CURRENT_YEAR = String(NOW.getFullYear())
const CURRENT_MONTH = String(NOW.getMonth() + 1).padStart(2, '0')

afterAll(cleanupTmpVaults)

let vault

beforeEach(() => {
  vault = makeTmpVault({
    'Projects/ideas.md': '# Ideas\nhello world\n',
    'Journals/2026/2026-03/2026-03-01.md': '# Day 1\n* [ ] buy milk\n* [x] water plants\n',
  })
  setVaultDir(vault)
  setAppDataDir(vault)
  setLogDir(path.join(vault, 'logs'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetVaultDir()
})

/** Drive handleApi with a fake request and return the captured response. */
async function call(rawUrl, { method = 'GET', body } = {}) {
  const res = fakeRes()
  const handled = await handleApi(fakeReq({ url: rawUrl, method, body }), res, apiUrl(rawUrl))
  return { handled, res }
}

// Settings now live OUTSIDE the vault (app-data dir); writeSettings()/readSettings()
// from ../settings.mjs target that location, so the routes' readSettings() finds them.

describe('routing', () => {
  it('returns false for an unknown path so the next middleware can run', async () => {
    const { handled } = await call('/something/else')
    expect(handled).toBe(false)
  })

  it('answers an unmatched /api path with JSON 404 (never the SPA HTML)', async () => {
    const { handled, res } = await call('/api/files/write', { method: 'GET' })
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(404)
    expect(res.getHeader('content-type')).toContain('application/json')
    expect(JSON.parse(res.text()).error).toBe('not found')
  })
})

describe('GET /api/files/list', () => {
  it('returns the vault root node with its children', async () => {
    const { res } = await call('/api/files/list')
    expect(res.statusCode).toBe(200)
    const [root] = res.json()
    expect(root.type).toBe('folder')
    expect(root.name).toBe(path.basename(vault))
    const names = root.children.map((c) => c.name)
    expect(names).toContain('Projects')
    expect(names).toContain('Journals')
  })

  it('reflects a re-bound vault', async () => {
    const other = makeTmpVault({ 'only.md': '# only' })
    setVaultDir(other)
    const { res } = await call('/api/files/list')
    expect(res.json()[0].children.map((c) => c.name)).toEqual(['only.md'])
  })
})

describe('GET /api/files/read', () => {
  it('returns the note content as text', async () => {
    const { res } = await call('/api/files/read?path=Projects/ideas.md')
    expect(res.statusCode).toBe(200)
    expect(res.text()).toBe('# Ideas\nhello world\n')
  })

  it('rejects a missing path parameter', async () => {
    const { res } = await call('/api/files/read')
    expect(res.statusCode).toBe(400)
  })

  it('forbids directory traversal', async () => {
    const { res } = await call('/api/files/read?path=../../etc/passwd')
    expect(res.statusCode).toBe(403)
  })

  it('404s a file that does not exist', async () => {
    const { res } = await call('/api/files/read?path=nope.md')
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/files/write', () => {
  it('writes a note and creates parent directories', async () => {
    const { res } = await call('/api/files/write', {
      method: 'POST',
      body: { path: 'Deep/New/note.md', content: '# created' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(readVaultFile(vault, 'Deep/New/note.md')).toBe('# created')
  })

  it('rejects a body without content', async () => {
    const { res } = await call('/api/files/write', { method: 'POST', body: { path: 'a.md' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects malformed JSON', async () => {
    const res = fakeRes()
    await handleApi(
      fakeReq({ url: '/api/files/write', method: 'POST', body: '{oops' }),
      res,
      apiUrl('/api/files/write'),
    )
    expect(res.statusCode).toBe(400)
  })

  it('forbids writing outside the vault', async () => {
    const { res } = await call('/api/files/write', {
      method: 'POST',
      body: { path: '../escaped.md', content: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /api/files/delete', () => {
  it('removes a note', async () => {
    const { res } = await call('/api/files/delete?path=Projects/ideas.md', { method: 'DELETE' })
    expect(res.json()).toEqual({ ok: true })
    expect(fs.existsSync(path.join(vault, 'Projects/ideas.md'))).toBe(false)
  })

  it('requires a path', async () => {
    const { res } = await call('/api/files/delete', { method: 'DELETE' })
    expect(res.statusCode).toBe(400)
  })

  it('forbids traversal', async () => {
    const { res } = await call('/api/files/delete?path=../outside.md', { method: 'DELETE' })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/files/move', () => {
  it('renames a note into another folder', async () => {
    const { res } = await call('/api/files/move', {
      method: 'POST',
      body: { from: 'Projects/ideas.md', to: 'Archive/ideas.md' },
    })
    expect(res.json()).toEqual({ ok: true })
    expect(readVaultFile(vault, 'Archive/ideas.md')).toContain('# Ideas')
  })

  it('rejects a partial body', async () => {
    const { res } = await call('/api/files/move', { method: 'POST', body: { from: 'a.md' } })
    expect(res.statusCode).toBe(400)
  })

  it('forbids traversal on either side', async () => {
    const { res } = await call('/api/files/move', {
      method: 'POST',
      body: { from: 'Projects/ideas.md', to: '../out.md' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/files/listdir', () => {
  it('lists one level with types', async () => {
    const { res } = await call('/api/files/listdir?path=Projects')
    const nodes = res.json()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ name: 'ideas.md', type: 'file' })
  })

  it('defaults to the vault root', async () => {
    const { res } = await call('/api/files/listdir')
    expect(res.json().map((n) => n.name)).toContain('Projects')
  })

  it('forbids traversal', async () => {
    const { res } = await call('/api/files/listdir?path=..')
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/files/search', () => {
  it('finds a keyword', async () => {
    const { res } = await call('/api/files/search?q=hello')
    const hits = res.json()
    expect(hits).toHaveLength(1)
    expect(hits[0].path).toBe('Projects/ideas.md')
  })

  it('requires the q parameter', async () => {
    const { res } = await call('/api/files/search')
    expect(res.statusCode).toBe(400)
  })

  it('returns an empty list when nothing matches', async () => {
    const { res } = await call('/api/files/search?q=zzzz')
    expect(res.json()).toEqual([])
  })
})

describe('POST /api/files/mkdir', () => {
  it('creates a directory inside the vault', async () => {
    const { res } = await call('/api/files/mkdir', { method: 'POST', body: { path: 'New/Folder' } })
    expect(res.json()).toEqual({ ok: true })
    expect(fs.statSync(path.join(vault, 'New/Folder')).isDirectory()).toBe(true)
  })

  it('requires a path', async () => {
    const { res } = await call('/api/files/mkdir', { method: 'POST', body: {} })
    expect(res.statusCode).toBe(400)
  })

  it('forbids traversal', async () => {
    const { res } = await call('/api/files/mkdir', { method: 'POST', body: { path: '../evil' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/files/upload', () => {
  it('stores a base64 image under images/', async () => {
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: Buffer.from('fake-png').toString('base64'), ext: 'png' },
    })
    const { path: stored } = res.json()
    expect(stored.startsWith('images/')).toBe(true)
    expect(readVaultFile(vault, stored)).toBe('fake-png')
  })

  it('rejects an unsafe extension', async () => {
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: 'AAAA', ext: '../evil' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a body without data', async () => {
    const { res } = await call('/api/files/upload', { method: 'POST', body: { ext: 'png' } })
    expect(res.statusCode).toBe(400)
  })

  it('answers a url an editor can paste straight into markdown', async () => {
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: Buffer.from('fake-png').toString('base64'), ext: 'png' },
    })
    const { path: stored, url } = res.json()
    expect(url).toBe(`/${stored}`)
  })

  it('honours the configured default folder', async () => {
    writeSettings({ imageDefaultDir: 'attachments' })
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: Buffer.from('x').toString('base64'), ext: 'png' },
    })
    const { dir, path: stored } = res.json()
    expect(dir).toBe('attachments')
    expect(vaultExists(vault, stored)).toBe(true)
  })

  it('sends an image to the folder its note matches', async () => {
    writeSettings({
      imageRules: [
        { id: 'r1', name: 'Journals', pattern: '^Journals/', target: 'assets/{year}/{month}', enabled: true },
      ],
    })
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: {
        data: Buffer.from('fake-png').toString('base64'),
        ext: 'png',
        notePath: 'Journals/2026/2026-03/2026-03-01.md',
      },
    })
    const { dir, ruleId, ruleName, path: stored, url } = res.json()
    expect(dir).toBe(`assets/${CURRENT_YEAR}/${CURRENT_MONTH}`)
    expect(ruleId).toBe('r1')
    expect(ruleName).toBe('Journals')
    expect(readVaultFile(vault, stored)).toBe('fake-png')
    // The url handed to the editor must actually resolve back to those bytes —
    // that round trip is what makes a rule-configured folder visible in a note.
    const served = await call(url)
    expect(served.res.statusCode).toBe(200)
    expect(served.res.getHeader('content-type')).toBe('image/png')
    expect(served.res.text()).toBe('fake-png')
  })

  it('ignores a rule that would write outside the vault', async () => {
    writeSettings({
      imageRules: [{ id: 'bad', name: 'Escape', pattern: '.*', target: '../outside', enabled: true }],
    })
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: Buffer.from('x').toString('base64'), ext: 'png', notePath: 'Projects/ideas.md' },
    })
    expect(res.json().dir).toBe('images')
    expect(vaultExists(vault, '../outside')).toBe(false)
  })

  it('never lets a malformed rules list break an upload', async () => {
    writeSettings({ imageRules: 'not-an-array', imageDefaultDir: 42 })
    const { res } = await call('/api/files/upload', {
      method: 'POST',
      body: { data: Buffer.from('x').toString('base64'), ext: 'png', notePath: 'Projects/ideas.md' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().dir).toBe('images')
  })
})

describe('POST /api/files/resolve-image-dir', () => {
  it('previews the folder stored settings resolve to', async () => {
    writeSettings({
      imageRules: [{ id: 'r1', name: 'Journals', pattern: '^Journals/', target: 'assets/journals', enabled: true }],
    })
    const { res } = await call('/api/files/resolve-image-dir', {
      method: 'POST',
      body: { notePath: 'Journals/2026/2026-03/2026-03-01.md' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ dir: 'assets/journals', ruleId: 'r1', ruleName: 'Journals' })
  })

  it('previews rules the settings page has not persisted yet', async () => {
    // The UI debounces its write, so it sends the live values: they must win
    // over whatever is on disk.
    writeSettings({ imageRules: [] })
    const { res } = await call('/api/files/resolve-image-dir', {
      method: 'POST',
      body: {
        notePath: 'Projects/ideas.md',
        imageRules: [{ id: 'draft', name: 'Draft', pattern: '^Projects/', target: 'assets/projects', enabled: true }],
        imageDefaultDir: 'images',
      },
    })
    expect(res.json()).toMatchObject({ dir: 'assets/projects', ruleId: 'draft' })
  })

  it('reports a miss as the default folder', async () => {
    const { res } = await call('/api/files/resolve-image-dir', {
      method: 'POST',
      body: { notePath: 'Projects/ideas.md' },
    })
    expect(res.json()).toEqual({ dir: 'images', ruleId: '', ruleName: '' })
  })

  it('rejects a malformed body', async () => {
    const res = fakeRes()
    await handleApi(
      fakeReq({ url: '/api/files/resolve-image-dir', method: 'POST', body: '{oops' }),
      res,
      apiUrl('/api/files/resolve-image-dir'),
    )
    expect(res.statusCode).toBe(400)
  })
})

describe('tasks endpoints', () => {
  it('GET /api/month-tasks returns the month\'s tasks', async () => {
    const { res } = await call('/api/month-tasks?year=2026&month=3')
    expect(res.json()).toEqual({
      year: '2026',
      month: '03',
      tasks: [
        { date: '2026-03-01', done: false, text: 'buy milk' },
        { date: '2026-03-01', done: true, text: 'water plants' },
      ],
    })
  })

  it('GET /api/month-tasks rejects an invalid month', async () => {
    const { res } = await call('/api/month-tasks?year=2026&month=13')
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/all-tasks aggregates every date', async () => {
    const { res } = await call('/api/all-tasks')
    expect(res.json().tasks['2026-03-01']).toEqual([
      { done: false, text: 'buy milk' },
      { done: true, text: 'water plants' },
    ])
  })

  it('POST /api/month-tasks toggles a task and persists it', async () => {
    const { res } = await call('/api/month-tasks', {
      method: 'POST',
      body: { date: '2026-03-01', text: 'buy milk', done: true },
    })
    expect(res.json()).toEqual({ ok: true })
    expect(readVaultFile(vault, 'Journals/2026/2026-03/2026-03-01.md')).toContain('* [x] buy milk')
  })

  it('POST /api/month-tasks rejects a bad body', async () => {
    const { res } = await call('/api/month-tasks', {
      method: 'POST',
      body: { date: '2026-03-01', text: 'buy milk', done: 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/month-tasks 400s when the task is not found', async () => {
    const { res } = await call('/api/month-tasks', {
      method: 'POST',
      body: { date: '2026-03-01', text: 'nope', done: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ ok: false, error: 'task not found' })
  })
})

describe('app-config endpoints', () => {
  it('GET /api/app-config returns the loaded config', async () => {
    const { res } = await call('/api/app-config')
    expect(res.statusCode).toBe(200)
    expect(typeof res.json()).toBe('object')
  })

  it('POST /api/app-config rejects an empty vaultPath', async () => {
    const { res } = await call('/api/app-config', { method: 'POST', body: { vaultPath: '  ' } })
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/app-config rejects a non-string vaultPath', async () => {
    const { res } = await call('/api/app-config', { method: 'POST', body: { vaultPath: 42 } })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/vault/probe', () => {
  it('reports an existing directory', async () => {
    const { res } = await call('/api/vault/probe', { method: 'POST', body: { path: vault } })
    expect(res.json()).toEqual({ exists: true })
  })

  it('reports a file as not a directory', async () => {
    const { res } = await call('/api/vault/probe', {
      method: 'POST',
      body: { path: path.join(vault, 'Projects/ideas.md') },
    })
    expect(res.json()).toEqual({ exists: false })
  })

  it('reports a missing path', async () => {
    const { res } = await call('/api/vault/probe', {
      method: 'POST',
      body: { path: '/no/such/directory' },
    })
    expect(res.json()).toEqual({ exists: false })
  })

  it('treats an empty body as not existing', async () => {
    const { res } = await call('/api/vault/probe', { method: 'POST', body: {} })
    expect(res.json()).toEqual({ exists: false })
  })
})

describe('POST /api/ai/config', () => {
  it('persists a provider list and pins the active provider', async () => {
    const { res } = await call('/api/ai/config', {
      method: 'POST',
      body: {
        providers: [
          { id: 'p1', name: 'One', apiKey: 'k1', baseURL: 'https://one.local/v1', model: 'm1' },
          { id: 'p2', name: 'Two', apiKey: 'k2', baseURL: 'https://two.local/v1', model: 'm2' },
        ],
        activeProvider: 'p2',
      },
    })
    expect(res.json()).toEqual({ ok: true })
    const saved = readSettings()
    expect(saved.aiProviders).toHaveLength(2)
    expect(saved.aiActiveProvider).toBe('p2')
  })

  it('falls back to the first provider when the active id is unknown', async () => {
    await call('/api/ai/config', {
      method: 'POST',
      body: {
        providers: [{ id: 'p1', name: 'One', apiKey: 'k1', model: 'm1' }],
        activeProvider: 'missing',
      },
    })
    const saved = readSettings()
    expect(saved.aiActiveProvider).toBe('p1')
  })

  it('sanitizes provider and model fields', async () => {
    await call('/api/ai/config', {
      method: 'POST',
      body: {
        providers: [
          {
            id: 42,
            apiKey: 'k',
            model: 'm',
            models: [{ id: 'm', name: 'm', toolCalling: 1, vision: 0, maxInputTokens: 100 }],
          },
          null,
          'garbage',
        ],
      },
    })
    const saved = readSettings()
    expect(saved.aiProviders).toHaveLength(1)
    expect(saved.aiProviders[0].id).toBe('')
    expect(saved.aiProviders[0].name).toBe('Untitled')
    expect(saved.aiProviders[0].vendor).toBe('customendpoint')
    expect(saved.aiProviders[0].models[0]).toMatchObject({
      toolCalling: true,
      vision: false,
      maxInputTokens: 100,
    })
  })

  it('supports the legacy flat fields', async () => {
    await call('/api/ai/config', {
      method: 'POST',
      body: { apiKey: 'sk-flat', baseURL: 'https://flat.local/v1', model: 'flat-model', models: [' a ', '', 'b'] },
    })
    const saved = readSettings()
    expect(saved.aiApiKey).toBe('sk-flat')
    expect(saved.aiBaseURL).toBe('https://flat.local/v1')
    expect(saved.aiModel).toBe('flat-model')
    expect(saved.aiModels).toEqual(['a', 'b'])
  })

  it('merges into existing settings instead of replacing them', async () => {
    writeSettings({ keepMe: true })
    await call('/api/ai/config', { method: 'POST', body: { apiKey: 'k', model: 'm' } })
    const saved = readSettings()
    expect(saved.keepMe).toBe(true)
    expect(saved.aiApiKey).toBe('k')
  })
})

describe('POST /api/proxy/config', () => {
  it('persists a custom proxy url', async () => {
    const { res } = await call('/api/proxy/config', {
      method: 'POST',
      body: { mode: 'custom', proxyUrl: 'http://127.0.0.1:7890' },
    })
    expect(res.json()).toEqual({ ok: true })
    const saved = readSettings()
    expect(saved.proxyMode).toBe('custom')
    expect(saved.proxyUrl).toBe('http://127.0.0.1:7890/')
  })

  it('rejects a non-http custom proxy url', async () => {
    const { res } = await call('/api/proxy/config', {
      method: 'POST',
      body: { mode: 'custom', proxyUrl: 'ftp://evil.example' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.text()).toContain('invalid proxy url')
  })

  it('normalizes an unknown mode to direct', async () => {
    await call('/api/proxy/config', { method: 'POST', body: { mode: 'nonsense' } })
    expect(readSettings().proxyMode).toBe('direct')
  })

  it('defaults proxyMode to direct when absent', async () => {
    await call('/api/proxy/config', { method: 'POST', body: {} })
    expect(readSettings().proxyMode).toBe('direct')
  })

  it('rejects malformed JSON', async () => {
    const res = fakeRes()
    await handleApi(
      fakeReq({ url: '/api/proxy/config', method: 'POST', body: '{oops' }),
      res,
      apiUrl('/api/proxy/config'),
    )
    expect(res.statusCode).toBe(400)
  })
})

describe('settings.json raw editor', () => {
  it('GET /api/settings/raw returns the on-disk settings text', async () => {
    writeSettings({ theme: 'dark', appZoom: 120 })
    const { res } = await call('/api/settings/raw')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.content).toBe('string')
    expect(JSON.parse(body.content)).toMatchObject({ theme: 'dark', appZoom: 120 })
  })

  it('PUT /api/settings/raw overwrites the file and round-trips', async () => {
    const { res } = await call('/api/settings/raw', {
      method: 'PUT',
      body: { content: JSON.stringify({ theme: 'light', note: 'manual' }, null, 2) },
    })
    expect(res.json()).toEqual({ ok: true })
    const saved = readSettings()
    expect(saved.theme).toBe('light')
    expect(saved.note).toBe('manual')
  })

  it('rejects malformed JSON without touching the stored file', async () => {
    writeSettings({ theme: 'dark' })
    const { res } = await call('/api/settings/raw', {
      method: 'PUT',
      body: { content: '{ this is not json ' },
    })
    expect(res.statusCode).toBe(400)
    expect(readSettings().theme).toBe('dark')
  })

  it('does not leak settings.json into the vault', async () => {
    await call('/api/settings/raw', {
      method: 'PUT',
      body: { content: JSON.stringify({ theme: 'light' }) },
    })
    expect(vaultExists(vault, 'settings.json')).toBe(false)
  })
})

describe('POST /api/ai/chat', () => {
  it('400s when no provider is configured', async () => {
    const { res } = await call('/api/ai/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.text()).toContain('AI not configured')
  })

  it('400s on an invalid baseURL', async () => {
    writeSettings({ aiApiKey: 'k', aiModel: 'm', aiBaseURL: 'not a url' })
    const { res } = await call('/api/ai/chat', { method: 'POST', body: { messages: [] } })
    expect(res.statusCode).toBe(400)
    expect(res.text()).toContain('baseURL')
  })

  it('502s when the upstream request throws', async () => {
    writeSettings({ aiApiKey: 'k', aiModel: 'm', aiBaseURL: 'https://upstream.local/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const { res } = await call('/api/ai/chat', { method: 'POST', body: { messages: [] } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('ECONNREFUSED')
  })

  it('forwards the upstream status when the provider rejects the request', async () => {
    writeSettings({ aiApiKey: 'k', aiModel: 'm', aiBaseURL: 'https://upstream.local/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })),
    )
    const { res } = await call('/api/ai/chat', { method: 'POST', body: { messages: [] } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toContain('unauthorized')
  })

  it('streams the upstream body through as SSE', async () => {
    writeSettings({ aiApiKey: 'k', aiModel: 'm', aiBaseURL: 'https://upstream.local/v1' })
    const encoder = new TextEncoder()
    const { ReadableStream } = await import('node:stream/web')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[]}\n\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: stream })))
    const res = fakeRes()
    await handleApi(
      fakeReq({ url: '/api/ai/chat', method: 'POST', body: { messages: [] } }),
      res,
      apiUrl('/api/ai/chat'),
    )
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('text/event-stream')
    // The stream pump is started without awaiting, so flush the microtask queue.
    await new Promise((r) => setTimeout(r, 0))
    expect(res.text()).toContain('data: {"choices":[]}')
  })
})

describe('GET /api/settings/public', () => {
  // The first-paint script in index.html reads this synchronously before React
  // mounts. It used to fetch /notes/settings.json, a path only 2 of the 3 hosts
  // served — on Electron the request 404'd and the desktop app silently lost
  // its saved theme and zoom on every cold start.
  it('returns the theme and zoom without any secret', async () => {
    writeSettings({
      theme: 'dark',
      appZoom: 130,
      aiApiKey: 'sk-flat',
      aiProviders: [{ id: 'p1', name: 'p', apiKey: 'sk-secret', models: [] }],
    })
    const { res } = await call('/api/settings/public')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ theme: 'dark', appZoom: 130 })
    expect(JSON.stringify(body)).not.toContain('sk-')
  })

  it('answers an empty object for a vault with no settings file', async () => {
    const { res } = await call('/api/settings/public')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ aiProviders: [] })
  })
})

describe('static routes', () => {
  it('serves a cached image from images/', async () => {
    const { ReadableStream } = await import('node:stream/web')
    void ReadableStream
    writeVaultFile(vault, 'images/pic.png', 'binary')
    const { res } = await call('/images/pic.png')
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('image/png')
    expect(res.getHeader('cache-control')).toBe('public, max-age=86400')
  })

  it('never serves a file outside images/', async () => {
    // %2e%2e is a double-dot segment for the URL parser, so it is normalized
    // away before handleApi runs and the route never matches.
    const { handled, res } = await call('/images/%2e%2e/%2e%2e/etc/passwd')
    expect(handled).toBe(false)
    expect(res.text()).toBe('')
  })

  it('keeps an encoded slash inside the vault instead of escaping', async () => {
    // ..%2f survives URL parsing (only %2e variants are normalized), and the
    // images route does not decode it, so the path stays inside the vault.
    const { res } = await call('/images/..%2f..%2fetc/passwd')
    expect(res.statusCode).toBe(404)
  })

  it('lets the URL normalizer strip ".." so the route no longer matches', async () => {
    // /images/../Projects/ideas.md is normalized to /Projects/ideas.md before
    // handleApi sees it, which is not an /images/ route at all.
    const { handled } = await call('/images/../Projects/ideas.md')
    expect(handled).toBe(false)
  })

  it('404s a missing image', async () => {
    const { res } = await call('/images/nope.png')
    expect(res.statusCode).toBe(404)
  })

  it('serves an image from any vault folder a save rule can name', async () => {
    writeVaultFile(vault, 'assets/2026/09/shot.png', 'binary')
    const { res } = await call('/vault/assets/2026/09/shot.png')
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('image/png')
    expect(res.getHeader('cache-control')).toBe('public, max-age=86400')
  })

  it('serves an image whose folder name needs percent-encoding', async () => {
    writeVaultFile(vault, 'assets/项目/截图.png', 'binary')
    const { res } = await call('/vault/assets/' + encodeURIComponent('项目') + '/'
      + encodeURIComponent('截图.png'))
    expect(res.statusCode).toBe(200)
  })

  it('refuses anything that is not an image, so settings.json stays private', async () => {
    // The vault root holds settings.json — which carries every AI provider's
    // API key — and the /vault/ route accepts arbitrary paths. The extension
    // allowlist is the only thing standing between the two.
    writeVaultFile(vault, 'settings.json', '{"aiProviders":[{"apiKey":"sk-secret"}]}')
    const { res } = await call('/vault/settings.json')
    expect(res.statusCode).toBe(403)
    expect(res.text()).not.toContain('sk-secret')
  })

  it('refuses a traversal that survives URL parsing', async () => {
    writeVaultFile(vault, 'images/pic.png', 'binary')
    const { res } = await call('/vault/..%2f..%2fetc/passwd')
    expect(res.statusCode).toBe(403)
  })

  it('404s a missing image under /vault/', async () => {
    const { res } = await call('/vault/assets/nope.png')
    expect(res.statusCode).toBe(404)
  })

  it('serves a liteapp asset without caching', async () => {
    writeVaultFile(vault, '.LiteApp/demo/index.html', '<h1>hi</h1>')
    const { res } = await call('/liteapp/demo/index.html')
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('text/html; charset=utf-8')
    expect(res.getHeader('cache-control')).toBe('no-cache')
  })

  it('blocks a traversal that survives URL parsing and reaches decodeURIComponent', async () => {
    // /liteapp/ decodes its segment before joining. "..%2f" is NOT normalized
    // away by the URL parser, so it decodes to a real "../" and must be caught
    // by safeJoin — this is the second line of defence.
    const { res } = await call('/liteapp/..%2f..%2fetc/passwd')
    expect(res.statusCode).toBe(403)
  })

  it('exposes the shared MIME table', () => {
    expect(MIME['.md']).toBeUndefined()
    expect(MIME['.svg']).toBe('image/svg+xml')
    expect(MIME['.woff2']).toBe('font/woff2')
  })
})

describe('initBackend', () => {
  it('rebinds the vault root and the log directory', () => {
    const target = makeTmpVault()
    initBackend({ vaultPath: target })
    expect(getVaultDir()).toBe(path.resolve(target))
    const { res } = fakeRes()
    void res
  })

  it('keeps the current vault when no path is given', () => {
    initBackend({})
    expect(getVaultDir()).toBe(vault)
  })

  it('ignores an empty vaultPath', () => {
    initBackend({ vaultPath: '' })
    expect(getVaultDir()).toBe(vault)
  })

  describe('settings storage (moved out of the vault)', () => {
    it('persists settings via the API and never creates <vault>/settings.json', async () => {
      const { res: put } = await call('/api/settings', { method: 'PUT', body: { theme: 'dark', appZoom: 130 } })
      expect(put.statusCode).toBe(200)
      const { res } = await call('/api/settings')
      const body = res.json()
      expect(body.theme).toBe('dark')
      expect(body.appZoom).toBe(130)
      // settings must NOT be written into the vault note tree
      expect(vaultExists(vault, 'settings.json')).toBe(false)
    })

    it('migrates a legacy in-vault settings.json out of the vault', async () => {
      writeVaultFile(vault, 'settings.json', JSON.stringify({ aiApiKey: 'sk-legacy' }))
      expect(vaultExists(vault, 'settings.json')).toBe(true)
      const { res } = await call('/api/settings')
      const body = res.json()
      expect(body.aiApiKey).toBe('sk-legacy')
      // legacy file removed so it no longer shows up in the note tree
      expect(vaultExists(vault, 'settings.json')).toBe(false)
    })
  })
})
