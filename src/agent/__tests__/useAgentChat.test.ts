// Agent chat behaviour, with the streaming backend replaced by a stub and the
// real localStorage underneath — so the persistence contract is exercised for
// real instead of asserted through a mock.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAgentContext, streamAgentChat } from '../api'
import type { AgentStreamEvent } from '../types'
import { estimateTokens, useAgentChat } from '../useAgentChat'

vi.mock('../api', () => ({
  buildAgentContext: vi.fn(async () => ({})),
  streamAgentChat: vi.fn(async () => {}),
}))

const streamAgentChatMock = vi.mocked(streamAgentChat)

const KEY = 'markseek.test.agent'

type StreamParams = Parameters<typeof streamAgentChat>[0]

/** The arguments of the most recent run, so events can be replayed into it. */
function stream(): StreamParams {
  const call = streamAgentChatMock.mock.calls.at(-1)?.[0]
  if (!call) throw new Error('streamAgentChat was never called')
  return call
}

interface Persisted {
  messages: Array<{ role: string; content: string }>
  activities: unknown[]
}

function persisted(): Persisted | null {
  const raw = localStorage.getItem(KEY)
  return raw ? (JSON.parse(raw) as Persisted) : null
}

async function send(text: string) {
  const view = renderHook(() => useAgentChat(undefined, KEY))
  await act(async () => {
    view.result.current.send(text)
  })
  return view
}

async function emit(events: AgentStreamEvent[]) {
  await act(async () => {
    for (const ev of events) stream().onEvent(ev)
  })
}

const buildAgentContextMock = vi.mocked(buildAgentContext)

// The stream stays open until a test closes it, so events can be replayed
// while the run is still in flight — that is the state the real SSE is in.
let closeStream: (() => void) | null = null

beforeEach(() => {
  streamAgentChatMock.mockClear()
  streamAgentChatMock.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        closeStream = resolve
      }),
  )
  buildAgentContextMock.mockResolvedValue({})
  // A failing run logs the error; keep it out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/** Let the in-flight run finish, which is when the run reports mutations. */
async function endStream() {
  await act(async () => {
    closeStream?.()
    closeStream = null
    await Promise.resolve()
  })
}

describe('estimateTokens', () => {
  it('returns zero for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('never returns less than one token for real text', () => {
    expect(estimateTokens('a')).toBe(1)
  })

  it('weights CJK characters higher than latin ones', () => {
    const latin = estimateTokens('a'.repeat(400))
    const cjk = estimateTokens('中'.repeat(400))
    expect(cjk).toBeGreaterThan(latin)
  })
})

describe('useAgentChat outgoing history', () => {
  it('forwards the accumulated history verbatim — sanitizing is the backend’s job', async () => {
    // server/agent/loop.mjs repairs the tool-call/tool-result pairing before
    // every provider request, so the hook must forward what it accumulated and
    // must NOT drop or re-shape anything (including an unpaired tool result).
    const call = { id: 'c1', type: 'function' as const, function: { name: 'x', arguments: '{}' } }
    const view = await send('hi')
    await emit([
      {
        type: 'assistant_message',
        message: { role: 'assistant', content: '', tool_calls: [call] },
      },
      { type: 'tool_result', id: 'c1', summary: 'pending' },
      { type: 'done', assistantMessage: { role: 'assistant', content: '', tool_calls: [call] } },
    ])
    await endStream()

    await act(async () => {
      view.result.current.send('again')
    })

    const sent = streamAgentChatMock.mock.calls.at(-1)?.[0].messages ?? []
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user'])
    expect(sent[1].tool_calls).toHaveLength(1)
    expect(sent[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: 'pending' })
  })
})

describe('useAgentChat persistence', () => {
  it('reopens the persisted conversation', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ messages: [{ role: 'user', content: 'earlier' }], activities: [] }),
    )

    const { result } = renderHook(() => useAgentChat(undefined, KEY))

    expect(result.current.messages).toEqual([{ role: 'user', content: 'earlier' }])
  })

  it('writes nothing for a conversation that was never used', () => {
    renderHook(() => useAgentChat(undefined, KEY))

    expect(persisted()).toBeNull()
  })

  it('writes nothing at all when no storage key is configured', () => {
    const { result } = renderHook(() => useAgentChat(undefined, undefined))

    expect(result.current.messages).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  it('persists the user message as soon as it is sent', async () => {
    const { result } = await send('hello')

    expect(result.current.messages[0]).toEqual({ role: 'user', content: 'hello' })
    expect(persisted()?.messages.map((m) => m.content)).toEqual(['hello', ''])
  })

  it('persists the streamed answer, not just the question', async () => {
    const view = await send('hello')

    await emit([{ type: 'token', content: 'Hi' }, { type: 'token', content: ' there' }])

    expect(view.result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Hi there',
    })
    expect(persisted()?.messages.map((m) => m.content)).toEqual(['hello', 'Hi there'])
  })

  it('keeps only the last 100 messages', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }))
    localStorage.setItem(KEY, JSON.stringify({ messages: many, activities: [] }))

    const view = await send('one more')

    // The in-memory conversation keeps everything; only what is written to
    // disk is trimmed to the last 100 turns.
    expect(persisted()?.messages).toHaveLength(100)
    expect(persisted()?.messages.at(-1)).toMatchObject({ content: '' })
    expect(view.result.current.messages).toHaveLength(122)
  })

  it('clears the stored conversation on reset', async () => {
    const view = await send('hello')

    await act(async () => {
      view.result.current.reset()
    })

    expect(view.result.current.messages).toEqual([])
    expect(persisted()).toBeNull()
  })
})

