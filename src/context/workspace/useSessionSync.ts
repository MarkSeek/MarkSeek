// Session persistence: reopen the workspace the user left behind, then keep the
// snapshot up to date.
//
// Only identifiers are persisted — every restored tab re-reads its file from
// disk, so an edited note always comes back current. Writing is gated on
// `sessionReadyRef`: before the restore finishes `tabs` is still empty, and
// reporting that would wipe the snapshot we are about to read.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getVaultKey, patchSession, readSession } from '../../utils/sessionStorage'
import { buildRestoredTab } from './buildRestoredTab'
import { filePathToYmd } from '../../utils/diaryPath'
import { DIARY_PREFIX, type Tab, type TabAction } from './tabsReducer'

export interface SessionSyncOptions {
  vaultPath: string | null
  /** Set once the file tree is loaded, which unblocks the restore. */
  treeReady: boolean
  tabs: Tab[]
  activeTabId: string | null
  selectedNodeId: string | null
  expandedPaths: Set<string>
  dispatch: (action: TabAction) => void
  getTabs: () => Tab[]
  openDiary: (ymd?: string) => Promise<void>
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
}

export interface SessionSyncApi {
  /** True once the snapshot has been applied (or found empty). */
  restoreChecked: boolean
}

export function useSessionSync({
  vaultPath,
  treeReady,
  tabs,
  activeTabId,
  selectedNodeId,
  expandedPaths,
  dispatch,
  getTabs,
  openDiary,
  setExpandedPaths,
}: SessionSyncOptions): SessionSyncApi {
  const sessionReadyRef = useRef(false)
  const [restoreChecked, setRestoreChecked] = useState(false)
  const restoredVaultRef = useRef<string | null>(null)
  const sessionSigRef = useRef('')

  const vaultKeyRef = useRef(getVaultKey(vaultPath))
  vaultKeyRef.current = getVaultKey(vaultPath)

  const restoreSession = useCallback(
    async (vaultKey: string) => {
      const snap = readSession(vaultKey)
      if (snap.expandedPaths.length > 0) {
        setExpandedPaths(new Set(snap.expandedPaths))
      }

      const restored: Tab[] = []
      if (snap.tabs.length > 0) {
        // Read concurrently, then reassemble in the persisted order.
        const results = await Promise.allSettled(snap.tabs.map(buildRestoredTab))
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) restored.push(r.value)
        }
      }

      // Rebuild the diary singleton BEFORE deciding the active tab. `openDiary`
      // dedupes by the fixed `__diary__` id, so this can never create a second
      // diary tab. It is not part of `restored` because `buildRestoredTab`
      // returns null for it — we reopen it explicitly so it gets the right date
      // and the `pendingDiaryYmd` wiring.
      const diaryEntry = snap.tabs.find((t) => t.kind === 'diary')
      if (diaryEntry) {
        const ymd = diaryEntry.filePath
          ? filePathToYmd(diaryEntry.filePath) ?? undefined
          : undefined
        await openDiary(ymd)
      }

      if (restored.length > 0 || diaryEntry) {
        // `openDiary` above already added the live diary singleton, so keep it
        // and drop any stale copy coming from the snapshot.
        const current = getTabs()
        const nonDiary = current.filter((t) => t.kind !== 'diary')
        const diary = current.find((t) => t.kind === 'diary')
        const base = restored.filter((t) => t.kind !== 'diary')
        const merged = diary
          ? [...base, ...nonDiary.filter((t) => !base.some((b) => b.id === t.id)), diary]
          : base
        // Active tab: the diary wins when it was active, otherwise the
        // persisted file id, otherwise the last restored tab.
        const active =
          snap.activeTabId === DIARY_PREFIX
            ? DIARY_PREFIX
            : snap.activeTabId && restored.some((t) => t.id === snap.activeTabId)
              ? snap.activeTabId
              : restored.length > 0
                ? restored[restored.length - 1].id
                : DIARY_PREFIX
        dispatch({
          type: 'replaceAll',
          tabs: merged,
          activeTabId: active,
          selectedNodeId: snap.selectedNodeId ?? active,
        })
      } else if (snap.selectedNodeId) {
        dispatch({ type: 'select', id: snap.selectedNodeId })
      }

      sessionReadyRef.current = true
      setRestoreChecked(true)
    },
    [dispatch, getTabs, openDiary, setExpandedPaths],
  )

  // Restore once the file tree is in place; switching vaults clears the old
  // tabs before the new session is applied.
  useEffect(() => {
    if (!treeReady) return
    const vaultKey = getVaultKey(vaultPath)
    if (restoredVaultRef.current === vaultKey) return
    if (restoredVaultRef.current !== null) {
      dispatch({ type: 'replaceAll', tabs: [], activeTabId: null, selectedNodeId: null })
      sessionReadyRef.current = false
      setRestoreChecked(false)
    }
    restoredVaultRef.current = vaultKey
    void restoreSession(vaultKey)
  }, [dispatch, restoreSession, treeReady, vaultPath])

  // Report the tab set / active tab / tree selection. Keystrokes mutate the
  // content but never the tab set, so the id signature keeps this effect idle
  // while typing.
  useEffect(() => {
    if (!sessionReadyRef.current) return
    const tabsSig = tabs.map((t) => `${t.id}>${t.filePath ?? ''}`).join('|')
    const sig = `${tabsSig}::${activeTabId ?? ''}::${selectedNodeId ?? ''}`
    if (sig === sessionSigRef.current) return
    sessionSigRef.current = sig
    // Persist every open tab, including the diary singleton — its date and
    // active state must survive a reload. Duplicates are impossible because
    // `openDiary` dedupes by the fixed `__diary__` id on restore.
    patchSession(vaultKeyRef.current, {
      // Identifiers only; content is re-read from disk on the next launch.
      tabs: tabs.map((t) => ({ id: t.id, path: t.path, kind: t.kind, filePath: t.filePath })),
      activeTabId,
      selectedNodeId,
    })
  }, [activeTabId, selectedNodeId, tabs, restoreChecked])

  // Report the directories the user expanded in the file tree.
  useEffect(() => {
    if (!sessionReadyRef.current) return
    patchSession(vaultKeyRef.current, { expandedPaths: [...expandedPaths] })
  }, [expandedPaths, restoreChecked])

  return { restoreChecked }
}
