import { describe, expect, it } from 'vitest'
import {
  CALENDAR_ID,
  DIARY_PREFIX,
  type Tab,
  fileNameFromPath,
  initialTabsState,
  tabsReducer,
  type WorkspaceTabsState,
} from '../tabsReducer'

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, name: id, path: id, content: '', dirty: false, kind: 'file', ...extra }
}

function stateWith(tabs: Tab[], activeTabId: string | null = tabs[0]?.id ?? null): WorkspaceTabsState {
  return { tabs, activeTabId, selectedNodeId: null }
}

describe('fileNameFromPath', () => {
  it('strips the folder and the .md suffix', () => {
    expect(fileNameFromPath('a/b/note.md')).toBe('note')
    expect(fileNameFromPath('note.md')).toBe('note')
  })

  it('keeps other extensions', () => {
    expect(fileNameFromPath('a/script.js')).toBe('script.js')
  })
})

describe('open', () => {
  it('appends a tab and activates it', () => {
    const next = tabsReducer(initialTabsState, { type: 'open', tab: tab('a.md') })
    expect(next.tabs.map((t) => t.id)).toEqual(['a.md'])
    expect(next.activeTabId).toBe('a.md')
  })

  it('keeps the content of an already open tab', () => {
    const before = stateWith([tab('a.md', { content: 'old' })])
    const next = tabsReducer(before, { type: 'open', tab: tab('a.md', { content: 'new' }) })
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0].content).toBe('old')
    expect(next.activeTabId).toBe('a.md')
  })

  it('only selects in the tree when asked to', () => {
    const withSelect = tabsReducer(initialTabsState, { type: 'open', tab: tab('a.md'), select: true })
    expect(withSelect.selectedNodeId).toBe('a.md')
    // Virtual pages open without touching the tree selection.
    const virtual = tabsReducer(initialTabsState, { type: 'open', tab: tab(CALENDAR_ID) })
    expect(virtual.selectedNodeId).toBeNull()
  })

  it('can append without stealing focus', () => {
    const before = stateWith([tab('a.md')])
    const next = tabsReducer(before, { type: 'open', tab: tab('b.md'), activate: false })
    expect(next.activeTabId).toBe('a.md')
    expect(next.tabs.map((t) => t.id)).toEqual(['a.md', 'b.md'])
  })
})

describe('activate', () => {
  it('activates a known tab', () => {
    const before = stateWith([tab('a.md'), tab('b.md')], 'a.md')
    const next = tabsReducer(before, { type: 'activate', id: 'b.md', select: true })
    expect(next.activeTabId).toBe('b.md')
    expect(next.selectedNodeId).toBe('b.md')
  })

  it('ignores an unknown id', () => {
    const before = stateWith([tab('a.md')])
    expect(tabsReducer(before, { type: 'activate', id: 'ghost' })).toBe(before)
  })
})

describe('close', () => {
  it('hands the focus to the neighbour on the left', () => {
    const before = stateWith([tab('a.md'), tab('b.md'), tab('c.md')], 'b.md')
    const next = tabsReducer(before, { type: 'close', id: 'b.md' })
    expect(next.tabs.map((t) => t.id)).toEqual(['a.md', 'c.md'])
    expect(next.activeTabId).toBe('c.md')
  })

  it('falls back to the last tab when closing the trailing one', () => {
    const before = stateWith([tab('a.md'), tab('b.md')], 'b.md')
    const next = tabsReducer(before, { type: 'close', id: 'b.md' })
    expect(next.activeTabId).toBe('a.md')
  })

  it('clears the active id when the last tab closes', () => {
    const before = stateWith([tab('a.md')])
    expect(tabsReducer(before, { type: 'close', id: 'a.md' }).activeTabId).toBeNull()
  })

  it('keeps the active id when closing a background tab', () => {
    const before = stateWith([tab('a.md'), tab('b.md')], 'a.md')
    expect(tabsReducer(before, { type: 'close', id: 'b.md' }).activeTabId).toBe('a.md')
  })

  it('leaves the tree selection alone', () => {
    const before: WorkspaceTabsState = { tabs: [tab('a.md')], activeTabId: 'a.md', selectedNodeId: 'a.md' }
    const next = tabsReducer(before, { type: 'close', id: 'a.md' })
    expect(next.selectedNodeId).toBe('a.md')
  })

  it('ignores an unknown id', () => {
    const before = stateWith([tab('a.md')])
    expect(tabsReducer(before, { type: 'close', id: 'ghost' })).toBe(before)
  })
})

