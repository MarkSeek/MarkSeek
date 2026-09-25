// Pure reducer for the agent SSE stream.
//
// `useAgentChat` used to hold a ~90-line switch that both advanced the run
// state (accumulated history, mutated paths) and performed React side effects
// (append a token, push an activity row, publish statistics). Mixing the two
// made the subtlest part of the chat untestable without rendering React and
// driving a fake stream through it.
//
// This module does the thinking and returns an ordered list of effects; the
// hook applies them. So the reducer is a pure function of (state, event) and is
// covered directly by src/agent/__tests__/eventReducer.test.ts.
import type {
  AgentMessage,
  AgentStreamEvent,
  AgentUsage,
  ConfirmRequest,
  Confirmation,
  ToolActivity,
} from './types'

/** Write tools whose `path` argument names a note the host must refresh. */
const WRITE_TOOLS = new Set(['create_note', 'write_note', 'append_note'])

/** Confirmation ops that mutate a note. */
const WRITE_OPS = new Set(['create', 'write', 'append'])

/** Everything one run accumulates before it is folded into the history. */
export interface AgentRunState {
  /**
   * Fully-formed assistant + tool messages produced by this run, in server
   * order. Mirroring the server's own sequence (each assistant with its
   * reasoning_content/tool_calls, followed by its tool results) is what lets a
   * thinking model's required reasoning_content survive a resume.
   */
  accumulatedHistory: AgentMessage[]
  /** Notes a write tool touched, so the host can refresh dependent views. */
  mutationPaths: Set<string>
}

/** What the UI has to do in response to one stream event. */
export type AgentEventEffect =
  | { type: 'appendToken'; content: string }
  | { type: 'pushActivity'; activity: Partial<ToolActivity> & { id: string } }
  /**
   * Add a write to the confirmation queue. The model can emit several write
   * calls in a single step, so this queues rather than replaces: dropping all
   * but the last one used to leave the others pending forever in the history.
   */
  | { type: 'queuePendingConfirm'; request: ConfirmRequest }
  | { type: 'setError'; message: string }
  | { type: 'setStreaming'; streaming: boolean }
  /** Freeze the run clock: the answer is paused, not finished. */
  | { type: 'freezeElapsed' }
  /** Publish the run statistics onto the final answer. */
  | { type: 'attachStats'; usage?: AgentUsage }

/**
 * Start a run. Confirmations being sent already authorize a real disk write,
 * so their paths count as mutations even though no tool event will replay.
 */
export function createRunState(confirmations: Confirmation[] = []): AgentRunState {
  const mutationPaths = new Set<string>()
  for (const c of confirmations) {
    if (c.approved && c.path) mutationPaths.add(c.path)
  }
  return { accumulatedHistory: [], mutationPaths }
}

/**
 * Fold one stream event into `state` (mutated) and return the effects the UI
 * must apply, in order.
 */
export function handleAgentEvent(
  state: AgentRunState,
  ev: AgentStreamEvent,
): AgentEventEffect[] {
  switch (ev.type) {
    case 'token':
      return [{ type: 'appendToken', content: ev.content }]

    case 'tool_call': {
      if (WRITE_TOOLS.has(ev.name) && ev.args?.path) {
        state.mutationPaths.add(String(ev.args.path))
      }
      return [
        {
          type: 'pushActivity',
          activity: { id: ev.id, name: ev.name, args: ev.args, status: 'running' },
        },
      ]
    }

    case 'assistant_message':
      // Server-sent full assistant message (reasoning_content + tool_calls),
      // mirrored verbatim so nothing a model requires is dropped on resume.
      if (ev.message) state.accumulatedHistory.push(ev.message)
      return []

    case 'tool_result':
      state.accumulatedHistory.push({
        role: 'tool',
        content: ev.summary,
        tool_call_id: ev.id,
      })
      return [
        { type: 'pushActivity', activity: { id: ev.id, status: 'done', result: ev.summary } },
      ]

    case 'confirm_required': {
      // Record the matching tool message so the assistant's tool_calls always
      // has a responding tool message (required by the provider API).
      state.accumulatedHistory.push({
        role: 'tool',
        content: `Pending confirmation for ${ev.op} on ${ev.path}.`,
        tool_call_id: ev.id,
      })
      if (WRITE_OPS.has(ev.op)) state.mutationPaths.add(ev.path)
      return [
        {
          type: 'queuePendingConfirm',
          request: {
            id: ev.id,
            op: ev.op,
            path: ev.path,
            exists: ev.exists,
            preview: ev.preview,
            content: ev.content,
          },
        },
        { type: 'pushActivity', activity: { id: ev.id, status: 'confirm' } },
      ]
    }

    case 'error':
      return [{ type: 'setError', message: ev.message }]

    case 'log':
      // Informational line (e.g. the search-term expansion) shown in the activity
      // log. Rendered distinctly by ActivityLog via the 'log' status.
      return [
        {
          type: 'pushActivity',
          activity: {
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: '',
            status: 'log',
            result: ev.line,
          },
        },
      ]

    case 'done':
      // A done that still carries tool_calls means the run PAUSED for a write
      // confirmation: the answer is not final, so freeze the elapsed time and
      // wait for the user's decision instead of publishing statistics.
      return ev.assistantMessage?.tool_calls?.length
        ? [{ type: 'freezeElapsed' }, { type: 'setStreaming', streaming: false }]
        : [{ type: 'attachStats', usage: ev.usage }, { type: 'setStreaming', streaming: false }]

    default:
      // 'info' / 'log' are diagnostics with no UI representation.
      return []
  }
}
