import { describe, expect, it, vi } from 'vitest'
import {
  createConversation,
  deleteAllConversations,
  deleteConversation,
  getActiveId,
  isConversationEmpty,
  listConversations,
  setActiveId,
  touchConversation,
  updateConversationTitle,
} from '../conversationStore'
import {
  KEYS,
  convActiveKey,
  convAgentKey,
  convMessagesKey,
  convMetaKey,
} from '../../utils/storageKeys'

// The current chat base key; all conversation keys are derived from it.
const BASE = KEYS.chatBase.home
const META_KEY = convMetaKey(BASE)
const ACTIVE_KEY = convActiveKey(BASE)

describe('createConversation', () => {
  it('stores the meta list and marks the new conversation active', () => {
    const conv = createConversation(BASE, 'hello')
    expect(conv.title).toBe('hello')
    expect(listConversations(BASE)).toHaveLength(1)
    expect(getActiveId(BASE)).toBe(conv.id)
    expect(JSON.parse(localStorage.getItem(META_KEY) ?? '[]')).toHaveLength(1)
  })

  it('generates unique ids', () => {
    const a = createConversation(BASE)
    const b = createConversation(BASE)
    expect(a.id).not.toBe(b.id)
  })
})

describe('listConversations', () => {
  it('sorts by updatedAt descending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1))
    const first = createConversation(BASE)
    vi.setSystemTime(new Date(2026, 0, 3))
    const second = createConversation(BASE)
    vi.useRealTimers()
    expect(listConversations(BASE).map((c) => c.id)).toEqual([second.id, first.id])
  })

  it('returns [] for missing, malformed or non-array payloads', () => {
    expect(listConversations(BASE)).toEqual([])
    localStorage.setItem(META_KEY, '{broken')
    expect(listConversations(BASE)).toEqual([])
    localStorage.setItem(META_KEY, '{"nope":1}')
    expect(listConversations(BASE)).toEqual([])
  })
})

describe('setActiveId / getActiveId', () => {
  it('removes the key when clearing the active conversation', () => {
    setActiveId(BASE, 'c1')
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('c1')
    setActiveId(BASE, null)
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(getActiveId(BASE)).toBeNull()
  })
})

describe('updateConversationTitle', () => {
  it('trims whitespace and truncates to 20 characters', () => {
    const conv = createConversation(BASE)
    updateConversationTitle(BASE, conv.id, '   a-title-that-is-definitely-too-long   ')
    expect(listConversations(BASE)[0].title).toBe('a-title-that-is-defi')
  })

  it('falls back to the default title when the value is blank', () => {
    const conv = createConversation(BASE)
    updateConversationTitle(BASE, conv.id, '    ')
    expect(listConversations(BASE)[0].title).toBe('New Chat')
  })

  it('ignores unknown conversation ids', () => {
    const conv = createConversation(BASE, 'keep')
    updateConversationTitle(BASE, 'missing', 'nope')
    expect(listConversations(BASE)[0].title).toBe('keep')
    expect(conv.id).toBeTruthy()
  })
})

describe('touchConversation', () => {
  it('bumps updatedAt so the conversation moves to the top', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1))
    const first = createConversation(BASE)
    vi.setSystemTime(new Date(2026, 0, 2))
    const second = createConversation(BASE)
    vi.setSystemTime(new Date(2026, 0, 5))
    touchConversation(BASE, first.id)
    vi.useRealTimers()
    expect(listConversations(BASE).map((c) => c.id)).toEqual([first.id, second.id])
  })
})

describe('isConversationEmpty', () => {
  it('treats a conversation without stored agent messages as empty', () => {
    const conv = createConversation(BASE)
    expect(isConversationEmpty(BASE, conv.id)).toBe(true)
    localStorage.setItem(convAgentKey(BASE, conv.id), JSON.stringify({ messages: [{ id: 1 }] }))
    expect(isConversationEmpty(BASE, conv.id)).toBe(false)
  })

  it('is empty when the payload is malformed', () => {
    const conv = createConversation(BASE)
    localStorage.setItem(convAgentKey(BASE, conv.id), '{broken')
    expect(isConversationEmpty(BASE, conv.id)).toBe(true)
  })
})

describe('deleteConversation', () => {
  it('removes meta, messages and falls back to the next active id', () => {
    const first = createConversation(BASE)
    const second = createConversation(BASE)
    localStorage.setItem(convMessagesKey(BASE, second.id), '[]')
    localStorage.setItem(convAgentKey(BASE, second.id), '{"messages":[]}')
    setActiveId(BASE, second.id)

    deleteConversation(BASE, second.id)

    expect(listConversations(BASE).map((c) => c.id)).toEqual([first.id])
    expect(localStorage.getItem(convMessagesKey(BASE, second.id))).toBeNull()
    expect(localStorage.getItem(convAgentKey(BASE, second.id))).toBeNull()
    expect(getActiveId(BASE)).toBe(first.id)
  })

  it('clears the active id when the last conversation is deleted', () => {
    const only = createConversation(BASE)
    deleteConversation(BASE, only.id)
    expect(getActiveId(BASE)).toBeNull()
  })
})

describe('deleteAllConversations', () => {
  it('wipes meta, active id and every message key', () => {
    const a = createConversation(BASE)
    const b = createConversation(BASE)
    localStorage.setItem(convMessagesKey(BASE, a.id), '[]')
    localStorage.setItem(convAgentKey(BASE, b.id), '{"messages":[]}')

    deleteAllConversations(BASE)

    expect(listConversations(BASE)).toEqual([])
    expect(getActiveId(BASE)).toBeNull()
    expect(localStorage.getItem(convMessagesKey(BASE, a.id))).toBeNull()
    expect(localStorage.getItem(convAgentKey(BASE, b.id))).toBeNull()
  })
})
