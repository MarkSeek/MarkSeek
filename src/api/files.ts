// Filesystem API wrapper layer.
// Talks to the Vite dev server middleware / production app.js; the frontend calls this uniformly.

import type { ImageRule } from '../config/settingsSchema'

export interface TreeNode {
  id: string // file relative path, e.g. "docs/requirements.md"
  name: string
  type: 'folder' | 'file'
  children?: TreeNode[]
  expanded?: boolean
}

/** Fetch the file tree */
export async function fetchFileTree(): Promise<TreeNode[]> {
  const res = await fetch('/api/files/list')
  if (!res.ok) throw new Error('Failed to load file tree')
  return res.json()
}

/** Recursively find a node by id in the tree */
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const r = findNode(n.children, id)
      if (r) return r
    }
  }
  return null
}

/**
 * Fetch the immediate children of a given directory.
 * The backend only exposes the whole tree; we fetch it fully then extract the target directory's
 * children locally, so expanding a folder only refreshes that subtree, avoiding a full re-render.
 */
export async function fetchDirChildren(dirPath: string): Promise<TreeNode[]> {
  const tree = await fetchFileTree()
  return findNode(tree, dirPath)?.children ?? []
}

/** List a directory's immediate children (folders + .html files, including dot-directories like .LiteApp) */
export interface DirEntry {
  id: string
  name: string
  type: 'folder' | 'file'
  mtime: number
}
export async function listDir(dirPath: string): Promise<DirEntry[]> {
  const res = await fetch(`/api/files/listdir?path=${encodeURIComponent(dirPath)}`)
  if (!res.ok) throw new Error('Failed to list directory')
  return res.json()
}

/** Read file content */
export async function readFile(path: string): Promise<string> {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Failed to read file')
  return res.text()
}

/** Write file content */
export async function writeFile(path: string, content: string): Promise<void> {
  const res = await fetch('/api/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
  if (!res.ok) throw new Error('Failed to write file')
  // Writes under the journals directory (task changes) notify registered listeners to refresh the mini-calendar etc.
  if (path.startsWith('Journals/') && taskChangeNotifier) {
    taskChangeNotifier()
  }
}

/**
 * Task-change notifier: registered by the UI layer (e.g. WorkspaceContext).
 * Triggered only when files under the "Journals" directory are written, so components like the
 * mini-calendar can refresh task dots immediately.
 */
let taskChangeNotifier: (() => void) | null = null

export function setTaskChangeNotifier(fn: (() => void) | null): void {
  taskChangeNotifier = fn
}

/** Delete a file */
export async function deleteFileOnDisk(path: string): Promise<void> {
  const res = await fetch(`/api/files/delete?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete file')
}

/** Move a file (rename or relocate) */
export async function moveFileOnDisk(from: string, to: string): Promise<void> {
  const res = await fetch('/api/files/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!res.ok) throw new Error('Failed to move file')
}

/** Create a directory */
export async function createDirectory(path: string): Promise<void> {
  const res = await fetch('/api/files/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error('Failed to create directory')
}

/**
 * Upload an image and return a URL that can be written directly into markdown.
 *
 * `notePath` is the current note's relative path inside the vault; the backend matches the save
 * rule to decide where to store it on disk; when omitted it uses the default directory, same as earlier versions.
 */
export async function uploadImage(file: File, notePath?: string): Promise<string> {
  // Read as base64
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data:image/png;base64, prefix
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const ext = file.name.split('.').pop() || 'png'
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: dataUrl, ext, notePath: notePath || '' }),
  })
  if (!res.ok) throw new Error('Failed to upload image')
  const json = await res.json()
  // Old backend only returned path; here we fall back to /<path> so markdown links still work
  return json.url || `/${json.path}`
}

export interface ImageDirPreview {
  dir: string
  ruleId: string
  ruleName: string
}

/**
 * Preview which directory a note's screenshot would be saved to.
 *
 * Uses the same backend rules so the frontend doesn't duplicate logic and diverge from the real
 * result. Passing in-memory `rules` / `defaultDir` previews changes not yet flushed (writes are debounced).
 */
export async function previewImageDir(
  notePath: string,
  rules?: ImageRule[],
  defaultDir?: string,
): Promise<ImageDirPreview> {
  const res = await fetch('/api/files/resolve-image-dir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notePath, imageRules: rules, imageDefaultDir: defaultDir }),
  })
  if (!res.ok) throw new Error('Failed to resolve save directory')
  return res.json()
}
