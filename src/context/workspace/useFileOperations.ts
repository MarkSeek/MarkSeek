// Note operations: open / save / close tabs and create / rename / move / delete
// files.
//
// Every operation follows the same shape: flush anything dirty first, then hit
// the API, then patch the tab state and the file tree locally so the sidebar
// never has to refetch (a refetch collapses the expanded folders).
import { useCallback, useMemo } from 'react'
import {
  createDirectory,
  deleteFileOnDisk,
  moveFileOnDisk,
  readFile,
  writeFile,
} from '../../api/files'
import { t } from '../../i18n'
import type { RecentItem } from '../../utils/recentStorage'
import { isImageFile } from '../../utils/isImage'
import { findNode, insertNode, removeNode, findNodeChildren } from '../../utils/treeOps'
import type { DraftAutosaveApi } from './useDraftAutosave'
import type { FileTreeApi } from './useFileTree'
import type { TabStateApi } from './useTabState'
import { fileNameFromPath } from './tabsReducer'

export interface FileOperationsOptions {
  tabs: TabStateApi
  autosave: DraftAutosaveApi
  tree: FileTreeApi
  addRecent: (item: RecentItem) => void
}

export interface FileOperationsApi {
  openFile: (path: string) => Promise<void>
  closeTab: (id: string, skipSave?: boolean) => Promise<void>
  switchTab: (id: string) => Promise<void>
  saveFile: (id: string) => Promise<void>
  createFile: (targetDir?: string) => Promise<void>
  createFolder: (targetDir?: string) => Promise<void>
  deleteFile: (id: string) => Promise<void>
  moveFile: (id: string, targetDir?: string) => Promise<void>
  renameFile: (id: string, newName: string) => Promise<void>
  refreshOpenFile: (path: string, nextContent?: string) => Promise<void>
  reorderTabs: (fromIndex: number, toIndex: number) => void
}

/** Directory a new entry goes into when the caller did not name one. */
function parentDirOf(selectedNodeId: string | null): string {
  if (!selectedNodeId) return ''
  return selectedNodeId.substring(0, selectedNodeId.lastIndexOf('/'))
}

/** New notes always start out as Markdown so they open in the editor. */
function markdownName(base: string): string {
  return `${base}.md`
}

/** Pick a name that does not clash with an existing sibling. */
function uniqueName(base: string, taken: Set<string>, withSuffix: (n: number) => string): string {
  let name = base
  let counter = 1
  while (taken.has(name)) {
    counter++
    name = withSuffix(counter)
  }
  return name
}

