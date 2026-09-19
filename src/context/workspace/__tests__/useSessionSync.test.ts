// Session restore: reopen the workspace the user left behind, and never report
// a half-built tab set — that is what used to wipe the snapshot on startup.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from '../../../api/files'
import { patchSession, readSession, type SessionSnapshot } from '../../../utils/sessionStorage'
import { DIARY_PREFIX, type Tab, type TabAction } from '../tabsReducer'
import { useSessionSync } from '../useSessionSync'

vi.mock('../../../api/files', () => ({
  readFile: vi.fn(),
}))

vi.mock('../../../utils/sessionStorage', () => ({
  getVaultKey: vi.fn((vaultPath: string | null) => (vaultPath?.trim() ? vaultPath.trim() : '__default__')),
  patchSession: vi.fn(),
  readSession: vi.fn(),
  clearSession: vi.fn(),
}))

const readFileMock = vi.mocked(readFile)
const patchSessionMock = vi.mocked(patchSession)
const readSessionMock = vi.mocked(readSession)

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: 1,
    savedAt: 0,
    tabs: [],
    activeTabId: null,
    expandedPaths: [],
    selectedNodeId: null,
    layout: { leftOpen: true, rightOpen: false, leftWidth: null, rightWidth: null },
    rightPanel: { view: 'chat', showRelations: false },
    ...overrides,
  }
}

interface SetupOptions {
  vaultPath?: string | null
  treeReady?: boolean
  tabs?: Tab[]
  activeTabId?: string | null
  selectedNodeId?: string | null
  snapshots?: Record<string, SessionSnapshot>
}

function setup(options: SetupOptions = {}) {
  const store: Record<string, SessionSnapshot> = { ...(options.snapshots ?? {}) }
  readSessionMock.mockImplementation((vaultKey) => {
    if (!store[vaultKey]) store[vaultKey] = snapshot()
    return store[vaultKey]
  })

  const dispatched: TabAction[] = []
  const dispatch = (action: TabAction) => dispatched.push(action)
  // Stands in for the live diary tab that `openDiary` would have inserted.
  const liveTabs: Tab[] = options.tabs ?? []
  const openDiary = vi.fn(async (ymd?: string) => {
    liveTabs.push({
      id: DIARY_PREFIX,
      name: ymd ?? 'today',
      path: DIARY_PREFIX,
      content: '',
      dirty: false,
      kind: 'diary',
      filePath: ymd ? `Journals/${ymd.slice(0, 4)}/${ymd.slice(0, 7)}/${ymd}.md` : undefined,
    })
  })
  const setExpandedPaths = vi.fn()

  const view = renderHook(
    (props: SetupOptions) =>
      useSessionSync({
        vaultPath: props.vaultPath ?? null,
        treeReady: props.treeReady ?? true,
        tabs: props.tabs ?? [],
        activeTabId: props.activeTabId ?? null,
        selectedNodeId: props.selectedNodeId ?? null,
        expandedPaths: new Set<string>(),
        dispatch,
        getTabs: () => liveTabs,
        openDiary,
        setExpandedPaths: setExpandedPaths as React.Dispatch<React.SetStateAction<Set<string>>>,
      }),
    { initialProps: options },
  )

  return { ...view, dispatched, liveTabs, openDiary, setExpandedPaths, store }
}

beforeEach(() => {
  readFileMock.mockResolvedValue('restored content')
})

