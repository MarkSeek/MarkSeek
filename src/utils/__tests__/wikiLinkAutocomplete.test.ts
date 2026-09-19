import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { isWikiAnchorOpen } from '../wikiLinkAutocomplete'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
})

function docWith(text: string) {
  return schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create(null, text ? schema.text(text) : null),
  )
}

describe('isWikiAnchorOpen', () => {
  it('is true at the brackets of an unfinished link', () => {
    expect(isWikiAnchorOpen(docWith('[[abc'), 1)).toBe(true)
  })

  it('is false once the brackets are gone', () => {
    // Deleting (or never finishing) the brackets frees the offset: `[[` typed
    // there again is a new link, not the dismissed one.
    expect(isWikiAnchorOpen(docWith('[abc'), 1)).toBe(false)
    expect(isWikiAnchorOpen(docWith('abc'), 1)).toBe(false)
    expect(isWikiAnchorOpen(docWith(''), 1)).toBe(false)
  })

  it('stays true while the brackets are still there, link closed or not', () => {
    expect(isWikiAnchorOpen(docWith('[[abc]]'), 1)).toBe(true)
  })

  it('is false outside the document', () => {
    const doc = docWith('[[')
    expect(isWikiAnchorOpen(doc, -1)).toBe(false)
    expect(isWikiAnchorOpen(doc, doc.content.size - 1)).toBe(false)
  })
})
