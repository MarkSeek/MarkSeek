// POST /api/ai/chat —— transparent SSE proxy to the configured provider.
//
// The editor's inline AI (continue / rewrite / summarize) talks to this route.
// The key stays on the server: it is read from settings.json through the shared
// provider resolver, never sent to the client.
import { resolveProvider, buildCompletionEndpoint } from '../ai/provider.mjs'
import { readSettings } from '../settings.mjs'
import { sendJson, badRequest } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'
import { logError } from '../log.mjs'

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleAiChat(req, res, url) {
  if (url.pathname !== '/api/ai/chat' || req.method !== 'POST') return false

  // One read serves both purposes: the AI provider AND the proxy mode the
  // outbound request will use.
  const settings = readSettings()
  const cfg = resolveProvider({ settings })
  if (!cfg) {
    logError('[markseek][ai/chat] aborted: missing apiKey or model')
    return badRequest(res, 'AI not configured (missing apiKey or model)')
  }

  let body
  try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
  const messages = body && body.messages

  // Validate upstream URL safety to avoid SSRF: only http/https are allowed
  let upstreamUrl
  try {
    upstreamUrl = buildCompletionEndpoint(cfg.baseURL)
  } catch {
    return badRequest(res, 'Invalid baseURL')
  }

  let upstream
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, messages, stream: true }),
      signal: req.signal,
    })
  } catch (e) {
    logError(
      '[markseek][ai/chat] upstream fetch failed:',
      e && e.message,
      e && e.cause ? `(cause: ${e.cause.message || e.cause})` : '',
    )
    return sendJson(res, { error: 'Upstream request failed: ' + (e && e.message) }, 502)
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    logError(`[markseek][ai/chat] upstream error ${upstream.status}:`, errText.slice(0, 500))
    return sendJson(
      res,
      { error: 'Upstream error ' + upstream.status + ': ' + errText.slice(0, 500) },
      upstream.status || 502,
    )
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  // undici (Node 18+) fetch response bodies are Web ReadableStreams without .pipe(),
  // so we read manually and forward via Node's res.write (SSE transparent proxy).
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.writableEnded) res.write(decoder.decode(value, { stream: true }))
      }
      if (!res.writableEnded) res.end()
    } catch (e) {
      logError('[markseek][ai/chat] stream error:', e && e.message)
      if (!res.writableEnded) res.end()
    }
  }
  pump()

  req.on('close', () => { try { reader.cancel() } catch { /* ignore */ } })
  return true
}
