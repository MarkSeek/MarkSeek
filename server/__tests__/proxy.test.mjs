import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { setLogDir } from '../log.mjs'
import { makeTmpVault, cleanupTmpVaults } from './helpers/tmp-vault.mjs'

// undici is replaced with a spy harness so the specs never open a socket.
const undiciMock = vi.hoisted(() => ({
  setGlobalDispatcher: vi.fn(),
  getGlobalDispatcher: vi.fn(() => ({ id: 'default-dispatcher' })),
  ProxyAgent: vi.fn(function ProxyAgent(url) {
    this.url = url
  }),
}))
vi.mock('undici', () => undiciMock)

const childProcessMock = vi.hoisted(() => ({ execSync: vi.fn() }))
vi.mock('node:child_process', () => childProcessMock)

const {
  normalizeProxyMode,
  validateProxyUrl,
  detectWindowsSystemProxy,
  windowsProxyServerToUrl,
  resolveProxyUrl,
  applyProxyDispatcher,
  applyProxyFromSettings,
  maskProxyUrl,
} = await import('../proxy.mjs')

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']

let savedEnv
let savedPlatform

beforeEach(() => {
  setLogDir(path.join(makeTmpVault(), 'logs'))
  savedEnv = {}
  for (const k of PROXY_ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  savedPlatform = process.platform
  undiciMock.setGlobalDispatcher.mockClear()
  undiciMock.getGlobalDispatcher.mockClear()
  undiciMock.ProxyAgent.mockClear()
  childProcessMock.execSync.mockReset()
})

afterEach(() => {
  for (const k of PROXY_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true })
})

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

/** The dispatcher passed to the most recent setGlobalDispatcher() call. */
function lastDispatcher() {
  const calls = undiciMock.setGlobalDispatcher.mock.calls
  return calls[calls.length - 1][0]
}

afterEach(cleanupTmpVaults)

describe('normalizeProxyMode', () => {
  it('passes through the two proxy modes', () => {
    expect(normalizeProxyMode('system')).toBe('system')
    expect(normalizeProxyMode('custom')).toBe('custom')
  })

  it('falls back to direct for anything else', () => {
    expect(normalizeProxyMode('direct')).toBe('direct')
    expect(normalizeProxyMode('nonsense')).toBe('direct')
    expect(normalizeProxyMode(undefined)).toBe('direct')
    expect(normalizeProxyMode(null)).toBe('direct')
    expect(normalizeProxyMode(123)).toBe('direct')
  })
})

