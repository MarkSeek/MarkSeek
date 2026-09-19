import { describe, expect, it } from 'vitest'
import { parseAgentStream } from '../sse'
import type { AgentStreamEvent } from '../types'

function frame(event: string, data: unknown, terminated = true): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n${terminated ? '\n' : ''}`
}

function responseOf(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return { body: stream } as unknown as Response
}

async function run(chunks: string[]): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  await parseAgentStream(responseOf(chunks), (event) => events.push(event))
  return events
}

describe('parseAgentStream', () => {
  it('parses token frames', async () => {
    expect(await run([frame('token', { content: 'hi' })])).toEqual([{ type: 'token', content: 'hi' }])
  })

  it('defaults missing tool_call args to an empty object', async () => {
    expect(await run([frame('tool_call', { id: 'c1', name: 'read_file' })])).toEqual([
      { type: 'tool_call', id: 'c1', name: 'read_file', args: {} },
    ])
  })

  it('parses tool_result frames', async () => {
    expect(await run([frame('tool_result', { id: 'c1', summary: 'done' })])).toEqual([
      { type: 'tool_result', id: 'c1', summary: 'done' },
    ])
  })

  it('parses confirm_required frames', async () => {
    const events = await run([
      frame('confirm_required', { id: 'c1', op: 'write', path: 'a.md', exists: true, preview: 'p' }),
    ])
    expect(events[0]).toEqual({
      type: 'confirm_required',
      id: 'c1',
      op: 'write',
      path: 'a.md',
      exists: true,
      preview: 'p',
      content: '',
    })
  })

  it('parses info, log and assistant_message frames', async () => {
    const events = await run([
      frame('info', { baseURL: 'https://api.example.com', model: 'gpt' }),
      frame('log', { line: 'booting' }),
      frame('assistant_message', { message: { role: 'assistant', content: 'hi' } }),
    ])
    expect(events).toEqual([
      { type: 'info', baseURL: 'https://api.example.com', model: 'gpt' },
      { type: 'log', line: 'booting' },
      { type: 'assistant_message', message: { role: 'assistant', content: 'hi' } },
    ])
  })

  it('normalizes partial usage and drops an empty usage object', async () => {
    const events = await run([
      frame('done', { assistantMessage: null, usage: { total_tokens: 12 } }),
      frame('done', { usage: { prompt_tokens: null, completion_tokens: 'x' } }),
    ])
    expect(events[0]).toEqual({ type: 'done', assistantMessage: null, usage: { total_tokens: 12 } })
    expect(events[1]).toEqual({ type: 'done', assistantMessage: undefined, usage: undefined })
  })

  it('parses error frames with a fallback message', async () => {
    expect(await run([frame('error', {})])).toEqual([{ type: 'error', message: 'Unknown error' }])
  })

  it('ignores unknown event names', async () => {
    expect(await run([frame('heartbeat', { at: 1 })])).toEqual([])
  })

  it('emits an error event when the response has no body', async () => {
    const events: AgentStreamEvent[] = []
    await parseAgentStream({ body: null } as unknown as Response, (e) => events.push(e))
    expect(events).toEqual([{ type: 'error', message: 'No response body.' }])
  })

  it('reassembles blocks split across chunk boundaries', async () => {
    const block = frame('token', { content: 'split' })
    const events = await run([block.slice(0, 8), block.slice(8)])
    expect(events).toEqual([{ type: 'token', content: 'split' }])
  })

  it('flushes a trailing block that is not followed by a blank line', async () => {
    expect(await run([frame('token', { content: 'tail' }, false)])).toEqual([
      { type: 'token', content: 'tail' },
    ])
  })

  it('keeps event order for a mixed stream', async () => {
    const events = await run([
      frame('token', { content: 'a' }),
      frame('tool_call', { id: '1', name: 'ls', args: { path: '.' } }),
      frame('tool_result', { id: '1', summary: 'ok' }),
      frame('done', { usage: { total_tokens: 3 } }),
    ])
    expect(events.map((e) => e.type)).toEqual(['token', 'tool_call', 'tool_result', 'done'])
  })
})
