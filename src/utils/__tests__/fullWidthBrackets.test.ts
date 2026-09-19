import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import type { Transaction } from '@milkdown/prose/state'
import { Schema } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import { createFullWidthBracketInput } from '../fullWidthBrackets'

// Minimal schema standing in for the editor: a paragraph of text plus an
// inline `code` mark, so the "brackets inside code are literal" rule is
// covered too.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
  marks: {
    code: { code: true, toDOM: () => ['code', 0] },
  },
})

const plugin = createFullWidthBracketInput()

function stateWith(text: string, mark?: 'code') {
  const content = text
    ? schema.text(text, mark ? [schema.marks.code.create()] : undefined)
    : null
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, content))
  return EditorState.create({ doc, plugins: [plugin] })
}

/** Applies `tr` through `applyTransaction`, as the view does. */
function typeInto(state: EditorState, text: string, at: number) {
  return state.applyTransaction(state.tr.insertText(text, at)).state
}

/** Stands in for the view: the handler only ever reads state and dispatches. */
function fakeView(state: EditorState) {
  const view = {
    state,
    dispatch: (tr: Transaction) => {
      view.state = view.state.apply(tr)
    },
  }
  return view as unknown as { state: EditorState } & Pick<EditorView, 'state' | 'dispatch'>
}

function type(view: ReturnType<typeof fakeView>, text: string, at: number): boolean {
  const props = plugin.props as {
    handleTextInput: (
      view: EditorView,
      from: number,
      to: number,
      text: string,
    ) => boolean
  }
  return props.handleTextInput(view as unknown as EditorView, at, at, text)
}

describe('createFullWidthBracketInput — typed input', () => {
  it('turns the second 【 into the closing half of [[', () => {
    const view = fakeView(stateWith('【'))
    expect(type(view, '【', 2)).toBe(true)
    expect(view.state.doc.textContent).toBe('[[')
  })

  it('swallows a 【 typed after an already rewritten [[', () => {
    // The IME re-delivering the bracket is what produced the third character.
    const view = fakeView(stateWith('[['))
    expect(type(view, '【', 3)).toBe(true)
    expect(view.state.doc.textContent).toBe('[[')
    expect((view.state.selection as TextSelection).$cursor?.parentOffset).toBe(2)
  })

  it('merges a half-width [ with a following 【', () => {
    const view = fakeView(stateWith('['))
    expect(type(view, '【', 2)).toBe(true)
    expect(view.state.doc.textContent).toBe('[[')
  })

  it('leaves the first 【 alone', () => {
    const view = fakeView(stateWith(''))
    expect(type(view, '【', 1)).toBe(false)
    expect(view.state.doc.textContent).toBe('')
  })

  it('leaves ordinary text that merely contains 【 alone', () => {
    const view = fakeView(stateWith(''))
    expect(type(view, '【的', 1)).toBe(false)
  })

  it('does not touch brackets inside inline code', () => {
    const view = fakeView(stateWith('【', 'code'))
    expect(type(view, '【', 2)).toBe(false)
  })
})

describe('createFullWidthBracketInput — document fallback', () => {
  it('rewrites 【【 that reached the document without going through typing', () => {
    let state = stateWith('')
    state = typeInto(state, '【【', 1)
    expect(state.doc.textContent).toBe('[[')
  })

  it('folds a stray 【 landing after the rewritten pair', () => {
    let state = stateWith('')
    state = typeInto(state, '【【', 1)
    state = typeInto(state, '【', 3)
    expect(state.doc.textContent).toBe('[[')
    expect((state.selection as TextSelection).$cursor?.parentOffset).toBe(2)
  })

  it('leaves a single 【 alone', () => {
    expect(typeInto(stateWith(''), '【', 1).doc.textContent).toBe('【')
  })

  it('leaves an ASCII [[ alone', () => {
    expect(typeInto(stateWith('['), '[', 2).doc.textContent).toBe('[[')
  })

  it('does not rewrite a whole document that merely contains 【【', () => {
    // Simulates loading a note: one big replacement, not a keystroke.
    const state = stateWith('前言【【目标]]')
    const tr = state.tr.replaceWith(
      1,
      state.doc.content.size - 1,
      schema.nodes.paragraph.create(null, schema.text('【【目标]]')),
    )
    expect(state.applyTransaction(tr).state.doc.textContent).toBe('【【目标]]')
  })
})
