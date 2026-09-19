import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runTool, applyWrite, TOOL_DEFINITIONS, todayString } from '../tools.mjs'
import {
  makeTmpVault,
  writeVaultFile,
  readVaultFile,
  cleanupTmpVaults,
} from '../../__tests__/helpers/tmp-vault.mjs'

afterAll(cleanupTmpVaults)

const SEED = {
  'Projects/ideas.md': '# Ideas\nbuild a search box\n',
  'Journals/2026/2026-03/2026-03-01.md': '# Day 1\n* [ ] write tests\n',
  'empty-folder/.keep': '',
}

function vault(files = SEED) {
  return makeTmpVault(files)
}

describe('tool definitions', () => {
  it('exposes one OpenAI-style definition per supported tool', async () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name)
    expect(names).toEqual([
      'list_notes',
      'search_notes',
      'read_note',
      'today_journal',
      'read_journal',
      'create_note',
      'write_note',
      'append_note',
    ])
  })

  it('gives every definition a type, name, description and parameters', async () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.type).toBe('function')
      expect(typeof def.function.description).toBe('string')
      expect(def.function.description.length).toBeGreaterThan(0)
      expect(def.function.parameters.type).toBe('object')
      expect(Array.isArray(def.function.parameters.required)).toBe(true)
    }
  })
})

describe('list_notes', () => {
  it('renders the whole vault tree', async () => {
    const root = vault()
    const { kind, value } = await runTool('list_notes', {}, { vaultDir: root })
    expect(kind).toBe('result')
    expect(value).toContain('📁 Projects/')
    expect(value).toContain('📄 Projects/ideas.md')
    expect(value).toContain('📄 Journals/2026/2026-03/2026-03-01.md')
  })

  it('scopes to a sub directory', async () => {
    const root = vault()
    const { value } = await runTool('list_notes', { dir: 'Projects' }, { vaultDir: root })
    expect(value).toContain('📄 Projects/ideas.md')
    expect(value).not.toContain('Journals')
  })

  it('reports an empty vault', async () => {
    const root = vault({ 'only.txt': 'not markdown' })
    expect((await runTool('list_notes', {}, { vaultDir: root })).value).toBe('No markdown files found.')
  })
})

describe('search_notes', () => {
  it('finds a keyword and prints the path', async () => {
    const root = vault()
    const { value } = await runTool('search_notes', { query: 'search box' }, { vaultDir: root })
    expect(value).toContain('- Projects/ideas.md')
    expect(value).toContain('build a search box')
  })

  it('is case-insensitive', async () => {
    const root = vault()
    expect((await runTool('search_notes', { query: 'SEARCH BOX' }, { vaultDir: root })).value).toContain(
      'Projects/ideas.md',
    )
  })

  it('reports no matches', async () => {
    const root = vault()
    expect((await runTool('search_notes', { query: 'zzz' }, { vaultDir: root })).value).toBe(
      'No notes matched "zzz".',
    )
  })

  it('requires a query', async () => {
    const root = vault()
    expect((await runTool('search_notes', {}, { vaultDir: root })).value).toBe('Error: missing query.')
  })
})

describe('read_note', () => {
  it('returns the file content', async () => {
    const root = vault()
    expect((await runTool('read_note', { path: 'Projects/ideas.md' }, { vaultDir: root })).value).toBe(
      '# Ideas\nbuild a search box\n',
    )
  })

  it('blocks traversal', async () => {
    const root = vault()
    expect((await runTool('read_note', { path: '../../etc/passwd' }, { vaultDir: root })).value).toBe(
      'Error: invalid path (directory traversal blocked).',
    )
  })

  it('reports a missing file', async () => {
    const root = vault()
    expect((await runTool('read_note', { path: 'nope.md' }, { vaultDir: root })).value).toBe(
      'Error: cannot read "nope.md".',
    )
  })

  it('requires a path', async () => {
    const root = vault()
    expect((await runTool('read_note', {}, { vaultDir: root })).value).toBe('Error: missing path.')
  })

  it('truncates very long notes', async () => {
    const root = vault({ 'long.md': 'x'.repeat(9000) })
    const { value } = await runTool('read_note', { path: 'long.md' }, { vaultDir: root })
    expect(value).toContain('[truncated, total 9000 chars]')
    expect(value.length).toBeLessThan(9000)
  })
})

describe('read_journal', () => {
  it('resolves the journal path from a date', async () => {
    const root = vault()
    const { value } = await runTool('read_journal', { date: '2026-03-01' }, { vaultDir: root })
    expect(value).toBe('Journal Journals/2026/2026-03/2026-03-01.md:\n# Day 1\n* [ ] write tests\n')
  })

  it('rejects a malformed date', async () => {
    const root = vault()
    expect((await runTool('read_journal', { date: 'yesterday' }, { vaultDir: root })).value).toBe(
      'Error: "yesterday" is not a valid date (expected YYYY-MM-DD).',
    )
  })

  it('reports a missing entry with the expected path', async () => {
    const root = vault()
    const { value } = await runTool('read_journal', { date: '2026-03-09' }, { vaultDir: root })
    expect(value).toContain('No journal entry found for 2026-03-09')
    expect(value).toContain('Journals/2026/2026-03/2026-03-09.md')
  })
})

