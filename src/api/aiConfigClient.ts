// The frontend no longer writes AI config directly to settings.json; it goes through the backend.
// The backend POST /api/ai/config merges and writes back to notes/settings.json's
// aiProviders / aiActiveProvider fields (compatible with the old flat fields).

import type { ProviderConfig } from '../config/settingsSchema'

export interface AiConfigPatch {
  // New multi-provider structure
  providers?: ProviderConfig[]
  activeProvider?: string
  // Compatible with the old flat fields (single-provider quick write)
  apiKey?: string
  baseURL?: string
  model?: string
  models?: string[]
}

export async function saveAiConfig(cfg: AiConfigPatch): Promise<void> {
  const res = await fetch('/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to save AI config (${res.status}): ${errText}`)
  }
}

// Network proxy is a global setting (not AI-specific) and is written separately via backend
// POST /api/proxy/config to notes/settings.json's proxyMode / proxyUrl fields, and applied
// immediately to the global dispatcher.
export interface ProxyConfigPatch {
  // Proxy mode: direct / system / custom
  mode?: string
  // Custom proxy URL (only used in custom mode), supports http://user:pass@host:port
  proxyUrl?: string
}

export async function saveProxyConfig(cfg: ProxyConfigPatch): Promise<void> {
  const res = await fetch('/api/proxy/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to save proxy config (${res.status}): ${errText}`)
  }
}
