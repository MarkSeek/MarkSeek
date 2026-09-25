// Editor drafts and the debounced autosave.
//
// The editor streams every keystroke here instead of straight into the tab
// state, so a dirty tab can be flushed to disk without waiting for React to
// re-render. Anything that replaces the file from the outside (agent write,
// calendar task drag, diary page turn) must call `clearDraft` first, otherwise
// the stale buffer is flushed back over the new content.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { writeFile } from '../../api/files'
import type { Tab } from './tabsReducer'

/** Idle time after the last keystroke before the draft is written. */
export const AUTO_SAVE_DELAY = 2000

export interface DraftAutosaveOptions {
  getTabs: () => Tab[]
  markSaved: (id: string) => void
}

export interface DraftAutosaveApi {
  /** Buffer the newest editor content and (re)arm the debounced save. */
  setDraft: (id: string, content: string) => void
  /** Drop the pending save and forget the buffered content. */
  clearDraft: (id: string) => void
  hasDraft: (id: string) => boolean
  saveFile: (id: string) => Promise<void>
  /** Cancel the debounced save but keep the buffered content. */
  cancelTimer: (id: string) => void
  /** Write every buffered draft out (used when the page goes away). */
  flushDirty: () => void
}

export function useDraftAutosave({ getTabs, markSaved }: DraftAutosaveOptions): DraftAutosaveApi {
  const draftsRef = useRef<Record<string, string>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Which tab the pending timer belongs to. Without it we could not tell
  // whether clearing the timer would drop another tab's unsaved edits.
  const timerTargetRef = useRef<string | null>(null)

  const saveFile = useCallback(
    async (id: string) => {
      const tab = getTabs().find((t) => t.id === id)
      if (!tab) return
      // A picture tab holds no text: writing it back would truncate the file.
      if (tab.kind === 'image') return
      const contentToSave = draftsRef.current[id]
      // No buffered edits: nothing to write.
      if (contentToSave === undefined) return
      try {
        // The diary virtual page writes to the real date file, not to its id.
        await writeFile(tab.filePath ?? tab.path, contentToSave)
        delete draftsRef.current[id]
        markSaved(id)
        // Let the sync layer (onSave auto mode) know a file was persisted.
        if (typeof document !== 'undefined' && document.dispatchEvent) {
          document.dispatchEvent(new CustomEvent('markseek:note-saved'))
        }
      } catch (e) {
        console.error('Failed to save file:', e)
      }
    },
    [getTabs, markSaved],
  )

  const cancelTimer = useCallback((id: string) => {
    if (timerRef.current && timerTargetRef.current === id) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      timerTargetRef.current = null
    }
  }, [])

  const clearDraft = useCallback(
    (id: string) => {
      cancelTimer(id)
      delete draftsRef.current[id]
    },
    [cancelTimer],
  )

  const setDraft = useCallback((id: string, content: string) => {
    // Nothing about a picture is editable, so it never buffers a draft.
    if (getTabs().find((t) => t.id === id)?.kind === 'image') return
    draftsRef.current[id] = content
    if (timerRef.current) clearTimeout(timerRef.current)
    timerTargetRef.current = id
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      timerTargetRef.current = null
      void saveFile(id)
    }, AUTO_SAVE_DELAY)
  }, [getTabs, saveFile])

  const hasDraft = useCallback((id: string) => draftsRef.current[id] !== undefined, [])

  const flushDirty = useCallback(() => {
    const ids = Object.keys(draftsRef.current)
    if (ids.length === 0) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      timerTargetRef.current = null
    }
    for (const id of ids) {
      // saveFile is async; on a real unload the request may be dropped, but
      // visibilitychange fires early enough that it usually lands.
      void saveFile(id)
    }
  }, [saveFile])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // The 2s debounce cannot be relied upon across an unload, and drafts are
  // never persisted, so the latest edits have to hit disk here.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushDirty()
    }
    window.addEventListener('pagehide', flushDirty)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushDirty)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushDirty])

  // A stable identity keeps every consumer callback (open / switch / close)
  // from being rebuilt on each render.
  return useMemo(
    () => ({ setDraft, clearDraft, hasDraft, saveFile, cancelTimer, flushDirty }),
    [cancelTimer, clearDraft, flushDirty, hasDraft, saveFile, setDraft],
  )
}
