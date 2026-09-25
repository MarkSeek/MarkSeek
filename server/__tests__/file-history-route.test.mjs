// Integration smoke test for the file-history route handler. It validates that
// server/routes/fileHistory.mjs (and its transitive imports) load and dispatch
// correctly without needing the real vault on disk.
import { describe, expect, it } from 'vitest'
import { handleFileHistory } from '../routes/fileHistory.mjs'

function mockRes() {
  const chunks = []
  const res = {
    statusCode: 200,
    headers: {},
    writeHead(code, headers) {
      res.statusCode = code
      res.headers = headers || {}
    },
    end(chunk) {
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      res.body = Buffer.concat(chunks).toString('utf8')
    },
  }
  return res
}

describe('handleFileHistory route', () => {
  it('ignores unrelated paths', async () => {
    const res = mockRes()
    const handled = await handleFileHistory(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/unknown'),
    )
    expect(handled).toBe(false)
  })

  it('bad-requests when the path parameter is missing', async () => {
    const res = mockRes()
    const handled = await handleFileHistory(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/sync/file-history'),
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })

  it('bad-requests when oid is missing on file-at-commit', async () => {
    const res = mockRes()
    const handled = await handleFileHistory(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/sync/file-at-commit?path=note.md'),
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
  })
})