describe('today_journal', () => {
  it('reports the server date and reads today\'s journal', async () => {
    const today = todayString()
    const [y, ym] = [today.slice(0, 4), today.slice(0, 7)]
    const root = vault({ [`Journals/${y}/${ym}/${today}.md`]: '# Today\n' })
    const { value } = await runTool('today_journal', {}, { vaultDir: root })
    expect(value).toContain(`Today's date (server local time): ${today}`)
    expect(value).toContain('# Today')
  })

  it('says so when today has no entry', async () => {
    const root = vault({ 'note.md': '# n' })
    const { value } = await runTool('today_journal', {}, { vaultDir: root })
    expect(value).toContain(`No journal entry found for ${todayString()}`)
  })
})

describe('write tools require confirmation', () => {
  it('previews create_note without touching disk', async () => {
    const root = vault()
    const outcome = await runTool(
      'create_note',
      { path: 'Projects/new.md', content: '# New\n' },
      { vaultDir: root },
    )
    expect(outcome.kind).toBe('confirm_required')
    expect(outcome.value).toMatchObject({
      op: 'write',
      path: 'Projects/new.md',
      exists: false,
      preview: '# New\n',
      content: '# New\n',
    })
    expect(fs.existsSync(path.join(root, 'Projects/new.md'))).toBe(false)
  })

  it('flags an existing file as exists: true', async () => {
    const root = vault()
    const outcome = await runTool(
      'write_note',
      { path: 'Projects/ideas.md', content: '# Replaced\n' },
      { vaultDir: root },
    )
    expect(outcome.value.exists).toBe(true)
    expect(readVaultFile(root, 'Projects/ideas.md')).toBe('# Ideas\nbuild a search box\n')
  })

  it('previews append_note against the simulated result', async () => {
    const root = vault()
    const outcome = await runTool(
      'append_note',
      { path: 'Projects/ideas.md', content: 'extra line' },
      { vaultDir: root },
    )
    expect(outcome.value.op).toBe('append')
    expect(outcome.value.preview).toBe('# Ideas\nbuild a search box\n\nextra line')
  })

  it('blocks traversal before previewing', async () => {
    const root = vault()
    const outcome = await runTool(
      'write_note',
      { path: '../../tmp/escape.md', content: 'x' },
      { vaultDir: root },
    )
    expect(outcome.kind).toBe('result')
    expect(outcome.value).toBe('Error: invalid path (directory traversal blocked).')
  })

  it('requires content', async () => {
    const root = vault()
    const outcome = await runTool('create_note', { path: 'a.md' }, { vaultDir: root })
    expect(outcome.value).toBe('Error: missing content.')
  })

  it('truncates a long preview but keeps the full content to apply later', async () => {
    const root = vault()
    const long = 'y'.repeat(9000)
    const outcome = await runTool('create_note', { path: 'big.md', content: long }, { vaultDir: root })
    expect(outcome.value.preview).toContain('[truncated preview]')
    expect(outcome.value.content).toBe(long)
  })
})

describe('unknown tools', () => {
  it('reports the unknown name instead of throwing', async () => {
    const root = vault()
    expect((await runTool('delete_everything', {}, { vaultDir: root })).value).toBe(
      'Error: unknown tool "delete_everything".',
    )
  })
})

describe('applyWrite', () => {
  it('writes a new file and creates parent directories', async () => {
    const root = vault()
    expect(
      applyWrite({ op: 'write', path: 'Deep/Nested/note.md', content: '# hi' }, { vaultDir: root }),
    ).toEqual({ ok: true })
    expect(readVaultFile(root, 'Deep/Nested/note.md')).toBe('# hi')
  })

  it('overwrites an existing file', async () => {
    const root = vault()
    applyWrite({ op: 'write', path: 'Projects/ideas.md', content: '# replaced' }, { vaultDir: root })
    expect(readVaultFile(root, 'Projects/ideas.md')).toBe('# replaced')
  })

  it('appends with a separator when the file has no trailing newline', async () => {
    const root = vault({ 'a.md': 'first' })
    applyWrite({ op: 'append', path: 'a.md', content: 'second' }, { vaultDir: root })
    expect(readVaultFile(root, 'a.md')).toBe('first\nsecond')
  })

  it('does not double the separator when the file already ends with a newline', async () => {
    const root = vault({ 'a.md': 'first\n' })
    applyWrite({ op: 'append', path: 'a.md', content: 'second' }, { vaultDir: root })
    expect(readVaultFile(root, 'a.md')).toBe('first\nsecond')
  })

  it('creates the file on append when it does not exist', async () => {
    const root = vault()
    applyWrite({ op: 'append', path: 'new.md', content: 'body' }, { vaultDir: root })
    expect(readVaultFile(root, 'new.md')).toBe('body')
  })

  it('refuses to escape the vault', async () => {
    const root = vault()
    writeVaultFile(root, 'outside-guard.txt', 'guard')
    const result = applyWrite(
      { op: 'write', path: '../../etc/markseek-escape-test.md', content: 'x' },
      { vaultDir: root },
    )
    expect(result).toEqual({ ok: false, error: 'invalid path' })
  })

  it('reports a failure instead of throwing', async () => {
    const root = vault()
    writeVaultFile(root, 'blocker', 'not a directory')
    const result = applyWrite(
      { op: 'write', path: 'blocker/nested/note.md', content: 'x' },
      { vaultDir: root },
    )
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })
})

describe('vault root injection', () => {
  it('keeps two concurrent vaults isolated', async () => {
    const a = vault({ 'a.md': 'A' })
    const b = vault({ 'a.md': 'B' })
    expect((await runTool('read_note', { path: 'a.md' }, { vaultDir: a })).value).toBe('A')
    expect((await runTool('read_note', { path: 'a.md' }, { vaultDir: b })).value).toBe('B')
  })
})
