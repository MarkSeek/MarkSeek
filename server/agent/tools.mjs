// Agent module: note tools.
// Reuses the existing file helpers exported from server/api.mjs so the agent's
// operations stay 1:1 aligned with what the UI can already do. All write tools
// only PREVIEW the change and flag it as requireConfirm; the actual disk write
// happens later via applyWrite() after the user approves.
import fs from 'fs'
import path from 'path'
// The vault root lives in a leaf module, and every filesystem helper takes it
// explicitly. This module therefore no longer imports api.mjs, which previously
// created the api -> agent -> tools -> api cycle.
import { getVaultDir } from '../vault.mjs'
import {
  safeJoin as safeJoinInVault,
  scanDir as scanDirInVault,
  searchNotes as searchNotesInVault,
  journalPathForDate,
  todayString,
} from '../notes-fs.mjs'

const MAX_READ_CHARS = 8000
const MAX_SEARCH_RESULTS = 10

/**
 * Tool call arguments are validated defensively. Each tool returns a plain
 * string summary that is fed back to the model as the tool result.
 */

function listNotes({ dir = '' } = {}, root = getVaultDir()) {
  const target = dir ? safeJoinInVault(root, dir) : root
  if (!target) return 'Error: invalid directory path.'
  const tree = scanDirInVault(root, target, root)
  if (!tree.length) return 'No markdown files found.'
  const render = (nodes, depth = 0) => {
    let out = ''
    for (const n of nodes) {
      const indent = '  '.repeat(depth)
      if (n.type === 'folder') {
        out += `${indent}📁 ${n.name}/\n`
        if (n.children) out += render(n.children, depth + 1)
      } else {
        out += `${indent}📄 ${n.id}\n`
      }
    }
    return out
  }
  return render(tree)
}

/**
 * The vault-wide scan is async, so this tool is too — see `runTool`.
 * @returns {Promise<string>} one line per hit, or a "no matches" notice.
 */
async function searchNotesTool({ query } = {}, root = getVaultDir()) {
  if (!query || typeof query !== 'string') return 'Error: missing query.'
  const results = (await searchNotesInVault(root, query.toLowerCase())).slice(0, MAX_SEARCH_RESULTS)
  if (!results.length) return `No notes matched "${query}".`
  return results
    .map((r) => {
      const matchLines = r.matches.length ? `\n    matches: ${r.matches.join(' | ')}` : ''
      return `- ${r.path}${matchLines}`
    })
    .join('\n')
}

function readNote({ path: p } = {}, root = getVaultDir()) {
  if (!p || typeof p !== 'string') return 'Error: missing path.'
  const fp = safeJoinInVault(root, p)
  if (!fp) return 'Error: invalid path (directory traversal blocked).'
  try {
    const content = fs.readFileSync(fp, 'utf-8')
    if (content.length > MAX_READ_CHARS) {
      return (
        content.slice(0, MAX_READ_CHARS) +
        `\n\n… [truncated, total ${content.length} chars]`
      )
    }
    return content
  } catch {
    return `Error: cannot read "${p}".`
  }
}

function readJournalFile(dateStr, root = getVaultDir()) {
  const rel = journalPathForDate(dateStr)
  if (!rel) return `Error: "${dateStr}" is not a valid date (expected YYYY-MM-DD).`
  const fp = safeJoinInVault(root, rel)
  if (!fp) return 'Error: invalid journal path (directory traversal blocked).'
  try {
    const content = fs.readFileSync(fp, 'utf-8')
    if (content.length > MAX_READ_CHARS) {
      return (
        `Journal ${rel}:\n` +
        content.slice(0, MAX_READ_CHARS) +
        `\n\n… [truncated, total ${content.length} chars]`
      )
    }
    return `Journal ${rel}:\n${content}`
  } catch {
    return `No journal entry found for ${dateStr} (expected path ${rel}).`
  }
}

function todayJournal(root = getVaultDir()) {
  const today = todayString()
  return `Today's date (server local time): ${today}\n\n` + readJournalFile(today, root)
}

/**
 * Build a preview for a write operation. Does NOT touch disk.
 * Returns an object describing what would happen, for user confirmation.
 */
