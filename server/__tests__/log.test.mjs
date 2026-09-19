import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { setLogDir, logInfo, logError, attachResLogger } from '../log.mjs'
import { makeTmpVault, cleanupTmpVaults } from './helpers/tmp-vault.mjs'

let logDir

beforeEach(() => {
  logDir = path.join(makeTmpVault(), 'logs')
  setLogDir(logDir)
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(cleanupTmpVaults)

function logFile() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return path.join(logDir, `markseek-${stamp}.log`)
}

function readLog() {
  try {
    return fs.readFileSync(logFile(), 'utf-8')
  } catch {
    return ''
  }
}

describe('log module', () => {
  it('creates the log directory lazily and appends a timestamped line', () => {
    logInfo('hello from test')
    const text = readLog()
    expect(text).toContain('hello from test')
    // "[HH:MM:SS.mmm] message"
    expect(text).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] hello from test$/m)
  })

  it('appends instead of overwriting', () => {
    logInfo('first')
    logInfo('second')
    const lines = readLog().trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('first')
    expect(lines[1]).toContain('second')
  })

  it('mirrors info to console.log and errors to console.error', () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    logInfo('an info line')
    logError('an error line')
    expect(info).toHaveBeenCalledWith('an info line')
    expect(error).toHaveBeenCalledWith('an error line')
  })

  it('survives circular references instead of throwing', () => {
    const circular = { name: 'loop' }
    circular.self = circular
    expect(() => logError('circular:', circular)).not.toThrow()
    // JSON.stringify fails on a cycle, so the raw String() fallback is used.
    expect(readLog()).toContain('[object Object]')
  })

  it('handles BigInt values that JSON.stringify rejects', () => {
    expect(() => logInfo('big:', 10n)).not.toThrow()
    expect(readLog()).toContain('10')
  })

  it('joins mixed string and object arguments', () => {
    logInfo('prefix', { a: 1 }, 'suffix')
    expect(readLog()).toContain('prefix {"a":1} suffix')
  })

  it('never throws when the log directory cannot be created', () => {
    // A regular file sits in place of the target directory, so mkdirSync fails.
    const blocker = path.join(logDir, '..', 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    setLogDir(path.join(blocker, 'logs'))
    expect(() => logInfo('should not explode')).not.toThrow()
  })
})

describe('attachResLogger', () => {
  it('writes to the file and forwards an SSE log event', () => {
    const writes = []
    const res = { write: (chunk) => writes.push(chunk) }
    const log = attachResLogger(res)
    log('streamed line')

    expect(readLog()).toContain('streamed line')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toBe('event: log\ndata: {"line":"streamed line"}\n\n')
  })

  it('swallows write errors once the response is closed', () => {
    const res = {
      write: () => {
        throw new Error('response closed')
      },
    }
    const log = attachResLogger(res)
    expect(() => log('after close')).not.toThrow()
    expect(readLog()).toContain('after close')
  })
})
