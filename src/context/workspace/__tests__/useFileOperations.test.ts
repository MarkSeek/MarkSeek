// Note operations, run against fakes for the three collaborators they
// orchestrate (tab state, autosave, file tree). The tab fake drives the REAL
// reducer, so an assertion on the resulting tab list is an assertion on
// production behaviour rather than on the stub.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDirectory,
  deleteFileOnDisk,
  moveFileOnDisk,
  readFile,
  writeFile,
  type TreeNode,
} from '../../../api/files'
import { t } from '../../../i18n'
import type { RecentItem } from '../../../utils/recentStorage'
import type { DraftAutosaveApi } from '../useDraftAutosave'
import type { FileTreeApi } from '../useFileTree'
import type { TabStateApi } from '../useTabState'
import {
  DIARY_PREFIX,
  initialTabsState,
  tabsReducer,
  type Tab,
  type TabAction,
  type WorkspaceTabsState,
} from '../tabsReducer'
import { useFileOperations } from '../useFileOperations'

vi.mock('../../../api/files', () => ({
  createDirectory: vi.fn(),
  deleteFileOnDisk: vi.fn(),
  moveFileOnDisk: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const readFileMock = vi.mocked(readFile)
const writeFileMock = vi.mocked(writeFile)
const moveFileOnDiskMock = vi.mocked(moveFileOnDisk)
const deleteFileOnDiskMock = vi.mocked(deleteFileOnDisk)
const createDirectoryMock = vi.mocked(createDirectory)

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, name: id.replace(/\.md$/, ''), path: id, content: '', dirty: false, ...extra }
}

function folder(id: string, children: TreeNode[] = []): TreeNode {
  return { id, name: id.split('/').pop() || id, type: 'folder', children }
}

function node(id: string, type: 'file' | 'folder' = 'file'): TreeNode {
  return { id, name: id.split('/').pop() || id, type }
}

/** The sidebar shape: one unnamed folder node holding the vault contents. */
function root(...children: TreeNode[]): TreeNode[] {
  return [{ id: '', name: 'vault', type: 'folder', children }]
}

interface SetupOptions {
  tabs?: Tab[]
  activeTabId?: string
  selectedNodeId?: string
  tree?: TreeNode[]
}

function setup(options: SetupOptions = {}) {
  let state: WorkspaceTabsState = {
    ...initialTabsState,
    tabs: options.tabs ?? [],
    activeTabId: options.activeTabId ?? null,
    selectedNodeId: options.selectedNodeId ?? null,
  }
  const dispatched: TabAction[] = []
  const drafts = new Set<string>()
  let tree: TreeNode[] = options.tree ?? root()

  const tabsApi: TabStateApi = {
    get tabs() {
      return state.tabs
    },
    get activeTabId() {
      return state.activeTabId
    },
    get activeTab() {
      return state.tabs.find((x) => x.id === state.activeTabId) ?? null
    },
    get selectedNodeId() {
      return state.selectedNodeId
    },
    getTabs: () => state.tabs,
    getState: () => state,
    dispatch: (action: TabAction) => {
      dispatched.push(action)
      state = tabsReducer(state, action)
    },
  }

  const autosave: DraftAutosaveApi = {
    setDraft: vi.fn(),
    clearDraft: vi.fn((id: string) => {
      drafts.delete(id)
    }),
    hasDraft: (id: string) => drafts.has(id),
    saveFile: vi.fn(async () => {}),
    cancelTimer: vi.fn(),
    flushDirty: vi.fn(),
  }

  const treeApi: FileTreeApi = {
    get fileTree() {
      return tree
    },
    loading: false,
    loadFileTree: vi.fn(async () => {}),
    addFileTreeNode: vi.fn(),
    updateTree: (fn) => {
      tree = fn(tree)
    },
    getTree: () => tree,
    expandedPaths: new Set<string>(),
    toggleExpandedPath: vi.fn(),
    setExpandedPaths: vi.fn(),
    addDiaryFile: vi.fn(),
  }

  const recents: RecentItem[] = []
  const view = renderHook(() =>
    useFileOperations({
      tabs: tabsApi,
      autosave,
      tree: treeApi,
      addRecent: (item) => recents.push(item),
    }),
  )

  return {
    result: view.result,
    dispatched,
    tabsState: () => state,
    /** Mark tabs as having unsaved editor buffers. */
    setDrafts: (ids: string[]) => ids.forEach((id) => drafts.add(id)),
    tree: () => tree,
    recents,
    autosave,
  }
}

async function run(fn: () => Promise<void>) {
  await act(async () => {
    await fn()
  })
}

beforeEach(() => {
  readFileMock.mockResolvedValue('')
  writeFileMock.mockResolvedValue(undefined)
  moveFileOnDiskMock.mockResolvedValue(undefined)
  deleteFileOnDiskMock.mockResolvedValue(undefined)
  createDirectoryMock.mockResolvedValue(undefined)
})

describe('useFileOperations.openFile', () => {
  it('reads the note, opens a tab and records it as recent', async () => {
    readFileMock.mockResolvedValue('# hello')
    const h = setup()

    await run(() => h.result.current.openFile('notes/a.md'))

    expect(h.dispatched).toEqual([
      {
        type: 'open',
        tab: {
          id: 'notes/a.md',
          name: 'a',
          path: 'notes/a.md',
          content: '# hello',
          dirty: false,
          kind: 'file',
        },
        select: true,
      },
    ])
    expect(h.recents).toEqual([{ path: 'notes/a.md', name: 'a', ts: expect.any(Number) }])
  })

  it('only activates a tab that is already open', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })

    await run(() => h.result.current.openFile('notes/a.md'))

    expect(h.dispatched).toEqual([{ type: 'activate', id: 'notes/a.md', select: true }])
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('flushes the draft of the tab it is leaving behind', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.openFile('notes/b.md'))

    // The save must land before the new tab is opened, or the buffer is lost.
    expect(h.autosave.saveFile).toHaveBeenCalledWith('notes/a.md')
    expect(h.dispatched[0]).toMatchObject({ type: 'open' })
  })

  it('does not flush when there is nothing buffered', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })

    await run(() => h.result.current.openFile('notes/b.md'))

    expect(h.autosave.saveFile).not.toHaveBeenCalled()
  })

  it('opens nothing when the file cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(new Error('missing'))
    const h = setup()

    await run(() => h.result.current.openFile('notes/a.md'))

    expect(h.dispatched).toEqual([])
    expect(h.recents).toEqual([])
  })

  it('opens a picture as an image tab without reading its bytes', async () => {
    const h = setup()

    await run(() => h.result.current.openFile('images/shot.png'))

    // Reading a picture as text would fill the tab with garbage bytes.
    expect(readFileMock).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([
      {
        type: 'open',
        tab: {
          id: 'images/shot.png',
          name: 'shot.png',
          path: 'images/shot.png',
          content: '',
          dirty: false,
          kind: 'image',
        },
        select: true,
      },
    ])
  })
})

