import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../i18n'
import { useWorkspace } from '../context/WorkspaceContext'
import { listDir } from '../api/files'
import { Icon } from './icons/Icon'
import { dateToYmd, formatDiaryDate, formatDiaryWeekday, partsToYmd } from '../utils/date'
import { ymdToDir } from '../utils/diaryPath'

type DirEntry = { type: string; name: string }

/** Shift `ymd` by `days` calendar days, returning 'YYYY-MM-DD'. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return dateToYmd(dt)
}

/** Jump to the first day of the adjacent month (dir < 0 prev, dir > 0 next). */
function shiftMonth(ymd: string, dir: number): string {
  const [y, m] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1 + dir, 1)
  return partsToYmd(dt.getFullYear(), dt.getMonth(), 1)
}

/**
 * The date banner of the diary virtual page.
 *
 * It sits ABOVE the Crepe editor and OUTSIDE the scroll container, so it never
 * scrolls away and it is not part of the document: it is not serialized into
 * markdown, it does not show up in the outline, and turning the page never
 * writes it to disk. The date used to be a `# YYYY-MM-DD` heading inside the
 * file; it now lives here and the file holds nothing but the user's text.
 *
 * The prev/next/today navigation used to live in the side gutter; it is now
 * part of this banner so the date and the controls that move between days sit
 * together. prev/next jump to the nearest *existing* journal entry rather than
 * the adjacent calendar day, so empty days are skipped.
 */
function DiaryHeadTitle({ ymd }: { ymd: string }) {
  const { lang, t } = useTranslation()
  const { openDiary, openTodayNote } = useWorkspace()

  // Intl.DateTimeFormat is expensive to build; reuse one per language.
  const main = useMemo(() => formatDiaryDate(ymd, lang), [ymd, lang])
  const weekday = useMemo(() => formatDiaryWeekday(ymd, lang), [ymd, lang])

  // Nearest existing journal entry before/after the current day, so the
  // prev/next buttons land on a real file instead of an empty calendar day.
  const [prevYmd, setPrevYmd] = useState<string | null>(null)
  const [nextYmd, setNextYmd] = useState<string | null>(null)
  const cacheRef = useRef<Map<string, { entries: DirEntry[]; ts: number }>>(new Map())

  useEffect(() => {
    let cancelled = false

    const loadMonth = async (monthDir: string) => {
      const cached = cacheRef.current.get(monthDir)
      if (cached && Date.now() - cached.ts < 60_000) return cached.entries
      const entries = await listDir(monthDir)
      cacheRef.current.set(monthDir, { entries, ts: Date.now() })
      return entries
    }

    const computeBound = async (dir: number): Promise<string | null> => {
      const today = dateToYmd(new Date())
      let cursor = shiftYmd(ymd, dir)
      const maxMonths = dir < 0 ? 60 : 12
      for (let i = 0; i < maxMonths; i++) {
        if (dir > 0 && cursor > today && i > 0) break
        const monthDir = ymdToDir(cursor)
        let entries: DirEntry[]
        try {
          entries = await loadMonth(monthDir)
        } catch {
          cursor = shiftMonth(cursor, dir)
          continue
        }
        const dates = entries
          .filter((e) => e.type === 'file' && /\.md$/.test(e.name))
          .map((e) => e.name.replace(/\.md$/, ''))
          .filter((d) => (dir < 0 ? d < ymd : d > ymd))
        if (dates.length > 0) {
          dates.sort()
          return dir < 0 ? dates[dates.length - 1] : dates[0]
        }
        cursor = shiftMonth(cursor, dir)
      }
      return null
    }

    computeBound(-1).then((r) => {
      if (!cancelled) setPrevYmd(r)
    })
    computeBound(1).then((r) => {
      if (!cancelled) setNextYmd(r)
    })

    return () => {
      cancelled = true
    }
  }, [ymd])

  const handlePrev = () => {
    if (prevYmd) openDiary(prevYmd)
  }
  const handleToday = () => {
    // Explicitly jump to today: openDiary() with no arg keeps the current date.
    openTodayNote()
  }
  const handleNext = () => {
    if (nextYmd) openDiary(nextYmd)
  }

  return (
    <div className="diary_head_title">
      <div className="diary_head_title-main">
        {/* Keyed by date: turning the page remounts this subtree, which restarts
            the fade-in animation instead of swapping the text silently. */}
        <div key={ymd} className="diary_head_title-turn">
          <div className="diary_head_title-date">{main}</div>
          {weekday && <div className="diary_head_title-weekday">{weekday}</div>}
        </div>

        {/* Day navigation, moved here from the side gutter. */}
        <div className="diary_head_title-nav">
          <button
            type="button"
            className="diary_head_title-nav-btn"
            onClick={handlePrev}
            disabled={!prevYmd}
            title={t('diaryNav.prev')}
            aria-label={t('diaryNav.prev')}
          >
            <Icon name="chevron-up" size={15} />
          </button>
          <button
            type="button"
            className="diary_head_title-nav-btn"
            onClick={handleToday}
            title={t('diaryNav.today')}
            aria-label={t('diaryNav.today')}
          >
            <Icon name="today" size={15} />
          </button>
          <button
            type="button"
            className="diary_head_title-nav-btn"
            onClick={handleNext}
            disabled={!nextYmd}
            title={t('diaryNav.next')}
            aria-label={t('diaryNav.next')}
          >
            <Icon name="chevron-down" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(DiaryHeadTitle)
