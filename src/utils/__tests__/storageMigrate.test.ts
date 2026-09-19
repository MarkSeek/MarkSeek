import { beforeEach, describe, expect, it } from 'vitest'
import { runStorageMigrations } from '../storageMigrate'

beforeEach(() => {
  localStorage.clear()
})

describe('runStorageMigrations', () => {
  it('is a no-op that returns 0 (legacy keys are no longer migrated)', () => {
    localStorage.setItem('markseek.lang', 'en')
    expect(runStorageMigrations()).toBe(0)
    expect(localStorage.getItem('markseek.lang')).toBe('en')
  })

  it('does nothing when storage is empty', () => {
    expect(runStorageMigrations()).toBe(0)
  })
})