function previewWrite({ op, path: p, content } = {}, root = getVaultDir()) {
  if (!p || typeof p !== 'string') return { error: 'missing path.' }
  if (typeof content !== 'string') return { error: 'missing content.' }
  const fp = safeJoinInVault(root, p)
  if (!fp) return { error: 'invalid path (directory traversal blocked).' }

  let exists = false
  let existing = ''
  try {
    existing = fs.readFileSync(fp, 'utf-8')
    exists = true
  } catch {
    exists = false
  }

  // For append, preview is based on the simulated result.
  const previewBase = op === 'append' && exists ? existing + '\n' + content : content
  const preview =
    previewBase.length > MAX_READ_CHARS
      ? previewBase.slice(0, MAX_READ_CHARS) + '\n\n… [truncated preview]'
      : previewBase

  return {
    op,
    path: p,
    exists,
    preview,
    // Keep the full content server-side for the later apply step.
    content,
  }
}

/**
 * Actually write to disk after the user approved. Used by /api/agent/confirm.
 */
export function applyWrite({ op, path: p, content }, { vaultDir } = {}) {
  const fp = safeJoinInVault(vaultDir || getVaultDir(), p)
  if (!fp) return { ok: false, error: 'invalid path' }
  try {
    if (op === 'append') {
      const dir = path.dirname(fp)
      fs.mkdirSync(dir, { recursive: true })
      let base = ''
      try {
        base = fs.readFileSync(fp, 'utf-8')
      } catch {
        base = ''
      }
      const sep = base && !base.endsWith('\n') ? '\n' : ''
      fs.writeFileSync(fp, base + sep + content, 'utf-8')
    } else {
      // create / write
      const dir = path.dirname(fp)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fp, content, 'utf-8')
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/**
 * Execute a single tool call by name.
 * Read tools return their result string.
 * Write tools return a confirm_required descriptor (no side effects).
 *
 * Async because `search_notes` reads the whole vault; callers must await it.
 * @returns {Promise<{ kind: string, value: any }>}
 */
export async function runTool(name, args, { vaultDir } = {}) {
  const root = vaultDir || getVaultDir()
  switch (name) {
    case 'list_notes':
      return { kind: 'result', value: listNotes(args, root) }
    case 'search_notes':
      return { kind: 'result', value: await searchNotesTool(args, root) }
    case 'read_note':
      return { kind: 'result', value: readNote(args, root) }
    case 'today_journal':
      return { kind: 'result', value: todayJournal(root) }
    case 'read_journal':
      return { kind: 'result', value: readJournalFile(args?.date, root) }
    case 'create_note':
    case 'write_note':
    case 'append_note': {
      const result = previewWrite({ op: name === 'append_note' ? 'append' : 'write', ...args }, root)
      if (result.error) return { kind: 'result', value: 'Error: ' + result.error }
      return {
        kind: 'confirm_required',
        value: {
          op: name === 'append_note' ? 'append' : 'write',
          path: result.path,
          exists: result.exists,
          preview: result.preview,
          // Pass the real content back so the confirm step can apply it.
          content: result.content,
        },
      }
    }
    default:
      return { kind: 'result', value: `Error: unknown tool "${name}".` }
  }
}

/**
 * OpenAI-style tool definitions sent to the model.
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: 'List the note tree under a directory (relative path). Empty dir lists everything.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional relative directory path, e.g. "Projects".' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search note filenames and content for a keyword. Returns matching paths and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search for.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: 'Read the full text of a note by relative path. Truncated if too long.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative note path, e.g. "Projects/ideas.md".' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'today_journal',
      description:
        'Read today\'s daily journal. The server computes the current date (server local time zone) and reads notes/Journals/YYYY/YYYY-MM/YYYY-MM-DD.md. Use this FIRST when the user asks about "today", "today\'s journal/diary", or "what I did today" — do NOT guess the date or search other files.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_journal',
      description:
        'Read the daily journal for a specific date. The server resolves notes/Journals/YYYY/YYYY-MM/YYYY-MM-DD.md without guessing. Use when the user mentions a concrete date (e.g. "yesterday", "2026-08-15" — convert to YYYY-MM-DD first).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Calendar date in YYYY-MM-DD format.' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a NEW note with given content. Requires user confirmation. Fails if the file already exists.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path for the new note, e.g. "Projects/idea.md".' },
          content: { type: 'string', description: 'Full Markdown content of the new note.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: 'Overwrite an EXISTING note (or create it) with given content. Requires user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative note path, e.g. "Projects/idea.md".' },
          content: { type: 'string', description: 'Full Markdown content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_note',
      description: 'Append content to the END of an existing note. Requires user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative note path, e.g. "Projects/idea.md".' },
          content: { type: 'string', description: 'Markdown content to append.' },
        },
        required: ['path', 'content'],
      },
    },
  },
]

// Re-exported for callers that need the server-computed date without reaching
// into notes-fs.mjs directly.
export { todayString }
