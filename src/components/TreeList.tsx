import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '../api/files'
import { useWorkspace } from '../context/WorkspaceContext'
import ConfirmDialog from './ConfirmDialog'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import { diaryPathToYmd } from '../utils/diaryPath'
import { fileIconName } from '../utils/fileIcon'
import { findBottomPinned, stickyMetrics } from '../utils/stickyHeader'
import { useInlineRename } from '../hooks/useInlineRename'
import TreeRenameInput from './TreeRenameInput'

/* ---- Context menu ---- */
interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  fileId: string
  /** Whether this right-click targets a file/folder (true) or a blank area (false) */
  onItem: boolean
}

interface ContextMenuProps {
  menu: ContextMenuState
  onCreateFile: (dir?: string) => void
  onCreateFolder: (dir?: string) => void
  onDelete: (id: string) => void
  onStartRename: (id: string) => void
  onClose: () => void
}

function ContextMenu({ menu, onCreateFile, onCreateFolder, onDelete, onStartRename, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Fix overflow after the menu appears (direct DOM manipulation, avoiding state-sync issues)
  useEffect(() => {
    if (!menu.visible || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let x = menu.x
    let y = menu.y
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8
    }
    ref.current.style.left = x + 'px'
    ref.current.style.top = y + 'px'
  }, [menu.visible, menu.x, menu.y])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  if (!menu.visible) return null

  const itemStyle = { padding: '8px 16px', cursor: 'pointer' } as const
  const sepStyle = { height: '1px', background: 'var(--border)', margin: '4px 0' } as const

  return createPortal(
    <div
      ref={ref}
      className="context-menu-anchor"
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000 }}
    >
      {/* The fixed anchor carries no `zoom` so left/top map 1:1 to the cursor
          in viewport coordinates. `zoom` lives on the inner wrapper so the menu
          still matches the app's zoom scale without shifting its position. */}
      <div
        className="context-menu"
        style={{
          background: 'var(--bg-content)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          boxShadow: 'var(--shadow-md)',
          minWidth: '140px',
          padding: '4px 0',
          fontSize: '13px',
          zoom: 'var(--app-zoom-scale, 1)',
        }}
      >
      <div
        className="context-menu-item"
        onClick={() => { onCreateFile(menu.fileId); onClose() }}
        style={{ ...itemStyle, color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        {t('tree.newNote')}
      </div>
      <div
        className="context-menu-item"
        onClick={() => { onCreateFolder(menu.fileId); onClose() }}
        style={{ ...itemStyle, color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        {t('tree.newFolder')}
      </div>
      {menu.onItem && (
        <>
          <div style={sepStyle} />
          <div
            className="context-menu-item"
            onClick={() => { onStartRename(menu.fileId); onClose() }}
            style={{ ...itemStyle, color: 'var(--text-primary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            {t('tree.rename')}
          </div>
          <div
            className="context-menu-item"
            onClick={() => { onDelete(menu.fileId); onClose() }}
            style={{ ...itemStyle, color: 'var(--danger)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            {t('tree.delete')}
          </div>
        </>
      )}
      </div>,
    </div>,
    document.body,
  )
}

/* ---- TreeItem (file item, also used as a leaf in recursive rendering) ---- */
interface TreeItemProps {
  node: TreeNode
  level: number
  expandedSet: Set<string>
  activeTabId: string | null
  selectedNodeId: string | null
  dragOverFolderId: string | null
  editingFileId: string | null
  onOpenFile: (path: string) => void
  onToggleFolder: (id: string) => void
  onSelectNode: (id: string) => void
  onContextMenu: (e: React.MouseEvent, fileId: string) => void
  onCommitRename: (id: string, newName: string) => void
  onCancelRename: () => void
  onFileDragStart: (e: React.DragEvent, fileId: string) => void
  onFileDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, folderId: string) => void
  onFolderDragLeave: () => void
  onFolderDrop: (e: React.DragEvent, folderId: string) => void
}

function TreeItem({
  node, level, expandedSet, activeTabId, selectedNodeId, dragOverFolderId, editingFileId,
  onOpenFile, onToggleFolder, onSelectNode, onContextMenu,
  onCommitRename, onCancelRename,
  onFileDragStart, onFileDragEnd, onFolderDragOver, onFolderDragLeave, onFolderDrop,
}: TreeItemProps) {
  const expanded = expandedSet.has(node.id) && !!node.children?.length
  const hasChildren = node.children && node.children.length > 0
  const isActive = node.type === 'file' && activeTabId === node.id
  // VSCode-style single selection: both files and folders highlight when selected
  const isSelected = selectedNodeId === node.id
  const isDragOver = node.type === 'folder' && dragOverFolderId === node.id
  const isEditing = editingFileId === node.id
  const itemRef = useRef<HTMLDivElement>(null)

  const rename = useInlineRename(isEditing, node.name, {
    onCommit: (name) => onCommitRename(node.id, name),
    onCancel: onCancelRename,
    // A note keeps its extension unless the user edits it: start with the stem
    // selected so typing a new title does not wipe the `.md`.
    selectStem: node.type === 'file',
  })

  // Scroll the selected file into view
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  const handleClick = () => {
    if (isEditing) return // do not trigger click while editing
    if (node.type === 'folder') {
      if (hasChildren) onToggleFolder(node.id)
      onSelectNode(node.id)
    } else {
      onOpenFile(node.id)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node.id)
  }

  return (
    <div
      className={`tree-item${isSelected ? ' selected' : ''}`}
      style={{
        paddingLeft: `${4 + level * 18}px`,
        ...(isDragOver ? {
          background: 'var(--bg-active)',
          outline: '2px dashed var(--accent)',
          outlineOffset: '-2px',
        } : {}),
      }}
      ref={itemRef}
      data-file-id={node.id}
      data-folder={node.type === 'folder' ? 'true' : 'false'}
      data-level={level}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      draggable={node.type === 'file' && !isEditing}
      onDragStart={node.type === 'file' ? (e) => onFileDragStart(e, node.id) : undefined}
      onDragEnd={node.type === 'file' ? onFileDragEnd : undefined}
      onDragOver={node.type === 'folder' ? (e) => onFolderDragOver(e, node.id) : undefined}
      onDragLeave={node.type === 'folder' ? onFolderDragLeave : undefined}
      onDrop={node.type === 'folder' ? (e) => onFolderDrop(e, node.id) : undefined}
    >
      {hasChildren ? (
        <span className={`tree-arrow${expanded ? ' expanded' : ''}`}>
          <Icon name="chevron-right" size={12} />
        </span>
      ) : (
        <span className="tree-arrow" />
      )}
      <span className="tree-icon">
        {node.type === 'folder'
          ? <Icon name={expanded ? 'folder-open' : 'folder'} size={16} />
          : <Icon name={fileIconName(node.name)} size={16} />
        }
      </span>
      {isEditing ? (
        <TreeRenameInput rename={rename} />
      ) : (
        <span className="tree-name">{node.name}</span>
      )}
    </div>
  )
}

/* ---- Grouped sticky headers (real sticky, multi-level nesting, VSCode/Finder-style push) ---- */
/**
 * Each folder (at any level) renders as an independent group header pinned to the top
 * of the scroll container.
 * CSS position:sticky handles the push naturally: when a sibling/child group scrolls to
 * the top, it pushes the upper header up (shrinking gradually) with no JS calculation.
 *
 * Multi-level support: a pinned parent header occupies one row of height, so a child
 * header's top must accumulate (top = level * --tree-row-h). This pins the child directory
 * header directly under the parent header, forming a nested sticky chain
 * (e.g. [Journals] / [2026] / [2026-07] pin in sequence).
 * Each group is wrapped in .tree-section, so the sticky range is limited to that group's
 * subtree; the previous header is pushed out of view by the next when the group ends.
 */
interface StickySectionProps {
  node: TreeNode
  level: number
  expanded: boolean
  selected: boolean
  isDragOver: boolean
  editing: boolean
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, fileId: string) => void
  onFolderDragOver: (e: React.DragEvent, folderId: string) => void
  onFolderDragLeave: () => void
  onFolderDrop: (e: React.DragEvent, folderId: string) => void
  onCommitRename: (id: string, newName: string) => void
  onCancelRename: () => void
}

function StickySection({
  node, level, expanded, selected, isDragOver, editing,
  onToggle, onSelect, onContextMenu,
  onFolderDragOver, onFolderDragLeave, onFolderDrop,
  onCommitRename, onCancelRename,
}: StickySectionProps) {
  const hasChildren = !!(node.children && node.children.length)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node.id)
  }

  const rename = useInlineRename(editing, node.name, {
    onCommit: (name) => onCommitRename(node.id, name),
    onCancel: onCancelRename,
  })

  return (
    <div
      className={`tree-item tree-sticky-section${selected ? ' selected' : ''}`}
      style={{
        paddingLeft: `${4 + level * 18}px`,
        top: `calc(var(--tree-row-h, 32px) * ${level})`,
        /* Each .tree-section establishes its own stacking context, so a single fixed
           positive z-index here is enough to keep the header above the normal rows in
           this group. "Parent above child" is guaranteed by DOM nesting: the child group
           lives inside the parent's stacking context, so the parent header's z-index is
           compared on the same level as the child group container, and the child header
           passes from under the parent header (Finder/iOS-style push effect).
           Do not use a global decreasing value like 100-level, or groups would wrongly
           occlude each other across boundaries. */
        zIndex: 1,
        ...(isDragOver ? {
          background: 'var(--bg-active)',
          outline: '2px dashed var(--accent)',
          outlineOffset: '-2px',
        } : {}),
      }}
      data-file-id={node.id}
      data-folder="true"
      data-level={level}
      onClick={() => {
        if (editing) return // do not trigger click while editing
        if (hasChildren) onToggle(node.id)
        onSelect(node.id)
      }}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => onFolderDragOver(e, node.id)}
      onDragLeave={onFolderDragLeave}
      onDrop={(e) => onFolderDrop(e, node.id)}
    >
      <span className={`tree-arrow${expanded ? ' expanded' : ''}`}>
        {hasChildren ? <Icon name="chevron-right" size={12} /> : null}
      </span>
      <span className="tree-icon">
        {expanded ? <Icon name="folder-open" size={16} /> : <Icon name="folder" size={16} />}
      </span>
      {editing ? (
        <TreeRenameInput rename={rename} />
      ) : (
        <span className="tree-name">{node.name}</span>
      )}
    </div>
  )
}

/* ---- TreeList ---- */

/** Skip the root node (e.g. the vault folder), using its children directly */
function getFlatTree(tree: TreeNode[]): TreeNode[] {
  if (tree.length === 1 && tree[0].type === 'folder' && tree[0].children) {
    return tree[0].children
  }
  return tree
}

export default function TreeList() {
  const { fileTree, loading, activeTabId, selectedNodeId, setSelectedNodeId, openFile, openDiary, deleteFile, moveFile, renameFile, createFile: createFileCtx, createFolder, expandedPaths, toggleExpandedPath, setExpandedPaths } = useWorkspace()

  // the actual list container ref
  const treeListRef = useRef<HTMLDivElement>(null)

  // ========== Expand-state control (from context, used by the diary partial-refresh check) ==========
  // When the active tab changes, auto-expand all of its parent directories
  useEffect(() => {
    if (!activeTabId || activeTabId === '__calendar__') return
    const parts = activeTabId.split('/')
    if (parts.length <= 1) return
    const ancestors: string[] = []
    for (let i = 0; i < parts.length - 1; i++) {
      ancestors.push(parts.slice(0, i + 1).join('/'))
    }
    setExpandedPaths(prev => {
      const next = new Set(prev)
      for (const a of ancestors) next.add(a)
      return next
    })
  }, [activeTabId, setExpandedPaths])

  /**
   * Collapse/expand a directory.
   *
   * Key point: scroll anchoring.
   *
   * When a sticky header is pinned, its real document position is usually far above the
   * viewport; sticky only pulls it down visually. Collapsing it removes a large subtree DOM
   * below it and the document height drops sharply, while scrollTop stays the same — so a
   * sibling directory far below suddenly "jumps" to the click position, and the clicked
   * header stops being pinned because its group collapsed.
   *
   * Solution: record the header's screen offset relative to the scroll container before the
   * DOM update, then immediately compensate with the scrollTop delta after the update, so the
   * clicked header stays visually in place and all sticky headers above it remain stable.
   */
  const toggleFolder = useCallback((folderId: string) => {
    // The scroll container is .sidebar-tree (overflow-y:auto), the parent of tree-list
    const scroller = treeListRef.current?.parentElement ?? null
    const headerEl = scroller?.querySelector<HTMLElement>(
      `[data-folder="true"][data-file-id="${CSS.escape(folderId)}"]`
    ) ?? null

    // Record the header's top offset relative to the scroll container's top before the click
    // (i.e. its actual drawn position, including the sticky effect).
    // Use stickyMetrics instead of getBoundingClientRect: the latter returns zoom-scaled
    // viewport px, and adding it directly to scrollTop (layout px) over-compensates by the
    // zoom factor, causing jumps when zoomed.
    const beforeTop = headerEl && scroller
      ? stickyMetrics(headerEl, scroller, scroller.scrollTop)?.visualTop ?? null
      : null

    toggleExpandedPath(folderId)

    if (beforeTop === null || !scroller) return

    // After the DOM updates (before paint), pull the header back to its original screen position to avoid a visual jump
    requestAnimationFrame(() => {
      const el = scroller.querySelector<HTMLElement>(
        `[data-folder="true"][data-file-id="${CSS.escape(folderId)}"]`
      )
      if (!el) return
      const afterTop = stickyMetrics(el, scroller, scroller.scrollTop)?.visualTop
      if (afterTop === undefined) return
      const delta = afterTop - beforeTop
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta
    })
  }, [])

  const displayTree = getFlatTree(fileTree)

  // ========== Pin detection: only show the bottom divider when a header is actually stuck ==========
  // The browser cannot tell via pure CSS whether a header is currently stuck, so we use a scroll listener.
  // The "actually stuck" determination and measurement live in utils/stickyHeader.ts
  // (isPinned / findBottomPinned). Here we only add .is-pinned to the bottom-most stuck
  // header, and CSS shows the divider based on it.
  useEffect(() => {
    const scroller = treeListRef.current?.parentElement ?? null
    if (!scroller) return

    const update = () => {
      const headers = scroller.querySelectorAll<HTMLElement>('[data-folder="true"]')
      const bottomPinned = findBottomPinned(headers, scroller, scroller.scrollTop)
      headers.forEach((el) => {
        el.classList.toggle('is-pinned', el === bottomPinned)
      })
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    // Re-check when the subtree expands/collapses or the window resizes, since the layout changes
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [displayTree, expandedPaths])

  // Recursive rendering: folder -> nested sticky section; file -> TreeItem
  const renderNodes = (nodes: TreeNode[], level: number): React.ReactNode => {
    return nodes.map((node) => {
      if (node.type === 'folder') {
        const expanded = expandedPaths.has(node.id) && !!node.children?.length
        return (
          <div className="tree-section" key={node.id}>
            <StickySection
              node={node}
              level={level}
              expanded={expanded}
              selected={selectedNodeId === node.id}
              isDragOver={dragOverFolderId === node.id}
              editing={editingFileId === node.id}
              onToggle={toggleFolder}
              onSelect={setSelectedNodeId}
              onContextMenu={handleContextMenu}
              onFolderDragOver={handleFolderDragOver}
              onFolderDragLeave={handleFolderDragLeave}
              onFolderDrop={handleFolderDrop}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
            />
            {expanded && node.children
              ? renderNodes(node.children, level + 1)
              : <div className="tree-section-placeholder" aria-hidden="true" />}
          </div>
        )
      }
      return (
        <TreeItem
          key={node.id}
          node={node}
          level={level}
          expandedSet={expandedPaths}
          activeTabId={activeTabId}
          selectedNodeId={selectedNodeId}
          dragOverFolderId={dragOverFolderId}
          editingFileId={editingFileId}
          onOpenFile={handleOpenFile}
          onToggleFolder={toggleFolder}
          onSelectNode={setSelectedNodeId}
          onContextMenu={handleContextMenu}
          onCommitRename={commitRename}
          onCancelRename={cancelRename}
          onFileDragStart={handleFileDragStart}
          onFileDragEnd={handleFileDragEnd}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
        />
      )
    })
  }

  // Click a file: if it is a dated .md under "Journals", open it via the diary virtual page;
  // otherwise open it as a standalone tab like a normal file.
  const handleOpenFile = useCallback(
    (path: string) => {
      const ymd = diaryPathToYmd(path)
      if (ymd) {
        void openDiary(ymd)
        return
      }
      void openFile(path)
    },
    [openDiary, openFile]
  )

  // ========== Context menu ==========
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    fileId: '',
    onItem: true,
  })
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [editingFileId, setEditingFileId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, fileId: string) => {
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fileId, onItem: true })
  }, [])

  /** Right-click on a blank area */
  const handleBlankContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fileId: '', onItem: false })
  }, [])

  /** Create a file under the given directory (empty string means the root) */
  const handleCreateFileIn = useCallback(async (dir?: string) => {
    await createFileCtx(dir || undefined)
  }, [createFileCtx])

  /** Create a folder under the given directory (empty string means the root) */
  const handleCreateFolderIn = useCallback(async (dir?: string) => {
    await createFolder(dir || undefined)
  }, [createFolder])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [])

  const startRename = useCallback((id: string) => {
    setEditingFileId(id)
  }, [])

  const cancelRename = useCallback(() => {
    setEditingFileId(null)
  }, [])

  /** Open the delete-confirmation dialog */
  const handleDeleteClick = useCallback((id: string) => {
    setConfirmDeleteId(id)
  }, [])

  /** Perform the deletion after confirmation */
  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      deleteFile(confirmDeleteId)
    }
    setConfirmDeleteId(null)
  }, [confirmDeleteId, deleteFile])

  /** Cancel the deletion */
  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null)
  }, [])

  const commitRename = useCallback((id: string, newName: string) => {
    setEditingFileId(null)
    renameFile(id, newName)
  }, [renameFile])

  const handleFileDragStart = useCallback((e: React.DragEvent, fileId: string) => {
    e.dataTransfer.setData('text/plain', fileId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleFileDragEnd = useCallback(() => {
    setDragOverFolderId(null)
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folderId)
  }, [])

  const handleFolderDragLeave = useCallback(() => {
    setDragOverFolderId(null)
  }, [])

  const handleFolderDrop = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    setDragOverFolderId(null)
    const fileId = e.dataTransfer.getData('text/plain')
    if (!fileId) return
    // do not move onto itself
    const parentDir = fileId.includes('/') ? fileId.substring(0, fileId.lastIndexOf('/')) : ''
    if (parentDir === folderId || (!parentDir && !folderId)) return
    // an empty folderId string means the root (vault node); convert to undefined when passing to moveFile
    moveFile(fileId, folderId || undefined)
  }, [moveFile])

  if (loading) {
    return (
      <div className="tree-list">
        <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('tree.loading')}</div>
      </div>
    )
  }

  if (fileTree.length === 0) {
    return (
      <div className="tree-list">
        <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('tree.empty')}</div>
      </div>
    )
  }

  return (
    <div className="tree-list" ref={treeListRef} onContextMenu={handleBlankContextMenu}>
      {renderNodes(displayTree, 0)}
      {/* Bottom fill area, ensuring there is always a blank region below the tree-list to right-click */}
      <div className="tree-list-blank" />
      <ContextMenu
        menu={contextMenu}
        onCreateFile={handleCreateFileIn}
        onCreateFolder={handleCreateFolderIn}
        onDelete={handleDeleteClick}
        onStartRename={startRename}
        onClose={closeContextMenu}
      />
      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('confirm.confirm')}
        message={confirmDeleteId ? t('tree.confirmDeleteFile', { name: confirmDeleteId.split('/').pop() ?? '' }) : ''}
        confirmText={t('tree.delete')}
        cancelText={t('confirm.cancel')}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  )
}
