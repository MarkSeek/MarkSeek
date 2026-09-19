// File-backed logger for the MarkSeek backend (shared Web + Electron).
//
// Goal: the Electron main process console isn't visible to the user (no F12),
// so we ALSO mirror every backend diagnostic line to a rotated daily log file
// under the vault's logs/ directory. The frontend can additionally surface a
// subset of these via an SSE `log` event (see agent/loop.mjs + agent/sse.ts).
//
// Usage: import { logInfo, logError, attachResLogger } from './log.mjs'
//   - logInfo('[markseek][agent] ...') writes to console + file.
//   - logError(...) same for errors.
//   - attachResLogger(res) returns a `log(text)` fn that writes to console +
//     file AND forwards the line to the live SSE response as a `log` event.
import fs from 'node:fs'
import path from 'node:path'

// The vault dir may change after config load; set via setLogDir().
let LOG_DIR = path.resolve(process.cwd(), 'app', 'logs')

export function setLogDir(dir) {
  if (dir && typeof dir === 'string') LOG_DIR = dir
}

function todayStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// Append one line to today's log file. Failures are silently ignored so we
// never crash the request path over logging.
function appendToFile(line) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    const file = path.join(LOG_DIR, `markseek-${todayStamp()}.log`)
    fs.appendFileSync(file, line + '\n', 'utf-8')
  } catch {
    /* ignore */
  }
}

function emit(level, args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')
  const ts = timestamp()
  const out = `[${ts}] ${text}`
  appendToFile(out)
  // Mirror to the real console for the Web dev server.
  if (level === 'error') console.error(text)
  else console.log(text)
  return text
}

function safeStringify(v) {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function logInfo(...args) {
  return emit('info', args)
}

export function logError(...args) {
  return emit('error', args)
}

/**
 * Bind a logger to a live SSE response. The returned `log(text)` writes the
 * line to console + file AND emits an SSE `log` event so the frontend F12
 * console can show backend diagnostics in real time.
 * @param {import('http').ServerResponse} res
 * @returns {(text: string) => void}
 */
export function attachResLogger(res) {
  return (text) => {
    const ts = timestamp()
    const out = `[${ts}] ${text}`
    appendToFile(out)
    console.log(text)
    try {
      res.write(`event: log\ndata: ${JSON.stringify({ line: text })}\n\n`)
    } catch {
      /* response already closed */
    }
  }
}
