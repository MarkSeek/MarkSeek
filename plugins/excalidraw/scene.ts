// Canvas notes: drawings this plugin opens as a full page (see ./page.tsx).
//
// Two on-disk formats share the Excalidraw scene JSON:
//
//   * `*.excalidraw.md` — a Markdown note. The drawing lives in a fenced code
//     block (```excalidraw) so the note stays a plain Markdown file that the
//     embedded block, the editor and other tools can all read, with any text
//     written around the fence preserved.
//   * `*.excalidraw` — a bare Excalidraw document. The whole file is the native
//     Excalidraw scene JSON (the same bytes the Excalidraw app writes), so it
//     round-trips with any Excalidraw tool without Markdown wrapping.

/** Matches `foo.excalidraw.md` and `foo.excalidraw`, case-insensitively. */
const CANVAS_FILE_RE = /\.excalidraw(\.md)?$/i

/** True for paths this plugin renders as a full-page canvas. */
export function isCanvasFile(path: string): boolean {
  return CANVAS_FILE_RE.test(path)
}

/** True for `*.excalidraw` files that store the raw Excalidraw JSON (no `.md`). */
export function isRawCanvasFile(path: string): boolean {
  return /\.excalidraw$/i.test(path)
}

/**
 * The drawing fence. Only unindented fences are recognised: both this plugin
 * and the editor block write them at column 0. Unused for raw `*.excalidraw`
 * files, where the whole file is the scene JSON.
 */
const FENCE_RE = /```[ \t]*excalidraw[ \t]*\r?\n([\s\S]*?)```/

export interface CanvasDoc {
  /** Markdown kept in front of the drawing fence (empty for raw files). */
  prefix: string
  /** Serialized Excalidraw scene JSON; empty when the drawing is blank. */
  scene: string
  /** Markdown kept behind the drawing fence (empty for raw files). */
  suffix: string
}

/**
 * Split a canvas file into its text and its drawing.
 *
 * When `raw` is true the file is a bare `*.excalidraw` document whose entire
 * content is the scene JSON — there is no fence and no surrounding prose, so the
 * whole file is returned as `scene`. Otherwise the file is a `*.excalidraw.md`
 * note and the drawing is extracted from its fenced block.
 */
export function parseCanvasDoc(content: string, raw = false): CanvasDoc {
  const md = content ?? ''
  // A bare Excalidraw file is the scene JSON itself; keep nothing around it.
  if (raw) return { prefix: '', scene: md.trim(), suffix: '' }
  const match = FENCE_RE.exec(md)
  // No fence yet: everything the file holds is treated as the heading text and
  // a fresh fence is appended on the first save.
  if (!match) return { prefix: md.trim(), scene: '', suffix: '' }
  const start = match.index
  const end = start + match[0].length
  return {
    prefix: md.slice(0, start).trim(),
    scene: match[1].trim(),
    suffix: md.slice(end).trim(),
  }
}

/**
 * Reassemble a canvas file from its text and the serialized scene.
 *
 * With `raw` true the whole file becomes the scene JSON (native Excalidraw
 * format); otherwise it is the fenced Markdown note.
 */
export function serializeCanvasDoc(doc: CanvasDoc, raw = false): string {
  if (raw) return doc.scene
  const fence = `\`\`\`excalidraw\n${doc.scene}\n\`\`\`\n`
  const head = doc.prefix ? `${doc.prefix}\n\n` : ''
  const tail = doc.suffix ? `\n${doc.suffix}\n` : ''
  return `${head}${fence}${tail}`
}

/** Parse a scene JSON, returning null instead of throwing on malformed input. */
export function parseScene(json: string): Record<string, unknown> | null {
  if (!json) return null
  try {
    const data = JSON.parse(json)
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Top-level scene key marking a drawing whose canvas background follows the
 * host theme. Excalidraw ignores unknown top-level keys, so the file still
 * opens unchanged in any Excalidraw app.
 */
export const THEME_BG_KEY = 'markseekThemeBg'

/**
 * Canvas colour of a drawing that follows the host theme: the canvas is left
 * transparent, so the surface behind it — the main panel — supplies the colour
 * and it tracks the theme in CSS, instantly and without a canvas repaint
 * (Excalidraw only repaints its background when elements, size or its own
 * theme change, so pushing a colour into `appState` alone is not reliable).
 *
 * The colour the panel had is still written into the file (see
 * `writeThemeBackground`), so exports and other Excalidraw apps get an opaque
 * background rather than the marker.
 */
export const THEME_CANVAS_BG = 'transparent'

/**
 * True while the drawing has no background of its own and the canvas follows
 * the host theme. Flipped to false once the user picks a background inside
 * Excalidraw, so a theme switch never overwrites their choice.
 *
 * Scenes without the key (fresh drawings, files written by other Excalidraw
 * apps) follow the theme as well: that is the whole point of the feature.
 */
export function followsThemeBackground(scene: Record<string, unknown> | null): boolean {
  if (!scene) return true
  const flag = scene[THEME_BG_KEY]
  return typeof flag === 'boolean' ? flag : true
}

/**
 * `scene` as `initialData` for a drawing that follows the theme: the canvas is
 * left transparent so the main panel behind it supplies the colour. A scene of
 * `null` (a note with no drawing yet) becomes an empty one on the same surface.
 */
export function sceneWithThemeCanvas(
  scene: Record<string, unknown> | null,
): Record<string, unknown> {
  const appState =
    scene && scene.appState && typeof scene.appState === 'object'
      ? (scene.appState as Record<string, unknown>)
      : {}
  return { ...(scene ?? {}), appState: { ...appState, viewBackgroundColor: THEME_CANVAS_BG } }
}

/**
 * Mark a parsed scene for storage: a drawing that follows the theme is flagged
 * and keeps the panel colour it was last drawn on, so the file, exports and
 * other Excalidraw apps see an opaque background instead of the `transparent`
 * marker the live canvas uses. `color === null` means the drawing owns its
 * background, which is then stored untouched.
 */
export function applyStoredBackground(
  scene: Record<string, unknown>,
  color: string | null,
): void {
  if (color == null) {
    delete scene[THEME_BG_KEY]
    return
  }
  scene[THEME_BG_KEY] = true
  const appState =
    scene.appState && typeof scene.appState === 'object'
      ? (scene.appState as Record<string, unknown>)
      : {}
  scene.appState = { ...appState, viewBackgroundColor: color }
}

/** `applyStoredBackground()` for a serialized scene. */
export function writeThemeBackground(sceneJson: string, color: string | null): string {
  const data = parseScene(sceneJson)
  if (!data) return sceneJson
  applyStoredBackground(data, color)
  return JSON.stringify(data)
}
