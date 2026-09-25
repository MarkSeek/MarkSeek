// The registry is provider-agnostic: the route layer depends only on it, so a
// new backend just registers an instance. These specs pin that contract.
import { describe, expect, it } from 'vitest'
import { getProvider, listProviders, registerProvider } from '../sync/index.mjs'
import { SyncProvider } from '../sync/types.mjs'

describe('sync provider registry', () => {
  it('registers the built-in git provider', () => {
    const p = getProvider('git')
    expect(p).not.toBeNull()
    expect(p.id).toBe('git')
    expect(p.label).toBe('Git')
  })

  it('returns null for an unknown provider id', () => {
    expect(getProvider('does-not-exist')).toBeNull()
  })

  it('lists the git provider among available providers', () => {
    expect(listProviders().some((p) => p.id === 'git')).toBe(true)
  })

  it('supports registering a custom provider (extensibility)', () => {
    class Dummy extends SyncProvider {
      id = 'dummy'
      label = 'Dummy'
    }
    registerProvider(new Dummy())
    expect(getProvider('dummy')?.id).toBe('dummy')
  })
})
