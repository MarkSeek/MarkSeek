import { describe, expect, it } from 'vitest'
import { pluginText } from '../manifestI18n'
import type { PluginManifest } from '../../../plugins/types'

const manifest: PluginManifest = {
  id: 'demo',
  name: 'Demo Plugin',
  version: '1.0.0',
  description: 'A demo plugin.',
  entry: 'index.js',
  i18n: {
    'zh-CN': { name: '示例插件', description: '一个示例插件。' },
  },
}

describe('pluginText', () => {
  it('uses the manifest defaults for the default language', () => {
    expect(pluginText(manifest, 'en')).toEqual({
      name: 'Demo Plugin',
      description: 'A demo plugin.',
    })
  })

  it('uses the localized copy when the language is covered', () => {
    expect(pluginText(manifest, 'zh-CN')).toEqual({
      name: '示例插件',
      description: '一个示例插件。',
    })
  })

  it('falls back per field and defaults the description to empty', () => {
    const partial: PluginManifest = {
      ...manifest,
      description: undefined,
      i18n: { 'zh-CN': { name: '示例插件' } },
    }
    expect(pluginText(partial, 'zh-CN')).toEqual({ name: '示例插件', description: '' })
  })

  it('falls back to the defaults when a plugin ships no translations', () => {
    const bare: PluginManifest = { ...manifest, i18n: undefined }
    expect(pluginText(bare, 'zh-CN')).toEqual({
      name: 'Demo Plugin',
      description: 'A demo plugin.',
    })
  })
})
