import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { saveAiConfig, saveProxyConfig } from '../api/aiConfigClient'
import { loadSettings as fetchSettings, saveSettings } from '../api/settingsClient'
import { getAppConfig, setAppConfig } from '../api/appConfig'
import { SETTINGS_DEFAULTS, type SettingsValues, type ProviderConfig } from '../config/settingsSchema'

// AI config fields (aiProviders / aiActiveProvider) are not written directly by the frontend;
// they go through the backend POST /api/ai/config into the app data directory (moved out of the
// vault, stored per vault).
const AI_KEYS = new Set(['aiProviders', 'aiActiveProvider'])

// Network proxy fields (proxyMode / proxyUrl) are global settings, not AI-specific; they go through
// the backend POST /api/proxy/config into the app data directory and apply to the global dispatcher immediately.
const PROXY_KEYS = new Set(['proxyMode', 'proxyUrl'])

export interface SettingsContextValue {
  ready: boolean
  values: SettingsValues
  get: <K extends keyof SettingsValues>(key: K) => SettingsValues[K]
  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
  reset: () => void
  // Re-read settings from disk (e.g. after the raw editor writes a new file).
  reload: () => Promise<void>
  // Vault (application-level config, decoupled from note settings.json)
  vaultPath: string | null
  vaultReady: boolean
  setVault: (path: string) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

// Migration: the old flat aiApiKey/aiBaseURL/aiModel/aiModels are folded into a single provider automatically
function migrateLegacy(parsed: Record<string, any>): Record<string, any> {
  if (Array.isArray(parsed.aiProviders)) return parsed
  const hasLegacy = ['aiApiKey', 'aiBaseURL', 'aiModel', 'aiModels'].some((k) => k in parsed)
  if (!hasLegacy) return parsed
  const id = 'p_' + Math.random().toString(36).slice(2, 9)
  const legacyModels: string[] = Array.isArray(parsed.aiModels) ? parsed.aiModels : []
  parsed.aiProviders = [
    {
      id,
      name: 'Default Provider',
      vendor: 'customendpoint',
      apiKey: parsed.aiApiKey || '',
      apiType: 'chat-completions',
      baseURL: parsed.aiBaseURL || 'https://api.deepseek.com',
      model: parsed.aiModel || (legacyModels[0] ?? ''),
      models: legacyModels.map((m) => ({ id: m, name: m })),
    },
  ]
  parsed.aiActiveProvider = parsed.aiProviders[0].id
  delete parsed.aiApiKey
  delete parsed.aiBaseURL
  delete parsed.aiModel
  delete parsed.aiModels
  return parsed
}

async function loadSettings(): Promise<SettingsValues> {
  try {
    const raw = await fetchSettings()
    if (raw && typeof raw === 'object') {
      const parsed = migrateLegacy(raw)
      // Merge defaults, tolerating missing fields
      return { ...SETTINGS_DEFAULTS, ...parsed }
    }
  } catch (e) {
    console.error('Failed to read settings, using defaults', e)
  }
  return { ...SETTINGS_DEFAULTS }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // The theme is already applied before the first frame via an inline script in index.html's <head,
  // which pre-reads settings.json and sets <html data-theme>; no localStorage fallback needed here.
  const initialValues: SettingsValues = { ...SETTINGS_DEFAULTS }
  const [values, setValues] = useState<SettingsValues>(initialValues)
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<SettingsValues>({ ...SETTINGS_DEFAULTS })

  // Vault (application-level config) state
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [vaultReady, setVaultReady] = useState(false)

  // Load on startup; if missing, write back the default config
  useEffect(() => {
    let cancelled = false
    loadSettings().then((loaded) => {
      if (cancelled) return
      pending.current = loaded
      setValues(loaded)
      setReady(true)
      // Write back once after the first frame load to ensure the settings file exists in the app data dir
      saveSettings(loaded).catch((e) => console.error('Failed to initialize settings', e))
    })
    // Load app-level config (vault path). On failure vaultPath stays null and the wizard guides the user.
    getAppConfig()
      .then((cfg) => {
        if (cancelled) return
        if (cfg && cfg.vaultPath) {
          setVaultPath(cfg.vaultPath)
          setVaultReady(true)
        } else {
          setVaultReady(true)
        }
      })
      .catch((e) => {
        console.error('Failed to read app-config', e)
        if (!cancelled) setVaultReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the vault path into the application-level config.
  const setVault = async (p: string) => {
    const trimmed = p.trim()
    await setAppConfig({ vaultPath: trimmed })
    setVaultPath(trimmed)
  }

  const persist = (next: SettingsValues) => {
    pending.current = next
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveSettings(pending.current).catch((e) => console.error('Failed to write settings', e))
    }, 300)
  }

  const get = <K extends keyof SettingsValues>(key: K): SettingsValues[K] => values[key]

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setValues((prev) => {
      // UI zoom: not below 50 or above 200 (clamp on direct out-of-range input)
      const clampedValue =
        key === 'appZoom' && typeof value === 'number'
          ? Math.min(200, Math.max(50, value))
          : value
      const next = { ...prev, [key]: clampedValue }
      if (AI_KEYS.has(key as string)) {
        // AI config: only update in-memory state; the backend writes it back to settings.json
        const patch: { providers?: ProviderConfig[]; activeProvider?: string } = {}
        if (Array.isArray(prev.aiProviders)) patch.providers = prev.aiProviders as ProviderConfig[]
        if (typeof prev.aiActiveProvider === 'string') patch.activeProvider = prev.aiActiveProvider
        // Overwrite only the fields changed this time, ensuring the latest values are reported
        if (key === 'aiProviders') patch.providers = value as ProviderConfig[]
        if (key === 'aiActiveProvider') patch.activeProvider = value as string
        saveAiConfig(patch).catch((e) => console.error('Failed to save AI config', e))
      } else if (PROXY_KEYS.has(key as string)) {
        // Network proxy: only update in-memory state; the backend writes it back to settings.json and applies the dispatcher
        const patch: { mode?: string; proxyUrl?: string } = {}
        if (typeof prev.proxyMode === 'string') patch.mode = prev.proxyMode
        if (typeof prev.proxyUrl === 'string') patch.proxyUrl = prev.proxyUrl
        // Overwrite only the fields changed this time, ensuring the latest values are reported
        if (key === 'proxyMode') patch.mode = value as string
        if (key === 'proxyUrl') patch.proxyUrl = value as string
        saveProxyConfig(patch).catch((e) => console.error('Failed to save proxy config', e))
      } else {
        persist(next)
      }
      return next
    })
  }

  const reset = () => {
    const next = { ...SETTINGS_DEFAULTS }
    setValues(next)
    persist(next)
  }

  const reload = async () => {
    const loaded = await loadSettings()
    pending.current = loaded
    setValues(loaded)
    setReady(true)
  }

  return (
    <SettingsContext.Provider value={{ ready, values, get, set, reset, reload, vaultPath, vaultReady, setVault }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