describe('useSessionSync', () => {
  it('waits for the file tree before touching the session', () => {
    setup({ treeReady: false })

    expect(readSessionMock).not.toHaveBeenCalled()
    expect(patchSessionMock).not.toHaveBeenCalled()
  })

  it('reopens the persisted notes, re-reading their content from disk', async () => {
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [
            { id: 'notes/a.md', path: 'notes/a.md', kind: 'file' },
            { id: 'notes/b.md', path: 'notes/b.md', kind: 'file' },
          ],
          activeTabId: 'notes/b.md',
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    const replaceAll = h.dispatched.find((a) => a.type === 'replaceAll')
    expect(replaceAll).toMatchObject({
      type: 'replaceAll',
      activeTabId: 'notes/b.md',
      selectedNodeId: 'notes/b.md',
    })
    if (replaceAll?.type !== 'replaceAll') throw new Error('expected a replaceAll action')
    expect(replaceAll.tabs.map((t) => t.id)).toEqual(['notes/a.md', 'notes/b.md'])
    expect(replaceAll.tabs[0]).toMatchObject({ content: 'restored content', dirty: false })
  })

  it('preserves the persisted tab order even when the reads settle out of order', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      // The second read resolves first: the snapshot must still come back in
      // the order it was saved.
      await new Promise((r) => setTimeout(r, path === 'notes/a.md' ? 20 : 0))
      return `content of ${path}`
    })
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [
            { id: 'notes/a.md', path: 'notes/a.md', kind: 'file' },
            { id: 'notes/b.md', path: 'notes/b.md', kind: 'file' },
          ],
          activeTabId: 'notes/a.md',
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    const replaceAll = h.dispatched.find((a) => a.type === 'replaceAll')
    if (replaceAll?.type !== 'replaceAll') throw new Error('expected a replaceAll action')
    expect(replaceAll.tabs.map((t) => t.id)).toEqual(['notes/a.md', 'notes/b.md'])
    expect(replaceAll.tabs.map((t) => t.content)).toEqual([
      'content of notes/a.md',
      'content of notes/b.md',
    ])
  })

  it('drops a note that disappeared from disk instead of opening a broken tab', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path === 'notes/gone.md') throw new Error('ENOENT')
      return 'ok'
    })
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [
            { id: 'notes/gone.md', path: 'notes/gone.md', kind: 'file' },
            { id: 'notes/a.md', path: 'notes/a.md', kind: 'file' },
          ],
          activeTabId: 'notes/gone.md',
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    const replaceAll = h.dispatched.find((a) => a.type === 'replaceAll')
    if (replaceAll?.type !== 'replaceAll') throw new Error('expected a replaceAll action')
    expect(replaceAll.tabs.map((t) => t.id)).toEqual(['notes/a.md'])
    // The persisted active tab is gone, so the last restored one takes over.
    expect(replaceAll.activeTabId).toBe('notes/a.md')
  })

  it('restores the expanded directories of the sidebar', async () => {
    const h = setup({
      snapshots: { __default__: snapshot({ expandedPaths: ['Journals', 'Ideas'] }) },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    expect(h.setExpandedPaths).toHaveBeenCalledWith(new Set(['Journals', 'Ideas']))
  })

  it('reopens the diary singleton on the persisted day', async () => {
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [
            {
              id: DIARY_PREFIX,
              path: DIARY_PREFIX,
              kind: 'diary',
              filePath: 'Journals/2026/2026-01/2026-01-02.md',
            },
          ],
          activeTabId: DIARY_PREFIX,
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    expect(h.openDiary).toHaveBeenCalledWith('2026-01-02')
    const replaceAll = h.dispatched.find((a) => a.type === 'replaceAll')
    if (replaceAll?.type !== 'replaceAll') throw new Error('expected a replaceAll action')
    // The live singleton is kept and the stale snapshot copy is dropped.
    expect(replaceAll.tabs.filter((t) => t.kind === 'diary')).toHaveLength(1)
    expect(replaceAll.activeTabId).toBe(DIARY_PREFIX)
  })

  it('restores a virtual page without touching the disk', async () => {
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [{ id: '__calendar__', path: '__calendar__', kind: 'calendar' }],
          activeTabId: '__calendar__',
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    expect(readFileMock).not.toHaveBeenCalled()
    const replaceAll = h.dispatched.find((a) => a.type === 'replaceAll')
    if (replaceAll?.type !== 'replaceAll') throw new Error('expected a replaceAll action')
    expect(replaceAll.tabs[0]).toMatchObject({ id: '__calendar__', kind: 'calendar', content: '' })
  })

  it('does not report the tab set before the restore has been applied', async () => {
    const h = setup({
      snapshots: {
        __default__: snapshot({
          tabs: [{ id: 'notes/a.md', path: 'notes/a.md', kind: 'file' }],
          activeTabId: 'notes/a.md',
        }),
      },
    })

    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))
    patchSessionMock.mockClear()

    // A rerender with the restored tabs now reports the live set.
    h.rerender({
      tabs: [
        { id: 'notes/a.md', name: 'a', path: 'notes/a.md', content: '', dirty: false, kind: 'file' },
      ],
      activeTabId: 'notes/a.md',
      selectedNodeId: 'notes/a.md',
      snapshots: h.store,
    })

    await waitFor(() =>
      expect(patchSessionMock).toHaveBeenCalledWith(
        '__default__',
        expect.objectContaining({
          tabs: [{ id: 'notes/a.md', path: 'notes/a.md', kind: 'file', filePath: undefined }],
          activeTabId: 'notes/a.md',
        }),
      ),
    )
  })

  it('clears the old workspace when the vault changes', async () => {
    const h = setup({ vaultPath: 'vault-a' })
    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))

    act(() => {
      h.rerender({ vaultPath: 'vault-b' })
    })

    await waitFor(() =>
      expect(h.dispatched).toContainEqual({
        type: 'replaceAll',
        tabs: [],
        activeTabId: null,
        selectedNodeId: null,
      }),
    )
    expect(readSessionMock).toHaveBeenCalledWith('vault-b')
  })

  it('restores only once per vault', async () => {
    const h = setup({ vaultPath: 'vault-a' })
    await waitFor(() => expect(h.result.current.restoreChecked).toBe(true))
    readSessionMock.mockClear()

    act(() => {
      h.rerender({ vaultPath: 'vault-a', tabs: [] })
    })

    expect(readSessionMock).not.toHaveBeenCalled()
  })
})
