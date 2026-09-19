// Recently opened notes, persisted in localStorage.
import { useCallback, useEffect, useState } from 'react'
import {
  loadRecent,
  pushRecent,
  saveRecent,
  type RecentItem,
} from '../../utils/recentStorage'

export interface RecentFilesApi {
  /** At most `RECENT_MAX` entries, newest first. */
  recentFiles: RecentItem[]
  /** Append an entry, deduped by path and moved to the front. */
  addRecent: (item: RecentItem) => void
}

export function useRecentFiles(): RecentFilesApi {
  const [recentFiles, setRecentFiles] = useState<RecentItem[]>(() => loadRecent())

  useEffect(() => {
    saveRecent(recentFiles)
  }, [recentFiles])

  const addRecent = useCallback((item: RecentItem) => {
    setRecentFiles((prev) => pushRecent(prev, item))
  }, [])

  return { recentFiles, addRecent }
}
