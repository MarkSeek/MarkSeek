// Behaviour of the diary singleton: one tab for every date, and re-opening it
// focuses the tab that is already there.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from '../../../api/files'
import { DIARY_PREFIX, type Tab, type TabAction } from '../tabsReducer'
import { ymdToFilePath } from '../../../utils/diaryPath'
import { useVirtualPages } from '../useVirtualPages'

vi.mock('../../../api/files', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const readFileMock = vi.mocked(readFile)
const writeFileMock = vi.mocked(writeFile)

function diaryTab(ymd: string): Tab {
  return {
    id: DIARY_PREFIX,
    name: ymd,
    path: DIARY_PREFIX,
    content: `content of ${ymd}`,
    dirty: false,
    kind: 'diary',
    filePath: ymdToFilePath(ymd),
  }
}

function setup(initialTabs: Tab[] = []) {
  const dispatched: TabAction[] = []
  const tabs = initialTabs
  const view = renderHook(() =>
    useVirtualPages({
      dispatch: (action) => {
        dispatched.push(action)
      },
      getTabs: () => tabs,
      clearDraft: () => {},
      addDiaryFile: () => {},
    }),
  )
  return { ...view, dispatched }
}

async function open(hook: { current: { openDiary: (ymd?: string) => Promise<void> } }, ymd?: string) {
  await act(async () => {
    await hook.current.openDiary(ymd)
  })
}

describe('useVirtualPages.openDiary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates the singleton when the diary tab is already open', async () => {
    const { result, dispatched } = setup([diaryTab('2026-01-01')])

    await open(result, '2026-01-02')

    // Regression: the tab used to stay behind when another one was in front.
    expect(dispatched).toEqual([{ type: 'activate', id: DIARY_PREFIX }])
    expect(result.current.pendingDiaryYmd).toBe('2026-01-02')
  })

  it('opens the singleton once and seeds it with the file on disk', async () => {
    readFileMock.mockResolvedValue('# 2026-01-02')
    const { result, dispatched } = setup()

    await open(result, '2026-01-02')

    expect(readFileMock).toHaveBeenCalledWith(ymdToFilePath('2026-01-02'))
    expect(writeFileMock).not.toHaveBeenCalled()
    expect(dispatched).toHaveLength(1)
    const action = dispatched[0]
    if (action.type !== 'open') throw new Error(`expected an open action, got ${action.type}`)
    expect(action.tab).toMatchObject({
      id: DIARY_PREFIX,
      name: '2026-01-02',
      content: '# 2026-01-02',
      kind: 'diary',
      filePath: ymdToFilePath('2026-01-02'),
    })
    expect(result.current.pendingDiaryYmd).toBe('2026-01-02')
  })

  it('creates an empty journal file when the day has no entry yet', async () => {
    readFileMock.mockRejectedValue(new Error('missing'))
    writeFileMock.mockResolvedValue(undefined)
    const { result, dispatched } = setup()

    await open(result, '2026-01-02')

    // The date is rendered by DiaryHeadTitle, so the file starts out empty:
    // nothing is seeded into the document the user is about to write.
    expect(writeFileMock).toHaveBeenCalledWith(ymdToFilePath('2026-01-02'), '')
    const action = dispatched[0]
    if (action.type !== 'open') throw new Error(`expected an open action, got ${action.type}`)
    expect(action.tab.content).toBe('')
    // The day is still tracked, just on the tab instead of in the document.
    expect(action.tab.filePath).toBe(ymdToFilePath('2026-01-02'))
    expect(action.tab.name).toBe('2026-01-02')
  })

  it('keeps the day on screen when reopened without an explicit date', async () => {
    const { result, dispatched } = setup([diaryTab('2026-01-01')])

    await open(result)

    expect(dispatched).toEqual([{ type: 'activate', id: DIARY_PREFIX }])
    expect(result.current.pendingDiaryYmd).toBe('2026-01-01')
  })
})