describe('useAgentChat run lifecycle', () => {
  it('opens the run with a user bubble and an empty assistant bubble', async () => {
    const view = await send('hello')

    expect(view.result.current.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
    ])
    expect(view.result.current.streaming).toBe(true)
  })

  it('reuses the trailing assistant bubble instead of stacking new ones', async () => {
    const view = await send('hello')

    await emit([{ type: 'token', content: 'a' }, { type: 'token', content: 'b' }])

    expect(view.result.current.messages).toHaveLength(2)
    expect(view.result.current.messages[1].content).toBe('ab')
  })

  it('tracks a tool call from running to done', async () => {
    const view = await send('hello')

    await emit([{ type: 'tool_call', id: 'c1', name: 'read_note', args: { path: 'a.md' } }])
    expect(view.result.current.activities).toEqual([
      { id: 'c1', name: 'read_note', args: { path: 'a.md' }, status: 'running' },
    ])

    await emit([{ type: 'tool_result', id: 'c1', summary: 'done reading' }])
    // One row per tool call: the result updates the row instead of adding one.
    expect(view.result.current.activities).toEqual([
      {
        id: 'c1',
        name: 'read_note',
        args: { path: 'a.md' },
        status: 'done',
        result: 'done reading',
      },
    ])
  })

  it('attaches the run statistics to the final answer', async () => {
    const view = await send('hello')

    await emit([
      { type: 'token', content: 'an answer' },
      { type: 'done', usage: { total_tokens: 42 } },
    ])

    expect(view.result.current.messages.at(-1)?.stats).toMatchObject({ tokens: 42 })
    expect(view.result.current.streaming).toBe(false)
  })

  it('publishes no statistics when the run paused for a confirmation', async () => {
    const view = await send('hello')

    await emit([
      { type: 'token', content: 'partial' },
      {
        type: 'done',
        assistantMessage: {
          role: 'assistant',
          content: 'partial',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'write_note', arguments: '{}' } },
          ],
        },
      },
    ])

    // The answer is not final yet, so the timing is frozen instead of published.
    expect(view.result.current.messages.at(-1)?.stats).toBeUndefined()
  })

  it('surfaces a pending write and clears it once the user decides', async () => {
    const view = await send('hello')

    await emit([
      {
        type: 'confirm_required',
        id: 'c1',
        op: 'write',
        path: 'a.md',
        exists: true,
        preview: '',
        content: 'new',
      },
    ])

    expect(view.result.current.pendingConfirm).toMatchObject({ id: 'c1', path: 'a.md' })

    await act(async () => {
      view.result.current.resolveConfirm(true)
    })

    expect(view.result.current.pendingConfirm).toBeNull()
    expect(stream().confirmations).toEqual([
      { id: 'c1', approved: true, op: 'write', path: 'a.md', content: 'new' },
    ])
  })

  it('reports an error and stops streaming when the run fails', async () => {
    streamAgentChatMock.mockRejectedValueOnce(new Error('boom'))
    const view = renderHook(() => useAgentChat(undefined, KEY))

    await act(async () => {
      view.result.current.send('hello')
    })

    expect(view.result.current.error).toBe('boom')
    expect(view.result.current.streaming).toBe(false)
  })

  it('aborts the in-flight request on stop', async () => {
    const view = await send('hello')

    act(() => view.result.current.stop())

    const signal = stream().signal
    if (!signal) throw new Error('the run did not pass an abort signal')
    expect(signal.aborted).toBe(true)
    expect(view.result.current.streaming).toBe(false)
  })

  it('ignores a send while a run is already streaming', async () => {
    const view = await send('first')

    await act(async () => {
      view.result.current.send('second')
    })

    expect(streamAgentChatMock).toHaveBeenCalledTimes(1)
    expect(view.result.current.messages.map((m) => m.content)).toEqual(['first', ''])
  })

  it('notifies the host about notes mutated by write tools', async () => {
    const onMutation = vi.fn()
    const view = renderHook(() => useAgentChat(undefined, KEY, onMutation))
    await act(async () => {
      view.result.current.send('hello')
    })

    await emit([{ type: 'tool_call', id: 'c1', name: 'write_note', args: { path: 'notes/a.md' } }])
    // Reported when the run ends, not while it is still streaming.
    expect(onMutation).not.toHaveBeenCalled()

    await emit([{ type: 'done' }])
    await endStream()

    expect(onMutation).toHaveBeenCalledWith(['notes/a.md'])
  })
})
