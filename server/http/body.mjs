// Request body readers shared by every backend route.
//
// Two entry points on purpose:
//   - readJsonBody() – most routes want a parsed object.
//   - readRawBody()  – the agent parses the text itself so it can answer with
//                      an SSE error frame instead of a 400.
//
// Previously api.mjs and agent/index.mjs each had their own copy with a
// different size cap and (worse) different failure behaviour: the agent's
// version destroyed the request on overflow but still resolved with the
// truncated body.

const MB = 1024 * 1024

/** Default cap for ordinary JSON routes (must accommodate base64 images). */
export const DEFAULT_BODY_LIMIT = 20 * MB

/** The agent only ever receives text (messages + note context), so it caps lower. */
export const MAX_AGENT_BODY_BYTES = 5 * MB

/**
 * Buffer the whole request body as text.
 * @param {import('http').IncomingMessage} req
 * @param {Object} [opts]
 * @param {number} [opts.limit] maximum accepted size in bytes
 * @returns {Promise<string>}
 */
export function readRawBody(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      // Reject oversized payloads instead of buffering them to completion.
      if (body.length > limit) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * Read and parse a JSON body. A blank body resolves to `{}`; malformed JSON or
 * a non-object payload rejects so the route can answer 400.
 * @param {import('http').IncomingMessage} req
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<Record<string, any>>}
 */
export async function readJsonBody(req, options) {
  const raw = await readRawBody(req, options)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) // throws on malformed JSON -> caller answers 400
  return parsed && typeof parsed === 'object' ? parsed : {}
}
