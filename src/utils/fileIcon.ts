import { isImageFile } from './isImage'

// Which icon a file gets in the tree, the recent list and the tab strip.
//
// `.excalidraw` comes first: such a file is owned by the Excalidraw plugin's
// page renderer, and the plugin itself is built standalone (see
// vite.plugins.config.ts), so this pattern cannot be imported back from
// src/plugins/excalidraw/scene.ts. It mirrors CANVAS_FILE_RE there.
const CANVAS_FILE_RE = /\.excalidraw(\.md)?$/i

/** Names this helper may return; every one of them exists in the icon set. */
export type FileIconName = 'file' | 'image' | 'excalidraw'

/** True for `foo.excalidraw` and `foo.excalidraw.md`, case-insensitively. */
export function isExcalidrawFile(path: string): boolean {
  return CANVAS_FILE_RE.test(path)
}

/** Icon matching the file type, falling back to the plain file icon. */
export function fileIconName(path: string): FileIconName {
  if (isExcalidrawFile(path)) return 'excalidraw'
  if (isImageFile(path)) return 'image'
  return 'file'
}
