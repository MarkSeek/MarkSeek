// Contract tests: the backend's settings schema and the frontend's UI schema
// describe the same settings.json, but they live in two languages and cannot
// import each other. These specs read the TypeScript source as text and assert
// the two sides agree, so renaming or adding a field on one side fails here
// instead of silently dropping user configuration.
//
// Every extraction asserts it found something: a regex that stops matching
// must fail loudly, not quietly pass with an empty list.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import {
  MODEL_FIELDS,
  PROVIDER_FIELDS,
  SETTINGS_DEFAULTS,
  THEMES,
  createDefaultSettings,
  publicSettings,
  sanitizeModel,
  sanitizeProvider,
} from '../settings-schema.mjs'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const schemaSource = fs.readFileSync(path.join(SRC, 'config/settingsSchema.ts'), 'utf-8')
const themeIdsSource = fs.readFileSync(path.join(SRC, 'config/themeIds.ts'), 'utf-8')

/** Every `{ key: 'x', ..., default: <value> }` field of the UI schema. */
function readFields() {
  const re =
    /key:\s*'([^']+)',[\s\S]*?\n\s*default:\s*(\[[^\]]*\]|'[^']*'|-?\d+(?:\.\d+)?|true|false)/g
  const fields = []
  for (const [, key, raw] of schemaSource.matchAll(re)) fields.push({ key, raw })
  return fields
}

function parseValue(raw) {
  if (raw.startsWith("'")) return raw.slice(1, -1)
  if (raw.startsWith('[')) return []
  if (raw === 'true') return true
  if (raw === 'false') return false
  return Number(raw)
}

/** Field names of a TS interface: `id: string` / `models: ModelConfig[]`. */
function readInterfaceFields(name) {
  const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schemaSource)
  if (!block) throw new Error(`interface ${name} not found in settingsSchema.ts`)
  return [...block[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1])
}

describe('settings defaults contract', () => {
  it('finds the UI schema fields at all', () => {
    // Guard: if the extraction breaks, every assertion below would pass on an
    // empty list and the contract would silently stop being tested.
    expect(readFields().length).toBeGreaterThanOrEqual(8)
  })

  it('mirrors every UI field with the same default value', () => {
    for (const { key, raw } of readFields()) {
      expect(SETTINGS_DEFAULTS, `backend is missing "${key}"`).toHaveProperty(key)
      expect(SETTINGS_DEFAULTS[key]).toEqual(parseValue(raw))
    }
  })

  it('agrees with the UI on the theme ids', () => {
    // src/config/themeIds.ts is what the first-paint script imports, and the
    // settings schema derives its `theme` options from it — so all three lists
    // (CSS, first paint, settings view) are one list.
    const ids = /export const THEME_IDS[^=]*=\s*\[([^\]]*)\]/.exec(themeIdsSource)
    if (!ids) throw new Error('THEME_IDS not found in src/config/themeIds.ts')
    const values = [...ids[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(values).toEqual(THEMES)
    expect(schemaSource).toContain("key: 'theme'")
    expect(SETTINGS_DEFAULTS.theme).toBe('warm')
  })
})

describe('AI provider contract', () => {
  it('coerces exactly the fields the UI schema declares', () => {
    expect(Object.keys(PROVIDER_FIELDS)).toEqual(readInterfaceFields('ProviderConfig'))
    expect(Object.keys(MODEL_FIELDS)).toEqual(readInterfaceFields('ModelConfig'))
  })

  it('fills every provider field even from an empty payload', () => {
    const provider = sanitizeProvider({})
    expect(provider).toEqual({
      id: '',
      name: 'Untitled',
      vendor: 'customendpoint',
      apiKey: '',
      apiType: 'chat-completions',
      baseURL: '',
      model: '',
      models: [],
    })
  })

  it('drops non-object models and non-numeric token limits', () => {
    const provider = sanitizeProvider({
      name: 'p',
      models: [null, 'nope', { id: 'm1', maxInputTokens: 4096, maxOutputTokens: 'lots' }],
    })
    expect(provider.models).toHaveLength(1)
    expect(provider.models[0]).toMatchObject({ id: 'm1', maxInputTokens: 4096 })
    // An unusable limit becomes absent rather than a misleading 0.
    expect(provider.models[0].maxOutputTokens).toBeUndefined()
    expect('maxOutputTokens' in provider.models[0]).toBe(true)
  })

  it('keeps a sanitized model JSON-serializable without nulls', () => {
    const json = JSON.stringify(sanitizeModel({ id: 'm', toolCalling: true }))
    expect(json).toBe(JSON.stringify({ id: 'm', name: '', url: '', toolCalling: true, vision: false }))
  })
})

describe('createDefaultSettings', () => {
  it('returns a mutable copy that does not share the provider array', () => {
    const a = createDefaultSettings()
    a.aiProviders.push({ id: 'x' })
    expect(createDefaultSettings().aiProviders).toHaveLength(0)
  })
})

describe('publicSettings', () => {
  it('strips every API key', () => {
    const safe = publicSettings({
      theme: 'dark',
      appZoom: 130,
      aiApiKey: 'sk-flat',
      aiProviders: [{ id: 'p1', name: 'p', apiKey: 'sk-secret', models: [] }],
    })
    expect(safe).toMatchObject({ theme: 'dark', appZoom: 130 })
    expect(safe.aiApiKey).toBeUndefined()
    expect(safe.aiProviders[0].apiKey).toBeUndefined()
    expect(JSON.stringify(safe)).not.toContain('sk-')
  })

  it('tolerates a settings object without any AI config', () => {
    expect(publicSettings({ theme: 'warm' })).toEqual({ theme: 'warm', aiProviders: [] })
  })
})
