import { useCallback, useEffect, useRef } from 'react'
import MilkdownEditor from './MilkdownEditor'
import DiaryHeadTitle from './DiaryHeadTitle'
import { DIARY_PREFIX, useWorkspace } from '../context/WorkspaceContext'
import { readFile, writeFile } from '../api/files'
import { dateToYmd } from '../utils/date'
import { filePathToYmd, ymdToFilePath } from '../utils/diaryPath'

/**
 * Diary virtual page: all dates share one fixed tab (`__diary__`); page turns do not open new tabs.
 * Dates entered via the calendar / file tree / today / shortcut all send a navigation request
 * through pendingDiaryYmd, handled serially by this component.
 *
 * Content ownership: the diary is exactly like ordinary files — the single source of truth is the
 * diary tab in WorkspaceContext (content is the body, filePath is the real file for the current date).
 * This component degrades to a "view + page-turn controller" that does only two things:
 *   1) editor changes go to updateContent, reusing the unified debounced persistence;
 *   2) on page turn, flush the old date first, then read the new date and updateDiaryTab to update the tab.
 *
 * So external writes (calendar task drag, agent file edits) only need to go through refreshOpenFile;
 * the diary page needs no special casing and no longer holds a second copy of content state or a
 * second writer.
 */
export default function DiaryPage({
  targetHeading,
  onHeadingConsumed,
}: {
  targetHeading?: string | null
  onHeadingConsumed?: () => void
}) {
  const {
    openTabs,
    updateContent,
    saveFile,
    updateDiaryTab,
    addDiaryFile,
    addRecent,
    pendingDiaryYmd,
    setPendingDiaryYmd,
  } = useWorkspace()

  const diaryTab = openTabs.find((tab) => tab.kind === 'diary') ?? null
  // the currently displayed date and content are both derived from the tab; no separate state copy
  const ymd = (diaryTab?.filePath ? filePathToYmd(diaryTab.filePath) : null) ?? dateToYmd(new Date())
  const content = diaryTab?.content ?? ''

  const scrollRef = useRef<HTMLDivElement>(null)
  // the latest displayed date (kept as a ref so async goToDate can decide whether a switch is really needed)
  const ymdRef = useRef(ymd)
  ymdRef.current = ymd
  // page turn in progress: suppress the intermediate content emitted by the editor during rebuild
  const loadingRef = useRef(false)
  // serialize page-turn requests: rapid clicks/keys take effect in order, and no request is lost
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  /** Switch to a given date (unified entry for page turns / external clicks) */
  const goToDate = useCallback(
    async (target: string) => {
      if (target === ymdRef.current) return
      loadingRef.current = true
      try {
        // Flush buffered edits BEFORE the tab switches to the new date:
        // `saveFile` writes to whatever `filePath` the tab points at right now.
        await saveFile(DIARY_PREFIX)

        let md = ''
        try {
          md = await readFile(ymdToFilePath(target))
        } catch {
          // A day with no entry yet is the normal case: create the placeholder
          // file so it shows up in the tree, and leave it empty. The date is
          // rendered by DiaryHeadTitle, so nothing is seeded into the document.
          md = ''
          await writeFile(ymdToFilePath(target), md)
          addDiaryFile(target)
        }
        // Content was just read from disk, so it is the new authoritative copy. updateDiaryTab
        // discards the editor buffer and the pending autosave, preventing the old date's content
        // from being written onto the new date's path.
        updateDiaryTab(target, md)
        // Add the currently displayed diary date file to the "Recent" list (deduped by real path and moved to the front).
        addRecent({ path: ymdToFilePath(target), name: target, ts: Date.now() })
      } finally {
        loadingRef.current = false
      }
    },
    [saveFile, addDiaryFile, updateDiaryTab, addRecent]
  )

  /** Enqueue a page-turn request: runs serially, never dropped */
  const navigateTo = useCallback(
    (target: string) => {
      queueRef.current = queueRef.current.then(() => goToDate(target)).catch(console.error)
    },
    [goToDate]
  )

  // external navigation requests (calendar / file tree / today / shortcut)
  useEffect(() => {
    if (pendingDiaryYmd == null) return
    const target = pendingDiaryYmd
    setPendingDiaryYmd(null)
    navigateTo(target)
  }, [pendingDiaryYmd, setPendingDiaryYmd, navigateTo])

  // reset scroll position to the top when the date switches or content is replaced externally
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [ymd, diaryTab?.rev])

  const handleChange = useCallback(
    (md: string) => {
      // during a page turn / external content replacement, the editor may emit intermediate content due to rebuild; ignore it
      if (loadingRef.current) return
      // do not report empty content (avoids clearing an existing file into a blank document)
      if (!md.trim()) return
      updateContent(DIARY_PREFIX, md)
    },
    [updateContent]
  )

  if (!diaryTab) return null

  return (
    <div className="diary-page">
      {/* Outside the scroll container on purpose: the date stays put while the
          document scrolls under it. It is also outside Crepe's subtree, so it
          is plain DOM — never part of the markdown, never written to disk. */}
      <DiaryHeadTitle ymd={ymd} />
      <div className="diary-scroll" ref={scrollRef}>
        <MilkdownEditor
          // Key is fixed: `rev` used to be part of it, so every page turn
          // destroyed and rebuilt the Crepe instance. Content now travels
          // through `contentVersion` and is swapped in place.
          key={DIARY_PREFIX}
          value={content}
          contentVersion={diaryTab.rev ?? 0}
          onChange={handleChange}
          targetHeading={targetHeading}
          onHeadingConsumed={onHeadingConsumed}
          filePath={ymdToFilePath(ymd)}
        />
      </div>
    </div>
  )
}
