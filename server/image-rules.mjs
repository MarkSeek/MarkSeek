// Where a screenshot / pasted image lands inside the vault.
//
// The rule engine behind the "Images & Attachments" settings group: a note's
// vault-relative path is matched against a list of user regexes, top to
// bottom, and the first hit decides the destination folder.
//
// This module is deliberately pure — no fs, no settings read, no clock of its
// own. Every input arrives as an argument, which is what lets the same
// resolution drive both the real upload (routes/files.mjs) and the "test this
// path" preview in the settings UI, so the preview can never drift from what
// an actual paste does.

/** Fallback folder when no rule matches (or the configured default is unusable). */
export const DEFAULT_IMAGE_DIR = 'images'

/** Placeholders a rule target may use; expanded against the note path + date. */
export const TARGET_PLACEHOLDERS = ['{year}', '{month}', '{day}', '{noteName}']

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)

/**
 * Normalize a vault-relative path for matching: backslashes to slashes, no
 * leading `./`, no leading slash.
 * @param {string} p
 * @returns {string}
 */
export function normalizeRelPath(p) {
  return str(p)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

/**
 * Validate a vault-relative DIRECTORY path.
 *
 * A target folder comes from user input (settings.json is hand-editable), so
 * it is treated as hostile: anything absolute, any `..`, any empty segment or
 * Windows drive letter is rejected outright rather than cleaned up — silently
 * rewriting it would hide a typo that sends images somewhere unexpected.
 * @param {unknown} dir
 * @returns {string} the normalized path, or '' when unusable
 */
export function sanitizeRelDir(dir) {
  const raw = str(dir).trim()
  if (!raw) return ''
  if (raw.includes('\0')) return ''
  // Absolute paths (posix or windows) and UNC-ish prefixes never describe a
  // folder inside the vault.
  if (/^([a-zA-Z]:)?[\\/]/.test(raw)) return ''
  const segments = raw.replace(/\\/g, '/').split('/')
  for (const seg of segments) {
    const s = seg.trim()
    if (!s || s === '.' || s === '..') return ''
  }
  return segments.map((s) => s.trim()).join('/')
}

/**
 * Coerce one untrusted rule entry into the persisted shape.
 * @param {unknown} raw
 * @param {number} [index] position in the list, used to synthesize a missing id
 * @returns {{ id: string, name: string, pattern: string, target: string, enabled: boolean }}
 */
export function sanitizeImageRule(raw, index = 0) {
  const r = isObject(raw) ? raw : {}
  return {
    id: str(r.id) || `r_${index}`,
    name: str(r.name),
    pattern: str(r.pattern),
    target: str(r.target),
    enabled: r.enabled === undefined ? true : Boolean(r.enabled),
  }
}

/**
 * Coerce the whole rule list, dropping entries that are not objects.
 * @param {unknown} raw
 * @returns {ReturnType<typeof sanitizeImageRule>[]}
 */
export function sanitizeImageRules(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((r, i) => sanitizeImageRule(r, i))
}

/**
 * Expand `{year}` / `{month}` / `{day}` / `{noteName}` in a rule target.
 *
 * `{noteName}` is the note's file name without its extension — the natural
 * "one folder per note" layout (`Journals/{noteName}/images`).
 * @param {string} target
 * @param {{ notePath?: string, now?: Date }} [ctx]
 * @returns {string}
 */
export function expandTarget(target, { notePath, now = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const base = normalizeRelPath(notePath).split('/').pop() || ''
  const noteName = base.replace(/\.[^.]*$/, '')
  return str(target)
    .split('{year}').join(String(now.getFullYear()))
    .split('{month}').join(pad(now.getMonth() + 1))
    .split('{day}').join(pad(now.getDate()))
    .split('{noteName}').join(noteName)
}

/**
 * Compile a rule's pattern, tolerating typos: an invalid regex must not break
 * uploads, it just never matches (the UI flags it inline as well).
 * @param {string} pattern
 * @returns {RegExp | null}
 */
export function compilePattern(pattern) {
  if (!str(pattern).trim()) return null
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/**
 * Decide the destination folder for an image inserted into `notePath`.
 *
 * Rules are consulted in array order — the array order *is* the priority, so
 * the settings UI moves entries up/down instead of storing a numeric rank.
 * The first enabled rule whose pattern matches wins; a rule whose target is
 * unsafe is skipped so a bad entry degrades to the next one instead of
 * failing the upload.
 *
 * @param {{ notePath?: string, settings?: Record<string, any>, now?: Date }} args
 * @returns {{ dir: string, ruleId: string, ruleName: string }}
 *   `ruleId === ''` means nothing matched and the default folder was used.
 */
export function resolveImageDir({ notePath, settings = {}, now = new Date() } = {}) {
  const fallback = sanitizeRelDir(settings.imageDefaultDir) || DEFAULT_IMAGE_DIR
  const miss = { dir: fallback, ruleId: '', ruleName: '' }

  const relPath = normalizeRelPath(notePath)
  if (!relPath) return miss

  for (const rule of sanitizeImageRules(settings.imageRules)) {
    if (!rule.enabled) continue
    const re = compilePattern(rule.pattern)
    if (!re) continue
    if (!re.test(relPath)) continue
    const dir = sanitizeRelDir(expandTarget(rule.target, { notePath: relPath, now }))
    if (!dir) continue
    return { dir, ruleId: rule.id, ruleName: rule.name }
  }

  return miss
}
