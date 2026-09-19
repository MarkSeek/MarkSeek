import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { DEFAULT_VAULT_DIR, getVaultDir, setVaultDir, resetVaultDir } from '../vault.mjs'
import { makeTmpVault, cleanupTmpVaults } from './helpers/tmp-vault.mjs'

afterEach(() => {
  resetVaultDir()
})
afterEach(cleanupTmpVaults)

describe('vault root', () => {
  it('defaults to <cwd>/notes', () => {
    expect(DEFAULT_VAULT_DIR).toBe(path.resolve(process.cwd(), 'notes'))
    expect(getVaultDir()).toBe(DEFAULT_VAULT_DIR)
  })

  it('rebinds to an absolute path', () => {
    const tmp = makeTmpVault()
    setVaultDir(tmp)
    expect(getVaultDir()).toBe(path.resolve(tmp))
  })

  it('resolves a relative path against cwd', () => {
    setVaultDir('notes')
    expect(getVaultDir()).toBe(path.resolve(process.cwd(), 'notes'))
  })

  it('ignores empty values so a bad config never wipes the vault', () => {
    const tmp = makeTmpVault()
    setVaultDir(tmp)
    for (const bad of ['', '   ', null, undefined, 0, {}]) setVaultDir(bad)
    expect(getVaultDir()).toBe(tmp)
  })

  it('resets back to the default', () => {
    setVaultDir(makeTmpVault())
    resetVaultDir()
    expect(getVaultDir()).toBe(DEFAULT_VAULT_DIR)
  })
})
