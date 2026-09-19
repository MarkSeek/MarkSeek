import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import type { Slice } from '@milkdown/prose/model'

// Chinese IMEs hand out the full-width bracket `【` instead of `[`, so the
// wiki-link opener a Chinese user types is `【【`, which nothing downstream
// recognises as a link. Two hooks rewrite it into `[[`:
//
//  1. `handleTextInput` — the main path. The typed bracket never reaches the
//     document, so nothing can re-deliver it and no third character can appear.
//  2. `appendTransaction` — the safety net for input paths that skip (1),
//     e.g. an IME committing text straight through the DOM. It also folds in a
//     stray `【` that lands right after an already rewritten `[[`, which is how
//     the extra bracket used to show up.
//
// Brackets inside code (block or inline) are literal content and never
// rewritten.

const FULL_WIDTH = '【'
const ASCII_PAIR = '[['

/** Bracket run at the very end of a string, half- or full-width. */
const RUN_BEFORE_TYPED = /[\[【]{1,2}$/
const RUN_AFTER_TYPED = /[\[【]{2,3}$/

/**
 * Upper bound (in slice size) for what still counts as a keystroke rather
 * than a paste or a whole-document swap. Only keystroke-sized insertions may
 * trigger the rewrite, so loading or pasting a note that happens to contain
 * `【【` never edits the document behind the user's back.
 */
const KEYSTROKE_SLICE_MAX = 8

function isCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.spec.code === true) return true
  const marks = state.storedMarks ?? $pos.marks()
  return marks.some((mark) => mark.type.spec.code === true)
}

/** Whether any step of `tr` inserted a `【` (as typing, not as a big paste). */
function insertedFullWidthBracket(tr: Transaction): boolean {
  for (const step of tr.steps) {
    const slice = (step as { slice?: Slice }).slice
    if (!slice) continue
    if (slice.size > KEYSTROKE_SLICE_MAX) continue
    const text = slice.content.textBetween(0, slice.content.size, undefined, '\ufffc')
    if (text.includes(FULL_WIDTH)) return true
  }
  return false
}

/**
 * Rewrites the bracket being typed together with the bracket(s) already in
 * front of the caret. Returns false (letting ProseMirror insert normally) for
 * anything that is not a bare bracket.
 */
function handleTypedBracket(view: EditorView, from: number, to: number, text: string): boolean {
  // Only one or two bare brackets, at least one of them full-width: a longer
  // string is ordinary text and must keep all of its characters.
  if (text.length > 2 || !/^[\[【]+$/.test(text) || !text.includes(FULL_WIDTH)) return false

  const state = view.state
  if (state.selection.empty === false || isCode(state, from)) return false

  const $pos = state.doc.resolve(from)
  const offset = $pos.parentOffset
  const before = $pos.parent.textBetween(Math.max(0, offset - 2), offset, undefined, '\ufffc')
  const run = RUN_BEFORE_TYPED.exec(before)
  // No bracket in front of the caret: this is the FIRST `【`, leave it be —
  // the pair is only completed by the next one.
  if (!run) return false

  const start = from - run[0].length
  const marks = state.storedMarks ?? $pos.marks()
  const tr = state.tr.replaceWith(start, to, state.schema.text(ASCII_PAIR, marks))
  view.dispatch(
    tr
      .setSelection(TextSelection.create(tr.doc, start + ASCII_PAIR.length))
      .scrollIntoView(),
  )
  return true
}

export function createFullWidthBracketInput(): Plugin {
  return new Plugin({
    key: new PluginKey('msFullWidthBracketInput'),
    props: {
      handleTextInput: (view, from, to, text) => handleTypedBracket(view, from, to, text),
    },
    appendTransaction(transactions, _oldState, newState) {
      const typed = transactions.some((tr) => tr.docChanged && insertedFullWidthBracket(tr))
      if (!typed) return null

      const sel = newState.selection
      if (!sel.empty) return null

      const $from = sel.$from
      if (isCode(newState, $from.pos)) return null

      const offset = $from.parentOffset
      const before = $from.parent.textBetween(
        Math.max(0, offset - 3),
        offset,
        undefined,
        '\ufffc',
      )
      const run = RUN_AFTER_TYPED.exec(before)
      // `[[` alone is already the wanted result; a run without a full-width
      // bracket was typed as ASCII and is none of our business.
      if (!run || !run[0].includes(FULL_WIDTH)) return null

      const start = $from.pos - run[0].length
      const tr = newState.tr.replaceWith(
        start,
        $from.pos,
        newState.schema.text(ASCII_PAIR, $from.marks()),
      )
      // Keep the caret right after the rewritten brackets.
      return tr.setSelection(TextSelection.create(tr.doc, start + ASCII_PAIR.length))
    },
  })
}
