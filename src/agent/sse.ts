// Frontend agent module: parse the agent SSE stream.
// The agent endpoint emits custom event names (token / tool_call /
// tool_result / confirm_required / done / error). This parser yields
// structured AgentStreamEvent objects.
import type { AgentStreamEvent, AgentUsage } from './types'

// Providers disagree on which usage fields they report, so normalize to
// numbers and drop the object entirely when nothing usable is present.
function parseUsage(raw: unknown): AgentUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const prompt = num(src.prompt_tokens)
  const completion = num(src.completion_tokens)
  const total = num(src.total_tokens)
  if (prompt === undefined && completion === undefined && total === undefined) {
    return undefined
  }
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total }
}

/**
 * Read a streaming Response body and invoke onEvent for each parsed event.
 * Unknown events are ignored. The function resolves when the stream ends.
 *
 * `options.onActivity` fires for every chunk that carried bytes. The caller
 * uses it to re-arm its idle timeout: an agent run legitimately lasts minutes,
 * so the deadline must be "no progress for N seconds" rather than "N seconds
 * total" (an absolute deadline used to kill long runs mid-answer).
 */
export async function parseAgentStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
  options: { onActivity?: () => void } = {},
): Promise<void> {
  if (!response.body) {
    onEvent({ type: 'error', message: 'No response body.' })
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) bytes += value.byteLength
    if (value) options.onActivity?.()
    buffer += decoder.decode(value, { stream: true })

    // Split into SSE blocks separated by a blank line.
    let sepIndex: number
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      const event = parseBlock(block)
      if (event) {
        onEvent(event)
      }
    }
  }

  // Flush any trailing block.
  const tail = buffer.trim()
  if (tail) {
    const event = parseBlock(tail)
    if (event) {
      onEvent(event)
    }
  }
}

function parseBlock(block: string): AgentStreamEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (!dataLines.length) return null
  const raw = dataLines.join('\n')
  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }

  switch (eventName) {
    case 'token':
      return { type: 'token', content: String(payload.content ?? '') }
    case 'tool_call':
      return {
        type: 'tool_call',
        id: String(payload.id ?? ''),
        name: String(payload.name ?? ''),
        args: payload.args ?? {},
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        id: String(payload.id ?? ''),
        summary: String(payload.summary ?? ''),
      }
    case 'confirm_required':
      return {
        type: 'confirm_required',
        id: String(payload.id ?? ''),
        op: payload.op,
        path: String(payload.path ?? ''),
        exists: Boolean(payload.exists),
        preview: String(payload.preview ?? ''),
        content: String(payload.content ?? ''),
      }
    case 'assistant_message':
      return { type: 'assistant_message', message: payload.message }
    case 'info':
      return {
        type: 'info',
        baseURL: String(payload.baseURL ?? ''),
        model: String(payload.model ?? ''),
        provider: payload.provider ? String(payload.provider) : undefined,
        proxy: payload.proxy ? String(payload.proxy) : undefined,
        mode: payload.mode ? String(payload.mode) : undefined,
      }
    case 'log':
      return { type: 'log', line: String(payload.line ?? '') }
    case 'done':
      return {
        type: 'done',
        assistantMessage: payload.assistantMessage,
        usage: parseUsage(payload.usage),
      }
    case 'error':
      return { type: 'error', message: String(payload.message ?? 'Unknown error') }
    default:
      return null
  }
}