describe('useFileOperations.closeTab', () => {
  it('cancels the debounce, saves the draft, then closes', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.closeTab('notes/a.md'))

    // The pending timer is dropped first so it cannot race the manual save.
    expect(h.autosave.cancelTimer).toHaveBeenCalledWith('notes/a.md')
    expect(h.autosave.saveFile).toHaveBeenCalledWith('notes/a.md')
    expect(h.autosave.clearDraft).toHaveBeenCalledWith('notes/a.md')
    expect(h.dispatched.map((a) => a.type)).toEqual(['close'])
    expect(h.tabsState().tabs).toEqual([])
  })

  it('skips the save when the caller asks for it', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.closeTab('notes/a.md', true))

    expect(h.autosave.saveFile).not.toHaveBeenCalled()
    expect(h.dispatched.map((a) => a.type)).toEqual(['close'])
  })

  it('does nothing for a tab that is not open', async () => {
    const h = setup()

    await run(() => h.result.current.closeTab('notes/ghost.md'))

    expect(h.dispatched).toEqual([])
  })
})

describe('useFileOperations.switchTab', () => {
  it('saves the outgoing draft and then activates the target', async () => {
    const h = setup({
      tabs: [tab('notes/a.md'), tab('notes/b.md')],
      activeTabId: 'notes/a.md',
    })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.switchTab('notes/b.md'))

    expect(h.autosave.saveFile).toHaveBeenCalledWith('notes/a.md')
    expect(h.dispatched).toEqual([{ type: 'activate', id: 'notes/b.md', select: true }])
  })
})

