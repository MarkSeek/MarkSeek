// Agent module: HTTP route assembly for the note agent.
// Exposes:
//   POST /api/agent/chat   -> SSE tool-calling run (resumable via confirmations)
//   POST /api/agent/confirm -> helper endpoint; simply forwards to /api/agent/chat
//                              with the user's decision so the loop can continue.
import { runAgent } from './loop.mjs'
import { setLogDir } from '../log.mjs'
import { readJsonBody, MAX_AGENT_BODY_BYTES } from '../http/body.mjs'

// The vault dir is set later via initBackend (api.mjs); it calls setLogDir there.
// Default to the cwd logs so Web dev still gets a file even before init.
setLogDir(undefined)

/**
 * Handle one agent HTTP request. Returns true when the request was an agent
 * route (and the response was written), false otherwise so the caller can fall
 * through to other routes.
 */
export async function agentHandler(req, res, proxyUrl) {
  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  if (
    (pathname === '/api/agent/chat' || pathname === '/api/agent/confirm') &&
    req.method === 'POST'
  ) {
    // A malformed payload degrades to an empty run rather than a 400: the SSE
    // stream is the only channel the client listens on here.
    let body = {}
    try {
      body = await readJsonBody(req, { limit: MAX_AGENT_BODY_BYTES })
    } catch {
      body = {}
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx and friends) so tokens reach the client
      // as they are produced instead of being held until the response completes.
      'X-Accel-Buffering': 'no',
    })

    const messages = Array.isArray(body.messages) ? body.messages : []
    const context = body.context || {}
    const mode = body.mode === 'ask' ? 'ask' : 'agent'
    // Both endpoints accept confirmations; /confirm just carries them.
    const confirmations = Array.isArray(body.confirmations) ? body.confirmations : []

    try {
      await runAgent({ res, messages, context, confirmations, mode, proxyUrl })
    } catch (e) {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: e.message || 'Agent failed.' })}\n\n`,
        )
        res.write(`event: done\ndata: {}\n\n`)
      } catch {
        /* ignore */
      }
    } finally {
      res.end()
    }
    return true
  }

  // Not an agent route.
  return false
}
