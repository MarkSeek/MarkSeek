// Direct unit tests for the agent stream reducer.
//
// These cover the branch that useAgentChat.test.ts can only reach by rendering
// React and replaying a fake stream: which messages end up in the resume
// history, which paths count as mutations, and when a run is finished versus
// merely paused.
import { describe, expect, it } from 'vitest'
import { createRunState, handleAgentEvent } from '../eventReducer'
import type { AgentStreamEvent } from '../types'

/** Run a sequence of events through one accumulator, collecting the effects. */
function fold(events: AgentStreamEvent[], confirmations = []) {
  const state = createRunState(confirmations)
  const effects = events.flatMap((ev) => handleAgentEvent(state, ev))
  return { state, effects }
}

describe('createRunState', () => {
  it('seeds the paths an already-approved confirmation will write', () => {
    const state = createRunState([{ id: 'c1', approved: true, op: 'write', path: 'a.md', content: 'x' }])
    expect([...state.mutationPaths]).toEqual(['a.md'])
  })

  it('does not treat a declined confirmation as a mutation', () => {
    const state = createRunState([{ id: 'c1', approved: false, op: 'write', path: 'a.md', content: 'x' }])
    expect(state.mutationPaths.size).toBe(0)
  })

  it('starts empty with no confirmations', () => {
    expect(createRunState()).toEqual({ accumulatedHistory: [], mutationPaths: new Set() })
  })
})

describe('handleAgentEvent: tokens and activities', () => {
  it('emits one append effect per token', () => {
    const { effects } = fold([
      { type: 'token', content: 'a' },
      { type: 'token', content: 'b' },
    ])
    expect(effects).toEqual([
      { type: 'appendToken', content: 'a' },
      { type: 'appendToken', content: 'b' },
    ])
  })

  it('opens a tool activity as running', () => {
    const { effects } = fold([
      { type: 'tool_call', id: 'c1', name: 'read_note', args: { path: 'a.md' } },
    ])
    expect(effects).toEqual([
      {
        type: 'pushActivity',
        activity: { id: 'c1', name: 'read_note', args: { path: 'a.md' }, status: 'running' },
      },
    ])
  })

  it('closes the same activity row when the result arrives', () => {
    const { effects } = fold([
      { type: 'tool_call', id: 'c1', name: 'read_note', args: {} },
      { type: 'tool_result', id: 'c1', summary: 'ok' },
    ])
    expect(effects).toHaveLength(2)
    // Same id, so `pushActivity` updates the row instead of adding one.
    expect(effects[1]).toEqual({
      type: 'pushActivity',
      activity: { id: 'c1', status: 'done', result: 'ok' },
    })
  })

  it('ignores diagnostics that have no UI representation', () => {
    const { state, effects } = fold([
      { type: 'info', baseURL: 'https://x', model: 'm' },
      { type: 'log', line: 'noise' },
    ])
    expect(effects).toEqual([])
    expect(state.accumulatedHistory).toEqual([])
  })
})

