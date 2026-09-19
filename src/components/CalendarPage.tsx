import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { TaskItem } from '../api/tasks'
import { loadMonthTasks } from '../api/tasks'
import { readFile, writeFile } from '../api/files'
import { useWorkspace } from '../context/WorkspaceContext'
import { t, getLang } from '../i18n'
import { KEYS } from '../utils/storageKeys'
import { monthKey, partsToYmd } from '../utils/date'
import { buildMonthGrid } from '../utils/monthGrid'
import { ymdToFilePath } from '../utils/diaryPath'

const WEEKDAY_KEYS = ['calendar.sun', 'calendar.mon', 'calendar.tue', 'calendar.wed', 'calendar.thu', 'calendar.fri', 'calendar.sat']
const MONTH_KEYS = ['calendar.jan', 'calendar.feb', 'calendar.mar', 'calendar.apr', 'calendar.may', 'calendar.jun', 'calendar.jul', 'calendar.aug', 'calendar.sep', 'calendar.oct', 'calendar.nov', 'calendar.dec']

/** [year, month0] shifted by `delta` months. Date handles the December carry. */
function shiftMonth(year: number, month0: number, delta: number): [number, number] {
  const d = new Date(year, month0 + delta, 1)
  return [d.getFullYear(), d.getMonth()]
}

