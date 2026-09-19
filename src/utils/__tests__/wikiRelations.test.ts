import { describe, expect, it } from 'vitest'
import { analyzeRelations, parseBackLinks, parseOutLinks } from '../relations'

// `[[B]]` written in one note is an outgoing link there and a backlink on B.

describe('wiki links in the relation panel', () => {
  it('reports [[B]] as an outgoing link of the note that carries it', () => {
    const out = parseOutLinks({ path: 'A.md', content: 'see [[B]] here' })
    expect(out).toEqual([{ path: 'B', name: 'B', kind: 'wiki', raw: 'B' }])
  })

  it('shows the note that wrote [[B]] as a backlink of B', () => {
    const back = parseBackLinks({ path: 'B.md', content: 'hello' }, [
      { path: 'A.md', content: 'see [[B]] here' },
      { path: 'B.md', content: 'hello' },
    ])
    expect(back).toEqual([{ path: 'A.md', name: 'A', snippet: '[[B]]' }])
  })

  it('resolves a directory-qualified [[dir/B]] backlink', () => {
    const back = parseBackLinks({ path: 'dir/B.md', content: 'hello' }, [
      { path: 'A.md', content: 'see [[dir/B]] here' },
      { path: 'dir/B.md', content: 'hello' },
    ])
    expect(back.map((b) => b.path)).toEqual(['A.md'])
  })

  it('ignores the alias when matching, but keeps it as the label', () => {
    expect(parseOutLinks({ path: 'A.md', content: 'see [[B|别名]] here' })).toEqual([
      { path: 'B', name: '别名', kind: 'wiki', raw: 'B' },
    ])
    const back = parseBackLinks({ path: 'B.md', content: 'hello' }, [
      { path: 'A.md', content: 'see [[B|别名]] here' },
      { path: 'B.md', content: 'hello' },
    ])
    expect(back.map((b) => b.path)).toEqual(['A.md'])
  })

  // Remark escapes a `[` that sits in prose, so the editor's serializer writes
  // `\[\[B]]`. The reader sees `[[B]]`, and the panel must see it too.
  it('still reads links whose brackets were escaped on save', () => {
    const stored = 'see \\[\\[B]] here'
    expect(parseOutLinks({ path: 'A.md', content: stored })).toEqual([
      { path: 'B', name: 'B', kind: 'wiki', raw: 'B' },
    ])
    const back = parseBackLinks({ path: 'B.md', content: 'hello' }, [
      { path: 'A.md', content: stored },
      { path: 'B.md', content: 'hello' },
    ])
    expect(back).toEqual([{ path: 'A.md', name: 'A', snippet: '[[B]]' }])
  })

  it('keeps both directions in sync', () => {
    const all = [
      { path: 'A.md', content: 'see [[B]] and [[C]]' },
      { path: 'B.md', content: 'back to [[A]]' },
      { path: 'C.md', content: 'nothing' },
    ]
    const res = analyzeRelations(all[1], all)
    expect(res.outLinks.map((o) => o.raw)).toEqual(['A'])
    expect(res.backLinks.map((b) => b.path)).toEqual(['A.md'])
  })
})
