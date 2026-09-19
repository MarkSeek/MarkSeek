import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { agentHandler } from '../index.mjs'
import { setVaultDir, resetVaultDir } from '../../vault.mjs'
import { setLogDir } from '../../log.mjs'
import { writeSettings } from '../../settings.mjs'
import { setAppDataDir } from '../../appdata.mjs'
import { fakeReq, fakeRes, parseSse } from '../../__tests__/helpers/http.mjs'
import { makeTmpVault, cleanupTmpVaults } from '../../__tests__/helpers/tmp-vault.mjs'

afterAll(cleanupTmpVaults)

beforeEach(() => {
  const v = makeTmpVault()
  setVaultDir(v)
  setAppDataDir(v)
  setLogDir(path.join(v, 'logs'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetVaultDir()
})

/** Drive agentHandler with a fake request and await the SSE response. */
async function call(url, { method = 'POST', body = {} } = {}) {
  const res = fakeRes()
  const handled = await agentHandler(fakeReq({ url, method, body }), res)
  return { handled, res, frames: parseSse(res) }
}

describe('agentHandler routing', () => {
  it('claims POST /api/agent/chat', async () => {
    // No provider configured in the empty vault, so the run ends immediately.
    setVaultDir(makeTmpVault())
    const { handled } = await call('/api/agent/chat')
    expect(handled).toBe(true)
  })

  it('claims POST /api/agent/confirm', async () => {
    setVaultDir(makeTmpVault())
    const { handled } = await call('/api/agent/confirm')
    expect(handled).toBe(true)
  })

  it('leaves GET requests to the next middleware', async () => {
    const { handled } = await call('/api/agent/chat', { method: 'GET' })
    expect(handled).toBe(false)
  })

  it('leaves unrelated paths to the next middleware', async () => {
    const { handled } = await call('/api/files/list')
    expect(handled).toBe(false)
  })
})

describe('agentHandler SSE response', () => {
  it('writes the streaming headers', async () => {
    setVaultDir(makeTmpVault())
    const { res } = await call('/api/agent/chat')
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('text/event-stream')
    expect(res.getHeader('cache-control')).toBe('no-cache, no-transform')
    expect(res.getHeader('x-accel-buffering')).toBe('no')
  })

  it('emits an error frame when no provider is configured', async () => {
    setVaultDir(makeTmpVault())
    const { frames, res } = await call('/api/agent/chat')
    expect(frames.find((f) => f.event === 'error').data.message).toMatch(
      /No AI provider configured/,
    )
    expect(frames.at(-1).event).toBe('done')
    expect(res.ended).toBe(true)
  })

  it('emits an error frame when the body is not valid JSON', async () => {
    setVaultDir(makeTmpVault())
    const res = fakeRes()
    // Send a raw (non-JSON) payload so the handler falls back to an empty body.
    await agentHandler(fakeReq({ url: '/api/agent/chat', method: 'POST', body: 'not json' }), res)
    const frames = parseSse(res)
    expect(frames.some((f) => f.event === 'error')).toBe(true)
  })

  it('ends the response even when the body carries nothing usable', async () => {
    setVaultDir(makeTmpVault())
    const res = fakeRes()
    await agentHandler(fakeReq({ url: '/api/agent/chat', method: 'POST', body: '}{' }), res)
    expect(res.ended).toBe(true)
  })

  it('emits error + done when the upstream call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    )
    // A provider is configured, so runAgent reaches the network and fails.
    const root = makeTmpVault()
    setVaultDir(root)
    setAppDataDir(root)
    writeSettings({ aiApiKey: 'k', aiModel: 'm' })
    const { frames, res } = await call('/api/agent/chat')
    const events = frames.map((f) => f.event)
    expect(events).toContain('error')
    expect(events).toContain('done')
    expect(res.ended).toBe(true)
  })
})
