// Zoom-aware fork of `prosemirror-virtual-cursor` (the virtual caret that
// Crepe's Cursor feature uses when `virtual` is not false).
//
// Why a fork: upstream positions the caret with viewport coordinates, e.g.
// `left = clientRect.left - editorRect.left`. Under the app's outer CSS zoom
// (.app-layout { zoom: var(--app-zoom-scale) }) both client rects are already
// multiplied by the zoom factor, and assigning that difference to `left`/`top`
// of an element living INSIDE the zoomed subtree scales it once more. The
// caret therefore drifts to the bottom-right at zoom > 1 and to the top-left
// at zoom < 1. This fork divides the measured offsets (and the caret height)
// by the effective zoom before assigning them.
//
// Differences from upstream:
// - Offsets are compensated by the effective zoom (see appZoomScale).
// - Offsets are measured against the caret's real containing block
//   (`offsetParent` — the `position: relative` .milkdown wrapper from Crepe's
//   reset.css) instead of assuming the editor DOM itself is positioned.
// - The caret stays hidden until it has been positioned at least once, so a
//   freshly mounted editor never shows a stray caret at the document start.
//
// The DOM structure and CSS class names are identical to upstream, so the
// stylesheet bundled by Crepe (theme/common/cursor.css) keeps working.
import { Mark } from '@milkdown/prose/model'
import type { ResolvedPos } from '@milkdown/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import { appZoomScale } from './zoom'

const key = new PluginKey('prosemirror-virtual-cursor-zoom')

// Minimal rect shape shared by DOM client rects and coordsAtPos.
interface CaretRect {
  top: number
  bottom: number
  left: number
}

// `Node.marks` is a readonly array in prosemirror-model, so keep it readonly
// all the way through. The only place that needs a mutable copy is
// `setStoredMarks` (see handleKeyDown).
function getMarksAround(
  $pos: ResolvedPos,
): [readonly Mark[] | undefined, readonly Mark[] | undefined] {
  const index = $pos.index()
  const after = $pos.parent.maybeChild(index)
  let before = $pos.textOffset ? after : null
  if (!before && index > 0) before = $pos.parent.maybeChild(index - 1)
  return [before?.marks, after?.marks]
}

function isTextSelection(selection: unknown): selection is TextSelection {
  return !!selection && typeof selection === 'object' && '$cursor' in selection
}

function getCursorRect(view: EditorView, toStart: boolean): CaretRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(toStart)
  const rects = range.getClientRects()
  const rect = rects.length ? rects[rects.length - 1] : null
  if (rect && rect.height) return rect
  // Fallback for collapsed ranges without client rects (e.g. empty nodes).
  try {
    return view.coordsAtPos(view.state.selection.head)
  } catch {
    return null
  }
}

function restartAnimation(element: HTMLElement, className: string) {
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}

function updateCursor(view: EditorView, cursor: HTMLElement) {
  if (!view.dom || view.isDestroyed) return
  const { state } = view
  const { selection } = state

  // `selectionchange` fires for selections ANYWHERE in the document (right
  // panel, search box, any input). Upstream measures that foreign rect and
  // positions the absolutely-positioned caret with it, which pushes the caret
  // outside the editor, inflates .editor-area's scrollWidth and shows a
  // horizontal scrollbar under the editor. Hide the caret unless the DOM
  // selection really lives inside this editor.
  const domSelection = window.getSelection()
  const ownsSelection =
    !!domSelection &&
    domSelection.rangeCount > 0 &&
    view.dom.contains(domSelection.anchorNode)
  if (!ownsSelection || !isTextSelection(selection)) {
    cursor.style.display = 'none'
    return
  }

  const cursorRect = getCursorRect(view, selection.$head === selection.$from)
  if (!cursorRect) return

  // The caret is absolutely positioned; offsetParent is its real containing
  // block (the .milkdown wrapper, made position:relative by Crepe's reset.css).
  const host = (cursor.offsetParent as HTMLElement | null) ?? view.dom
  const hostRect = host.getBoundingClientRect()
  const scale = appZoomScale()

  let className = 'prosemirror-virtual-cursor'
  const [marksBefore, marksAfter] = getMarksAround(selection.$head)
  const marks = state.storedMarks || selection.$head.marks()
  if (selection.$cursor && marksBefore && marksAfter && marks && !Mark.sameSet(marksBefore, marksAfter)) {
    if (Mark.sameSet(marksBefore, marks)) className += ' prosemirror-virtual-cursor-left'
    else if (Mark.sameSet(marksAfter, marks)) className += ' prosemirror-virtual-cursor-right'
  }
  cursor.className = className
  restartAnimation(cursor, 'prosemirror-virtual-cursor-animation')
  // Offsets measured in viewport px are already scaled by the zoom factor,
  // while left/top/height assigned inside the zoomed subtree are scaled once
  // more by the browser. Divide to undo the double scaling.
  cursor.style.height = `${(cursorRect.bottom - cursorRect.top) / scale}px`
  cursor.style.left = `${(cursorRect.left - hostRect.left) / scale}px`
  cursor.style.top = `${(cursorRect.top - hostRect.top) / scale}px`
  cursor.style.display = ''
}

