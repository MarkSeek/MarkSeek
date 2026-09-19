// Vault filesystem helpers shared by the HTTP API (server/api.mjs) and the
// note agent (server/agent/tools.mjs).
//
// Design rule: NO module-level mutable state. Every function receives the vault
// `root` as an explicit argument, so the logic is a pure function of
// (root, args) and can be exercised against a real temporary directory without
// mocking the filesystem.
import fs from 'node:fs'
import path from 'node:path'

import { safeJoin } from './lib/vault-path.mjs'
import { readAllVaultNotes } from './lib/vault-scan.mjs'

import {
  DAY_FILE_RE,
  JOURNALS_DIR,
  MONTH_RE,
  YEAR_RE,
  journalFilePath,
  monthDirPath,
} from '../shared/journal-layout.mjs'

// Re-exported so the rest of the server keeps importing it from here.
export { safeJoin }

// Regex for a Markdown task item: `* [ ] text` / `* [x] text`.
//
// The frontend does NOT parse markdown — it only renders what this module
// returns (see `extractTasks`) and sends the label back to `toggleTask`. So
// this regex and `normalizeTaskText` below are the single definition of what a
// task is, and there is nothing to keep in sync on the client.
export const TASK_RE = /^\s*\*\s*\[([ xX])\]\s*(.*)$/

/**
 * Recursively list files and folders under `dir`.
 * Hidden entries (dot-files) are skipped; paths are relative to `relativeTo`.
 *
 * `markdownOnly` (default true) restricts files to `.md` for the agent's
 * note-oriented tools. The sidebar tree passes `false` so every non-hidden
 * file (images, html, txt, …) is listed too.
 */
