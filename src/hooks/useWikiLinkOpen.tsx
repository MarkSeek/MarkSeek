import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDirectory, writeFile } from '../api/files'
import { useWorkspace } from '../context/WorkspaceContext'
import WikiLinkPicker, { type WikiLinkPickerState } from '../components/WikiLinkPicker'
import { collectMarkdownPaths, findNode } from '../utils/treeOps'
import { baseName, noteTitle, resolveWikiLink } from '../utils/wikiLink'

export interface WikiLinkOpenOptions {
  /** Note the link was written in; drives relative and same-directory matches. */
  fromPath?: string
  /** Viewport position the picker should open at. */
  coords?: { x: number; y: number }
}

export interface WikiLinkOpener {
  /** Resolve a `[[target]]` and open it, or surface the picker to choose one. */
  openWikiLink: (raw: string, options?: WikiLinkOpenOptions) => void
  /** Floating menu node, rendered by the caller; null when nothing is open. */
  pickerNode: ReactNode
}

/**
 * One implementation of "follow a wiki link", shared by the editor and the
 * relation panel so both resolve, disambiguate and create the same way.
 *
 * The hook lives in a .tsx file only because it hands back the picker element;
 * it holds no markup of its own beyond that one node.
 */
export function useWikiLinkOpen(): WikiLinkOpener {
  const { fileTree, openFile, addFileTreeNode, loadFileTree } = useWorkspace()
  const [picker, setPicker] = useState<WikiLinkPickerState | null>(null)

  const paths = useMemo(() => collectMarkdownPaths(fileTree), [fileTree])
  // Read through a ref so `openWikiLink` stays referentially stable: the
  // editor binds it once and would otherwise re-bind on every tree change.
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const treeRef = useRef(fileTree)
  treeRef.current = fileTree

  const closePicker = useCallback(() => setPicker(null), [])

  const openWikiLink = useCallback(
    (raw: string, options?: WikiLinkOpenOptions) => {
      const result = resolveWikiLink(raw, {
        paths: pathsRef.current,
        fromPath: options?.fromPath,
      })
      if (result.status === 'unique') {
        void openFile(result.path)
        return
      }
      // Nothing to choose and nowhere to create (empty brackets): stay quiet.
      if (result.status === 'missing' && !result.createPath) return
      setPicker({
        x: options?.coords?.x ?? window.innerWidth / 2,
        y: options?.coords?.y ?? window.innerHeight / 2,
        target: result.target,
        candidates: result.status === 'ambiguous' ? result.candidates : [],
        createPath: result.status === 'missing' ? result.createPath : '',
      })
    },
    [openFile],
  )

  /** Write a brand new note for a target that did not exist yet. */
  const createNote = useCallback(
    async (path: string) => {
      // Guarded the same way the file routes are: never leave the vault.
      if (!path || path.startsWith('/') || path.includes('..')) return
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      try {
        if (dir && !findNode(treeRef.current, dir)) await createDirectory(dir)
        await writeFile(path, `# ${noteTitle(path)}\n\n`)
        // Patch the tree when the parent is already there; a refetch would
        // collapse every expanded folder, so it is the fallback only.
        if (!dir || findNode(treeRef.current, dir)) {
          addFileTreeNode(dir, { id: path, name: baseName(path), type: 'file' })
        } else {
          await loadFileTree()
        }
        void openFile(path)
      } catch (e) {
        console.error('Failed to create backlink note:', e)
      }
    },
    [addFileTreeNode, loadFileTree, openFile],
  )

  const onPick = useCallback(
    (path: string) => {
      setPicker(null)
      void openFile(path)
    },
    [openFile],
  )

  const onCreate = useCallback(
    (path: string) => {
      setPicker(null)
      void createNote(path)
    },
    [createNote],
  )

  const pickerNode = (
    <WikiLinkPicker state={picker} onPick={onPick} onCreate={onCreate} onClose={closePicker} />
  )

  return { openWikiLink, pickerNode }
}
