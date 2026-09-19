import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  TASK_RE,
  safeJoin,
  scanDir,
  listDirDetailed,
  searchNotes,
  normalizeTaskText,
  extractTasks,
  toggleTaskInContent,
  validateYearMonth,
  readMonthTasks,
  readAllTasks,
  toggleTask,
  journalPathForDate,
  todayString,
} from '../notes-fs.mjs'
import {
  makeTmpVault,
  readVaultFile,
  writeVaultFile,
  cleanupTmpVaults,
} from './helpers/tmp-vault.mjs'

afterAll(cleanupTmpVaults)

describe('safeJoin', () => {
  const root = path.resolve('/tmp/vault')

  it('resolves a clean relative path inside the vault', () => {
    expect(safeJoin(root, 'notes/a.md')).toBe(path.join(root, 'notes/a.md'))
  })

  it('blocks parent traversal', () => {
    expect(safeJoin(root, '../secrets')).toBeNull()
    expect(safeJoin(root, 'a/../../b')).toBeNull()
    expect(safeJoin(root, '../../etc/passwd')).toBeNull()
  })

  it('rejects empty inputs', () => {
    expect(safeJoin(root, '')).toBeNull()
    expect(safeJoin(root, null)).toBeNull()
    expect(safeJoin(null, 'a.md')).toBeNull()
  })

  it('treats a sibling directory with a shared prefix as outside', () => {
    // /tmp/vault-other must not be reachable from /tmp/vault.
    expect(safeJoin('/tmp/vault', '../vault-other/x.md')).toBeNull()
  })
})

describe('scanDir', () => {
  it('sorts folders before files and skips hidden entries', () => {
    const root = makeTmpVault({
      'zeta.md': '# z',
      'alpha.md': '# a',
      'Projects/one.md': '# 1',
      '.hidden/secret.md': '# s',
      'Projects/.gitkeep.md': '# k',
    })
    const nodes = scanDir(root, root, root)
    expect(nodes.map((n) => n.name)).toEqual(['Projects', 'alpha.md', 'zeta.md'])
    const project = nodes.find((n) => n.name === 'Projects')
    expect(project.type).toBe('folder')
    expect(project.children.map((c) => c.name)).toEqual(['one.md'])
  })

  it('ignores non-markdown files but keeps them in listDirDetailed', () => {
    const root = makeTmpVault({ 'note.md': '# n', 'image.png': 'binary', 'data.json': '{}' })
    expect(scanDir(root, root, root).map((n) => n.name)).toEqual(['note.md'])
    expect(listDirDetailed(root, root).map((n) => n.name)).toEqual([
      'data.json',
      'image.png',
      'note.md',
    ])
  })

  it('returns [] for an unreadable directory', () => {
    expect(scanDir('/definitely/not/here', '/definitely/not/here')).toEqual([])
    expect(listDirDetailed('/definitely/not/here', '/definitely/not/here')).toEqual([])
  })

  it('exposes vault-relative ids', () => {
    const root = makeTmpVault({ 'Projects/deep/note.md': '# n' })
    const nodes = scanDir(root, root, root)
    expect(nodes[0].id).toBe('Projects')
    expect(nodes[0].children[0].id).toBe('Projects/deep')
    expect(nodes[0].children[0].children[0].id).toBe('Projects/deep/note.md')
  })
})

describe('listDirDetailed', () => {
  it('reports mtime and folder/file types', () => {
    const root = makeTmpVault({ 'note.md': '# n', 'sub/x.md': '# x' })
    const nodes = listDirDetailed(root, root)
    const folder = nodes.find((n) => n.name === 'sub')
    expect(folder.type).toBe('folder')
    expect(folder.mtime).toBeGreaterThan(0)
    const file = nodes.find((n) => n.name === 'note.md')
    expect(file.type).toBe('file')
    expect(file.mtime).toBeGreaterThan(0)
  })
})

