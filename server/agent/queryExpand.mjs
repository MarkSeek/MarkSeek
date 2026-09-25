// Agent module: LLM-based query expansion for note search.
//
// The vault search is a substring match (see notes-fs.mjs searchNotes), which is
// exact but blind to synonyms, related concepts and Chinese word segmentation.
// Before running a search we ask the configured model to rewrite the user's
// search intent into a handful of short, distinct terms, then search for each
// and merge the hits. This is "multi-term retrieval" — no embeddings, no RAG.
import { buildCompletionEndpoint } from '../ai/provider.mjs'

// Queries at or below this length are treated as precise keywords and searched
// verbatim (no LLM round-trip). 1-2 chars (e.g. "AI", "会议") are almost always
// an exact term the user already picked, so expanding them just adds latency.
const EXPAND_MIN_LEN = 2
const MAX_TERMS = 6
const EXPAND_TIMEOUT_MS = 20000
const EXPAND_MAX_TOKENS = 256

// Run-scoped cache so the same query is never expanded twice in one session.
const cache = new Map()

const SYSTEM_PROMPT = `You are a search-query expander for a personal Markdown note vault. Given the user's note-search request (it may be a natural-language question or a few keywords), output a JSON array of 3 to 6 short, distinct search terms that would best help locate relevant notes. Include synonyms, related concepts, abbreviations, and Chinese word-segmentation variants. Prefer short keywords/phrases over full sentences. Respond with ONLY the JSON array, for example: ["term1","term2"]. No other text.`

/** Clear the expansion cache. Tests call this to stay isolated. */
export function resetExpandCache() {
  cache.clear()
}

/**
 * Expand a search query into several candidate terms.
 * @param {string} query user-provided search intent
 * @param {{ apiKey: string, baseURL: string, model: string }} cfg active provider
 * @returns {Promise<string[]>} expanded terms (falls back to [query] on any issue)
 */
export async function expandQuery(query, cfg) {
  const q = String(query || '').trim()
  if (q.length <= EXPAND_MIN_LEN) return [q]
  const key = q.toLowerCase()
  if (cache.has(key)) return cache.get(key)

  let terms = [q]
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXPAND_TIMEOUT_MS)
    const resp = await fetch(buildCompletionEndpoint(cfg.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: q },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: EXPAND_MAX_TOKENS,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return cacheAndReturn(key, terms)
    const data = await resp.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content || ''
    const parsed = parseTerms(content)
    if (parsed.length) terms = parsed
  } catch {
    // Network/timeout/parse failure: search the original query, never throw.
  }
  return cacheAndReturn(key, terms)
}

function cacheAndReturn(key, terms) {
  cache.set(key, terms)
  return terms
}

/**
 * Extract a JSON string array from a model response that may be wrapped in code
 * fences or mixed with prose. Returns only clean, non-empty terms, capped.
 * @param {string} content
 * @returns {string[]}
 */
function parseTerms(content) {
  if (!content) return []
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : content
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr
      .map((t) => String(t || '').trim())
      .filter((t) => t.length > 0)
      .slice(0, MAX_TERMS)
  } catch {
    return []
  }
}
