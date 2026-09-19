import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { Node } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'

// Suggests notes while the caret sits inside an unfinished `[[`.
// The plugin only reports "what is being typed and where"; picking a candidate
// and writing it into the document is the React layer's job.

export interface WikiLinkSuggestState {
  /** Position of the opening `[[`. */
  from: number
  /** Caret position; everything in between is the query. */
  to: number
  /** Text typed after `[[`. */
  query: string
  /** Viewport position of the `[[`; the popup is `fixed`. */
  coords: { x: number; y: number }
}

/** How far back the caret's text is scanned for an opening `[[`. */
const LOOKBACK = 200

/**
 * Whether `pos` still opens an unfinished `[[` in `doc`.
 *
 * Used to tell "the same link the user dismissed" from "a new link typed at the
 * same offset": delete the brackets (or complete the link) and the offset alone
 * no longer identifies the dismissed popup, so `[[` typed there must pop again.
 */
export function isWikiAnchorOpen(doc: Node, pos: number): boolean {
  if (pos < 0 || pos + 2 > doc.content.size) return false
  try {
    return doc.textBetween(pos, pos + 2) === '[['
  } catch {
    // Position on a node boundary: it cannot be holding brackets.
    return false
  }
}

const suggestKey = new PluginKey('msWikiLinkSuggest')

function detect(view: EditorView): WikiLinkSuggestState | null {
  const { state } = view
  const sel = state.selection
  if (!sel.empty || !view.hasFocus()) return null

  const $from = sel.$from
  // `[[` inside code is code, not a link.
  if ($from.parent.type.spec.code === true) return null

  const offset = $from.parentOffset
  const before = $from.parent.textBetween(
    Math.max(0, offset - LOOKBACK),
    offset,
    undefined,
    '\ufffc',
  )
  // A closed `]]` or a newline ends the link, so neither can be in the query.
  const match = /\[\[([^[\]\n]*)$/.exec(before)
  if (!match) return null

  // A closing `]]` ahead of the caret means this is an already-complete
  // `[[...]]` — almost always one the reader just clicked into. The click
  // handler owns that case, so do not stack the completion popup on top of it.
  const after = $from.parent.textBetween(
    offset,
    $from.parent.content.size,
    undefined,
    '\ufffc',
  )
  if (/^\s*\]\]|^\s*[^[\]]*\]\]/.test(after)) return null

  const from = $from.pos - match[0].length
  const rect = view.coordsAtPos(from)
  return { from, to: $from.pos, query: match[1], coords: { x: rect.left, y: rect.bottom } }
}

/**
 * Reports the caret's `[[` context through `onChange`. Nothing is reported
 * while the signature (anchor position + query) is unchanged, so typing cannot
 * flood React with identical updates.
 */
export function createWikiLinkAutocomplete(
  onChange: (state: WikiLinkSuggestState | null) => void,
): Plugin {
  let last = ''
  const report = (view: EditorView) => {
    const next = detect(view)
    const signature = next ? `${next.from}:${next.query}` : ''
    if (signature === last) return
    last = signature
    onChange(next)
  }

  return new Plugin({
    key: suggestKey,
    view() {
      return {
        update: report,
        destroy: () => {
          last = ''
          onChange(null)
        },
      }
    },
  })
}