export function scanDir(root, dir, relativeTo = root, markdownOnly = true) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(relativeTo, fullPath).split(path.sep).join('/')
    if (entry.isDirectory()) {
      nodes.push({
        id: relPath,
        name: entry.name,
        type: 'folder',
        children: scanDir(root, fullPath, relativeTo, markdownOnly),
        expanded: true,
      })
    } else if (entry.isFile() && (!markdownOnly || entry.name.endsWith('.md'))) {
      nodes.push({ id: relPath, name: entry.name, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
  return nodes
}

/**
 * List one directory level with mtime, including non-markdown files.
 * Used by the file explorer's lazy folder expansion.
 */
export function listDirDetailed(root, dirPath) {
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes = []
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relPath = path.relative(root, fullPath).split(path.sep).join('/')
    let mtime = 0
    try { mtime = fs.statSync(fullPath).mtimeMs } catch { /* ignore */ }
    if (entry.isDirectory()) {
      nodes.push({ id: relPath, name: entry.name, type: 'folder', mtime })
    } else if (entry.isFile()) {
      nodes.push({ id: relPath, name: entry.name, type: 'file', mtime })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
  return nodes
}

/**
 * Search note names and contents for a keyword.
 * `keyword` must already be lower-cased by the caller.
 *
 * The vault scan is async and cached (see `lib/vault-scan.mjs`): the files are
 * read through a bounded concurrency pool and reused until something changes on
 * disk, so typing one more character costs no I/O at all — and, unlike the old
 * synchronous walk, a search can never freeze the other API routes that this
 * Node process is serving at the same time.
 *
 * @returns {Promise<Array<{ path: string, name: string, matches: string[] }>>}
 */
export async function searchNotes(root, keyword) {
  const needle = String(keyword || '').toLowerCase()
  // An empty keyword would "match" every note; callers treat it as no query.
  if (!needle) return []

  const notes = await readAllVaultNotes(root)
  const results = []
  for (const { path: relPath, content } of notes) {
    const name = relPath.split('/').pop()
    const nameMatch = name.toLowerCase().includes(needle)
    const contentMatches = []
    // A name hit already found the note; its body adds nothing to the result.
    if (!nameMatch) {
      for (const line of content.split('\n')) {
        if (line.toLowerCase().includes(needle)) {
          contentMatches.push(line.trim().slice(0, 80))
          if (contentMatches.length >= 3) break
        }
      }
    }
    if (nameMatch || contentMatches.length > 0) {
      results.push({ path: relPath, name, matches: contentMatches })
    }
  }
  return results
}

/**
 * Canonical form of a task's text: strips <br> and collapses whitespace runs.
 *
 * Used for BOTH roles on purpose — as the label returned to the UI
 * (`extractTasks`) and as the match key when toggling (`toggleTaskInContent`).
 * Because this module is the only writer/reader of these files, both sides of
 * every comparison have already been through this function, so they match.
 *
 * Do not "tighten" one side to a stricter rule (e.g. removing all whitespace):
 * the label and the key must stay derived from the SAME form or the toggle
 * silently stops finding the line it just rendered.
 */
export function normalizeTaskText(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract every Markdown task item from a note body.
 * @returns {Array<{ done: boolean, text: string }>}
 */
export function extractTasks(content) {
  const tasks = []
  String(content || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(TASK_RE)
      if (!m) return
      const done = m[1].toLowerCase() === 'x'
      const text = normalizeTaskText(m[2])
      // Skip empty unnamed tasks such as "* [ ]" / "* [x]".
      if (text) tasks.push({ done, text })
    })
  return tasks
}

/**
 * Flip the checkbox of the first task whose text matches `text`.
 * Pure string transform — the caller decides whether to persist it.
 * @returns {{ ok: boolean, content: string }}
 */
export function toggleTaskInContent(content, text, done) {
  const target = normalizeTaskText(text)
  const lines = String(content || '').replace(/\r?\n/g, '\n').split('\n')
  let hit = false
  const next = lines.map((line) => {
    const m = line.match(TASK_RE)
    if (m && !hit) {
      const t = normalizeTaskText(m[2])
      if (t === target) {
        hit = true
        const mark = done ? 'x' : ' '
        // Preserve the leading indentation and '*'; only swap the checkbox.
        return line.replace(TASK_RE, (whole) =>
          whole.replace(/\[\s*\]|\[[xX]\]/, `[${mark}]`),
        )
      }
    }
    return line
  })
  if (!hit) return { ok: false, content: String(content || '') }
  return { ok: true, content: next.join('\n') }
}

/**
 * Validate year/month query params.
 * @returns {{ y: number, m: number, mm: string } | null}
 */
export function validateYearMonth(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || y < 1000 || y > 9999) return null
  if (!Number.isInteger(m) || m < 1 || m > 12) return null
  return { y, m, mm: String(m).padStart(2, '0') }
}

/** All task items of one Journals month, each tagged with its date. */
export function readMonthTasks(root, year, mm) {
  const monthDir = safeJoin(root, monthDirPath(`${year}-${mm}`))
  const tasks = []
  if (!monthDir || !fs.existsSync(monthDir)) return tasks
  let files = []
  try {
    files = fs.readdirSync(monthDir).filter((f) => DAY_FILE_RE.test(f)).sort()
  } catch {
    return tasks
  }
  for (const f of files) {
    const date = f.replace(/\.md$/, '')
    let content
    try {
      content = fs.readFileSync(path.join(monthDir, f), 'utf-8')
    } catch {
      continue
    }
    for (const t of extractTasks(content)) tasks.push({ date, done: t.done, text: t.text })
  }
  return tasks
}

/**
 * Walk the whole Journals tree once and aggregate every day's tasks.
 * @returns {Record<string, Array<{ done: boolean, text: string }>>}
 */
export function readAllTasks(root) {
  const base = safeJoin(root, JOURNALS_DIR)
  const out = {}
  if (!base || !fs.existsSync(base)) return out
  let years
  try {
    years = fs.readdirSync(base).filter((f) => YEAR_RE.test(f))
  } catch {
    return out
  }
  for (const y of years) {
    const yearDir = path.join(base, y)
    let months
    try {
      months = fs.readdirSync(yearDir).filter((f) => MONTH_RE.test(f))
    } catch {
      continue
    }
    for (const m of months) {
      const monthDir = path.join(yearDir, m)
      let files
      try {
        files = fs.readdirSync(monthDir).filter((f) => DAY_FILE_RE.test(f))
      } catch {
        continue
      }
      for (const f of files) {
        const date = f.replace(/\.md$/, '')
        let content
        try {
          content = fs.readFileSync(path.join(monthDir, f), 'utf-8')
        } catch {
          continue
        }
        const tasks = extractTasks(content)
        if (tasks.length) out[date] = tasks
      }
    }
  }
  return out
}

/**
 * Toggle one task inside the matching journal file and persist it.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function toggleTask(root, date, text, done) {
  const relPath = journalFilePath(date)
  if (!relPath) return { ok: false, error: 'invalid date' }
  const filePath = safeJoin(root, relPath)
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'not found' }
  let content
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return { ok: false, error: 'not found' }
  }
  const result = toggleTaskInContent(content, text, done)
  if (!result.ok) return { ok: false, error: 'task not found' }
  try {
    fs.writeFileSync(filePath, result.content, 'utf-8')
  } catch {
    return { ok: false, error: 'write failed' }
  }
  return { ok: true }
}

/**
 * Derive the relative journal path for a calendar date.
 * The layout itself lives in shared/journal-layout.mjs, which the frontend
 * imports too, so both sides can never disagree about where a day lives.
 * @returns {string | null} null when the input is not a valid YYYY-MM-DD date.
 */
export function journalPathForDate(dateStr) {
  return journalFilePath(dateStr)
}

/**
 * "Today" in server local time. The date is injected so callers (and tests)
 * never depend on the wall clock implicitly.
 */
export function todayString(now = new Date()) {
  const y = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}
