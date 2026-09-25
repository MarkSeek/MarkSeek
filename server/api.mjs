// MarkSeek shared API module (used by both dev and prod).
// Pure Node, with no Vite / framework dependencies. Referenced by both vite.config.ts and app/app.js,
// so the dev and prod APIs always stay in sync.
//
// This module is now ONLY the dispatcher: it mounts the route modules and
// forwards each request to them in order. Routing tables, settings merging and
// the SSE proxy live in server/routes/*.mjs.
//
// Note agent module (independent folder): SSE tool-calling for note Q&A.
import { agentHandler } from './agent/index.mjs'

// Route groups, in the order they are consulted.
import { handleFiles } from './routes/files.mjs'
import { handleRelations } from './routes/relations.mjs'
import { handleTasks } from './routes/tasks.mjs'
import { handleConfig } from './routes/config.mjs'
import { handleAiChat } from './routes/ai.mjs'
import { handlePlugins } from './routes/plugins.mjs'
import { handleStatic } from './routes/static.mjs'
import { handleSync } from './routes/sync.mjs'

import { runtime } from './runtime.mjs'
import { sendJson } from './http/respond.mjs'

/**
 * Core handler: returns true if already handled (response sent); false if not matched (pass to the next middleware).
 * Compatible with both http.Server (req/res) and Vite middleware (req/res/next).
 * Convention: every success/error branch ends the response via sendJson/sendText/notFound, etc.,
 * all of which return true; unmatched branches explicitly return false.
 */
export async function handleApi(req, res, url) {
  // Mount the note agent (server/agent). It handles its own SSE response.
  if (url.pathname === '/api/agent/chat' || url.pathname === '/api/agent/confirm') {
    return agentHandler(req, res, runtime.proxyUrl)
  }

  if (await handleFiles(req, res, url)) return true
  if (await handleRelations(req, res, url)) return true
  if (await handleTasks(req, res, url)) return true
  if (await handleConfig(req, res, url)) return true
  if (await handleAiChat(req, res, url)) return true
  if (handlePlugins(req, res, url)) return true
  if (handleStatic(req, res, url)) return true
  if (await handleSync(req, res, url)) return true

  // Unmatched /api/* requests are client↔route mismatches (e.g. a stale build
  // calling a removed endpoint). Answer with JSON so the frontend never receives
  // the SPA's index.html (HTTP 200, HTML) — which would surface as a cryptic
  // "Unexpected token '<' … is not valid JSON" parse error.
  if (url.pathname.startsWith('/api/')) {
    return sendJson(res, { error: 'not found', path: url.pathname }, 404)
  }

  return false // not matched, pass to subsequent middleware
}

// Re-exported for the existing consumers (vite.config.ts, app/app.js,
// electron/server-adapter.mjs). Everything else now lives in the route modules.
export { initBackend, NOTES_DIR } from './runtime.mjs'
export { MIME } from './routes/static.mjs'