describe('handleAgentEvent: mutation tracking', () => {
  it('records the path of every write tool', () => {
    const { state } = fold([
      { type: 'tool_call', id: 'c1', name: 'write_note', args: { path: 'a.md' } },
      { type: 'tool_call', id: 'c2', name: 'append_note', args: { path: 'b.md' } },
      { type: 'tool_call', id: 'c3', name: 'create_note', args: { path: 'c.md' } },
    ])
    expect([...state.mutationPaths].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('does not record read-only tools', () => {
    const { state } = fold([
      { type: 'tool_call', id: 'c1', name: 'search_notes', args: { q: 'x' } },
      // A write tool with no path has nothing to refresh.
      { type: 'tool_call', id: 'c2', name: 'write_note', args: {} },
    ])
    expect(state.mutationPaths.size).toBe(0)
  })

  it('records a write that is still awaiting confirmation', () => {
    const { state } = fold([
      { type: 'confirm_required', id: 'c1', op: 'create', path: 'new.md', exists: false, preview: '', content: '' },
    ])
    expect([...state.mutationPaths]).toEqual(['new.md'])
  })

  it('counts a path only once, however many times it is written', () => {
    const { state } = fold([
      { type: 'tool_call', id: 'c1', name: 'write_note', args: { path: 'a.md' } },
      { type: 'tool_call', id: 'c2', name: 'write_note', args: { path: 'a.md' } },
    ])
    expect([...state.mutationPaths]).toEqual(['a.md'])
  })
})

describe('handleAgentEvent: resume history', () => {
  it('mirrors assistant and tool messages in server order', () => {
    const assistant = { role: 'assistant' as const, content: '', reasoning_content: 'think' }
    const { state } = fold([
      { type: 'assistant_message', message: assistant },
      { type: 'tool_result', id: 'c1', summary: 'done' },
      { type: 'assistant_message', message: { role: 'assistant', content: 'final' } },
    ])
    expect(state.accumulatedHistory).toEqual([
      assistant,
      { role: 'tool', content: 'done', tool_call_id: 'c1' },
      { role: 'assistant', content: 'final' },
    ])
  })

  it('keeps reasoning_content verbatim, which thinking models require back', () => {
    const message = { role: 'assistant' as const, content: '', reasoning_content: 'step 1' }
    const { state } = fold([{ type: 'assistant_message', message }])
    expect(state.accumulatedHistory[0].reasoning_content).toBe('step 1')
  })

  it('answers every pending tool call with a tool message', () => {
    // Dropping this message is what used to make the provider reject the next
    // request with "tool_call_id not found".
    const { state } = fold([
      { type: 'confirm_required', id: 'c1', op: 'write', path: 'a.md', exists: true, preview: '', content: '' },
    ])
    expect(state.accumulatedHistory).toEqual([
      { role: 'tool', content: 'Pending confirmation for write on a.md.', tool_call_id: 'c1' },
    ])
  })

  it('skips an assistant_message event that carries no message', () => {
    const { state } = fold([{ type: 'assistant_message', message: undefined as never }])
    expect(state.accumulatedHistory).toEqual([])
  })
})

describe('handleAgentEvent: confirmation', () => {
  it('surfaces the request and marks the activity row', () => {
    const { effects } = fold([
      { type: 'confirm_required', id: 'c1', op: 'write', path: 'a.md', exists: true, preview: 'diff', content: 'new' },
    ])
    expect(effects).toEqual([
      {
        type: 'setPendingConfirm',
        request: {
          id: 'c1',
          op: 'write',
          path: 'a.md',
          exists: true,
          preview: 'diff',
          content: 'new',
        },
      },
      { type: 'pushActivity', activity: { id: 'c1', status: 'confirm' } },
    ])
  })
})

describe('handleAgentEvent: run termination', () => {
  it('publishes statistics on a finished answer', () => {
    const { effects } = fold([{ type: 'done', usage: { total_tokens: 42 } }])
    expect(effects).toEqual([
      { type: 'attachStats', usage: { total_tokens: 42 } },
      { type: 'setStreaming', streaming: false },
    ])
  })

  it('freezes the clock instead when the run paused for a confirmation', () => {
    const { effects } = fold([
      {
        type: 'done',
        assistantMessage: {
          role: 'assistant',
          content: 'partial',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_note', arguments: '{}' } }],
        },
      },
    ])
    expect(effects).toEqual([
      { type: 'freezeElapsed' },
      { type: 'setStreaming', streaming: false },
    ])
  })

  it('treats a done with an empty tool_calls list as finished', () => {
    const { effects } = fold([
      { type: 'done', assistantMessage: { role: 'assistant', content: 'x', tool_calls: [] } },
    ])
    expect(effects[0].type).toBe('attachStats')
  })

  it('reports an error without ending the stream', () => {
    // The backend always follows an error with a done, so stopping here would
    // be redundant — and would hide the still-running state if it did not.
    const { effects } = fold([{ type: 'error', message: 'boom' }])
    expect(effects).toEqual([{ type: 'setError', message: 'boom' }])
  })
})