export function useFileOperations({
  tabs,
  autosave,
  tree,
  addRecent,
}: FileOperationsOptions): FileOperationsApi {
  const { dispatch, getTabs, getState } = tabs
  const { getTree, updateTree } = tree

  const openFile = useCallback(
    async (path: string) => {
      // Save the tab we are leaving behind before swapping the editor content.
      const currentId = getState().activeTabId
      if (currentId && currentId !== path && autosave.hasDraft(currentId)) {
        await autosave.saveFile(currentId)
      }

      // Already open: just focus it.
      if (getTabs().some((tab) => tab.id === path)) {
        dispatch({ type: 'activate', id: path, select: true })
        return
      }

      const name = fileNameFromPath(path)

      // A picture is binary: reading it as text would fill the tab with
      // garbage. It gets its own kind instead and the viewer loads the bytes
      // straight from the vault image URL.
      if (isImageFile(path)) {
        dispatch({
          type: 'open',
          tab: { id: path, name, path, content: '', dirty: false, kind: 'image' },
          select: true,
        })
        addRecent({ path, name, ts: Date.now() })
        return
      }

      try {
        const content = await readFile(path)
        dispatch({
          type: 'open',
          // `kind` marks a real note: virtual pages use synthetic ids instead.
          tab: { id: path, name, path, content, dirty: false, kind: 'file' },
          select: true,
        })
        addRecent({ path, name, ts: Date.now() })
      } catch (e) {
        console.error('Failed to open file:', e)
      }
    },
    [addRecent, autosave, dispatch, getState, getTabs],
  )

  const saveFile = useCallback((id: string) => autosave.saveFile(id), [autosave])

  const closeTab = useCallback(
    async (id: string, skipSave?: boolean) => {
      if (!getTabs().some((tab) => tab.id === id)) return

      // Deleting a file passes skipSave, otherwise the save would recreate it.
      if (!skipSave && autosave.hasDraft(id)) {
        // Drop the debounced save first so it cannot race the manual one.
        autosave.cancelTimer(id)
        await autosave.saveFile(id)
      }

      dispatch({ type: 'close', id })
      // Belt and braces: saveFile already dropped it on success.
      autosave.clearDraft(id)
    },
    [autosave, dispatch, getTabs],
  )

  const switchTab = useCallback(
    async (id: string) => {
      const currentId = getState().activeTabId
      if (currentId && currentId !== id && autosave.hasDraft(currentId)) {
        autosave.cancelTimer(currentId)
        await autosave.saveFile(currentId)
      }
      dispatch({ type: 'activate', id, select: true })
    },
    [autosave, dispatch, getState],
  )

  const createFile = useCallback(
    async (targetDir?: string) => {
      const parentPath = targetDir ?? parentDirOf(getState().selectedNodeId)
      const targetChildren =
        (parentPath ? findNodeChildren(getTree(), parentPath) : getTree()[0]?.children) ?? []
      const existingNames = new Set(
        targetChildren.filter((c) => c.type === 'file').map((c) => c.name),
      )
      const baseName = t('doc.newNoteName')
      const fileName = uniqueName(
        markdownName(baseName),
        existingNames,
        // The de-duplicating counter goes before the extension: "Note (2).md".
        (n) => markdownName(`${baseName} (${n})`),
      )
      const filePath = parentPath ? `${parentPath}/${fileName}` : fileName

      try {
        await writeFile(filePath, t('doc.newNoteContent'))
        // Patch the tree locally: a refetch would jump the scroll position.
        updateTree((prev) =>
          insertNode(prev, parentPath, { id: filePath, name: fileName, type: 'file' }),
        )
        await openFile(filePath)
      } catch (e) {
        console.error('Failed to create file:', e)
      }
    },
    [getState, getTree, openFile, updateTree],
  )

  const createFolder = useCallback(
    async (targetDir?: string) => {
      const parentPath = targetDir ?? parentDirOf(getState().selectedNodeId)
      const targetChildren =
        (parentPath ? findNodeChildren(getTree(), parentPath) : getTree()[0]?.children) ?? []
      const existingNames = new Set(
        targetChildren.filter((c) => c.type === 'folder').map((c) => c.name),
      )
      const folderName = uniqueName(
        t('doc.newFolderName'),
        existingNames,
        (n) => `${t('doc.newFolderName')} (${n})`,
      )
      const dirPath = parentPath ? `${parentPath}/${folderName}` : folderName

      try {
        await createDirectory(dirPath)
        updateTree((prev) =>
          insertNode(prev, parentPath, {
            id: dirPath,
            name: folderName,
            type: 'folder',
            children: [],
            expanded: true,
          }),
        )
      } catch (e) {
        console.error('Failed to create directory:', e)
      }
    },
    [getState, getTree, updateTree],
  )

  const deleteFile = useCallback(
    async (id: string) => {
      try {
        await deleteFileOnDisk(id)
        // The file is gone: closing without saving, or we would recreate it.
        await closeTab(id, true)
        updateTree((prev) => removeNode(prev, id))
      } catch (e) {
        console.error('Failed to delete file:', e)
      }
    },
    [closeTab, updateTree],
  )

  const moveFile = useCallback(
    async (id: string, targetDir?: string) => {
      // No target (context menu): ask the user.
      if (targetDir === undefined) {
        const input = window.prompt('Target directory path (leave empty for root)')
        if (input === null) return
        targetDir = input.trim()
      }
      // Derive the name from the path so unopened files can be moved too.
      const fileName = id.includes('/') ? id.substring(id.lastIndexOf('/') + 1) : id
      const newPath = targetDir ? `${targetDir}/${fileName}` : fileName

      try {
        await moveFileOnDisk(id, newPath)
        if (getTabs().some((tab) => tab.id === id)) {
          dispatch({
            type: 'remapTab',
            from: id,
            to: newPath,
            patch: { path: newPath, name: fileName },
          })
          // Pictures carry no text, so there is nothing to re-read.
          if (!isImageFile(newPath)) {
            const content = await readFile(newPath)
            dispatch({ type: 'setContent', id: newPath, content })
          }
        }
        updateTree((prev) => {
          const node = findNode(prev, id)
          if (!node) return prev
          const afterRemove = removeNode(prev, id)
          return insertNode(afterRemove, targetDir || '', {
            ...node,
            id: newPath,
            name: fileName,
          })
        })
      } catch (e) {
        console.error('Failed to move file:', e)
      }
    },
    [dispatch, getTabs, updateTree],
  )

  const renameFile = useCallback(
    async (id: string, newName: string) => {
      if (!newName || newName.trim() === '') return
      // Keep the name exactly as typed for both files and folders.
      const trimmed = newName.trim()
      const normalized = trimmed
      const dir = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : ''
      const newPath = dir ? `${dir}/${normalized}` : normalized

      try {
        await moveFileOnDisk(id, newPath)
        dispatch({
          type: 'remapTab',
          from: id,
          to: newPath,
          // The tab title never shows `.md` (see `fileNameFromPath`), so keep
          // the label in the same shape no matter what the user typed.
          patch: { path: newPath, name: fileNameFromPath(newPath) },
        })
        updateTree((prev) => {
          const target = findNode(prev, id)
          if (!target) return prev
          const afterRemove = removeNode(prev, id)
          return insertNode(afterRemove, dir, { ...target, id: newPath, name: normalized })
        })
      } catch (e) {
        console.error('Failed to rename:', e)
      }
    },
    [dispatch, getTree, updateTree],
  )

  /**
   * Reload a file that was changed from the outside (calendar task drag, agent
   * write).
   *
   * `nextContent` skips the extra disk round trip when the writer already holds
   * the new text, which also closes the window where another write could slip
   * in between.
   */
  const refreshOpenFile = useCallback(
    async (path: string, nextContent?: string) => {
      // A file tab uses its path as `id`, but the diary virtual page uses a
      // fixed id and keeps the real path in `filePath`. Matching `filePath`
      // also means a write to a day that is NOT on screen finds no tab, so the
      // diary is never navigated away by it.
      const tab = getTabs().find((candidate) => candidate.id === path || candidate.filePath === path)
      if (!tab) return
      // A picture is rendered from its URL, there is no text to reload.
      if (tab.kind === 'image') return

      // The editor buffer is stale now; dropping it with the pending autosave
      // is what stops the old text from being flushed over the new file.
      autosave.clearDraft(tab.id)

      try {
        const content = nextContent ?? (await readFile(path))
        dispatch({ type: 'replaceContent', id: tab.id, content })
      } catch (e) {
        console.error('Failed to refresh file content:', e)
      }
    },
    [autosave, dispatch, getTabs],
  )

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      dispatch({ type: 'reorder', from: fromIndex, to: toIndex })
    },
    [dispatch],
  )

  return useMemo(
    () => ({
      openFile,
      closeTab,
      switchTab,
      saveFile,
      createFile,
      createFolder,
      deleteFile,
      moveFile,
      renameFile,
      refreshOpenFile,
      reorderTabs,
    }),
    [
      openFile,
      closeTab,
      switchTab,
      saveFile,
      createFile,
      createFolder,
      deleteFile,
      moveFile,
      renameFile,
      refreshOpenFile,
      reorderTabs,
    ],
  )
}
