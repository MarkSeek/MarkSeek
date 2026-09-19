// Frontend agent module: React hook driving the agent conversation.
import { useCallback, useEffect, useRef, useState } from 'react'
import { readJson, removeRaw, writeJson } from '../utils/storage'
import { buildAgentContext, streamAgentChat } from './api'
import { createRunState, handleAgentEvent } from './eventReducer'
import type { AgentEventEffect } from './eventReducer'
import type {
  AgentMessage,
  AgentMessageStats,
  AgentUsage,
  Confirmation,
  ConfirmRequest,
  ToolActivity,
} from './types'

// Fallback token count for providers that never report usage on a streamed
// response. Rough heuristic: ~1 token per 4 latin characters and ~1 token per
// 1.5 CJK characters, which keeps the number in a believable range.
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length
  const rest = text.length - cjk
  return Math.max(1, Math.round(rest / 4 + cjk / 1.5))
}

// Pick the most complete token count a provider gave us, falling back to the
// estimate when usage is missing entirely.
function resolveTokens(usage: AgentUsage | undefined, content: string): number {
  if (usage) {
    const total = usage.total_tokens
    if (typeof total === 'number' && total > 0) return total
    const prompt = usage.prompt_tokens ?? 0
    const completion = usage.completion_tokens ?? 0
    if (prompt + completion > 0) return prompt + completion
  }
  return estimateTokens(content)
}

export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
  // Present only on the final answer of a run: token count + wall-clock time.
  stats?: AgentMessageStats
}

export interface AgentChatState {
  messages: AgentChatMessage[]
  activities: ToolActivity[]
  pendingConfirm: ConfirmRequest | null
  streaming: boolean
  error: string | null
}

interface PersistedAgent {
  messages: AgentChatState['messages']
  activities: ToolActivity[]
}

/**
 * Read the persisted history of one conversation. A missing or corrupt payload
 * reads back as an empty list rather than throwing.
 */
function readPersistedMessages(storageKey: string): AgentChatState['messages'] {
  const parsed = readJson<{ messages?: unknown } | null>(
    storageKey,
    null,
    (raw) => (raw && typeof raw === 'object' ? (raw as { messages?: unknown }) : null),
  )
  if (!parsed) return []
  const messages = parsed.messages
  return Array.isArray(messages) ? (messages as AgentChatState['messages']) : []
}

