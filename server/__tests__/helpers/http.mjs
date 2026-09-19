// Minimal fake IncomingMessage / ServerResponse so the backend handlers can be
// driven without binding a real socket.
import { EventEmitter } from 'node:events'

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.method]
 * @param {string | object} [opts.body] string is sent verbatim, objects are JSON encoded
 */
export function fakeReq({ url, method = 'GET', body = '' } = {}) {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  req.destroy = () => {}
  process.nextTick(() => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    if (payload) req.emit('data', payload)
    req.emit('end')
  })
  return req
}

export function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    writableEnded: false,
    setHeader(key, value) {
      res.headers[String(key).toLowerCase()] = value
      return res
    },
    getHeader(key) {
      return res.headers[String(key).toLowerCase()]
    },
    writeHead(status, headers) {
      res.statusCode = status
      for (const [k, v] of Object.entries(headers || {})) {
        res.headers[String(k).toLowerCase()] = v
      }
      return res
    },
    write(chunk) {
      res.chunks.push(String(chunk))
      return true
    },
    end(data) {
      if (data !== undefined && data !== null) res.chunks.push(String(data))
      res.ended = true
      res.writableEnded = true
      return res
    },
    text() {
      return res.chunks.join('')
    },
    json() {
      return JSON.parse(res.text())
    },
  }
  return res
}

/** Build the `url` object handleApi() expects from a raw path + query. */
export function apiUrl(raw) {
  return new URL(raw, 'http://localhost')
}

/** Collect SSE frames written to a fake res as [{ event, data }]. */
export function parseSse(res) {
  const frames = []
  let event = null
  for (const line of res.text().split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) {
      frames.push({ event, data: JSON.parse(line.slice(6).trim()) })
      event = null
    }
  }
  return frames
}
