import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { Node as PMNode } from '@milkdown/prose/model'
import { WIKI_LINK_RE } from './wikiLink'

// Renders `[[target]]` as a link without turning it into a schema node: the
// markdown keeps its brackets, so nothing here can corrupt a note on save.
// The brackets themselves get a dimmer decoration so the eye reads the target
// first.

const decorationsKey = new PluginKey<DecorationSet>('msWikiLinkDecorations')

/** True for code blocks / inline code, where `[[` is just text. */
function isCode(node: PMNode): boolean {
  return node.type.spec.code === true || node.type.name === 'code_block'
}

function build(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (isCode(node)) return false
    if (!node.isText || !node.text) return
    // Inline code keeps its own styling; a link inside it is not a link.
    if (node.marks.some((mark) => mark.type.spec.code === true)) return

    const text = node.text
    WIKI_LINK_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WIKI_LINK_RE.exec(text))) {
      const start = pos + match.index
      const end = start + match[0].length
      decorations.push(
        Decoration.inline(start, end, {
          class: 'ms-wikilink',
          'data-wikilink': match[1],
        }),
      )
      decorations.push(Decoration.inline(start, start + 2, { class: 'ms-wikilink-bracket' }))
      decorations.push(Decoration.inline(end - 2, end, { class: 'ms-wikilink-bracket' }))
    }
  })

  return DecorationSet.create(doc, decorations)
}

export function createWikiLinkDecorations(): Plugin {
  return new Plugin({
    key: decorationsKey,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, value) =>
        tr.docChanged ? build(tr.doc) : value.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state) => decorationsKey.getState(state) ?? DecorationSet.empty,
    },
  })
}
