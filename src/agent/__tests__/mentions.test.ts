import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../api/files'
import {
  flattenMarkdownFiles,
  mentionName,
  parseMentions,
  splitMentions,
} from '../mentions'

describe('parseMentions', () => {
  it('extracts a single reference', () => {
    expect(parseMentions('read @[[docs/a.md]] now')).toEqual(['docs/a.md'])
  })

  it('extracts several references in order', () => {
    expect(parseMentions('@[[a.md]] and @[[b/c.md]] please')).toEqual(['a.md', 'b/c.md'])
  })

  it('dedupes repeated references', () => {
    expect(parseMentions('@[[a.md]] @[[a.md]]')).toEqual(['a.md'])
  })

  it('trims surrounding whitespace in the path', () => {
    expect(parseMentions('@[[  a.md  ]]')).toEqual(['a.md'])
  })

  it('ignores non-wiki @ mentions', () => {
    expect(parseMentions('email me at foo@bar.com')).toEqual([])
  })

  it('returns nothing when there is no mention', () => {
    expect(parseMentions('just plain text')).toEqual([])
  })
})

describe('flattenMarkdownFiles', () => {
  const tree: TreeNode[] = [
    {
      id: 'docs',
      name: 'docs',
      type: 'folder',
      children: [
        { id: 'docs/a.md', name: 'a.md', type: 'file' },
        { id: 'docs/b.txt', name: 'b.txt', type: 'file' },
      ],
    },
    { id: 'root.md', name: 'root.md', type: 'file' },
  ]

  it('keeps only .md files, recursing into folders', () => {
    const out = flattenMarkdownFiles(tree)
    expect(out).toEqual([
      { path: 'docs/a.md', name: 'a.md' },
      { path: 'root.md', name: 'root.md' },
    ])
  })
})

describe('mentionName', () => {
  it('strips the .md extension and folder', () => {
    expect(mentionName('docs/notes/My Note.md')).toBe('My Note')
  })
})

describe('splitMentions', () => {
  it('alternates text and mention segments', () => {
    expect(splitMentions('see @[[a.md]] and @[[b.md]] end')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'mention', value: 'a.md' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: 'b.md' },
      { type: 'text', value: ' end' },
    ])
  })

  it('returns a single text segment when there is no mention', () => {
    expect(splitMentions('plain')).toEqual([{ type: 'text', value: 'plain' }])
  })
})
