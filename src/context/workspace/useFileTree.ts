// File tree state: the sidebar contents plus the expanded-directory set.
//
// The tree is patched in place for local changes (create / rename / move /
// delete) instead of being refetched, so the sidebar never jumps or collapses
// what the user had open.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDirChildren, fetchFileTree, type TreeNode } from '../../api/files'
import { insertNode, findNode, removeNode, updateNodeChildren } from '../../utils/treeOps'
import { ymdToDir, ymdToFilePath } from '../../utils/diaryPath'

export interface FileTreeApi {
  fileTree: TreeNode[]
  loading: boolean
  loadFileTree: () => Promise<void>
  /** Insert one node without refetching the whole tree. */
  addFileTreeNode: (parentPath: string, node: TreeNode) => void
  /** Patch the tree from a function of the previous value. */
  updateTree: (fn: (prev: TreeNode[]) => TreeNode[]) => void
  /** Latest tree, safe to read in the same tick as an update. */
  getTree: () => TreeNode[]
  /** Directories the user expanded in the sidebar. */
  expandedPaths: Set<string>
  toggleExpandedPath: (id: string) => void
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  /**
   * Surface a journal file that was just created: only when its month folder
   * is already expanded, otherwise the tree is left alone.
   */
  addDiaryFile: (ymd: string) => void
}

export function useFileTree(): FileTreeApi {
  const [fileTree, setFileTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  // Mirrors kept for the callbacks that read the tree outside of a render
  // (create / rename / move all inspect sibling names first).
  const fileTreeRef = useRef<TreeNode[]>(fileTree)
  fileTreeRef.current = fileTree
  const expandedPathsRef = useRef<Set<string>>(expandedPaths)
  expandedPathsRef.current = expandedPaths

  /**
   * The one writer of the tree. Updating the mirror here (instead of waiting
   * for the next render) is what makes `getTree()` correct in the same tick as
   * an insert — create / rename read sibling names right after patching.
   */
  const applyTree = useCallback(
    (next: TreeNode[] | ((prev: TreeNode[]) => TreeNode[])) => {
      const value = typeof next === 'function' ? next(fileTreeRef.current) : next
      fileTreeRef.current = value
      setFileTree(value)
    },
    [],
  )

  const loadFileTree = useCallback(async () => {
    setLoading(true)
    try {
      const tree = await fetchFileTree()
      applyTree(tree)
    } finally {
      setLoading(false)
    }
  }, [applyTree])

  useEffect(() => {
    void loadFileTree()
  }, [loadFileTree])

  const addFileTreeNode = useCallback(
    (parentPath: string, node: TreeNode) => {
      applyTree((prev) => insertNode(prev, parentPath, node))
    },
    [applyTree],
  )

  const updateTree = useCallback(
    (fn: (prev: TreeNode[]) => TreeNode[]) => {
      applyTree(fn)
    },
    [applyTree],
  )

  const getTree = useCallback(() => fileTreeRef.current, [])

  /**
   * Refresh one directory's children without touching the expanded state of
   * the rest of the tree.
   */
  const refreshDir = useCallback(async (dirPath: string) => {
    try {
      const children = await fetchDirChildren(dirPath)
      applyTree((prev) => updateNodeChildren(prev, dirPath, children))
    } catch (e) {
      console.error('Failed to refresh directory:', e)
    }
  }, [applyTree])

  const toggleExpandedPath = useCallback(
    (id: string) => {
      // Read the mirror so the decision does not depend on a stale closure.
      const willExpand = !expandedPathsRef.current.has(id)
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (willExpand) next.add(id)
        else next.delete(id)
        return next
      })
      // Pull the latest children when the user expands a folder, so files
      // created elsewhere in the meantime become visible.
      if (willExpand) void refreshDir(id)
    },
    [refreshDir],
  )

  const addDiaryFile = useCallback(
    (ymd: string) => {
      const fileId = ymdToFilePath(ymd)
      const parentDir = ymdToDir(ymd)
      // Already in the tree: nothing to do.
      if (findNode(fileTreeRef.current, fileId)) return
      // The month folder is collapsed: leave the tree alone.
      if (!expandedPathsRef.current.has(parentDir)) return
      addFileTreeNode(parentDir, { id: fileId, name: `${ymd}.md`, type: 'file' })
    },
    [addFileTreeNode],
  )

  return {
    fileTree,
    loading,
    loadFileTree,
    addFileTreeNode,
    updateTree,
    getTree,
    expandedPaths,
    toggleExpandedPath,
    setExpandedPaths,
    addDiaryFile,
  }
}

/** Re-exported so callers can patch the tree without importing treeOps twice. */
export { findNode, removeNode }
