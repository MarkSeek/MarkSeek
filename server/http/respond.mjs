// HTTP response helpers shared by every backend route.
//
// Every helper returns `true` so route handlers can `return sendJson(...)`
// directly: handleApi()'s contract is "true = response already written".
// Keeping them in one module also removes the previous trap where api.mjs and
// agent/index.mjs each defined a `sendJson` with the arguments in the opposite
// order.

function send(res, status, contentType, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.end(payload)
  return true
}

/**
 * @param {import('http').ServerResponse} res
 * @param {any} data JSON-serializable payload
 * @param {number} [status]
 */
export function sendJson(res, data, status = 200) {
  return send(res, status, 'application/json;charset=utf-8', JSON.stringify(data))
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} text
 * @param {string} [contentType]
 * @param {number} [status]
 */
export function sendText(res, text, contentType = 'text/plain;charset=utf-8', status = 200) {
  return send(res, status, contentType, text)
}

export function notFound(res, msg = 'Not Found') {
  res.statusCode = 404
  res.end(msg)
  return true
}

export function forbidden(res, msg = 'forbidden') {
  res.statusCode = 403
  res.end(msg)
  return true
}

export function badRequest(res, msg = 'bad request') {
  res.statusCode = 400
  res.end(msg)
  return true
}

export function serverError(res, msg = 'server error') {
  res.statusCode = 500
  res.end(msg)
  return true
}
