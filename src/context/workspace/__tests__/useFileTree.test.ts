// File tree state: local patches instead of refetches, plus the two rules the
// sidebar depends on — expanding a folder pulls fresh children, and a journal
// file only appears when its month folder is already open.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDirChildren, fetchFileTree, type TreeNode } from '../../../api/files'
import { ymdToDir, ymdToFilePath } from '../../../utils/diaryPath'
import { useFileTree } from '../useFileTree'

vi.mock('../../../api/files', () => ({
  fetchFileTree: vi.fn(),
  fetchDirChildren: vi.fn(),
}))

const fetchFileTreeMock = vi.mocked(fetchFileTree)
const fetchDirChildrenMock = vi.mocked(fetchDirChildren)

function folder(id: string, children: TreeNode[] = []): TreeNode {
  return { id, name: id.split('/').pop() || id, type: 'folder', children }
}

function file(id: string): TreeNode {
  return { id, name: id.split('/').pop() || id, type: 'file' }
}

/** The sidebar shape: one unnamed folder node holding the vault contents. */
function root(...children: TreeNode[]): TreeNode[] {
  return [{ id: '', name: 'vault', type: 'folder', children }]
}

describe('useFileTree', () => {
  beforeEach(() => {
    fetchFileTreeMock.mockResolvedValue(root(file('a.md')))
    fetchDirChildrenMock.mockResolvedValue([])
  })

  it('loads the tree on mount and reports when it is done', async () => {
    const { result } = renderHook(() => useFileTree())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fileTree).toEqual(root(file('a.md')))
  })

  it('addFileTreeNode inserts without refetching the tree', async () => {
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))
    fetchFileTreeMock.mockClear()

    act(() => result.current.addFileTreeNode('', file('b.md')))

    expect(fetchFileTreeMock).not.toHaveBeenCalled()
    expect(result.current.fileTree[0].children?.map((c) => c.id)).toEqual(['a.md', 'b.md'])
  })

  it('getTree sees an updateTree patch in the same tick', async () => {
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let seen: TreeNode[] = []

    act(() => {
      result.current.updateTree(() => root(file('c.md')))
      seen = result.current.getTree()
    })

    expect(seen[0].children?.map((c) => c.id)).toEqual(['c.md'])
  })

  it('expands a folder and pulls its children', async () => {
    fetchDirChildrenMock.mockResolvedValue([file('Journals/note.md')])
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.toggleExpandedPath('Journals')
      await Promise.resolve()
    })

    expect(result.current.expandedPaths.has('Journals')).toBe(true)
    expect(fetchDirChildrenMock).toHaveBeenCalledWith('Journals')
  })

  it('collapses a folder without refetching it', async () => {
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.toggleExpandedPath('Journals')
      await Promise.resolve()
    })
    fetchDirChildrenMock.mockClear()

    act(() => result.current.toggleExpandedPath('Journals'))

    expect(result.current.expandedPaths.has('Journals')).toBe(false)
    expect(fetchDirChildrenMock).not.toHaveBeenCalled()
  })

  it('surfaces a new journal file only when its month folder is expanded', async () => {
    const monthDir = ymdToDir('2026-01-02')
    fetchFileTreeMock.mockResolvedValue(root(folder(monthDir, [file('Journals/a.md')])))
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Collapsed: the tree is left alone.
    act(() => result.current.addDiaryFile('2026-01-02'))
    const children = result.current.getTree()[0].children ?? []
    expect(findIds(children, monthDir)).not.toContain(ymdToFilePath('2026-01-02'))

    await act(async () => {
      result.current.toggleExpandedPath(monthDir)
      await Promise.resolve()
    })
    act(() => result.current.addDiaryFile('2026-01-02'))

    const after = result.current.getTree()[0].children ?? []
    expect(findIds(after, monthDir)).toContain(ymdToFilePath('2026-01-02'))
  })

  it('does not duplicate a journal file that is already in the tree', async () => {
    const monthDir = ymdToDir('2026-01-02')
    const filePath = ymdToFilePath('2026-01-02')
    fetchFileTreeMock.mockResolvedValue(root(folder(monthDir, [file(filePath)])))
    fetchDirChildrenMock.mockResolvedValue([file(filePath)])
    const { result } = renderHook(() => useFileTree())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.toggleExpandedPath(monthDir)
      await Promise.resolve()
    })
    // The refresh above already put the day in the tree: adding it again must
    // be a no-op instead of stacking a second entry.
    act(() => result.current.addDiaryFile('2026-01-02'))

    const after = result.current.getTree()[0].children ?? []
    expect(findIds(after, monthDir).filter((id) => id === filePath)).toHaveLength(1)
  })
})

/** ids of the children of `dirId`, searched one level deep. */
function findIds(nodes: TreeNode[], dirId: string): string[] {
  const dir = nodes.find((n) => n.id === dirId)
  return (dir?.children ?? []).map((c) => c.id)
}
