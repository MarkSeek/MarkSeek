// i18n core: a per-language flat key dictionary system.
// t(key) reads the module-level currentLang (synced by App when settings.language changes),
// falling back to English and then to the key itself when missing, so the UI never goes blank.
import { zhCN } from './zh-CN'
import { en } from './en'
import { readRawMigrated, writeRaw } from '../utils/storage'
import { KEYS } from '../utils/storageKeys'

export type Lang = 'zh-CN' | 'en'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
]

export const DEFAULT_LANG: Lang = 'en'

const DICTS: Record<Lang, Record<string, string>> = {
  'zh-CN': zhCN,
  en,
}

// Module-level current language, so t() can be used outside React (e.g. file template generation) without a hook
// Legacy key from a previous brand is no longer read; this release does not
// migrate old data, so only the current key is consulted.
const LANG_LEGACY_KEYS: string[] = []
function readStoredLang(): Lang {
  const v = readRawMigrated(KEYS.lang, LANG_LEGACY_KEYS)
  if (v === 'zh-CN' || v === 'en') return v
  return DEFAULT_LANG
}
let currentLang: Lang = readStoredLang()

export function setLang(lang: Lang) {
  currentLang = lang
  writeRaw(KEYS.lang, lang)
}

export function getLang(): Lang {
  return currentLang
}

/**
 * Translation function. Supports {name}-style variable interpolation.
 * Missing key: falls back to English, then to the key string itself.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentLang] ?? DICTS[DEFAULT_LANG]
  let str: string = dict[key]
  if (str === undefined) str = DICTS[DEFAULT_LANG][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

// React compatibility: useTranslation returns t and the current language so dependent components re-render on language change
import { useSettings } from '../context/SettingsContext'

export function useTranslation() {
  const { values } = useSettings()
  const lang = (values.language as Lang) || DEFAULT_LANG
  // Sync the module-level language for use by the non-component t()
  setLang(lang)
  return { t, lang }
}