describe('useFileOperations.deleteFile', () => {
  it('deletes on disk, closes the tab without saving and drops the tree node', async () => {
    const h = setup({
      tabs: [tab('notes/a.md')],
      activeTabId: 'notes/a.md',
      tree: root(node('notes/a.md')),
    })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.deleteFile('notes/a.md'))

    expect(deleteFileOnDiskMock).toHaveBeenCalledWith('notes/a.md')
    // Closing with skipSave is what stops the save from recreating the file.
    expect(h.autosave.saveFile).not.toHaveBeenCalled()
    expect(h.dispatched.map((a) => a.type)).toEqual(['close'])
    expect(h.tabsState().tabs).toEqual([])
    expect(h.tree()[0].children).toEqual([])
  })

  it('leaves the workspace alone when the delete fails', async () => {
    deleteFileOnDiskMock.mockRejectedValueOnce(new Error('locked'))
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })

    await run(() => h.result.current.deleteFile('notes/a.md'))

    expect(h.dispatched).toEqual([])
    expect(h.tabsState().tabs).toHaveLength(1)
  })
})

describe('useFileOperations.renameFile', () => {
  it('keeps the name as typed and follows it with the tab id', async () => {
    const h = setup({
      tabs: [tab('notes/a.md')],
      activeTabId: 'notes/a.md',
      tree: root(node('notes/a.md')),
    })

    await run(() => h.result.current.renameFile('notes/a.md', 'renamed.md'))

    expect(moveFileOnDiskMock).toHaveBeenCalledWith('notes/a.md', 'notes/renamed.md')
    expect(h.dispatched.find((a) => a.type === 'remapTab')).toEqual({
      type: 'remapTab',
      from: 'notes/a.md',
      to: 'notes/renamed.md',
      patch: { path: 'notes/renamed.md', name: 'renamed' },
    })
    expect(h.tabsState().activeTabId).toBe('notes/renamed.md')
  })

  it('lets the extension be changed rather than forced back to .md', async () => {
    const h = setup({ tree: root(node('notes/a.md')) })

    await run(() => h.result.current.renameFile('notes/a.md', 'notes.txt'))

    expect(moveFileOnDiskMock).toHaveBeenCalledWith('notes/a.md', 'notes/notes.txt')
  })

  it('keeps a folder name exactly as typed', async () => {
    const h = setup({ tree: root(folder('notes', [node('notes/a.md')])) })

    await run(() => h.result.current.renameFile('notes', 'Archive'))

    expect(moveFileOnDiskMock).toHaveBeenCalledWith('notes', 'Archive')
    expect(h.tree()[0].children?.map((c) => c.id)).toEqual(['Archive'])
  })

  it('ignores an empty name', async () => {
    const h = setup({ tabs: [tab('notes/a.md')] })

    await run(() => h.result.current.renameFile('notes/a.md', '   '))

    expect(moveFileOnDiskMock).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([])
  })
})

describe('useFileOperations.moveFile', () => {
  it('moves the file, remaps the tab and patches the tree', async () => {
    readFileMock.mockResolvedValue('moved content')
    const h = setup({
      tabs: [tab('notes/a.md')],
      activeTabId: 'notes/a.md',
      tree: root(node('notes/a.md'), folder('archive')),
    })

    await run(() => h.result.current.moveFile('notes/a.md', 'archive'))

    expect(moveFileOnDiskMock).toHaveBeenCalledWith('notes/a.md', 'archive/a.md')
    expect(h.dispatched.map((a) => a.type)).toEqual(['remapTab', 'setContent'])
    expect(h.tabsState().tabs[0]).toMatchObject({
      id: 'archive/a.md',
      content: 'moved content',
    })
    expect(h.tree()[0].children?.map((c) => c.id)).toEqual(['archive'])
  })

  it('does not re-read a picture after moving it', async () => {
    const h = setup({
      tabs: [tab('images/shot.png', { kind: 'image' })],
      activeTabId: 'images/shot.png',
      tree: root(node('images/shot.png'), folder('archive')),
    })

    await run(() => h.result.current.moveFile('images/shot.png', 'archive'))

    expect(readFileMock).not.toHaveBeenCalled()
    expect(h.dispatched.map((a) => a.type)).toEqual(['remapTab'])
    expect(h.tabsState().tabs[0]).toMatchObject({ id: 'archive/shot.png', content: '' })
  })
})

