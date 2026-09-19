// Relations API.
//
// The whole-vault scan lives in the backend now (POST /api/relations): the
// panel sends the note it is looking at and gets the finished result back,
// instead of downloading every note and running the regex scan on the UI
// thread.
import type { RelationResult } from '../utils/relations'

/**
 * @param path    vault-relative path of the current note
 * @param content the editor's live text; sent so unsaved edits are reflected
 * @param signal  lets the panel drop a request it no longer needs
 */
export async function fetchRelations(
  path: string,
  content?: string,
  signal?: AbortSignal,
): Promise<RelationResult> {
  const res = await fetch('/api/relations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
    signal,
  })
  if (!res.ok) throw new Error('Failed to load relations')
  return res.json()
}
