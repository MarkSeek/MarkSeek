import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { resolveProvider, resolveProviderFromSettings, buildCompletionEndpoint } from '../provider.mjs'
import { makeTmpVault, cleanupTmpVaults } from '../../__tests__/helpers/tmp-vault.mjs'
import { setVaultDir } from '../../vault.mjs'
import { setAppDataDir } from '../../appdata.mjs'
import { writeSettings, settingsPath } from '../../settings.mjs'

afterAll(cleanupTmpVaults)

/** Resolve straight from a settings object — covers the rules without any fs. */
function fromSettings(settings) {
  return resolveProvider({ settings })
}

describe('resolveProvider', () => {
  it('returns null when settings are missing', () => {
    const root = makeTmpVault()
    setVaultDir(root)
    setAppDataDir(root)
    expect(resolveProvider({})).toBeNull()
  })

  it('returns null for unparsable settings', () => {
    const root = makeTmpVault()
    setVaultDir(root)
    setAppDataDir(root)
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), '{ not json')
    expect(resolveProvider({})).toBeNull()
  })

  it('returns null when key or model is missing', () => {
    expect(fromSettings({ aiModel: 'm' })).toBeNull()
    expect(fromSettings({ aiApiKey: 'k' })).toBeNull()
    expect(fromSettings({})).toBeNull()
    expect(fromSettings({ unrelated: true })).toBeNull()
  })

  it('treats a ${...} placeholder key as unset', () => {
    expect(fromSettings({ aiApiKey: '${input:openaiKey}', aiModel: 'm' })).toBeNull()
  })

  it('resolves the legacy flat fields', () => {
    expect(fromSettings({ aiApiKey: 'sk-legacy', aiModel: 'gpt-4o-mini' })).toEqual({
      apiKey: 'sk-legacy',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      toolCalling: false,
      vendor: 'openai-compatible',
    })
  })

  it('keeps a custom legacy baseURL', () => {
    expect(fromSettings({ aiApiKey: 'k', aiModel: 'm', aiBaseURL: 'https://llm.local/v1' }).baseURL).toBe(
      'https://llm.local/v1',
    )
  })

  it('picks the active provider from the list', () => {
    const cfg = fromSettings({
      aiProviders: [
        { id: 'a', apiKey: 'ka', model: 'ma', baseURL: 'https://a.local/v1' },
        { id: 'b', apiKey: 'kb', model: 'mb', baseURL: 'https://b.local/v1' },
      ],
      aiActiveProvider: 'b',
    })
    expect(cfg.apiKey).toBe('kb')
    expect(cfg.model).toBe('mb')
    expect(cfg.baseURL).toBe('https://b.local/v1')
  })

  it('falls back to the first provider when the active id is unknown', () => {
    const cfg = fromSettings({
      aiProviders: [
        { id: 'a', apiKey: 'ka', model: 'ma' },
        { id: 'b', apiKey: 'kb', model: 'mb' },
      ],
      aiActiveProvider: 'does-not-exist',
    })
    expect(cfg.apiKey).toBe('ka')
  })

  it('defaults baseURL and vendor to the OpenAI-compatible fallback', () => {
    const cfg = fromSettings({ aiProviders: [{ id: 'a', apiKey: 'ka', model: 'ma' }] })
    expect(cfg.baseURL).toBe('https://api.openai.com/v1')
    expect(cfg.vendor).toBe('openai-compatible')
  })

  it('keeps the provider vendor when it declares one', () => {
    const cfg = fromSettings({
      aiProviders: [{ id: 'a', vendor: 'deepseek', apiKey: 'ka', model: 'ma' }],
    })
    expect(cfg.vendor).toBe('deepseek')
  })

  it('applies model-level url and name overrides', () => {
    const cfg = fromSettings({
      aiProviders: [
        {
          id: 'a',
          apiKey: 'ka',
          model: 'alias',
          models: [{ id: 'alias', name: 'real-model-name', url: 'https://model.local/v1' }],
        },
      ],
      aiActiveProvider: 'a',
    })
    expect(cfg.model).toBe('real-model-name')
    expect(cfg.baseURL).toBe('https://model.local/v1')
  })

  it('reads toolCalling from the matching model entry', () => {
    const cfg = fromSettings({
      aiProviders: [
        { id: 'a', apiKey: 'ka', model: 'm', models: [{ id: 'm', name: 'm', toolCalling: true }] },
      ],
      aiActiveProvider: 'a',
    })
    expect(cfg.toolCalling).toBe(true)
  })

  it('reports toolCalling false when the model entry is absent', () => {
    const cfg = fromSettings({
      aiProviders: [{ id: 'a', apiKey: 'ka', model: 'm', models: [] }],
      aiActiveProvider: 'a',
    })
    expect(cfg.toolCalling).toBe(false)
  })

  it('ignores an empty provider list and falls through to legacy fields', () => {
    const cfg = fromSettings({
      aiProviders: [],
      aiApiKey: 'sk-fallback',
      aiModel: 'legacy-model',
    })
    expect(cfg.apiKey).toBe('sk-fallback')
    expect(cfg.model).toBe('legacy-model')
  })

  it('reads the settings from the app-data dir when none are passed', () => {
    const root = makeTmpVault()
    setVaultDir(root)
    setAppDataDir(root)
    writeSettings({ aiApiKey: 'k', aiModel: 'm' })
    expect(resolveProvider({}).model).toBe('m')
  })
})

describe('resolveProviderFromSettings', () => {
  it('never returns null so callers can inspect a partial config', () => {
    expect(resolveProviderFromSettings({})).toEqual({
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      model: '',
      toolCalling: false,
      vendor: 'openai-compatible',
    })
  })

  it('does not strip a ${...} placeholder — that is resolveProvider\'s job', () => {
    expect(resolveProviderFromSettings({ aiApiKey: '${x}', aiModel: 'm' }).apiKey).toBe('${x}')
  })
})

describe('buildCompletionEndpoint', () => {
  it('appends /chat/completions to a bare baseURL', () => {
    expect(buildCompletionEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  it('tolerates a trailing slash', () => {
    expect(buildCompletionEndpoint('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    expect(buildCompletionEndpoint('https://api.openai.com/v1///')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  it('does not double-append an explicit endpoint', () => {
    expect(buildCompletionEndpoint('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    expect(buildCompletionEndpoint('http://localhost:1234/v1/chat/completions')).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
  })

  it('rejects non-http protocols as an SSRF guard', () => {
    expect(() => buildCompletionEndpoint('ftp://evil.example/v1')).toThrow(
      /Invalid provider baseURL protocol/,
    )
    expect(() => buildCompletionEndpoint('file:///etc')).toThrow()
  })

  it('throws for an empty baseURL', () => {
    expect(() => buildCompletionEndpoint('')).toThrow()
    expect(() => buildCompletionEndpoint(undefined)).toThrow()
  })
})
