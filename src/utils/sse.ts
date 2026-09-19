/**
 * SSE (Server-Sent Events) streaming parser.
 * Compatible with the OpenAI-style `data: {json}` chunks, ending on `data: [DONE]`.
 * Reused by the frontend AI calls (streamChat, Milkdown backend proxy) to avoid duplicate implementations.
 */

export interface ParseSSEOptions {
  signal?: AbortSignal
}

/**
 * Parse an SSE response body, yielding tokens one by one.
 * Empty lines and unparsable lines are skipped automatically; iteration ends on `[DONE]`.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array> | null,
  options: ParseSSEOptions = {},
): AsyncGenerator<string, void, unknown> {
  const reader = body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const token = json.choices?.[0]?.delta?.content
          if (token) yield token
        } catch {
          // skip unparsable lines
        }
      }
    }
  } finally {
    if (options.signal?.aborted) {
      // the caller controls cancellation via AbortController; nothing extra to do here
    }
  }
}
