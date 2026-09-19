import { describe, expect, it } from 'vitest'
import {
  analyzeRelations,
  parseBackLinks,
  parseOutLinks,
  parseTagMatrix,
  parseTags,
  parseTasks,
} from '../relations'

const current = { path: 'notes/a.md', content: '' }

describe('parseOutLinks', () => {
  it('resolves sibling links relative to the note', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[sibling](./b.md)' })
    expect(out).toEqual([{ path: 'notes/b.md', name: 'b', kind: 'file' }])
  })

  it('resolves vault-absolute links against the vault root', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[absolute](/top/c.md)' })
    expect(out.map((o) => o.path)).toEqual(['top/c.md'])
  })

  it('drops links pointing back at the note itself', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[self](./a.md)' })
    expect(out).toEqual([])
  })

  it('deduplicates repeated targets', () => {
    const out = parseOutLinks({
      path: 'notes/a.md',
      content: ['[one](./b.md)', '[two](./b.md#anchor)'].join('\n'),
    })
    expect(out).toHaveLength(1)
  })

  it('collects wikilinks, keeping the alias only as the label', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[[Other Note|alias]]' })
    expect(out).toEqual([{ path: 'Other Note', name: 'alias', kind: 'wiki', raw: 'Other Note' }])
  })

  it('keeps external links, tagged so the panel can open the browser', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[site](https://example.com)' })
    expect(out).toEqual([
      {
        path: 'https://example.com',
        name: 'site',
        kind: 'external',
        href: 'https://example.com',
      },
    ])
  })

  it('resolves plain relative links without a "./" prefix', () => {
    const out = parseOutLinks({ path: 'notes/a.md', content: '[plain](b.md)' })
    expect(out.map((o) => o.path)).toEqual(['notes/b.md'])
  })

  it('leaves links to images and other files out of the note list', () => {
    expect(parseOutLinks({ path: 'notes/a.md', content: '![pic](./p.png)' })).toEqual([])
  })
})

describe('parseBackLinks', () => {
  const all = [
    { path: 'notes/a.md', content: '' },
    { path: 'notes/b.md', content: 'see [a](./a.md) for details' },
    { path: 'notes/c.md', content: 'wikilink [[a]] here' },
    { path: 'notes/d.md', content: 'nothing here' },
    { path: 'other/a.md', content: '[external](https://example.com)' },
  ]

  it('finds notes linking to the current one by path', () => {
    const back = parseBackLinks(current, all)
    expect(back.map((b) => b.path)).toEqual(['notes/b.md', 'notes/c.md'])
  })

  it('records the matching line as a snippet', () => {
    const back = parseBackLinks(current, all)
    expect(back[0].snippet).toBe('[a](./a.md)')
  })

  it('never reports the current note as its own backlink', () => {
    const back = parseBackLinks(current, [
      { path: 'notes/a.md', content: '[self](./a.md)' },
      { path: 'notes/b.md', content: '[a](./a.md)' },
    ])
    expect(back.map((b) => b.path)).toEqual(['notes/b.md'])
  })

  it('ignores external links when matching', () => {
    const back = parseBackLinks(current, [
      { path: 'notes/e.md', content: '[site](https://example.com/a.md)' },
    ])
    expect(back).toEqual([])
  })
})

describe('parseTags', () => {
  it('extracts ascii, unicode and dashed tags', () => {
    expect(parseTags({ path: 'a.md', content: '#todo #work-log #笔记 #_private' })).toEqual([
      'todo',
      'work-log',
      '笔记',
      '_private',
    ])
  })

  it('deduplicates tags', () => {
    expect(parseTags({ path: 'a.md', content: '#a #b #a' })).toEqual(['a', 'b'])
  })

  it('ignores tags inside code blocks and inline code', () => {
    const content = ['#real', '```', '#fenced', '```', '`#inline`'].join('\n')
    expect(parseTags({ path: 'a.md', content })).toEqual(['real'])
  })
})

describe('parseTagMatrix', () => {
  it('lists other notes sharing each tag', () => {
    const tags = parseTagMatrix(
      { path: 'a.md', content: '#shared #only-me' },
      [
        { path: 'a.md', content: '#shared #only-me' },
        { path: 'b.md', content: '#shared' },
        { path: 'c.md', content: '#other' },
      ],
    )
    expect(tags).toEqual([
      { tag: 'shared', others: [{ path: 'b.md', name: 'b' }] },
      { tag: 'only-me', others: [] },
    ])
  })

  it('returns [] when the note has no tags', () => {
    expect(parseTagMatrix({ path: 'a.md', content: 'plain' }, [])).toEqual([])
  })
})

describe('parseTasks', () => {
  it('parses open and checked items with any list marker', () => {
    const tasks = parseTasks({
      path: 'a.md',
      content: ['- [ ] open', '* [x] done', '+ [X] also done', '- not a task'].join('\n'),
    })
    expect(tasks).toEqual([
      { text: 'open', done: false },
      { text: 'done', done: true },
      { text: 'also done', done: true },
    ])
  })

  it('returns [] when there are no task items', () => {
    expect(parseTasks({ path: 'a.md', content: '# heading' })).toEqual([])
  })
})

describe('analyzeRelations', () => {
  it('combines every analyzer into one result', () => {
    const result = analyzeRelations(
      { path: 'notes/a.md', content: '#tag\n- [ ] todo\n[x](./b.md)' },
      [
        { path: 'notes/a.md', content: '#tag\n- [ ] todo\n[x](./b.md)' },
        { path: 'notes/b.md', content: '[[a]]' },
      ],
    )
    expect(result.backLinks.map((b) => b.path)).toEqual(['notes/b.md'])
    expect(result.outLinks.map((o) => o.path)).toEqual(['notes/b.md'])
    expect(result.tags).toEqual([{ tag: 'tag', others: [] }])
    expect(result.tasks).toEqual([{ text: 'todo', done: false }])
  })
})
