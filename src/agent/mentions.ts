// Chat mention helpers: parse `@[[path]]` tokens, flatten the vault tree into a
// mentionable note list, and derive display labels. Pure functions so they are
// easy to unit test and safe to call on every keystroke.
import type { TreeNode } from '../api/files'

// The mention marker reuses the app's existing `[[ ]]` wiki-link convention, so
// a reference reads naturally inside a message and the regex stays trivial.
export const MENTION_RE = /@\[\[([^\]\n]+)\]\]/g

// Hard caps so a user cannot flood the agent context with dozens of huge notes.
export const MAX_MENTIONS = 8
export const MENTION_TRUNCATE = 6000

export interface MentionTarget {
  path: string
  name: string
}

/**
 * Extract the de-duplicated vault-relative paths referenced via `@[[path]]`.
 * Returns them in first-seen order.
 */
export function parseMentions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text))) {
    const p = m[1].trim()
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * Recursively collect every Markdown file in the tree as a mention target.
 * Folders are descended; only `.md` files are mentionable.
 */
export function flattenMarkdownFiles(
  nodes: TreeNode[],
  out: MentionTarget[] = [],
): MentionTarget[] {
  for (const n of nodes) {
    if (n.type === 'folder') {
      if (n.children) flattenMarkdownFiles(n.children, out)
    } else if (n.type === 'file' && /\.md$/i.test(n.name)) {
      out.push({ path: n.id, name: n.name })
    }
  }
  return out
}

/** Human label for a mention: the file name without its `.md` extension. */
export function mentionName(path: string): string {
  const base = path.split('/').pop() || path
  return base.replace(/\.md$/i, '')
}

export interface MentionSegment {
  type: 'text' | 'mention'
  value: string
}

/**
 * Split message content into alternating text / mention segments so the UI can
 * render `@[[path]]` as a clickable chip while passing the rest to Markdown.
 */
export function splitMentions(content: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(content))) {
    if (m.index > last) {
      segments.push({ type: 'text', value: content.slice(last, m.index) })
    }
    segments.push({ type: 'mention', value: m[1].trim() })
    last = m.index + m[0].length
  }
  if (last < content.length) {
    segments.push({ type: 'text', value: content.slice(last) })
  }
  return segments
}
