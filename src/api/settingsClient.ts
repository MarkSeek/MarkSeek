// Full settings load/save through the backend API.
//
// Settings are no longer stored as a note file inside the vault; they live in
// the application data dir (one file per vault) and are only reachable via this
// endpoint, so they never show up in the note tree or get synced with notes.

export type SettingsDoc = Record<string, any>

/** Load the full settings document (the stored object, or {} when absent). */
export async function loadSettings(): Promise<SettingsDoc> {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error('Failed to load settings')
  const data = await res.json()
  return data && typeof data === 'object' ? data : {}
}

/**
 * Merge a partial settings object into the stored document.
 * @param partial fields to upsert (e.g. theme, appZoom, imageRules, …)
 */
export async function saveSettings(partial: SettingsDoc): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to save settings (${res.status}): ${errText}`)
  }
}

export interface RawSettings {
  content: string
}

/** Load the raw, on-disk text of settings.json for manual editing. */
export async function fetchSettingsRaw(): Promise<string> {
  const res = await fetch('/api/settings/raw')
  if (!res.ok) throw new Error('Failed to load raw settings')
  const data = (await res.json()) as RawSettings
  return data.content
}

/** Overwrite settings.json with manually edited text. Throws on invalid JSON. */
export async function saveSettingsRaw(content: string): Promise<void> {
  const res = await fetch('/api/settings/raw', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || 'Failed to save raw settings')
  }
}
