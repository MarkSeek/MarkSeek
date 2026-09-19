import { describe, expect, it } from 'vitest'
import {
  filterWikiCandidates,
  noteTitle,
  parseWikiTarget,
  resolveWikiLink,
  suggestCreatePath,
  unescapeWikiLinks,
} from '../wikiLink'

const PATHS = [
  '文件1.md',
  '目录1/文件1.md',
  '目录1/子目录/文件1.md',
  'a/b/c.md',
  'notes/Other.md',
]

describe('parseWikiTarget', () => {
  it('trims the target and normalizes separators', () => {
    expect(parseWikiTarget('  目录1/文件1 ')).toEqual({ target: '目录1/文件1' })
  })

  it('splits off alias and anchor', () => {
    expect(parseWikiTarget('文件1|别名')).toEqual({ target: '文件1', alias: '别名' })
    expect(parseWikiTarget('文件1#标题')).toEqual({ target: '文件1', anchor: '标题' })
    expect(parseWikiTarget('文件1#标题|别名')).toEqual({
      target: '文件1',
      alias: '别名',
      anchor: '标题',
    })
  })

  it('writes backslashes through as forward slashes', () => {
    expect(parseWikiTarget('目录1\\文件1').target).toBe('目录1/文件1')
  })
})

describe('resolveWikiLink', () => {
  it('resolves a bare name that exists once', () => {
    expect(resolveWikiLink('Other', { paths: ['notes/Other.md'], fromPath: 'notes/a.md' })).toEqual({
      status: 'unique',
      path: 'notes/Other.md',
    })
  })

  it('reports every same-named note when the target is ambiguous', () => {
    const result = resolveWikiLink('文件1', { paths: PATHS })
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return
    expect(result.candidates).toHaveLength(3)
    // Shorter paths first, so the least nested note is the default guess.
    expect(result.candidates[0]).toBe('文件1.md')
  })

  it('narrows a target carrying a directory down to one note', () => {
    expect(resolveWikiLink('目录1/文件1', { paths: PATHS })).toEqual({
      status: 'unique',
      path: '目录1/文件1.md',
    })
  })

  it('walks multi-level directories', () => {
    expect(resolveWikiLink('b/c', { paths: PATHS })).toEqual({
      status: 'unique',
      path: 'a/b/c.md',
    })
    expect(resolveWikiLink('a/b/c', { paths: PATHS })).toEqual({
      status: 'unique',
      path: 'a/b/c.md',
    })
  })

  it('asks the reader to choose between same-named notes', () => {
    const result = resolveWikiLink('文件1', {
      paths: ['notes/文件1.md', 'other/文件1.md'],
      fromPath: 'other/current.md',
    })
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return
    // The note sitting next to the linking one is offered first.
    expect(result.candidates[0]).toBe('other/文件1.md')
  })

  it('accepts an explicit .md extension', () => {
    expect(resolveWikiLink('目录1/文件1.md', { paths: PATHS })).toEqual({
      status: 'unique',
      path: '目录1/文件1.md',
    })
  })

  it('ignores case but returns the on-disk casing', () => {
    expect(resolveWikiLink('other', { paths: ['notes/Other.md'] })).toEqual({
      status: 'unique',
      path: 'notes/Other.md',
    })
  })

  it('never resolves a note to itself', () => {
    expect(
      resolveWikiLink('文件1', { paths: ['文件1.md', '目录1/文件1.md'], fromPath: '文件1.md' }),
    ).toEqual({ status: 'unique', path: '目录1/文件1.md' })
  })

  it('does not match a partial name across a segment boundary', () => {
    expect(resolveWikiLink('文件1', { paths: ['另一个文件1.md'] })).toMatchObject({
      status: 'missing',
    })
  })

  it('suggests a creation path for a missing target', () => {
    expect(resolveWikiLink('新的笔记', { paths: PATHS, fromPath: 'notes/a.md' })).toEqual({
      status: 'missing',
      target: '新的笔记',
      createPath: 'notes/新的笔记.md',
    })
  })

  it('keeps a directory in the suggested creation path', () => {
    expect(resolveWikiLink('新目录/新的笔记', { paths: PATHS, fromPath: 'notes/a.md' })).toEqual({
      status: 'missing',
      target: '新目录/新的笔记',
      createPath: '新目录/新的笔记.md',
    })
  })
})

describe('suggestCreatePath', () => {
  it('appends .md once', () => {
    expect(suggestCreatePath(' 笔记 ')).toBe('笔记.md')
    expect(suggestCreatePath('笔记.md')).toBe('笔记.md')
  })
})

describe('noteTitle', () => {
  it('strips the directory and the extension', () => {
    expect(noteTitle('目录1/文件1.md')).toBe('文件1')
    expect(noteTitle('文件1.markdown')).toBe('文件1')
  })
})

describe('filterWikiCandidates', () => {
  it('ranks names starting with the query first', () => {
    const list = filterWikiCandidates('文件', {
      paths: ['x/另一个文件.md', '文件1.md'],
      fromPath: 'current.md',
    })
    expect(list).toEqual(['文件1.md', 'x/另一个文件.md'])
  })

  it('lists the current directory first for an empty query', () => {
    const list = filterWikiCandidates('', {
      paths: ['far/文件1.md', '文件1.md'],
      fromPath: 'current.md',
    })
    expect(list).toEqual(['文件1.md', 'far/文件1.md'])
  })

  it('never offers the note being edited', () => {
    expect(filterWikiCandidates('文件', { paths: ['文件1.md'], fromPath: '文件1.md' })).toEqual([])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => `文件${i}.md`)
    expect(filterWikiCandidates('文件', { paths: many, limit: 5 })).toHaveLength(5)
  })
})

describe('unescapeWikiLinks', () => {
  it('restores the brackets remark escapes in prose', () => {
    expect(unescapeWikiLinks('see \\[\\[文件1]] here')).toBe('see [[文件1]] here')
  })

  it('restores a link whose closing brackets were escaped too', () => {
    expect(unescapeWikiLinks('a \\[\\[b/c\\]\\] b')).toBe('a [[b/c]] b')
  })

  it('leaves every other escape alone', () => {
    expect(unescapeWikiLinks('a \\*star\\* and \\#tag')).toBe('a \\*star\\* and \\#tag')
  })
})
