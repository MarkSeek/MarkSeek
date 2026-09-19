import { describe, expect, it } from 'vitest'
import { buildTree, parseHeadings } from '../outline'

describe('parseHeadings', () => {
  it('collects ATX headings from h1 to h6', () => {
    const md = ['# One', '## Two', '###### Six'].join('\n')
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 6, text: 'Six' },
    ])
  })

  it('ignores 7 hashes and a missing space after the hashes', () => {
    expect(parseHeadings('####### Too deep')).toEqual([])
    expect(parseHeadings('#NoSpace')).toEqual([])
  })

  // Known defect: a heading whose title is only whitespace is still collected
  // (as an empty string), so the outline renders a blank row.
  it.fails('ignores headings with an empty title', () => {
    expect(parseHeadings('#   ')).toEqual([])
  })

  it('trims trailing whitespace and markers from the title', () => {
    expect(parseHeadings('##  Title   ')).toEqual([{ level: 2, text: 'Title' }])
  })

  it('returns [] for empty input', () => {
    expect(parseHeadings('')).toEqual([])
  })

  // Characterization: fenced code blocks are not excluded, so a shell comment
  // shows up as a heading. Documented so a fix shows up as a test failure.
  it.fails('skips headings inside fenced code blocks', () => {
    const md = '```sh\n# install deps\n```\n'
    expect(parseHeadings(md)).toEqual([])
  })
})

describe('buildTree', () => {
  it('nests deeper headings under their parent', () => {
    const tree = buildTree([
      { level: 1, text: 'A' },
      { level: 2, text: 'A1' },
      { level: 3, text: 'A1a' },
      { level: 2, text: 'A2' },
      { level: 1, text: 'B' },
    ])
    expect(tree.map((n) => n.text)).toEqual(['A', 'B'])
    expect(tree[0].children.map((n) => n.text)).toEqual(['A1', 'A2'])
    expect(tree[0].children[0].children.map((n) => n.text)).toEqual(['A1a'])
  })

  it('attaches a heading that skips levels to the closest ancestor', () => {
    const tree = buildTree([
      { level: 1, text: 'A' },
      { level: 3, text: 'Deep' },
      { level: 2, text: 'Shallow' },
    ])
    expect(tree[0].children.map((n) => n.text)).toEqual(['Deep', 'Shallow'])
  })

  it('returns [] for no headings', () => {
    expect(buildTree([])).toEqual([])
  })
})