export function useAgentChat(
  currentNote?: { path: string; content: string },
  storageKey?: string,
  onMutation?: (paths: string[]) => void,
) {
  // Load any persisted conversation from localStorage on init.
  // Messages are restored to keep the dialogue continuous across sessions.
  // Activities are intentionally NOT restored: the activity log is per-session,
  // so each session records its own tool activity without accumulating prior ones.
  const loadedMessages: AgentChatState['messages'] = storageKey
    ? readPersistedMessages(storageKey)
    : []

  const [state, setState] = useState<AgentChatState>({
    messages: loadedMessages,
    activities: [],
    pendingConfirm: null,
    streaming: false,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)
  // Messages kept server-side shaped (with tool_calls) for resuming loops.
  // UI-only `stats` is stripped so it is never echoed to the provider.
  const historyRef = useRef<AgentMessage[]>(
    loadedMessages.map(({ role, content }) => ({ role, content })),
  )
  const confirmQueueRef = useRef<Confirmation[]>([])
  // Wall-clock timing for the current run. A run can be paused waiting for a
  // write confirmation, so elapsed time is accumulated per active segment and
  // the time the user spends deciding is excluded from the reported duration.
  const runStartRef = useRef<number>(0)
  const elapsedRef = useRef<number>(0)
  // Mirror of the committed state. Updating it inside `commit` (rather than
  // waiting for the next render) is what lets two updates in the same tick
  // build on each other, and lets the persistence effect below read the newest
  // value without a second copy that could go stale.
  const stateRef = useRef(state)
  stateRef.current = state

  // The single writer. Every transition goes through here so the mirror and
  // React state can never disagree.
  const commit = useCallback(
    (next: AgentChatState | ((s: AgentChatState) => AgentChatState)) => {
      const value = typeof next === 'function' ? next(stateRef.current) : next
      stateRef.current = value
      setState(value)
    },
    [],
  )

  // Persist only the message history (not the activity log) so conversations
  // survive reloads while each session keeps its own fresh activity log.
  //
  // This is an effect on purpose: writing from inside a state transition made
  // every updater impure (React is free to replay them, e.g. StrictMode) and
  // turned a keystroke of streaming into synchronous localStorage IO.
  useEffect(() => {
    if (!storageKey) return
    // An untouched conversation writes nothing, so opening a chat never leaves
    // an empty entry behind.
    if (state.messages.length === 0) return
    const payload: PersistedAgent = {
      messages: state.messages.slice(-100),
      activities: [],
    }
    writeJson(storageKey, payload)
  }, [state.messages, storageKey])

  const update = useCallback(
    (patch: Partial<AgentChatState>) => {
      commit((s) => ({ ...s, ...patch }))
    },
    [commit],
  )

  const pushActivity = useCallback(
    (activity: Partial<ToolActivity> & { id: string }) => {
      commit((s) => {
        const idx = s.activities.findIndex((a) => a.id === activity.id)
        let next: ToolActivity[]
        if (idx === -1) {
          const full = {
            name: activity.name ?? '',
            args: activity.args ?? {},
            status: activity.status ?? 'running',
            ...activity,
          } as ToolActivity
          next = [...s.activities, full]
        } else {
          next = s.activities.slice()
          next[idx] = { ...next[idx], ...activity }
        }
        return { ...s, activities: next }
      })
    },
    [commit],
  )

  const appendAssistantToken = useCallback(
    (content: string) => {
      commit((s) => {
        const next = s.messages.slice()
        const last = next[next.length - 1]
        if (last && last.role === 'assistant') {
          next[next.length - 1] = { ...last, content: last.content + content }
        } else {
          next.push({ role: 'assistant' as const, content })
        }
        return { ...s, messages: next }
      })
    },
    [commit],
  )

  // Attach the run statistics (tokens + wall-clock duration) to the LAST
  // assistant message, which is the answer the user actually reads. Runs that
  // produced no text (errors, immediate stop) get no statistic row.
  const attachStats = useCallback(
    (usage?: AgentUsage) => {
      const startedAt = runStartRef.current
      if (!startedAt) return
      const durationMs = Math.round(performance.now() - startedAt + elapsedRef.current)
      runStartRef.current = 0
      elapsedRef.current = 0
      commit((s) => {
        let idx = -1
        for (let i = s.messages.length - 1; i >= 0; i--) {
          if (s.messages[i].role === 'assistant') {
            idx = i
            break
          }
        }
        if (idx === -1) return s
        const target = s.messages[idx]
        if (!target.content) return s
        const next = s.messages.slice()
        next[idx] = {
          ...target,
          stats: { tokens: resolveTokens(usage, target.content), durationMs },
        }
        return { ...s, messages: next }
      })
    },
    [commit],
  )

  // The single place an event effect touches React state. `handleAgentEvent`
  // decides *what* must happen; this decides *how*, and is the only part of the
  // event pipeline that is not pure.
  const applyEffect = useCallback(
    (effect: AgentEventEffect) => {
      switch (effect.type) {
        case 'appendToken':
          appendAssistantToken(effect.content)
          break
        case 'pushActivity':
          pushActivity(effect.activity)
          break
        case 'setPendingConfirm':
          update({ pendingConfirm: effect.request })
          break
        case 'setError':
          update({ error: effect.message })
          break
        case 'setStreaming':
          update({ streaming: effect.streaming })
          break
        case 'freezeElapsed':
          if (runStartRef.current) {
            elapsedRef.current += performance.now() - runStartRef.current
            runStartRef.current = 0
          }
          break
        case 'attachStats':
          attachStats(effect.usage)
          break
      }
    },
    [appendAssistantToken, attachStats, pushActivity, update],
  )

  // Core run: sends current history + any queued confirmations.
  const run = useCallback(
    async (userText?: string, mode: 'ask' | 'agent' = 'agent') => {
      if (userText) {
        const userMsg: AgentMessage = { role: 'user', content: userText }
        historyRef.current = [...historyRef.current, userMsg]
        commit((s) => ({
          ...s,
          messages: [...s.messages, { role: 'user' as const, content: userText }],
        }))
      }

      // Ensure an assistant bubble exists for streamed tokens.
      commit((s) =>
        s.messages[s.messages.length - 1]?.role === 'assistant'
          ? s
          : { ...s, messages: [...s.messages, { role: 'assistant' as const, content: '' }] },
      )
      update({ streaming: true, error: null })

      const context = await buildAgentContext(currentNote)
      const confirmations = confirmQueueRef.current
      confirmQueueRef.current = []

      // Everything this run accumulates. Confirmations sent with it already
      // authorize a real disk write, so their paths are seeded as mutations.
      const acc = createRunState(confirmations)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamAgentChat({
          // Sent verbatim: the backend sanitizes the tool-call/tool-result
          // pairing before every provider request (see server/agent/loop.mjs),
          // so repairing it here too would only duplicate that logic.
          messages: historyRef.current,
          context,
          confirmations,
          mode,
          signal: controller.signal,
          onEvent: (ev) => {
            for (const effect of handleAgentEvent(acc, ev)) applyEffect(effect)
          },
        })
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error('[markseek][fe:agent] run threw:', e?.message, e?.cause ? `(cause: ${e.cause?.message || e.cause})` : '', e?.stack ? '\n' + e.stack : '')
          // A failed run produces no usable answer, so discard its timing too.
          runStartRef.current = 0
          elapsedRef.current = 0
          update({ error: e?.message || 'Agent run failed.', streaming: false })
        }
      } finally {
        abortRef.current = null
      }

      // Persist the full, ordered assistant + tool sequence produced by this run
      // into history so the next resume keeps complete context. Each assistant
      // message is stored verbatim (including reasoning_content and tool_calls),
      // which is exactly what thinking models require to be echoed back — this
      // fixes the "reasoning_content must be passed back" 400 on multi-step runs
      // and lets an approved write actually apply.
      if (acc.accumulatedHistory.length) {
        historyRef.current = [...historyRef.current, ...acc.accumulatedHistory]
      }

      // Notify the host about files mutated during this run so it can refresh
      // any open tabs, the file tree, calendar dots, and diary views.
      if (acc.mutationPaths.size && onMutation) {
        onMutation([...acc.mutationPaths])
      }
    },
    [applyEffect, commit, currentNote, update, onMutation],
  )

  const send = useCallback(
    (text: string, mode: 'ask' | 'agent' = 'agent') => {
      const trimmed = text.trim()
      if (!trimmed || state.streaming) return
      // Only clear the pending confirmation; keep the activity history.
      update({ pendingConfirm: null })
      // Start timing the answer so the UI can report its duration.
      runStartRef.current = performance.now()
      elapsedRef.current = 0
      void run(trimmed, mode)
    },
    [run, state.streaming, update],
  )

  // User decides on the pending write.
  const resolveConfirm = useCallback(
    (approved: boolean) => {
      const req = state.pendingConfirm
      if (!req) return
      confirmQueueRef.current.push({
        id: req.id,
        approved,
        op: req.op,
        path: req.path,
        content: req.content,
      })
      update({ pendingConfirm: null })
      // Resume the loop with the decision and time this new segment: the pause
      // spent waiting for the user is intentionally excluded from the duration.
      runStartRef.current = performance.now()
      void run()
    },
    [run, state.pendingConfirm, update],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    // Drop the pending timing segment: a stopped run never reports statistics.
    runStartRef.current = 0
    elapsedRef.current = 0
    update({ streaming: false })
  }, [update])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    historyRef.current = []
    confirmQueueRef.current = []
    if (storageKey) removeRaw(storageKey)
    commit({
      messages: [],
      activities: [],
      pendingConfirm: null,
      streaming: false,
      error: null,
    })
  }, [commit, storageKey])

  return {
    ...state,
    send,
    resolveConfirm,
    stop,
    reset,
  }
}
