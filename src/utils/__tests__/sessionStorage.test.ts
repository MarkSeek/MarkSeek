import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'markseek.session.v1'
const LEGACY_LEFT = 'leftSidebarWidth'
const LEGACY_RIGHT = 'rightPanelWidth'

// The module keeps a module-level cache of every vault snapshot, so each test
// needs a fresh copy instead of the singleton.
async function loadModule() {
  vi.resetModules()
  return import('../sessionStorage')
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getVaultKey', () => {
  it('falls back to the default bucket when no vault is set', async () => {
    const { getVaultKey } = await loadModule()
    expect(getVaultKey(null)).toBe('__default__')
    expect(getVaultKey('')).toBe('__default__')
    expect(getVaultKey('   ')).toBe('__default__')
  })

  it('uses the trimmed vault path as bucket key', async () => {
    const { getVaultKey } = await loadModule()
    expect(getVaultKey('  /notes/vault  ')).toBe('/notes/vault')
  })
})

describe('readSession defaults', () => {
  it('returns a usable snapshot when nothing was persisted', async () => {
    const { readSession } = await loadModule()
    const snap = readSession('v')
    expect(snap.tabs).toEqual([])
    expect(snap.activeTabId).toBeNull()
    expect(snap.expandedPaths).toEqual([])
    expect(snap.layout.leftOpen).toBe(true)
    expect(snap.layout.rightOpen).toBeNull()
    expect(snap.rightPanel).toEqual({ view: 'chat', showRelations: false })
  })

  it('inherits widths from the pre-session legacy keys', async () => {
    localStorage.setItem(LEGACY_LEFT, '320')
    localStorage.setItem(LEGACY_RIGHT, 'oops')
    const { readSession } = await loadModule()
    const snap = readSession('v')
    expect(snap.layout.leftWidth).toBe(320)
    expect(snap.layout.rightWidth).toBeNull()
  })
})

describe('normalize (untrusted JSON)', () => {
  it('drops entries whose schema version does not match', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ future: { version: 99, tabs: [{ id: 'a', path: 'a.md' }] } }),
    )
    const { readSession } = await loadModule()
    expect(readSession('future').tabs).toEqual([])
  })

  it('filters malformed tabs and expanded paths', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: {
          version: 1,
          tabs: [
            { id: 'ok', path: 'a.md', kind: 'bogus', filePath: 5 },
            { id: '', path: 'x.md' },
            { id: 'no-path' },
            null,
            'string-tab',
          ],
          expandedPaths: ['notes', 42, null],
          selectedNodeId: 7,
          layout: { leftWidth: -5, rightWidth: 'wide', rightOpen: 'yes', leftOpen: false },
          rightPanel: { showRelations: true },
        },
      }),
    )
    const { readSession } = await loadModule()
    const snap = readSession('v')
    expect(snap.tabs).toHaveLength(1)
    expect(snap.tabs[0]).toEqual({ id: 'ok', path: 'a.md', kind: undefined, filePath: undefined })
    expect(snap.expandedPaths).toEqual(['notes'])
    expect(snap.selectedNodeId).toBeNull()
    expect(snap.layout.leftWidth).toBeNull()
    expect(snap.layout.rightWidth).toBeNull()
    expect(snap.layout.rightOpen).toBeNull()
    expect(snap.layout.leftOpen).toBe(false)
  })

  it('upgrades snapshots that only carry showRelations', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: { version: 1, rightPanel: { showRelations: true } } }),
    )
    const { readSession } = await loadModule()
    expect(readSession('v').rightPanel).toEqual({ view: 'relations', showRelations: true })
  })

  it('prefers an explicit view and keeps showRelations in sync', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: { version: 1, rightPanel: { view: 'relations', showRelations: false } } }),
    )
    const { readSession } = await loadModule()
    expect(readSession('v').rightPanel).toEqual({ view: 'relations', showRelations: true })
  })
})

describe('patchSession', () => {
  it('merges layout one level deep and keeps untouched fields', async () => {
    const mod = await loadModule()
    mod.patchSession('v', { tabs: [{ id: 't1', path: 'a.md' }], layout: { leftWidth: 333 } })
    expect(mod.readSession('v').tabs).toHaveLength(1)
    expect(mod.readSession('v').layout.leftWidth).toBe(333)
    expect(mod.readSession('v').layout.leftOpen).toBe(true)

    mod.patchSession('v', { layout: { rightWidth: 222 } })
    expect(mod.readSession('v').layout.leftWidth).toBe(333)
    expect(mod.readSession('v').layout.rightWidth).toBe(222)
  })

  it('allows clearing nullable fields but ignores undefined', async () => {
    const mod = await loadModule()
    mod.patchSession('v', { activeTabId: 't1', selectedNodeId: 'n1' })
    mod.patchSession('v', { activeTabId: null })
    expect(mod.readSession('v').activeTabId).toBeNull()
    expect(mod.readSession('v').selectedNodeId).toBe('n1')
  })
})

describe('flushSession', () => {
  it('debounces writes and persists on the next tick', async () => {
    const mod = await loadModule()
    mod.patchSession('v', { tabs: [] })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    vi.advanceTimersByTime(299)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    vi.advanceTimersByTime(1)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('keeps only the 5 most recently saved vaults', async () => {
    const mod = await loadModule()
    for (let i = 1; i <= 6; i++) {
      vi.setSystemTime(new Date(2026, 0, i))
      mod.patchSession(`v${i}`, { tabs: [] })
    }
    mod.flushSession()
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(['v2', 'v3', 'v4', 'v5', 'v6'])
  })

  it('survives a storage write failure (quota / private mode)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const mod = await loadModule()
    expect(() => {
      mod.patchSession('v', { tabs: [] })
      mod.flushSession()
    }).not.toThrow()
    spy.mockRestore()
  })
})

describe('clearSession', () => {
  it('removes the vault snapshot on the next flush', async () => {
    const mod = await loadModule()
    mod.patchSession('v', { tabs: [{ id: 't', path: 'a.md' }] })
    mod.flushSession()
    mod.clearSession('v')
    mod.flushSession()
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(raw.v).toBeUndefined()
  })
})
