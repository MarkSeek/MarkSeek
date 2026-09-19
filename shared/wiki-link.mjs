// Pure helpers for `[[wiki link]]` targets.
//
// The vault has no link index: a target is matched against the flat list of
// markdown paths the caller already holds. Keeping every rule here means the
// editor (browser), the relation backend (Node) and the tests all resolve
// `[[a/b]]` the same way.
//
// Plain ESM on purpose: the browser and Node import this exact file, with no
// build step. The TypeScript types live in the sibling `wiki-link.d.mts`.
//
// NOTE: `WIKI_LINK_RE` carries the `g` flag, so `lastIndex` is shared state.
// Every consumer resets it before a scan — keep doing that when adding
// callers, especially on the server where one request would otherwise resume
// a scan left halfway by another.

/**
 * Matches a whole `[[target]]` (optionally `[[target|alias]]`).
 *
 * Remark escapes every `[` that sits in prose, so a link can reach the file as
 * `\[\[target]]` — still shown as `[[target]]` in the editor, but unreadable to
 * anything that parses the text. The optional backslashes keep such a file
 * working instead of silently losing every link.
 */
export const WIKI_LINK_RE = /(?:\\?\[){2}([^[\]\n]+?)(?:\\?\]){2}/g

/**
 * Undo remark's escaping of a wiki link's brackets.
 *
 * `crepe.getMarkdown()` writes `\[\[target]]`; remark turns that back into
 * `[[target]]` on parse, so the corruption is invisible while typing and only
 * shows up in the file and in everything that reads it. Only bracket pairs
 * forming a wiki link are restored — every other escape is left alone.
 */
export function unescapeWikiLinks(md) {
  return md
    .replace(/(?:\\\[){2}([^[\]\n]+?)(?:\\\]){2}/g, '[[$1]]')
    .replace(/(?:\\\[){2}([^[\]\n]+?)\]\]/g, '[[$1]]')
}

/** Show `[[target]]` even when the file on disk carries remark's `\` escapes. */
export function cleanWikiText(text) {
  return text.replace(/\\([[\]])/g, '$1')
}

/** Directory holding `p`, or '' when the file sits at the vault root. */
export function dirName(p) {
  const norm = p.replace(/\\/g, '/')
  const at = norm.lastIndexOf('/')
  return at < 0 ? '' : norm.slice(0, at)
}

/** File name without its directory. */
export function baseName(p) {
  const norm = p.replace(/\\/g, '/')
  const at = norm.lastIndexOf('/')
  return at < 0 ? norm : norm.slice(at + 1)
}

/** Note title: file name without directory and extension. */
export function noteTitle(p) {
  return baseName(p).replace(/\.(md|markdown)$/i, '')
}

/**
 * Vault-relative path without extension, backslashes and leading `./`.
 *
 * Deliberately NOT lower-cased: the comparison lower-cases a copy so the
 * returned path keeps the casing it has on disk.
 */
function normalizeKey(p) {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\.(md|markdown)$/i, '')
    .replace(/\/+$/, '')
    .trim()
}

const lower = (p) => p.toLowerCase()

/** Join `dir` and `key` the way a vault path looks, or `key` at the root. */
function joinKey(dir, key) {
  return dir ? `${dir}/${key}` : key
}

/**
 * Split a raw wikilink body into its target / alias / anchor parts.
 * `[[ dir1/file1 | alias ]]` and `[[file1#heading]]` both parse here.
 */
export function parseWikiTarget(raw) {
  const trimmed = (raw ?? '').trim().replace(/\\/g, '/')
  if (!trimmed) return { target: '' }

  // The alias is a display concern only: it must never leak into the target.
  const [beforeAlias, ...aliasParts] = trimmed.split('|')
  const [beforeAnchor, ...anchorParts] = beforeAlias.split('#')

  const result = { target: beforeAnchor.trim() }
  const alias = aliasParts.join('|').trim()
  const anchor = anchorParts.join('#').trim()
  if (alias) result.alias = alias
  if (anchor) result.anchor = anchor
  return result
}

/** Rank candidates: same directory first, then shorter paths, then A-Z. */
function sortCandidates(list, fromPath) {
  const dir = fromPath ? dirName(fromPath) : ''
  return [...list].sort((a, b) => {
    if (dir) {
      const aNear = dirName(a) === dir ? 0 : 1
      const bNear = dirName(b) === dir ? 0 : 1
      if (aNear !== bNear) return aNear - bNear
    }
    if (a.length !== b.length) return a.length - b.length
    return a.localeCompare(b, 'zh')
  })
}

