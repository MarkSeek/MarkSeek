// Virtual pages: home, calendar, lite apps, settings and the diary singleton.
//
// None of these correspond to a tab per file — they are singletons keyed by a
// synthetic id. The diary is the only one that also owns a real file (the
// journal entry of the day currently on screen).
import { useCallback, useMemo, useState } from 'react'
import { readFile, writeFile } from '../../api/files'
import { t } from '../../i18n'
import { dateToYmd } from '../../utils/date'
import { filePathToYmd, ymdToFilePath, ymdToTabName } from '../../utils/diaryPath'
import {
  CALENDAR_ID,
  DIARY_PREFIX,
  HOME_ID,
  LITEAPP_PREFIX,
  SETTINGS_ID,
  type Tab,
  type TabAction,
} from './tabsReducer'

export interface VirtualPagesOptions {
  dispatch: (action: TabAction) => void
  getTabs: () => Tab[]
  /** Drop the buffered draft of a tab (outside writes must not be overwritten). */
  clearDraft: (id: string) => void
  /** Surface a freshly created journal file in the sidebar. */
  addDiaryFile: (ymd: string) => void
}

export interface VirtualPagesApi {
  openCalendar: () => void
  openHome: () => void
  openLiteApp: () => void
  openSettings: () => void
  /** Open the diary on `ymd` (defaults to today's entry). */
  openDiary: (ymd?: string) => Promise<void>
  openTodayNote: () => Promise<void>
  /** Follow a diary page turn: new title, new file path, new content. */
  updateDiaryTab: (ymd: string, content: string) => void
  /** Date the diary page should jump to; consumed then cleared by DiaryPage. */
  pendingDiaryYmd: string | null
  setPendingDiaryYmd: (ymd: string | null) => void
}

function virtualTab(id: string, name: string, kind: Tab['kind']): Tab {
  return { id, name, path: id, content: '', dirty: false, kind }
}

export function useVirtualPages({
  dispatch,
  getTabs,
  clearDraft,
  addDiaryFile,
}: VirtualPagesOptions): VirtualPagesApi {
  const [pendingDiaryYmd, setPendingDiaryYmd] = useState<string | null>(null)

  // Every virtual page is a singleton: it is opened once and then only focused.
  const openSingleton = useCallback(
    (tab: Tab) => {
      dispatch({ type: 'open', tab })
    },
    [dispatch],
  )

  const openCalendar = useCallback(
    () => openSingleton(virtualTab(CALENDAR_ID, t('tab.calendar'), 'calendar')),
    [openSingleton],
  )

  const openLiteApp = useCallback(
    () => openSingleton(virtualTab(LITEAPP_PREFIX, t('tab.liteapp'), 'liteapp')),
    [openSingleton],
  )

  const openHome = useCallback(
    () => openSingleton(virtualTab(HOME_ID, t('tab.home'), undefined)),
    [openSingleton],
  )

  const openSettings = useCallback(
    () => openSingleton(virtualTab(SETTINGS_ID, t('tab.settings'), 'settings')),
    [openSingleton],
  )

  /**
   * Open the diary on a given day.
   *
   * Every date shares the same virtual tab, so this never stacks tabs. It also
   * does not write the tab content: it only ensures the tab exists and raises
   * `pendingDiaryYmd`, which DiaryPage turns into "save the old day -> read the
   * new one -> update the tab". Doing the work here would rewrite `activeTab`
   * before the content is ready and desync the title from the file.
   */
  const openDiary = useCallback(
    async (ymd?: string) => {
      const existing = getTabs().find((tab) => tab.id === DIARY_PREFIX)

      // When the tab does not exist yet, seed it with the real content: opening
      // it empty would mount the editor over an existing file and blank it out.
      if (!existing) {
        const dateStr = ymd ?? dateToYmd(new Date())
        const filePath = ymdToFilePath(dateStr)
        let content = ''
        try {
          content = await readFile(filePath)
        } catch {
          // Not an error: a day with no entry yet is the normal case. Create
          // the placeholder file so the day shows up in the tree, and leave it
          // empty — the date is rendered by DiaryHeadTitle, not stored in the
          // document, so opening a day must not seed a heading into it.
          content = ''
          await writeFile(filePath, content)
          addDiaryFile(dateStr)
        }
        dispatch({
          type: 'open',
          tab: {
            id: DIARY_PREFIX,
            name: ymdToTabName(dateStr),
            path: DIARY_PREFIX,
            content,
            dirty: false,
            kind: 'diary',
            filePath,
          },
        })
      } else {
        // The singleton may be open behind another tab (a note, the calendar,
        // ...). Re-opening it only has to bring it forward; the day on screen is
        // handled by `pendingDiaryYmd` below.
        dispatch({ type: 'activate', id: DIARY_PREFIX })
      }

      // With an explicit target use it; otherwise keep the day already on
      // screen so a bare "open the diary" click never jumps around.
      const target =
        ymd ??
        (existing?.filePath ? filePathToYmd(existing.filePath) : null) ??
        dateToYmd(new Date())
      setPendingDiaryYmd(target)
    },
    [addDiaryFile, dispatch, getTabs],
  )

  const openTodayNote = useCallback(
    (): Promise<void> => openDiary(dateToYmd(new Date())),
    [openDiary],
  )

  /**
   * Follow a diary page turn.
   *
   * The content is the authoritative copy that was just read from disk, so the
   * editor buffer and any pending autosave are dropped — otherwise the old
   * day's text would be written onto the new day's path. Bumping `rev` makes
   * the editor swap the document in place instead of remounting.
   */
  const updateDiaryTab = useCallback(
    (ymd: string, content: string) => {
      clearDraft(DIARY_PREFIX)
      dispatch({
        type: 'replaceContent',
        id: DIARY_PREFIX,
        content,
        patch: { name: ymdToTabName(ymd), filePath: ymdToFilePath(ymd) },
      })
    },
    [clearDraft, dispatch],
  )

  return useMemo(
    () => ({
      openCalendar,
      openHome,
      openLiteApp,
      openSettings,
      openDiary,
      openTodayNote,
      updateDiaryTab,
      pendingDiaryYmd,
      setPendingDiaryYmd,
    }),
    [
      openCalendar,
      openHome,
      openLiteApp,
      openSettings,
      openDiary,
      openTodayNote,
      updateDiaryTab,
      pendingDiaryYmd,
    ],
  )
}