describe('searchNotes', () => {
  const root = makeTmpVault({
    'alpha.md': '# Title\nhello world\nsecond hello line',
    'nested/beta.md': 'nothing here',
    'HELLO.md': '# upper',
  })

  it('matches file content and returns snippets', async () => {
    const hits = await searchNotes(root, 'hello')
    const paths = hits.map((h) => h.path).sort()
    expect(paths).toEqual(['HELLO.md', 'alpha.md'])
    const alpha = hits.find((h) => h.path === 'alpha.md')
    expect(alpha.matches.length).toBeGreaterThan(0)
    expect(alpha.matches.every((m) => m.length <= 80)).toBe(true)
  })

  it('matches by file name without reading content', async () => {
    const hits = await searchNotes(root, 'beta')
    expect(hits).toHaveLength(1)
    expect(hits[0].matches).toEqual([])
  })

  it('caps content snippets at three per note', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `line ${i} needle`).join('\n')
    const vault = makeTmpVault({ 'many.md': many })
    const hits = await searchNotes(vault, 'needle')
    expect(hits[0].matches).toHaveLength(3)
  })

  it('returns [] when nothing matches', async () => {
    expect(await searchNotes(root, 'zzzz-not-present')).toEqual([])
  })

  it('returns [] for an empty keyword instead of every note', async () => {
    expect(await searchNotes(root, '')).toEqual([])
  })

  it('picks up an edit made after the first scan', async () => {
    const vault = makeTmpVault({ 'note.md': 'first pass\n' })
    expect(await searchNotes(vault, 'second')).toEqual([])
    writeVaultFile(vault, 'note.md', 'first pass\nsecond pass\n')
    const hits = await searchNotes(vault, 'second')
    expect(hits.map((h) => h.path)).toEqual(['note.md'])
  })
})

describe('task parsing', () => {
  it('parses done/open items and skips empty ones', () => {
    const content = ['* [ ] open one', '* [x] done two', '* [X] done upper', '* [ ]', '* [x]   '].join('\n')
    expect(extractTasks(content)).toEqual([
      { done: false, text: 'open one' },
      { done: true, text: 'done two' },
      { done: true, text: 'done upper' },
    ])
  })

  it('strips <br> and collapses whitespace in labels', () => {
    expect(normalizeTaskText('a<br>b   c')).toBe('ab c')
    const tasks = extractTasks('* [ ] line1<br>line2')
    expect(tasks[0].text).toBe('line1line2')
  })

  it('exposes the shared TASK_RE used by the frontend', () => {
    expect('* [x] hello'.match(TASK_RE)[2]).toBe('hello')
    expect('not a task'.match(TASK_RE)).toBeNull()
  })
})

describe('toggleTaskInContent', () => {
  const content = ['# Journal', '', '* [ ] buy milk', '* [x] water plants', ''].join('\n')

  it('flips the matching task to done and keeps the rest intact', () => {
    const r = toggleTaskInContent(content, 'buy milk', true)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('* [x] buy milk')
    expect(r.content).toContain('* [x] water plants')
    expect(r.content.split('\n')[0]).toBe('# Journal')
  })

  it('flips back to open', () => {
    const r = toggleTaskInContent(content, 'water plants', false)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('* [ ] water plants')
  })

  it('only flips the first occurrence', () => {
    const dup = '* [ ] same\n* [ ] same'
    const r = toggleTaskInContent(dup, 'same', true)
    expect(r.content).toBe('* [x] same\n* [ ] same')
  })

  it('normalizes CRLF line endings', () => {
    const r = toggleTaskInContent('# t\r\n* [ ] task\r\n', 'task', true)
    expect(r.ok).toBe(true)
    expect(r.content).toBe('# t\n* [x] task\n')
  })

  it('reports a miss and returns the content unchanged', () => {
    const r = toggleTaskInContent(content, 'not a task', true)
    expect(r.ok).toBe(false)
    expect(r.content).toBe(content)
  })
})

describe('validateYearMonth', () => {
  it('accepts a valid year/month and zero-pads the month', () => {
    expect(validateYearMonth('2026', '3')).toEqual({ y: 2026, m: 3, mm: '03' })
    expect(validateYearMonth('2026', '12')).toEqual({ y: 2026, m: 12, mm: '12' })
  })

  it('rejects out-of-range or non-numeric values', () => {
    expect(validateYearMonth('2026', '13')).toBeNull()
    expect(validateYearMonth('2026', '0')).toBeNull()
    expect(validateYearMonth('2026', 'abc')).toBeNull()
    expect(validateYearMonth('26', '1')).toBeNull()
    expect(validateYearMonth('2026.5', '1')).toBeNull()
    expect(validateYearMonth(undefined, undefined)).toBeNull()
  })
})