/**
 * The path a missing target would be created at.
 * A target carrying a directory is vault-relative; a bare name lands next to
 * the note that linked it, which is what "new note next to this one" means.
 */
export function suggestCreatePath(target, fromPath) {
  const key = normalizeKey(target)
  if (!key) return ''
  const withExt = /\.(md|markdown)$/i.test(key) ? key : `${key}.md`
  if (key.includes('/')) return withExt
  const dir = fromPath ? dirName(fromPath) : ''
  return joinKey(dir, withExt)
}

/**
 * Resolve one wikilink body against the vault.
 *
 * Two shapes of target:
 * - `[[dir1/file1]]` names a path, so it is matched as one (next to the
 *   linking note first, then from the vault root, then as a path suffix).
 * - `[[file1]]` names a note, so every note called `file1` is a candidate; more
 *   than one means the reader has to choose, which is the point of the picker.
 */
export function resolveWikiLink(raw, { paths, fromPath }) {
  const { target } = parseWikiTarget(raw)
  const key = normalizeKey(target)
  if (!key) {
    return { status: 'missing', target: (raw ?? '').trim(), createPath: '' }
  }

  const dir = fromPath ? dirName(fromPath) : ''
  const selfKey = lower(normalizeKey(fromPath ?? ''))
  const rootKey = lower(key)
  const pool = paths.filter((p) => lower(normalizeKey(p)) !== selfKey)

  // Bare name: every note carrying it is a candidate, wherever it lives.
  if (!key.includes('/')) {
    const named = pool.filter((p) => lower(noteTitle(p)) === rootKey)
    if (named.length === 1) return { status: 'unique', path: named[0] }
    if (named.length > 1) {
      return { status: 'ambiguous', candidates: sortCandidates(named, fromPath), target }
    }
    return { status: 'missing', target, createPath: suggestCreatePath(target, fromPath) }
  }

  // Directory-qualified: next to the linking note, then from the vault root.
  const relKey = lower(normalizeKey(joinKey(dir, key)))
  const rootHits = []
  const relHits = []
  for (const p of pool) {
    const norm = lower(normalizeKey(p))
    if (dir && norm === relKey) relHits.push(p)
    else if (norm === rootKey) rootHits.push(p)
  }
  const exact = dir ? relHits.concat(rootHits) : rootHits
  if (exact.length === 1) return { status: 'unique', path: exact[0] }
  if (exact.length > 1) {
    return { status: 'ambiguous', candidates: sortCandidates(exact, fromPath), target }
  }

  // Fall back to "path ends with these segments" so `b/c` finds `a/b/c.md`.
  // The boundary has to be a `/`, otherwise `c` would also match `abc`.
  const suffix = `/${rootKey}`
  const matched = pool.filter((p) => {
    const norm = lower(normalizeKey(p))
    return norm.endsWith(suffix)
  })
  const sorted = sortCandidates(matched, fromPath)
  if (sorted.length === 1) return { status: 'unique', path: sorted[0] }
  if (sorted.length > 1) {
    return { status: 'ambiguous', candidates: sorted, target }
  }

  return { status: 'missing', target, createPath: suggestCreatePath(target, fromPath) }
}

/**
 * Notes to offer while the user is typing `[[`.
 * Names starting with the query rank above names merely containing it, and a
 * bare query lists the notes of the current directory first.
 */
export function filterWikiCandidates(query, { paths, fromPath, limit = 12 }) {
  const q = lower(normalizeKey(query)).trim()
  const dir = fromPath ? dirName(fromPath) : ''
  const selfKey = lower(normalizeKey(fromPath ?? ''))

  const scored = []
  for (const p of paths) {
    const norm = lower(normalizeKey(p))
    if (norm === selfKey) continue
    if (!q) {
      scored.push({ path: p, rank: 0 })
      continue
    }
    const name = lower(noteTitle(p))
    let rank = -1
    if (name.startsWith(q)) rank = 0
    else if (name.includes(q)) rank = 1
    else if (norm.includes(q)) rank = 2
    if (rank >= 0) scored.push({ path: p, rank })
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (dir) {
      const aNear = dirName(a.path) === dir ? 0 : 1
      const bNear = dirName(b.path) === dir ? 0 : 1
      if (aNear !== bNear) return aNear - bNear
    }
    if (a.path.length !== b.path.length) return a.path.length - b.path.length
    return a.path.localeCompare(b.path, 'zh')
  })

  return scored.slice(0, limit).map((s) => s.path)
}