describe('reorder', () => {
  it('moves a tab to another index', () => {
    const before = stateWith([tab('a.md'), tab('b.md'), tab('c.md')])
    const next = tabsReducer(before, { type: 'reorder', from: 0, to: 2 })
    expect(next.tabs.map((t) => t.id)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('clamps an out-of-range target to the end', () => {
    const before = stateWith([tab('a.md'), tab('b.md')])
    expect(tabsReducer(before, { type: 'reorder', from: 0, to: 99 }).tabs.map((t) => t.id)).toEqual([
      'b.md',
      'a.md',
    ])
    // Dragging the last tab past the end is a no-op.
    expect(tabsReducer(before, { type: 'reorder', from: 1, to: 99 }).tabs.map((t) => t.id)).toEqual([
      'a.md',
      'b.md',
    ])
  })

  it('ignores an out-of-range source', () => {
    const before = stateWith([tab('a.md')])
    expect(tabsReducer(before, { type: 'reorder', from: 5, to: 0 })).toBe(before)
  })
})

describe('drafting and saving', () => {
  it('marks a tab dirty while typing', () => {
    const before = stateWith([tab('a.md')])
    const next = tabsReducer(before, { type: 'draft', id: 'a.md', content: 'typed' })
    expect(next.tabs[0]).toMatchObject({ content: 'typed', dirty: true })
  })

  it('clears the dirty flag once the write lands', () => {
    const before = stateWith([tab('a.md', { content: 'typed', dirty: true })])
    const next = tabsReducer(before, { type: 'markSaved', id: 'a.md' })
    expect(next.tabs[0].dirty).toBe(false)
    expect(next.tabs[0].content).toBe('typed')
  })

  it('ignores drafts for a tab that is not open', () => {
    const before = stateWith([tab('a.md')])
    const next = tabsReducer(before, { type: 'draft', id: 'ghost', content: 'x' })
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]).toBe(before.tabs[0])
  })
})

describe('replaceContent', () => {
  it('swaps the document, drops the dirty flag and bumps rev', () => {
    const before = stateWith([tab('a.md', { content: 'old', dirty: true, rev: 2 })])
    const next = tabsReducer(before, { type: 'replaceContent', id: 'a.md', content: 'new' })
    expect(next.tabs[0]).toMatchObject({ content: 'new', dirty: false, rev: 3 })
  })

  it('starts rev at 1 for a tab that had none', () => {
    const before = stateWith([tab('a.md')])
    expect(tabsReducer(before, { type: 'replaceContent', id: 'a.md', content: 'x' }).tabs[0].rev).toBe(1)
  })

  it('applies the extra patch used by the diary page turn', () => {
    const before = stateWith([
      tab(DIARY_PREFIX, { kind: 'diary', name: '2026-01-01', filePath: 'Journals/a.md' }),
    ])
    const next = tabsReducer(before, {
      type: 'replaceContent',
      id: DIARY_PREFIX,
      content: 'day two',
      patch: { name: '2026-01-02', filePath: 'Journals/b.md' },
    })
    expect(next.tabs[0]).toMatchObject({
      name: '2026-01-02',
      filePath: 'Journals/b.md',
      content: 'day two',
      rev: 1,
    })
  })
})

describe('setContent', () => {
  it('reloads the content without touching dirty or rev', () => {
    const before = stateWith([tab('a.md', { content: 'old', dirty: true, rev: 4 })])
    const next = tabsReducer(before, { type: 'setContent', id: 'a.md', content: 'reloaded' })
    expect(next.tabs[0]).toMatchObject({ content: 'reloaded', dirty: true, rev: 4 })
  })
})

describe('remapTab', () => {
  it('follows the file path and keeps the tab active', () => {
    const before = stateWith([tab('a.md')], 'a.md')
    const next = tabsReducer(before, {
      type: 'remapTab',
      from: 'a.md',
      to: 'sub/a.md',
      patch: { path: 'sub/a.md' },
    })
    expect(next.tabs[0]).toMatchObject({ id: 'sub/a.md', path: 'sub/a.md' })
    expect(next.activeTabId).toBe('sub/a.md')
  })

  it('carries the tree selection over', () => {
    const before: WorkspaceTabsState = { tabs: [tab('a.md')], activeTabId: 'a.md', selectedNodeId: 'a.md' }
    const next = tabsReducer(before, { type: 'remapTab', from: 'a.md', to: 'b.md' })
    expect(next.selectedNodeId).toBe('b.md')
  })

  it('leaves a background tab in the background', () => {
    const before = stateWith([tab('a.md'), tab('b.md')], 'a.md')
    const next = tabsReducer(before, { type: 'remapTab', from: 'b.md', to: 'c.md' })
    expect(next.activeTabId).toBe('a.md')
  })
})

describe('replaceAll', () => {
  it('restores a whole session', () => {
    const next = tabsReducer(stateWith([tab('stale.md')]), {
      type: 'replaceAll',
      tabs: [tab('a.md'), tab('b.md')],
      activeTabId: 'b.md',
      selectedNodeId: 'b.md',
    })
    expect(next.tabs.map((t) => t.id)).toEqual(['a.md', 'b.md'])
    expect(next.activeTabId).toBe('b.md')
    expect(next.selectedNodeId).toBe('b.md')
  })

  it('keeps the current focus when the patch omits it', () => {
    const before = stateWith([tab('a.md')], 'a.md')
    const next = tabsReducer(before, { type: 'replaceAll', tabs: [tab('b.md')] })
    expect(next.activeTabId).toBe('a.md')
  })
})

describe('retitle', () => {
  it('re-localises the virtual page titles only', () => {
    const before = stateWith([tab(CALENDAR_ID, { kind: 'calendar', name: 'old' }), tab('a.md')])
    const next = tabsReducer(before, { type: 'retitle', titles: { [CALENDAR_ID]: 'Calendar' } })
    expect(next.tabs[0].name).toBe('Calendar')
    expect(next.tabs[1].name).toBe('a.md')
  })
})

describe('select', () => {
  it('sets and clears the tree selection', () => {
    const next = tabsReducer(initialTabsState, { type: 'select', id: 'a.md' })
    expect(next.selectedNodeId).toBe('a.md')
    expect(tabsReducer(next, { type: 'select', id: null }).selectedNodeId).toBeNull()
  })
})