describe('useFileOperations.refreshOpenFile', () => {
  it('replaces the content of an open note', async () => {
    readFileMock.mockResolvedValue('new text')
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })
    h.setDrafts(['notes/a.md'])

    await run(() => h.result.current.refreshOpenFile('notes/a.md'))

    // The stale buffer has to go, or the autosave would overwrite the file.
    expect(h.autosave.clearDraft).toHaveBeenCalledWith('notes/a.md')
    expect(readFileMock).toHaveBeenCalledWith('notes/a.md')
    expect(h.dispatched).toEqual([
      { type: 'replaceContent', id: 'notes/a.md', content: 'new text' },
    ])
  })

  it('skips the disk read when the caller already has the text', async () => {
    const h = setup({ tabs: [tab('notes/a.md')], activeTabId: 'notes/a.md' })

    await run(() => h.result.current.refreshOpenFile('notes/a.md', 'authored'))

    expect(readFileMock).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([
      { type: 'replaceContent', id: 'notes/a.md', content: 'authored' },
    ])
  })

  it('matches a diary tab by its real file path', async () => {
    const diary = tab(DIARY_PREFIX, {
      kind: 'diary',
      filePath: 'Journals/2026/2026-01/2026-01-02.md',
    })
    const h = setup({ tabs: [diary], activeTabId: DIARY_PREFIX })

    await run(() =>
      h.result.current.refreshOpenFile('Journals/2026/2026-01/2026-01-02.md', 'today'),
    )

    expect(h.dispatched).toEqual([{ type: 'replaceContent', id: DIARY_PREFIX, content: 'today' }])
  })

  it('ignores a write to a day that is not on screen', async () => {
    const diary = tab(DIARY_PREFIX, {
      kind: 'diary',
      filePath: 'Journals/2026/2026-01/2026-01-02.md',
    })
    const h = setup({ tabs: [diary], activeTabId: DIARY_PREFIX })

    await run(() => h.result.current.refreshOpenFile('Journals/2026/2026-01/2026-01-09.md', 'x'))

    expect(h.dispatched).toEqual([])
  })
})

describe('useFileOperations.createFile', () => {
  it('writes the new note, patches the tree and opens it', async () => {
    const h = setup({ tree: root() })

    await run(() => h.result.current.createFile())

    const expectedPath = `${t('doc.newNoteName')}.md`
    expect(writeFileMock).toHaveBeenCalledWith(expectedPath, t('doc.newNoteContent'))
    expect(h.tree()[0].children?.map((c) => c.id)).toEqual([expectedPath])
    expect(h.dispatched.some((a) => a.type === 'open')).toBe(true)
  })

  it('picks a free name instead of overwriting a sibling', async () => {
    const base = t('doc.newNoteName')
    const h = setup({ tree: root(node(`${base}.md`), node(`${base} (2).md`)) })

    await run(() => h.result.current.createFile())

    expect(writeFileMock).toHaveBeenCalledWith(`${base} (3).md`, expect.any(String))
  })
})

describe('useFileOperations.createFolder', () => {
  it('creates the directory and inserts an expanded node', async () => {
    const h = setup({ tree: root() })

    await run(() => h.result.current.createFolder())

    const name = t('doc.newFolderName')
    expect(createDirectoryMock).toHaveBeenCalledWith(name)
    expect(h.tree()[0].children?.[0]).toMatchObject({ id: name, type: 'folder', expanded: true })
  })
})

describe('useFileOperations.reorderTabs', () => {
  it('delegates to the reducer', () => {
    const h = setup({ tabs: [tab('a.md'), tab('b.md')], activeTabId: 'a.md' })

    act(() => h.result.current.reorderTabs(0, 1))

    expect(h.dispatched).toEqual([{ type: 'reorder', from: 0, to: 1 }])
    expect(h.tabsState().tabs.map((x) => x.id)).toEqual(['b.md', 'a.md'])
  })
})