describe('validateProxyUrl', () => {
  it('accepts http and https urls', () => {
    expect(validateProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890/')
    expect(validateProxyUrl('https://proxy.example.com:8080')).toBe('https://proxy.example.com:8080/')
  })

  it('rejects non-http protocols', () => {
    expect(validateProxyUrl('javascript:alert(1)')).toBeUndefined()
    expect(validateProxyUrl('ftp://proxy.example.com')).toBeUndefined()
    expect(validateProxyUrl('file:///etc/passwd')).toBeUndefined()
    expect(validateProxyUrl('data:text/plain,hi')).toBeUndefined()
  })

  it('rejects malformed or empty input', () => {
    expect(validateProxyUrl('')).toBeUndefined()
    expect(validateProxyUrl('   ')).toBeUndefined()
    expect(validateProxyUrl('not a url')).toBeUndefined()
    expect(validateProxyUrl(undefined)).toBeUndefined()
    expect(validateProxyUrl(null)).toBeUndefined()
    expect(validateProxyUrl({})).toBeUndefined()
  })

  it('rejects a url without a host', () => {
    expect(validateProxyUrl('http://')).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    expect(validateProxyUrl('  http://127.0.0.1:7890  ')).toBe('http://127.0.0.1:7890/')
  })
})

describe('windowsProxyServerToUrl', () => {
  it('converts a bare host:port to an http proxy url', () => {
    expect(windowsProxyServerToUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890/')
  })

  it('keeps an explicit scheme', () => {
    expect(windowsProxyServerToUrl('https://proxy.example.com:8080')).toBe(
      'https://proxy.example.com:8080/',
    )
  })

  it('prefers the https entry of a per-scheme list', () => {
    expect(windowsProxyServerToUrl('http=1.2.3.4:80;https=5.6.7.8:443')).toBe(
      'http://5.6.7.8:443/',
    )
  })

  it('falls back to http then ftp in a per-scheme list', () => {
    // Ports are always coerced to an http:// proxy url, so the default port 80
    // is normalized away by the URL parser.
    expect(windowsProxyServerToUrl('http=1.2.3.4:80')).toBe('http://1.2.3.4/')
    expect(windowsProxyServerToUrl('ftp=1.2.3.4:21')).toBe('http://1.2.3.4:21/')
  })

  it('returns undefined for empty or unusable input', () => {
    expect(windowsProxyServerToUrl('')).toBeUndefined()
    expect(windowsProxyServerToUrl(undefined)).toBeUndefined()
    expect(windowsProxyServerToUrl('   ')).toBeUndefined()
    expect(windowsProxyServerToUrl('javascript:alert(1)')).toBeUndefined()
  })
})

describe('resolveProxyUrl', () => {
  it('returns undefined in direct mode', () => {
    expect(resolveProxyUrl({ proxyMode: 'direct', proxyUrl: 'http://x:1' })).toBeUndefined()
    expect(resolveProxyUrl({})).toBeUndefined()
    expect(resolveProxyUrl()).toBeUndefined()
  })

  it('validates the custom url', () => {
    expect(resolveProxyUrl({ proxyMode: 'custom', proxyUrl: 'http://x:1' })).toBe('http://x:1/')
    expect(resolveProxyUrl({ proxyMode: 'custom', proxyUrl: 'ftp://x:1' })).toBeUndefined()
    expect(resolveProxyUrl({ proxyMode: 'custom' })).toBeUndefined()
  })

  it('honours the legacy aiProxyMode / aiProxyUrl aliases', () => {
    expect(resolveProxyUrl({ aiProxyMode: 'custom', aiProxyUrl: 'http://legacy:1' })).toBe(
      'http://legacy:1/',
    )
    expect(resolveProxyUrl({ aiProxyMode: 'system' })).toBeUndefined()
  })

  it('treats an empty custom url as "unset" and falls back to the legacy value', () => {
    expect(
      resolveProxyUrl({ proxyMode: 'custom', proxyUrl: '', aiProxyUrl: 'http://old:1' }),
    ).toBe('http://old:1/')
  })

  it('prefers the injected system proxy over env vars', () => {
    process.env.HTTP_PROXY = 'http://env-proxy:1'
    expect(resolveProxyUrl({ proxyMode: 'system' }, 'http://injected:2')).toBe('http://injected:2/')
  })

  it('falls back to env vars in system mode', () => {
    process.env.HTTPS_PROXY = 'http://https-proxy:1'
    expect(resolveProxyUrl({ proxyMode: 'system' })).toBe('http://https-proxy:1/')

    delete process.env.HTTPS_PROXY
    process.env.https_proxy = 'http://lower-https:2'
    expect(resolveProxyUrl({ proxyMode: 'system' })).toBe('http://lower-https:2/')

    delete process.env.https_proxy
    process.env.HTTP_PROXY = 'http://http-proxy:3'
    expect(resolveProxyUrl({ proxyMode: 'system' })).toBe('http://http-proxy:3/')

    delete process.env.HTTP_PROXY
    process.env.http_proxy = 'http://lower-http:4'
    expect(resolveProxyUrl({ proxyMode: 'system' })).toBe('http://lower-http:4/')
  })

  it('ignores an invalid injected system proxy', () => {
    expect(resolveProxyUrl({ proxyMode: 'system' }, 'javascript:alert(1)')).toBeUndefined()
  })
})

describe('applyProxyDispatcher', () => {
  it('installs a ProxyAgent for a valid url', () => {
    const result = applyProxyDispatcher('http://127.0.0.1:7890')
    expect(result).toEqual({ applied: true, mode: 'proxy', host: '127.0.0.1:7890' })
    expect(undiciMock.ProxyAgent).toHaveBeenCalledWith('http://127.0.0.1:7890/')
    expect(undiciMock.setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it('restores the default dispatcher for direct / invalid urls', () => {
    expect(applyProxyDispatcher(undefined)).toEqual({ applied: false, mode: 'direct' })
    expect(applyProxyDispatcher('ftp://nope')).toEqual({ applied: false, mode: 'direct' })
    expect(undiciMock.ProxyAgent).not.toHaveBeenCalled()
    expect(undiciMock.setGlobalDispatcher).toHaveBeenCalledWith({ id: 'default-dispatcher' })
  })

  it('falls back to direct when the agent cannot be built', () => {
    undiciMock.ProxyAgent.mockImplementationOnce(() => {
      throw new Error('bad url')
    })
    expect(applyProxyDispatcher('http://127.0.0.1:7890')).toEqual({
      applied: false,
      mode: 'direct',
    })
    expect(undiciMock.setGlobalDispatcher).toHaveBeenCalled()
  })

  it('restores the ORIGINAL direct dispatcher, not the currently installed one', () => {
    // Regression: getGlobalDispatcher() returns the CURRENT dispatcher, so
    // re-applying it after a proxy was installed left the process stuck on the
    // old proxy. The capture-at-import instance is what makes "direct" stick.
    applyProxyDispatcher('http://127.0.0.1:7890')
    const installedProxy = lastDispatcher()
    applyProxyDispatcher(undefined)
    const restored = lastDispatcher()
    expect(restored).not.toBe(installedProxy)
    // Restoring twice must reuse the very same direct dispatcher instance.
    applyProxyDispatcher(undefined)
    expect(lastDispatcher()).toBe(restored)
  })
})

describe('maskProxyUrl', () => {
  it('hides credentials before a url reaches a log or an SSE frame', () => {
    expect(maskProxyUrl('http://user:pass@127.0.0.1:7890/')).toBe('http://***@127.0.0.1:7890/')
  })

  it('leaves a credential-free url untouched', () => {
    expect(maskProxyUrl('http://127.0.0.1:7890/')).toBe('http://127.0.0.1:7890/')
  })

  it('reports direct for an empty url', () => {
    expect(maskProxyUrl(undefined)).toBe('(direct)')
    expect(maskProxyUrl('')).toBe('(direct)')
  })
})

describe('applyProxyFromSettings', () => {
  it('resolves then applies in one step', () => {
    applyProxyFromSettings({ proxyMode: 'custom', proxyUrl: 'http://p:1' })
    expect(undiciMock.ProxyAgent).toHaveBeenCalledWith('http://p:1/')
  })

  it('tolerates a missing settings object', () => {
    expect(() => applyProxyFromSettings()).not.toThrow()
    expect(undiciMock.setGlobalDispatcher).toHaveBeenCalledWith({ id: 'default-dispatcher' })
  })
})

describe('detectWindowsSystemProxy', () => {
  const registryOutput = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    127.0.0.1:7890',
    '',
  ].join('\n')

  it('returns undefined off Windows without touching the registry', () => {
    setPlatform('linux')
    expect(detectWindowsSystemProxy()).toBeUndefined()
    expect(childProcessMock.execSync).not.toHaveBeenCalled()
  })

  it('reads the proxy server when the proxy is enabled', () => {
    setPlatform('win32')
    childProcessMock.execSync.mockReturnValue(registryOutput)
    expect(detectWindowsSystemProxy()).toBe('127.0.0.1:7890')
    expect(childProcessMock.execSync).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when the proxy is disabled', () => {
    setPlatform('win32')
    childProcessMock.execSync.mockReturnValue(
      registryOutput.replace('0x1', '0x0'),
    )
    expect(detectWindowsSystemProxy()).toBeUndefined()
  })

  it('returns undefined when no server is configured', () => {
    setPlatform('win32')
    childProcessMock.execSync.mockReturnValue(
      '    ProxyEnable    REG_DWORD    0x1\n',
    )
    expect(detectWindowsSystemProxy()).toBeUndefined()
  })

  it('swallows registry query failures', () => {
    setPlatform('win32')
    childProcessMock.execSync.mockImplementation(() => {
      throw new Error('reg not found')
    })
    expect(detectWindowsSystemProxy()).toBeUndefined()
  })
})
