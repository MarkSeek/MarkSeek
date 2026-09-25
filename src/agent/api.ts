// Frontend agent module: API client + context helpers.
import { parseAgentStream } from './sse'
import { t } from '../i18n'
import type {
  AgentContext,
  AgentMessage,
  AgentStreamEvent,
  Confirmation,
} from './types'

// Two budgets instead of one absolute deadline:
//   connect — how long we wait for the first byte (headers + first event);
//   idle    — how long the stream may go silent once it is flowing.
// A multi-step agent run legitimately lasts minutes, so the old single 35s
// deadline aborted the body mid-answer: the UI got a truncated reply and, worse,
// never left the streaming state because an abort is not an error.
const CONNECT_TIMEOUT_MS = 30_000
const IDLE_TIMEOUT_MS = 60_000

interface StreamTimeout {
  signal: AbortSignal
  /** Call whenever bytes arrive: re-arms the (longer) idle budget. */
  activity: () => void
  /** Stop the timer: the stream ended or was superseded. */
  finish: () => void
}

/**
 * Abort signal driven by inactivity rather than by total elapsed time.
 * `onTimeout` runs just before the abort so the caller can publish an error
 * event through the normal channel instead of losing it in a rejected promise.
 */
function createStreamTimeout(onTimeout: (phase: 'connect' | 'idle') => void): StreamTimeout {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let phase: 'connect' | 'idle' = 'connect'

  const arm = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(
      () => {
        onTimeout(phase)
        controller.abort()
      },
      phase === 'connect' ? CONNECT_TIMEOUT_MS : IDLE_TIMEOUT_MS,
    )
  }

  arm()

  return {
    signal: controller.signal,
    activity: () => {
      // The first byte ends the connect phase; from here on only silence kills.
      phase = 'idle'
      arm()
    },
    finish: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * Stream an agent run from POST /api/agent/chat.
 * `confirmations` carries the user's decisions for any previously-paused writes
 * so the backend loop can resume and apply approved changes.
 */
export async function streamAgentChat(params: {
  messages: AgentMessage[]
  context: AgentContext
  confirmations?: Confirmation[]
  mode?: 'ask' | 'agent'
  signal?: AbortSignal
  onEvent: (event: AgentStreamEvent) => void
}): Promise<void> {
  const { messages, context, confirmations, mode, signal, onEvent } = params
  // Bounded waiting so a silent backend (e.g. Electron direct mode where the
  // upstream fetch hangs forever) never leaves the UI with zero feedback — but
  // bounded per gap, not for the whole run.
  const timeout = createStreamTimeout((phase) => {
    onEvent({
      type: 'error',
      message: phase === 'connect' ? t('chat.errorConnectTimeout') : t('chat.errorIdleTimeout'),
    })
    onEvent({ type: 'done' })
  })
  const controller = signal ? chainAbort(signal, timeout.signal) : timeout.signal
  let response: Response
  try {
    response = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        context,
        confirmations: confirmations ?? [],
        mode: mode ?? 'agent',
      }),
      signal: controller,
    })
  } catch (e: any) {
    console.error('[markseek][fe:agent] fetch FAILED:', e?.message, e?.cause ? `(cause: ${e.cause?.message || e.cause})` : '')
    // A user-initiated abort is not a failure: stay silent and let the hook
    // simply settle the run.
    if (e?.name !== 'AbortError') {
      onEvent({ type: 'error', message: t('chat.error') + (e?.message || '') })
      onEvent({ type: 'done' })
    }
    timeout.finish()
    return
  }

  if (!response.ok) {
    let msg = `Agent request failed (${response.status}).`
    try {
      const j = await response.json()
      if (j?.message) msg = j.message
    } catch {
      /* ignore */
    }
    console.error('[markseek][fe:agent] non-ok response:', msg)
    onEvent({ type: 'error', message: msg })
    onEvent({ type: 'done' })
    timeout.finish()
    return
  }

  // Headers arrived: switch from the connect budget to the idle budget.
  timeout.activity()
  try {
    await parseAgentStream(response, onEvent, { onActivity: timeout.activity })
  } finally {
    timeout.finish()
  }
}

// Combine an external AbortSignal with an internal timeout signal: abort when
// either fires.
function chainAbort(external: AbortSignal, internal: AbortSignal): AbortSignal {
  const es = new AbortController()
  external.addEventListener('abort', () => es.abort(external.reason))
  internal.addEventListener('abort', () => es.abort(internal.reason))
  return es.signal
}

/**
 * Build the lightweight context object sent with each run.
 * Reuses the existing file API so the agent always reflects the live tree.
 */
export async function buildAgentContext(currentNote?: {
  path: string
  content: string
}): Promise<AgentContext> {
  const context: AgentContext = {}
  try {
    const tree = await fetch('/api/files/list').then((r) => r.json())
    context.treeSummary = renderTree(tree)
  } catch {
    context.treeSummary = '(unable to read note tree)'
  }
  if (currentNote && currentNote.path) {
    context.currentNote = {
      path: currentNote.path,
      content:
        currentNote.content.length > 6000
          ? currentNote.content.slice(0, 6000) + '\n…[truncated]'
          : currentNote.content,
    }
  }
  return context
}

function renderTree(nodes: any[]): string {
  if (!Array.isArray(nodes)) return ''
  const lines: string[] = []
  const walk = (items: any[], depth: number) => {
    for (const n of items) {
      const indent = '  '.repeat(depth)
      if (n.type === 'folder') {
        lines.push(`${indent}${n.name}/`)
        if (Array.isArray(n.children)) walk(n.children, depth + 1)
      } else {
        lines.push(`${indent}${n.id}`)
      }
    }
  }
  walk(nodes, 0)
  return lines.join('\n')
}