describe('readMonthTasks / readAllTasks', () => {
  const files = {
    'Journals/2026/2026-03/2026-03-01.md': '* [ ] task a\n* [x] task b\n',
    'Journals/2026/2026-03/2026-03-02.md': '* [ ] task c\n',
    'Journals/2026/2026-03/notes.txt': '* [ ] ignored (not a journal file)',
    'Journals/2026/2026-04/2026-04-01.md': '* [ ] task d\n',
  }

  it('reads one month and tags every task with its date', () => {
    const root = makeTmpVault(files)
    expect(readMonthTasks(root, '2026', '03')).toEqual([
      { date: '2026-03-01', done: false, text: 'task a' },
      { date: '2026-03-01', done: true, text: 'task b' },
      { date: '2026-03-02', done: false, text: 'task c' },
    ])
  })

  it('returns [] for a month without journals', () => {
    const root = makeTmpVault(files)
    expect(readMonthTasks(root, '2026', '05')).toEqual([])
    expect(readMonthTasks(root, '2020', '01')).toEqual([])
  })

  it('aggregates every month keyed by date', () => {
    const root = makeTmpVault(files)
    const all = readAllTasks(root)
    expect(Object.keys(all).sort()).toEqual(['2026-03-01', '2026-03-02', '2026-04-01'])
    expect(all['2026-03-01']).toEqual([
      { done: false, text: 'task a' },
      { done: true, text: 'task b' },
    ])
  })

  it('ignores non-journal files and stray directories', () => {
    const root = makeTmpVault({
      'Journals/2026/2026-03/2026-03-01.md': '* [ ] real\n',
      'Journals/2026/2026-03/README.md': '* [ ] not a date file',
      'Journals/2026/not-a-month/2026-13-01.md': '* [ ] skipped',
      'Journals/2026/2026-03/random.md': '* [ ] skipped',
    })
    expect(Object.keys(readAllTasks(root))).toEqual(['2026-03-01'])
  })

  it('returns {} when there is no Journals directory', () => {
    expect(readAllTasks(makeTmpVault({ 'note.md': '# n' }))).toEqual({})
  })
})

describe('toggleTask', () => {
  const seed = { 'Journals/2026/2026-03/2026-03-01.md': '# Day\n* [ ] buy milk\n' }

  it('persists the toggle to disk', () => {
    const root = makeTmpVault(seed)
    expect(toggleTask(root, '2026-03-01', 'buy milk', true)).toEqual({ ok: true })
    expect(readVaultFile(root, 'Journals/2026/2026-03/2026-03-01.md')).toContain('* [x] buy milk')
  })

  it('rejects a malformed date', () => {
    const root = makeTmpVault(seed)
    expect(toggleTask(root, '2026-3-1', 'buy milk', true)).toEqual({
      ok: false,
      error: 'invalid date',
    })
    expect(toggleTask(root, 'not-a-date', 'buy milk', true)).toEqual({
      ok: false,
      error: 'invalid date',
    })
  })

  it('reports not found when the journal does not exist', () => {
    const root = makeTmpVault(seed)
    expect(toggleTask(root, '2026-03-09', 'buy milk', true)).toEqual({
      ok: false,
      error: 'not found',
    })
  })

  it('reports task not found when no line matches', () => {
    const root = makeTmpVault(seed)
    expect(toggleTask(root, '2026-03-01', 'water plants', true)).toEqual({
      ok: false,
      error: 'task not found',
    })
  })

  it('blocks traversal through the date segment', () => {
    const outside = makeTmpVault({ 'target.md': '* [ ] outside\n' })
    const root = makeTmpVault({ 'note.md': '# n' })
    const evil = `../../${path.basename(outside)}/target`
    expect(toggleTask(root, evil, 'outside', true)).toEqual({
      ok: false,
      error: 'invalid date',
    })
    expect(fs.readFileSync(path.join(outside, 'target.md'), 'utf-8')).toContain('* [ ] outside')
  })
})

describe('journalPathForDate', () => {
  it('builds the Journals/YYYY/YYYY-MM/YYYY-MM-DD.md path', () => {
    expect(journalPathForDate('2026-03-01')).toBe('Journals/2026/2026-03/2026-03-01.md')
  })

  it('returns null for malformed or impossible dates', () => {
    expect(journalPathForDate('2026-13-01')).toBeNull()
    expect(journalPathForDate('2026-00-10')).toBeNull()
    expect(journalPathForDate('2026-01-32')).toBeNull()
    expect(journalPathForDate('2026-1-1')).toBeNull()
    expect(journalPathForDate('')).toBeNull()
    expect(journalPathForDate(undefined)).toBeNull()
  })

  it('never leaks traversal characters into the path', () => {
    expect(journalPathForDate('../../etc/passwd')).toBeNull()
  })
})

describe('todayString', () => {
  it('formats an injected date as YYYY-MM-DD', () => {
    expect(todayString(new Date(2026, 2, 5))).toBe('2026-03-05')
    expect(todayString(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('defaults to now and stays well-formed', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('vault isolation', () => {
  it('keeps two temp vaults independent', async () => {
    const a = makeTmpVault({ 'a.md': '# a' })
    const b = makeTmpVault({ 'b.md': '# b' })
    writeVaultFile(a, 'shared.md', 'in a')
    // The whole-vault read is cached per root, so one vault's notes can never
    // leak into a search of the other.
    expect(await searchNotes(a, 'shared')).toHaveLength(1)
    expect(await searchNotes(b, 'shared')).toHaveLength(0)
  })
})