/** Drop duplicate [year, month0] pairs: source and target month may coincide. */
function dedupeMonths(months: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>()
  return months.filter(([y, m]) => {
    const key = `${y}-${m}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---- File operation helpers ----

/**
 * Loose comparison key for a task: strips the markdown checkbox marker, <br>
 * and ALL whitespace.
 *
 * This is the ONLY "is this the same task?" rule in the file — it is applied to
 * both sides of every comparison (a raw markdown line and a task's text), so a
 * task rendered from markdown and the same task typed by the user match.
 * Whitespace is removed rather than collapsed because the calendar's task chips
 * wrap arbitrary text and the backend's matcher does the same.
 */
function taskMatchKey(text: string): string {
  return text
    .replace(/^[-*]\s*\[[ xX]\]\s*/, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\s+/g, '')
    .trim()
}

/** Get the indentation width (column count) of a line */
function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].length
}

/**
 * Locate a task line and take it out together with its body.
 *
 * Rules:
 * 1. The `* [ ]` task line itself is always included.
 * 2. Every following line that is not top-level (indented deeper than the task line)
 *    belongs to the task; stop at the first non-empty line whose indentation
 *    is <= the task line indentation.
 * 3. Blank lines do not terminate the block, but trailing blank lines are excluded.
 *
 * Returns null when the task is not found in the content.
 */
function extractTaskBlock(
  content: string,
  task: TaskItem
): { block: string[]; rest: string } | null {
  const lines = content.split('\n')
  const needle = taskMatchKey(task.text)
  const start = lines.findIndex((line) => taskMatchKey(line) === needle)
  if (start === -1) return null

  const baseIndent = indentOf(lines[start])
  let end = start + 1
  let lastContent = start
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === '') { end++; continue }
    if (indentOf(line) <= baseIndent) break
    lastContent = end
    end++
  }

  const block = lines.slice(start, lastContent + 1)
  const rest = [...lines.slice(0, start), ...lines.slice(end)].join('\n')
  return { block, rest }
}

/** Append a task (task line + its body block) to the file content */
function appendTaskToContent(content: string, task: TaskItem, block?: string[]): string {
  const body = block && block.length
    ? block.join('\n')
    : (task.done ? '* [x] ' : '* [ ] ') + task.text
  return content.trimEnd() + '\n\n' + body + '\n'
}

// ---- drag data key ----
const DRAG_TASK_KEY = KEYS.dragTask

export default function CalendarPage() {
  const today = new Date()
  const { openDiary, refreshOpenFile, addFileTreeNode, taskVersion } = useWorkspace()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [tasksByDate, setTasksByDate] = useState<Record<string, TaskItem[]>>({})
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  // Months already loaded on demand (key: "YYYY-MM"), to avoid duplicate requests.
  const loadedMonthsRef = useRef<Set<string>>(new Set())

  // Load one month's tasks and merge them incrementally into existing data (no full replacement,
  // so already-visible months do not flash).
  // With force=true, ignore the loaded cache and re-read the file (used to force-refresh after a drag).
  const ensureMonthLoaded = useCallback(async (year: number, month0: number, force = false) => {
    const key = monthKey(year, month0)
    if (!force && loadedMonthsRef.current.has(key)) return
    loadedMonthsRef.current.add(key)
    try {
      const byDate = await loadMonthTasks(year, month0 + 1)
      setTasksByDate((prev) => ({ ...prev, ...byDate }))
    } catch {
      // on load failure, remove the marker so a retry is allowed next time
      loadedMonthsRef.current.delete(key)
    }
  }, [])

  // The grid renders the visible month plus the tail of the previous one and the
  // head of the next one, so all three are kept warm. Loading only these (never
  // a full historical walk) is what keeps the calendar responsive.
  const visibleMonths = useMemo(
    () => [
      shiftMonth(viewYear, viewMonth, -1),
      [viewYear, viewMonth] as [number, number],
      shiftMonth(viewYear, viewMonth, 1),
    ],
    [viewYear, viewMonth],
  )

  // Covers the initial mount, a month change AND a `taskVersion` bump (the
  // notes were rewritten by the editor, the agent or the backend watcher).
  useEffect(() => {
    void taskVersion
    for (const [y, m] of visibleMonths) void ensureMonthLoaded(y, m)
  }, [visibleMonths, ensureMonthLoaded, taskVersion])

  // After a dragged task is written, refresh the visible months (reusing the monthly lazy load
  // instead of a full walk).
  // forceMonths is optional: pass [year, month0] pairs that must be re-read to fix the calendar
  // not refreshing after a drag.
  const reloadTasks = useCallback(async (forceMonths: Array<[number, number]> = []) => {
    for (const [y, m] of visibleMonths) await ensureMonthLoaded(y, m)
    for (const [y, m] of forceMonths) {
      await ensureMonthLoaded(y, m, true)
    }
  }, [visibleMonths, ensureMonthLoaded])

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedIndex(null)
  }, [viewMonth])

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedIndex(null)
  }, [viewMonth])

  const goToday = useCallback(() => {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getDay()
    setSelectedIndex(firstDayOfMonth + today.getDate() - 1)
  }, [today])

  /** Click a day number: open that date's Journals entry in the diary virtual page */
  const openDailyFile = useCallback(async (day: number, month: number, year: number) => {
    await openDiary(partsToYmd(year, month, day))
  }, [openDiary])

  /**
   * Move a dragged task onto `targetKey` (a 'YYYY-MM-DD' day).
   *
   * Order matters: the two files are written first, then the calendar state is
   * patched locally (so the UI responds immediately instead of racing the
   * backend reload), and only then are the affected months re-read to settle
   * any long-term drift.
   */
  const handleDropTask = useCallback(
    async (e: React.DragEvent, targetKey: string) => {
      e.preventDefault()
      setDragOverIndex(null)

      const raw = e.dataTransfer.getData(DRAG_TASK_KEY)
      if (!raw) return
      const dragData = JSON.parse(raw)
      // Dropping back onto the same day is a no-op.
      if (dragData.sourceDate === targetKey) return

      const task: TaskItem = { text: dragData.text, done: dragData.done }
      const srcPath = ymdToFilePath(dragData.sourceDate)
      const tgtPath = ymdToFilePath(targetKey)

      // 1. Remove from the source note.
      const srcContent = await readFile(srcPath)
      // Take the task line together with its indented body block
      const extracted = extractTaskBlock(srcContent, task)
      const nextSrcContent = extracted ? extracted.rest : srcContent
      await writeFile(srcPath, nextSrcContent)

      // 2. Write into the target note, creating it when it does not exist yet.
      let tgtContent: string
      let isNewFile = false
      try {
        tgtContent = await readFile(tgtPath)
      } catch {
        tgtContent = `# ${targetKey}\n\n`
        isNewFile = true
      }
      const nextTgtContent = appendTaskToContent(tgtContent, task, extracted?.block)
      await writeFile(tgtPath, nextTgtContent)

      // 3. A brand new note is spliced into the tree locally (no full reload).
      if (isNewFile) {
        const parentDir = tgtPath.includes('/') ? tgtPath.substring(0, tgtPath.lastIndexOf('/')) : ''
        const fileName = tgtPath.split('/').pop() || tgtPath
        addFileTreeNode(parentDir, { id: tgtPath, name: fileName, type: 'file' })
      }

      // 4. Refresh whichever of the two notes is open, passing the content we
      //    already have so no extra read can interleave in this window.
      await refreshOpenFile(srcPath, nextSrcContent)
      await refreshOpenFile(tgtPath, nextTgtContent)

      // 5. Patch the calendar state directly: immediate and deterministic.
      const needle = taskMatchKey(task.text)
      setTasksByDate((prev) => {
        const next = { ...prev }
        next[dragData.sourceDate] = (next[dragData.sourceDate] || []).filter(
          (t) => taskMatchKey(t.text) !== needle,
        )
        const tgtList = next[targetKey] || []
        next[targetKey] = tgtList.some((t) => taskMatchKey(t.text) === needle)
          ? tgtList
          : [...tgtList, { ...task }]
        return next
      })

      // 6. Re-read the affected months in the background to stay disk-accurate.
      const [srcY, srcM0] = dragData.sourceDate.split('-').map(Number)
      const [tgtY, tgtM0] = targetKey.split('-').map(Number)
      void reloadTasks(dedupeMonths([[srcY, srcM0 - 1], [tgtY, tgtM0 - 1]]))
    },
    [refreshOpenFile, addFileTreeNode, reloadTasks],
  )

  // Cell-style arguments (day, month, year) -> 'YYYY-MM-DD'.
  const dateKey = (d: number, m: number, y: number) => partsToYmd(y, m, d)

  // Shares the same grid algorithm as the sidebar mini calendar, but without a fixed row count (ends on the actual number of weeks).
  const cells = buildMonthGrid(viewYear, viewMonth)

  const isTodayCell = (cell: { day: number; month: number; year: number }) =>
    cell.day === today.getDate() && cell.month === today.getMonth() && cell.year === today.getFullYear()

  const isCurrentMonth = (cell: { inMonth: boolean }) => cell.inMonth

  return (
    <div className="calendar-page">
      <div className="calendar-card">
        <div className="calendar-page-header">
          <div className="calendar-page-nav">
            <button className="calendar-page-btn" onClick={prevMonth} title={t('calendar.prev')}>‹</button>
            <span className="calendar-page-title">{getLang() === 'en' ? `${t(MONTH_KEYS[viewMonth])} ${viewYear}` : `${viewYear}${t('calendar.year')}${t(MONTH_KEYS[viewMonth])}`}</span>
            <button className="calendar-page-btn" onClick={nextMonth} title={t('calendar.next')}>›</button>
          </div>
          <button className="calendar-page-today" onClick={goToday}>{t('calendar.today')}</button>
        </div>

        <div className="calendar-page-weekdays">
          {WEEKDAY_KEYS.map(k => <span key={k} className="cp-wd">{t(k)}</span>)}
        </div>

      <div className="calendar-page-grid">
        {cells.map((cell, i) => {
          const tasks = tasksByDate[dateKey(cell.day, cell.month, cell.year)] || []
          const isDragOver = dragOverIndex === i
          return (
            <div
              key={i}
              className={`cp-day${isCurrentMonth(cell) ? '' : ' cp-other-month'}${isTodayCell(cell) ? ' cp-today' : ''}${selectedIndex === i ? ' cp-selected' : ''}${isDragOver ? ' cp-drag-over' : ''}`}
              onClick={() => setSelectedIndex(i)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverIndex(i)
              }}
              onDragLeave={() => { setDragOverIndex(null) }}
              onDrop={(e) => void handleDropTask(e, dateKey(cell.day, cell.month, cell.year))}
            >
              <>
                <span
                  className="cp-day-num"
                  onClick={(e) => { e.stopPropagation(); openDailyFile(cell.day, cell.month, cell.year) }}
                  title={t('calendar.openEntry')}
                >
                  {cell.day}
                </span>
                <div className="cp-day-tasks">
                  {tasks.slice(0, 4).map((t, ti) => (
                    <span
                      key={ti}
                      className={`cp-task${t.done ? ' cp-task-done' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TASK_KEY, JSON.stringify({
                          text: t.text,
                          done: t.done,
                          sourceDate: dateKey(cell.day, cell.month, cell.year),
                        }))
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      {t.text}
                    </span>
                  ))}
                  {tasks.length > 4 && <span className="cp-task-more"> ...</span>}
                </div>
              </>
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
