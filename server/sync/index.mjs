// Provider registry. New backends register an instance here; the route layer
// resolves the active provider by id read from settings and never imports a
// concrete provider class directly.
import { GitSyncProvider } from './git.mjs'

/** @type {Map<string, import('./types.mjs').SyncProvider>} */
const providers = new Map()

/** Register a sync provider instance. */
export function registerProvider(provider) {
  providers.set(provider.id, provider)
}

/** Resolve a provider by id, or null when unknown. */
export function getProvider(id) {
  return providers.get(id) || null
}

/** List registered providers (id + label) for the UI dropdown. */
export function listProviders() {
  return [...providers.values()].map((p) => ({ id: p.id, label: p.label }))
}

// Built-in providers. To add another backend, implement it under server/sync/
// and register it here — no other file needs to change.
registerProvider(new GitSyncProvider())