export function createVirtualCursor(): Plugin {
  let cursor: HTMLElement | null =
    typeof document === 'undefined' ? null : document.createElement('div')
  // Hidden until the first successful positioning (see updateCursor) so a
  // freshly mounted editor never shows a stray caret at the document start.
  cursor?.style.setProperty('display', 'none')

  return new Plugin({
    key,
    view: (view) => {
      const doc = view.dom.ownerDocument
      // Bind the element to a local const: `cursor` is a mutable `let` captured
      // by the closure below, so TS cannot narrow it to non-null there.
      const el = cursor || (cursor = doc.createElement('div'))
      const update = () => updateCursor(view, el)
      let observer: ResizeObserver | undefined
      if (typeof window !== 'undefined' && window.ResizeObserver) {
        observer = new window.ResizeObserver(() => update())
        observer.observe(view.dom)
      }
      doc.addEventListener('selectionchange', update)
      return {
        update: () => update(),
        destroy: () => {
          doc.removeEventListener('selectionchange', update)
          observer?.disconnect()
        },
      }
    },
    props: {
      // Keep the caret on the correct side of mark boundaries when stepping
      // over them with the arrow keys (same as upstream).
      handleKeyDown: (view, event) => {
        const { selection } = view.state
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.isComposing ||
          !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
          !isTextSelection(selection) ||
          !selection.empty
        )
          return false
        const $pos = selection.$head
        const [marksBefore, marksAfter] = getMarksAround($pos)
        const marks = view.state.storedMarks || $pos.marks()
        if (marksBefore && marksAfter && !Mark.sameSet(marksBefore, marksAfter)) {
          if (event.key === 'ArrowLeft' && !Mark.sameSet(marksBefore, marks)) {
            view.dispatch(view.state.tr.setStoredMarks([...marksBefore]))
            return true
          }
          if (event.key === 'ArrowRight' && !Mark.sameSet(marksAfter, marks)) {
            view.dispatch(view.state.tr.setStoredMarks([...marksAfter]))
            return true
          }
        }
        if (event.key === 'ArrowLeft' && $pos.textOffset === 1) {
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, $pos.pos - 1))
              .setStoredMarks($pos.marks()),
          )
          return true
        }
        if (
          event.key === 'ArrowRight' &&
          $pos.textOffset + 1 === ($pos.parent.maybeChild($pos.index())?.nodeSize ?? -1)
        ) {
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, $pos.pos + 1))
              .setStoredMarks($pos.marks()),
          )
          return true
        }
        return false
      },
      decorations: (state) => {
        if (!cursor || !isTextSelection(state.selection) || !state.selection.empty) return
        return DecorationSet.create(state.doc, [
          Decoration.widget(0, cursor, { key: 'prosemirror-virtual-cursor' }),
        ])
      },
      // The .virtual-cursor-enabled class hides the native caret via CSS
      // (prosemirror-virtual-cursor's stylesheet).
      attributes: {
        class: 'virtual-cursor-enabled',
      },
    },
  })
}
