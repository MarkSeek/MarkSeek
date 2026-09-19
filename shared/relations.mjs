// Pure helpers for analyzing a note's relations within the knowledge base.
// No I/O here — callers pass in already-read file contents.
//
// Plain ESM on purpose: the browser used to be the only caller (via
// src/utils/relations.ts) but the whole-vault scan now runs in Node, and both
// sides must agree on what counts as a link, a tag or a task. The TypeScript
// types live in the sibling `relations.d.mts`.
import { WIKI_LINK_RE, cleanWikiText, parseWikiTarget, resolveWikiLink } from './wiki-link.mjs'

/** Strip extension and normalize separators to "/" for comparison. */
function normalizePath(p) {
  return p
    .replace(/\\/g, '/')
    .replace(/\.(md|markdown)$/i, '')
    .replace(/^\.?\//, '')
    .toLowerCase()
}

/** Human-friendly name without directory and extension. */
function displayName(p) {
  const base = p.split(/[/\\]/).pop() ?? p
  return base.replace(/\.(md|markdown)$/i, '')
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-]+)/gu
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/gm
/** Anything the browser should open instead of the app. */
const EXTERNAL_RE = /^(https?:|mailto:|tel:)/i

/** Directory of `p`, or '' at the vault root. */
function dirOf(p) {
  const norm = p.replace(/\\/g, '/')
  const at = norm.lastIndexOf('/')
  return at < 0 ? '' : norm.slice(0, at)
}

/** Join a directory and a relative target into one vault path. */
function joinPath(dir, rel) {
  const joined = dir ? `${dir}/${rel}` : rel
  return joined.replace(/\/{2,}/g, '/')
}

/**
 * Resolve a markdown link target to a vault path.
 * A leading "/" means the vault root; anything else is relative to the note
 * that carries the link. Returns null for anchors and empty targets.
 */
function resolveLink(target, basePath) {
  const anchor = target.split('#')[0].trim()
  if (!anchor) return null
  const cleaned = anchor.replace(/\\/g, '/').replace(/^\.\//, '')
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '')
  return joinPath(dirOf(basePath), cleaned)
}

/**
 * Turn a resolved link into the path of a note: bare names get `.md`, other
 * file types (images, html, …) are not notes and are reported as `null`.
 */
function asNotePath(resolved) {
  if (!resolved) return null
  if (/\.(md|markdown)$/i.test(resolved)) return resolved
  const last = resolved.split('/').pop() ?? ''
  if (/\.[a-z0-9]{1,8}$/i.test(last)) return null
  return `${resolved}.md`
}

/** Parse outgoing links (markdown + wikilinks) from a note's content. */
export function parseOutLinks(note) {
  const found = new Map()
  const base = normalizePath(note.path)
  let m

  MD_LINK_RE.lastIndex = 0
  while ((m = MD_LINK_RE.exec(note.content))) {
    // `[label](target)` — the label is what the reader sees.
    const label = m[0].slice(1, m[0].indexOf(']('))
    const target = m[1].trim()
    if (!target || target.startsWith('#')) continue

    if (EXTERNAL_RE.test(target)) {
      if (!found.has(target)) {
        found.set(target, { path: target, name: label || target, kind: 'external', href: target })
      }
      continue
    }

    const path = asNotePath(resolveLink(target, note.path))
    if (!path || normalizePath(path) === base) continue
    if (!found.has(path)) found.set(path, { path, name: displayName(path), kind: 'file' })
  }

  WIKI_LINK_RE.lastIndex = 0
  while ((m = WIKI_LINK_RE.exec(note.content))) {
    const { target, alias } = parseWikiTarget(m[1])
    if (!target) continue
    // Matching happens on click: only the vault can say which note this is.
    if (!found.has(target)) {
      found.set(target, { path: target, name: alias || target, kind: 'wiki', raw: target })
    }
  }

  return [...found.values()]
}

/**
 * Parse backlinks: other notes whose links (markdown/wikilink) point to the
 * current note.
 *
 * Wikilinks go through the same resolver the click handler uses, so a note
 * that writes `[[dir1/file1]]` counts as a backlink of exactly that note —
 * even when other directories hold a note with the same name.
 */
export function parseBackLinks(current, all) {
  const curAnchor = normalizePath(current.path)
  const result = new Map()
  const paths = all.map((file) => file.path)
  let m

  for (const file of all) {
    if (normalizePath(file.path) === curAnchor) continue
    const content = file.content
    let hit

    MD_LINK_RE.lastIndex = 0
    while ((m = MD_LINK_RE.exec(content))) {
      const target = m[1].trim()
      if (!target || target.startsWith('#') || EXTERNAL_RE.test(target)) continue
      const path = asNotePath(resolveLink(target, file.path))
      if (path && normalizePath(path) === curAnchor) {
        hit = m[0]
        break
      }
    }

    if (!hit) {
      WIKI_LINK_RE.lastIndex = 0
      while ((m = WIKI_LINK_RE.exec(content))) {
        const outcome = resolveWikiLink(m[1], { paths, fromPath: file.path })
        const pointsHere =
          outcome.status === 'unique'
            ? normalizePath(outcome.path) === curAnchor
            : outcome.status === 'ambiguous' &&
              outcome.candidates.some((c) => normalizePath(c) === curAnchor)
        if (pointsHere) {
          // The file may carry remark's `\` escapes; the reader sees brackets.
          hit = cleanWikiText(m[0])
          break
        }
      }
    }

    if (hit && !result.has(normalizePath(file.path))) {
      result.set(normalizePath(file.path), {
        path: file.path,
        name: displayName(file.path),
        snippet: hit,
      })
    }
  }

  return [...result.values()]
}

/** Parse tags from a note's content (excluding code blocks). */
export function parseTags(note) {
  const tags = new Set()
  let m
  // crude code-fence removal to avoid matching tags inside code
  const cleaned = note.content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(cleaned))) {
    tags.add(m[1])
  }
  return [...tags]
}

/**
 * Build tag entries: each tag of the current note with other notes sharing it.
 */
export function parseTagMatrix(current, all) {
  const myTags = parseTags(current)
  if (myTags.length === 0) return []
  const curAnchor = normalizePath(current.path)
  return myTags.map((tag) => {
    const others = all
      .filter((f) => normalizePath(f.path) !== curAnchor)
      .filter((f) => parseTags(f).includes(tag))
      .map((f) => ({ path: f.path, name: displayName(f.path) }))
    return { tag, others }
  })
}

/** Parse task list items (- [ ] / - [x]) from content. */
export function parseTasks(note) {
  const tasks = []
  let m
  TASK_RE.lastIndex = 0
  while ((m = TASK_RE.exec(note.content))) {
    tasks.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() })
  }
  return tasks
}

/** Run all analyzers against the full set of notes. */
export function analyzeRelations(current, all) {
  return {
    backLinks: parseBackLinks(current, all),
    outLinks: parseOutLinks(current),
    tags: parseTagMatrix(current, all),
    tasks: parseTasks(current),
  }
}
