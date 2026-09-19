// User-facing text of a plugin manifest for the active language.
//
// A plugin ships its own translations in `plugin.json` under `i18n`, so a plugin
// folder stays self-contained and third-party plugins can be localized without
// a host release. The root `name` / `description` are the fallback used whenever
// the active language has no entry — which is why they should be written in the
// app's default language (English).
import type { Lang } from '../i18n'
import type { PluginManifest } from '../../plugins/types'

export interface PluginText {
  name: string
  description: string
}

export function pluginText(manifest: PluginManifest, lang: Lang): PluginText {
  const localized = manifest.i18n?.[lang]
  return {
    name: localized?.name || manifest.name,
    description: localized?.description || manifest.description || '',
  }
}
