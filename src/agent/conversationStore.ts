// Conversation metadata store based on localStorage.
//
// Each chat panel instance is identified by a base key (see `KEYS.chatBase`).
// A base key owns a list of conversations, each identified by an id, and the
// messages of a conversation live under their own derived keys. Both the base
// and the derived keys were renamed when the storage layer was unified, so
// every read falls back to the legacy aliases and promotes what it finds.
import {
  readJsonMigrated,
  readRaw,
  readRawMigrated,
  removeRaw,
  writeJson,
  writeRaw,
} from '../utils/storage'
import {
  convActiveKey,
  convAgentKey,
  convMetaKey,
  convMessagesKey,
  legacyChatBases,
  legacyConvActiveKeys,
  legacyConvAgentKeys,
  legacyConvMetaKeys,
  legacyConvMessagesKeys,
} from '../utils/storageKeys'

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: number
}

const TITLE_MAX = 20
const DEFAULT_TITLE = 'New Chat'

function genId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isMeta(raw: unknown): raw is ConversationMeta {
  if (!raw || typeof raw !== 'object') return false
  const it = raw as Record<string, unknown>
  return typeof it.id === 'string' && !!it.id && typeof it.title === 'string'
}

function toMetaList(raw: unknown): ConversationMeta[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter(isMeta).map((it) => ({
    id: it.id,
    title: it.title,
    updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : 0,
  }))
}

/** Persisted agent payload: only the message list matters for emptiness. */
function toMessageBag(raw: unknown): { messages?: unknown } | null {
  return raw && typeof raw === 'object' ? (raw as { messages?: unknown }) : null
}

export function listConversations(baseKey: string): ConversationMeta[] {
  const list = readJsonMigrated(convMetaKey(baseKey), legacyConvMetaKeys(baseKey), [], toMetaList)
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

function writeMeta(baseKey: string, list: ConversationMeta[]): void {
  writeJson(convMetaKey(baseKey), list)
}

export function getActiveId(baseKey: string): string | null {
  return readRawMigrated(convActiveKey(baseKey), legacyConvActiveKeys(baseKey))
}

export function setActiveId(baseKey: string, id: string | null): void {
  if (id) writeRaw(convActiveKey(baseKey), id)
  else removeRaw(convActiveKey(baseKey))
}

export function createConversation(baseKey: string, title = DEFAULT_TITLE): ConversationMeta {
  const conv: ConversationMeta = {
    id: genId(),
    title,
    updatedAt: Date.now(),
  }
  const list = listConversations(baseKey)
  list.push(conv)
  writeMeta(baseKey, list)
  setActiveId(baseKey, conv.id)
  return conv
}

// A conversation is considered empty when it has no stored messages.
// Agent chat persists under the conversation's agent key as `{ messages: [...] }`.
export function isConversationEmpty(baseKey: string, id: string): boolean {
  const parsed = readJsonMigrated<{ messages?: unknown } | null>(
    convAgentKey(baseKey, id),
    legacyConvAgentKeys(baseKey, id),
    null,
    toMessageBag,
  )
  if (!parsed) return true
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  return messages.length === 0
}

export function deleteConversation(baseKey: string, id: string): void {
  const list = listConversations(baseKey).filter((c) => c.id !== id)
  writeMeta(baseKey, list)
  removeRaw(convMessagesKey(baseKey, id))
  removeRaw(convAgentKey(baseKey, id))
  for (const legacy of legacyConvMessagesKeys(baseKey, id)) removeRaw(legacy)
  for (const legacy of legacyConvAgentKeys(baseKey, id)) removeRaw(legacy)
  if (getActiveId(baseKey) === id) {
    const next = list[0]
    setActiveId(baseKey, next ? next.id : null)
  }
}

export function deleteAllConversations(baseKey: string): void {
  const list = listConversations(baseKey)
  removeRaw(convMetaKey(baseKey))
  setActiveId(baseKey, null)
  for (const conv of list) {
    removeRaw(convMessagesKey(baseKey, conv.id))
    removeRaw(convAgentKey(baseKey, conv.id))
    for (const legacy of legacyConvMessagesKeys(baseKey, conv.id)) removeRaw(legacy)
    for (const legacy of legacyConvAgentKeys(baseKey, conv.id)) removeRaw(legacy)
  }
}

export function updateConversationTitle(baseKey: string, id: string, title: string): void {
  const list = listConversations(baseKey)
  const target = list.find((c) => c.id === id)
  if (!target) return
  const trimmed = title.trim().slice(0, TITLE_MAX)
  target.title = trimmed || DEFAULT_TITLE
  target.updatedAt = Date.now()
  writeMeta(baseKey, list)
}

export function touchConversation(baseKey: string, id: string): void {
  const list = listConversations(baseKey)
  const target = list.find((c) => c.id === id)
  if (!target) return
  target.updatedAt = Date.now()
  writeMeta(baseKey, list)
}

/** True when a legacy payload actually carries messages worth migrating. */
function hasMessages(raw: string | null): boolean {
  if (!raw) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

/**
 * Move the messages of every conversation onto the current keys. Only runs the
 * first time (once the meta key exists under the new name there is nothing
 * left in the old one), so it never walks the whole history on every mount.
 */
function migrateConversationMessages(baseKey: string, list: ConversationMeta[]): void {
  for (const conv of list) {
    readJsonMigrated<unknown>(
      convMessagesKey(baseKey, conv.id),
      legacyConvMessagesKeys(baseKey, conv.id),
      null,
    )
    readJsonMigrated<unknown>(
      convAgentKey(baseKey, conv.id),
      legacyConvAgentKeys(baseKey, conv.id),
      null,
    )
  }
}

/**
 * Fold a pre-conversation payload into a default conversation so the existing
 * chat history is not lost.
 */
function migrateSoloPayload(baseKey: string): void {
  for (const old of legacyChatBases(baseKey)) {
    const plain = readRaw(old)
    const agent = readRaw(`${old}-agent`)
    if (!hasMessages(plain)) continue
    const conv: ConversationMeta = {
      id: genId(),
      title: 'Default Chat',
      updatedAt: Date.now(),
    }
    if (plain) writeRaw(convMessagesKey(baseKey, conv.id), plain)
    if (agent) writeRaw(convAgentKey(baseKey, conv.id), agent)
    writeMeta(baseKey, [conv])
    setActiveId(baseKey, conv.id)
    removeRaw(old)
    removeRaw(`${old}-agent`)
    return
  }
}

/**
 * Migrate legacy single-session data (no conversation id) into a default
 * conversation, and promote any conversation still stored under the old keys.
 * Idempotent: after the first run the meta key exists under its current name
 * and the function returns immediately.
 */
export function migrateLegacy(baseKey: string): void {
  if (readRaw(convMetaKey(baseKey)) !== null) return
  const list = listConversations(baseKey)
  if (list.length > 0) {
    migrateConversationMessages(baseKey, list)
    return
  }
  migrateSoloPayload(baseKey)
}
