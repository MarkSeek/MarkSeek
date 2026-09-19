// Frontend agent module: API client + context helpers.
import { parseAgentStream } from './sse'
import type {
  AgentContext,
  AgentMessage,
  AgentStreamEvent,
  Confirmation,
} from './types'

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
  // Frontend-side timeout so a silent backend (e.g. Electron direct mode where
  // the upstream fetch hangs forever) does not leave the UI with zero feedback.
  // 35s > backend 30s window; if it throws we surface the cause in the console.
  const timeoutSignal = AbortSignal.timeout(35000)
  const controller = signal ? chainAbort(signal, timeoutSignal) : timeoutSignal
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
    onEvent({ type: 'error', message: 'Backend request failed: ' + (e?.message || 'unknown error') })
    onEvent({ type: 'done' })
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
    return
  }

  await parseAgentStream(response, onEvent)
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
