import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../api/files'
import {
  findNode,
  findNodeChildren,
  insertNode,
  removeNode,
  sortTreeNodes,
  updateNodeChildren,
} from '../treeOps'

function file(id: string): TreeNode {
  return { id, name: id.split('/').pop() || id, type: 'file' }
}

function folder(id: string, children: TreeNode[] = [], expanded = false): TreeNode {
  return { id, name: id.split('/').pop() || id, type: 'folder', children, expanded }
}

// The vault root is the folder node without an id, matching what the API returns.
function tree(): TreeNode[] {
  return [
    folder('', [
      folder('Journals', [
        folder('Journals/2026', [file('Journals/2026/2026-01-01.md')], true),
      ]),
      file('note.md'),
      file('alpha.md'),
    ]),
  ]
}

describe('findNode', () => {
  it('finds nested nodes', () => {
    expect(findNode(tree(), 'Journals/2026')?.type).toBe('folder')
    expect(findNode(tree(), 'Journals/2026/2026-01-01.md')?.type).toBe('file')
  })

  it('returns null for an unknown id', () => {
    expect(findNode(tree(), 'nope.md')).toBeNull()
    expect(findNode([], 'nope.md')).toBeNull()
  })
})

describe('findNodeChildren', () => {
  it('returns the children of a known node', () => {
    expect(findNodeChildren(tree(), 'Journals')?.map((c) => c.id)).toEqual(['Journals/2026'])
  })

  it('returns an empty array for a leaf file', () => {
    expect(findNodeChildren(tree(), 'note.md')).toEqual([])
  })

  it('returns null for an unknown node', () => {
    expect(findNodeChildren(tree(), 'missing')).toBeNull()
  })
})

describe('sortTreeNodes', () => {
  it('puts folders before files', () => {
    expect(sortTreeNodes(folder('a'), file('z'))).toBeLessThan(0)
    expect(sortTreeNodes(file('z'), folder('a'))).toBeGreaterThan(0)
  })

  it('sorts each group by name', () => {
    expect(sortTreeNodes(file('a.md'), file('b.md'))).toBeLessThan(0)
  })
})

describe('insertNode', () => {
  it('inserts into the vault root and keeps the order', () => {
    const next = insertNode(tree(), '', file('beta.md'))
    expect(next[0].children?.map((c) => c.name)).toEqual([
      'Journals',
      'alpha.md',
      'beta.md',
      'note.md',
    ])
  })

  it('inserts into a nested folder', () => {
    const next = insertNode(tree(), 'Journals', folder('Journals/2025'))
    const children = findNodeChildren(next, 'Journals')
    expect(children?.map((c) => c.name)).toEqual(['2025', '2026'])
  })

  it('sorts a new file among existing ones', () => {
    const next = insertNode(tree(), 'Journals/2026', file('Journals/2026/2026-02-01.md'))
    const children = findNodeChildren(next, 'Journals/2026')
    expect(children?.map((c) => c.name)).toEqual(['2026-01-01.md', '2026-02-01.md'])
  })

  it('leaves the tree untouched when the parent is unknown', () => {
    const source = tree()
    expect(insertNode(source, 'nope', file('x.md'))).toEqual(source)
  })
})

describe('updateNodeChildren', () => {
  it('replaces the children of one directory only', () => {
    const before = tree()
    const next = updateNodeChildren(before, 'Journals/2026', [file('Journals/2026/2026-03-01.md')])
    expect(findNodeChildren(next, 'Journals/2026')?.map((c) => c.name)).toEqual(['2026-03-01.md'])
    // Sibling branches keep their identity, so they are not re-rendered.
    expect(findNode(next, 'note.md')).toBe(findNode(before, 'note.md'))
  })

  it('is a no-op for an unknown directory', () => {
    const source = tree()
    expect(updateNodeChildren(source, 'nope', [])).toEqual(source)
  })
})

describe('removeNode', () => {
  it('removes a nested subtree', () => {
    const next = removeNode(tree(), 'Journals/2026')
    expect(findNode(next, 'Journals/2026/2026-01-01.md')).toBeNull()
    expect(findNode(next, 'Journals')).not.toBeNull()
  })

  it('removes a top-level file', () => {
    const next = removeNode(tree(), 'note.md')
    expect(findNodeChildren(next, '')?.map((c) => c.id)).toEqual([
      'Journals',
      'alpha.md',
    ])
  })

  it('is a no-op for an unknown id', () => {
    const source = tree()
    expect(removeNode(source, 'nope')).toEqual(source)
  })
})
