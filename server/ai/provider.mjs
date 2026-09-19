// Everything the backend needs to talk to the configured OpenAI-compatible
// provider:
//   1. resolveProvider()      – pick the active provider from settings.json
//   2. buildCompletionEndpoint() – turn its baseURL into a chat-completions URL
//
// This module is the SINGLE source of truth. /api/ai/chat (server/api.mjs) and
// the note agent (server/agent/loop.mjs) both go through it, so the two can
// never drift apart again (they previously each carried a copy of the
// resolution rules, and the copies had already diverged: only the agent read
// `toolCalling` and only the agent knew the provider's `vendor`).
import { readSettings } from '../settings.mjs'

// Used whenever the provider (or the legacy flat fields) leaves baseURL empty.
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// Reported when the provider carries no explicit vendor.
export const DEFAULT_VENDOR = 'openai-compatible'

/**
 * @typedef {Object} ProviderConfig
 * @property {string} apiKey
 * @property {string} baseURL
 * @property {string} model
 * @property {boolean} toolCalling
 * @property {string} vendor
 */

/** @returns {string} trimmed value, or '' for anything else. */
function str(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Pick the provider the user activated, falling back to the first entry.
 * @param {any[]} providers
 * @param {string} [activeId]
 */
function findProvider(providers, activeId) {
  return providers.find((p) => p && p.id === activeId) || providers[0] || {}
}

/**
 * Find the model entry matching `modelId`. Entries are matched on `id` first
 * and `name` second because the UI stores the alias in `id`.
 * @param {any} models
 * @param {string} [modelId]
 */
function findModel(models, modelId) {
  if (!Array.isArray(models)) return undefined
  return models.find((m) => m && (m.id || m.name) === modelId)
}

/**
 * Resolve the active provider from an already-read settings object.
 * Exported separately so specs can cover the rules without touching the disk.
 * @param {Record<string, any>} settings
 * @returns {ProviderConfig} never null — an unconfigured provider simply yields
 *   empty strings that resolveProvider() then rejects.
 */
export function resolveProviderFromSettings(settings) {
  const providers = Array.isArray(settings.aiProviders) ? settings.aiProviders : []

  // Legacy flat fields (no provider list configured yet).
  if (!providers.length) {
    return {
      apiKey: str(settings.aiApiKey),
      baseURL: str(settings.aiBaseURL) || DEFAULT_BASE_URL,
      model: str(settings.aiModel),
      toolCalling: false,
      vendor: DEFAULT_VENDOR,
    }
  }

  const active = findProvider(providers, settings.aiActiveProvider)
  const modelId = str(active.model)
  const model = findModel(active.models, modelId)

  return {
    apiKey: str(active.apiKey),
    // A model-level url overrides the provider baseURL.
    baseURL: str(model && model.url) || str(active.baseURL) || DEFAULT_BASE_URL,
    // Prefer the model's real name for the request; `id` is only a UI alias.
    model: str(model && (model.name || model.id)) || modelId,
    toolCalling: Boolean(model && model.toolCalling),
    vendor: str(active.vendor) || DEFAULT_VENDOR,
  }
}

/**
 * Resolve the provider the backend should use right now.
 * @param {Object} [opts]
 * @param {Record<string, any>} [opts.settings] already-read settings; skips the
 *   file read entirely (used by callers that also need the raw settings).
 * @returns {ProviderConfig | null} null when no usable apiKey/model is configured.
 */
export function resolveProvider({ settings } = {}) {
  const source = settings || readSettings()
  const resolved = resolveProviderFromSettings(source)

  // Placeholder keys (e.g. VS Code "${input:openaiKey}") count as unset.
  if (resolved.apiKey.startsWith('${')) resolved.apiKey = ''
  if (!resolved.apiKey || !resolved.model) return null
  return resolved
}

/**
 * Build the chat-completions URL from a provider baseURL.
 * baseURL may already be the full endpoint (incl. /v1/chat/completions); only
 * append the path when it is not present, so we never double-append.
 * @throws when the resolved protocol is not http/https (SSRF guard).
 * @param {string} baseURL
 * @returns {string}
 */
export function buildCompletionEndpoint(baseURL) {
  const endpoint = String(baseURL ?? '').trim().replace(/\/+$/, '')
  // Concatenate instead of `new URL('/chat/completions', endpoint)`: a leading
  // slash makes the reference path-absolute, which DISCARDS the base path and
  // turns the common "https://host/v1" baseURL into "https://host/chat/completions".
  const url = endpoint.endsWith('/chat/completions')
    ? new URL(endpoint)
    : new URL(endpoint + '/chat/completions')
  // SSRF guard: only http/https allowed.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid provider baseURL protocol.')
  }
  return url.toString()
}
