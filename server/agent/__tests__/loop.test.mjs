import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadableStream } from 'node:stream/web'
import path from 'node:path'
import {
  buildSystemPrompt,
  sanitizeMessages,
  resolveTools,
  READ_ONLY_TOOL_NAMES,
  mergeUsage,
  consumeCompletionStream,
  applyConfirmationsToHistory,
  resolveWriteDecision,
  runAgent,
} from '../loop.mjs'
import { setVaultDir, resetVaultDir } from '../../vault.mjs'
import { setLogDir } from '../../log.mjs'
import { fakeRes, parseSse } from '../../__tests__/helpers/http.mjs'
import { makeTmpVault, writeVaultFile, readVaultFile, cleanupTmpVaults } from '../../__tests__/helpers/tmp-vault.mjs'
import { writeSettings } from '../../settings.mjs'
import { setAppDataDir } from '../../appdata.mjs'

afterAll(cleanupTmpVaults)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build a minimal streaming Response object from raw SSE text chunks. */
function sseResponse(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]))
      else controller.close()
    },
  })
  return { ok: true, status: 200, body: stream }
}

function deltaChunk(delta, extra = '') {
  return `data: ${JSON.stringify({ choices: [{ delta, ...extra }] })}\n\n`
}

function toolCallChunk(index, id, name, args) {
  return (
    'data: ' +
    JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] } }],
    }) +
    '\n\n'
  )
}

const TOOL_CALL_STREAM = [toolCallChunk(0, 'call_1', 'list_notes', '{}'), 'data: [DONE]\n\n']
const FINAL_STREAM = [
  deltaChunk({ content: 'found ' }),
  deltaChunk({ content: 'one note' }),
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
  'data: [DONE]\n\n',
]

/**
 * Queue one fake upstream response per agent step. A fresh stream is built for
 * every call because a ReadableStream body can only be read once.
 * The last entry is reused once the queue is exhausted.
 * @param {string[][]} responses array of SSE chunk arrays
 */
function stubFetch(responses) {
  const queue = [...responses]
  const spy = vi.fn(async () => sseResponse(queue.length > 1 ? queue.shift() : queue[0]))
  vi.stubGlobal('fetch', spy)
  return spy
}

/** A temp vault that is also bound as the active vault root. */
function activeVault() {
  const root = makeTmpVault()
  setVaultDir(root)
  return root
}

function configuredVault(files = {}) {
  const root = makeTmpVault({
    'Projects/ideas.md': '# Ideas\n',
    ...files,
  })
  setVaultDir(root)
  setLogDir(path.join(root, 'logs'))
  setAppDataDir(root)
  writeSettings({ aiApiKey: 'sk-test', aiModel: 'test-model' })
  return root
}

beforeEach(() => {
  const v = makeTmpVault()
  setVaultDir(v)
  setAppDataDir(v)
  setLogDir(path.join(v, 'logs'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetVaultDir()
})

// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('uses the read-only persona in ask mode', () => {
    const prompt = buildSystemPrompt({ mode: 'ask' })
    expect(prompt).toContain('MarkSeek Ask')
    expect(prompt).toContain('READ-ONLY access')
    expect(prompt).not.toContain('MarkSeek Agent')
  })

  it('uses the full agent persona otherwise', () => {
    const prompt = buildSystemPrompt({ mode: 'agent' })
    expect(prompt).toContain('MarkSeek Agent')
    expect(prompt).toContain('confirm')
    expect(prompt).not.toContain('READ-ONLY access')
  })

  it('defaults to the agent persona when mode is undefined', () => {
    expect(buildSystemPrompt({})).toContain('MarkSeek Agent')
  })

  it('injects today only when provided', () => {
    expect(buildSystemPrompt({ mode: 'ask' })).not.toContain("Today's date is")
    expect(buildSystemPrompt({ mode: 'ask', today: '2026-03-01' })).toContain(
      "Today's date is 2026-03-01 (server local time zone).",
    )
  })

  it('adds the journal-reading rules alongside today', () => {
    const prompt = buildSystemPrompt({ mode: 'ask', today: '2026-03-01' })
    expect(prompt).toContain('today_journal')
    expect(prompt).toContain('STRICTLY LIMIT reads')
  })

  it('appends the note tree and the currently open note', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      treeSummary: '📄 a.md',
      currentNote: { path: 'a.md', content: 'body' },
    })
    expect(prompt).toContain('Current note tree:\n📄 a.md')
    expect(prompt).toContain('The user is currently viewing: a.md')
    expect(prompt).toContain('body')
  })

  it('ignores a current note without a path', () => {
    expect(buildSystemPrompt({ mode: 'agent', currentNote: { content: 'x' } })).not.toContain(
      'currently viewing',
    )
  })

  it('renders the referenced-notes block for mentions', () => {
    const prompt = buildSystemPrompt({
      mode: 'ask',
      mentions: [
        { path: 'notes/a.md', content: 'alpha' },
        { path: 'notes/b.md', content: 'beta' },
      ],
    })
    expect(prompt).toContain('explicitly referenced these notes')
    expect(prompt).toContain('### notes/a.md')
    expect(prompt).toContain('alpha')
    expect(prompt).toContain('### notes/b.md')
    expect(prompt).toContain('beta')
  })

  it('omits the mentions block when none are provided', () => {
    expect(buildSystemPrompt({ mode: 'ask' })).not.toContain(
      'explicitly referenced these notes',
    )
  })

  it('always ends with the citation rule', () => {
    expect(buildSystemPrompt({ mode: 'ask' }).trim().endsWith('Always cite the note paths you used. Be concise and factual.')).toBe(
      true,
    )
  })
})

describe('sanitizeMessages', () => {
  it('keeps a well-formed tool round trip', () => {
    const messages = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ]
    expect(sanitizeMessages(messages)).toHaveLength(3)
  })

  it('drops a tool result that has no matching assistant tool_call', () => {
    const messages = [
      { role: 'user', content: 'q' },
      { role: 'tool', tool_call_id: 'orphan', content: 'r' },
    ]
    const out = sanitizeMessages(messages)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('strips tool_calls that never received a result', () => {
    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ]
    const out = sanitizeMessages(messages)
    expect(out[0].tool_calls).toEqual([{ id: 'c1' }])
  })

  it('removes the tool_calls key entirely when nothing is paired', () => {
    const messages = [
      { role: 'assistant', content: 'a', tool_calls: [{ id: 'c1' }] },
      { role: 'user', content: 'follow up' },
    ]
    const out = sanitizeMessages(messages)
    expect(out[0]).toEqual({ role: 'assistant', content: 'a' })
    expect('tool_calls' in out[0]).toBe(false)
  })

  it('keeps only the last duplicated tool result for a call id', () => {
    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'first' },
      { role: 'tool', tool_call_id: 'c1', content: 'second' },
    ]
    const out = sanitizeMessages(messages)
    expect(out.filter((m) => m.role === 'tool')).toHaveLength(1)
    expect(out[1].content).toBe('second')
  })

  it('drops a tool result separated from its assistant call by another message', () => {
    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'user', content: 'interruption' },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ]
    const out = sanitizeMessages(messages)
    expect(out.map((m) => m.role)).toEqual(['assistant', 'user'])
  })

  it('keeps consecutive tool results for a multi-call assistant message', () => {
    const messages = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r1' },
      { role: 'tool', tool_call_id: 'c2', content: 'r2' },
    ]
    expect(sanitizeMessages(messages)).toHaveLength(3)
  })

  it('returns [] for empty input', () => {
    expect(sanitizeMessages([])).toEqual([])
  })
})

describe('resolveTools', () => {
  it('restricts ask mode to the read-only subset', () => {
    const names = resolveTools('ask').map((t) => t.function.name)
    expect(names).toEqual(READ_ONLY_TOOL_NAMES)
    expect(names).not.toContain('write_note')
  })

  it('exposes every tool in agent mode', () => {
    const names = resolveTools('agent').map((t) => t.function.name)
    expect(names).toContain('write_note')
    expect(names).toContain('append_note')
    expect(names.length).toBeGreaterThan(READ_ONLY_TOOL_NAMES.length)
  })

  it('defaults to the full tool set', () => {
    expect(resolveTools().length).toBe(resolveTools('agent').length)
  })
})

describe('mergeUsage', () => {
  const empty = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

  it('accumulates across steps', () => {
    const first = mergeUsage(empty, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
    expect(first.totals).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
    expect(first.seen).toBe(true)
    const second = mergeUsage(first.totals, { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 })
    expect(second.totals).toEqual({ prompt_tokens: 14, completion_tokens: 6, total_tokens: 20 })
  })

  it('derives total_tokens when the provider omits it', () => {
    expect(mergeUsage(empty, { prompt_tokens: 3, completion_tokens: 4 }).totals).toEqual({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    })
  })

  it('ignores garbage numbers', () => {
    expect(mergeUsage(empty, { prompt_tokens: 'x', completion_tokens: null }).totals).toEqual(empty)
  })

  it('reports seen: false when the chunk carries no usage', () => {
    expect(mergeUsage(empty, undefined).seen).toBe(false)
    expect(mergeUsage(empty, {}).seen).toBe(false)
    expect(mergeUsage(empty, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }).seen).toBe(false)
  })

  it('does not mutate the passed totals', () => {
    mergeUsage(empty, { prompt_tokens: 1, completion_tokens: 1 })
    expect(empty).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  })
})

describe('consumeCompletionStream', () => {
  it('concatenates content deltas and forwards them live', async () => {
    const seen = []
    const result = await consumeCompletionStream(sseResponse(['data: {"choices":[{"delta":{"content":"he"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n', 'data: [DONE]\n\n']), {
      onContent: (t) => seen.push(t),
    })
    expect(result.content).toBe('hello')
    expect(seen).toEqual(['he', 'llo'])
  })

  it('buffers tool-call arguments split across chunks', async () => {
    const result = await consumeCompletionStream(
      sseResponse([
        toolCallChunk(0, 'call_1', 'read_note', '{"path":'),
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.md\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'read_note', args: { path: 'a.md' } }])
  })

  it('keeps several tool calls apart by index', async () => {
    const result = await consumeCompletionStream(
      sseResponse([
        toolCallChunk(0, 'call_1', 'list_notes', '{}'),
        toolCallChunk(1, 'call_2', 'read_note', '{"path":"a.md"}'),
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.toolCalls.map((t) => t.name)).toEqual(['list_notes', 'read_note'])
  })

  it('falls back to {} when the arguments are not valid JSON', async () => {
    const result = await consumeCompletionStream(
      sseResponse([toolCallChunk(0, 'call_1', 'read_note', '{oops'), 'data: [DONE]\n\n']),
    )
    expect(result.toolCalls[0].args).toEqual({})
  })

  it('captures usage sent in a trailing chunk with no choices', async () => {
    const result = await consumeCompletionStream(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.usage).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 })
  })

  it('captures reasoning_content and the finish reason', async () => {
    const result = await consumeCompletionStream(
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    expect(result.reasoningContent).toBe('think')
    expect(result.finishReason).toBe('stop')
  })

  it('ignores malformed JSON and non-data lines', async () => {
    const result = await consumeCompletionStream(
      sseResponse(['data: {not json}\n\n', 'event: ping\n\n', 'data: [DONE]\n\n']),
    )
    expect(result.content).toBe('')
    expect(result.toolCalls).toEqual([])
  })

  it('handles a chunk boundary falling mid-frame', async () => {
    const result = await consumeCompletionStream(
      sseResponse(['data: {"choices":[{"del', 'ta":{"content":"split"}}]}\n\n', 'data: [DONE]\n\n']),
    )
    expect(result.content).toBe('split')
  })
})

describe('applyConfirmationsToHistory', () => {
  it('writes an approved operation and rewrites the tool result', () => {
    const root = activeVault()
    const messages = [
      { role: 'tool', tool_call_id: 'c1', content: 'Pending confirmation for write on a.md.' },
    ]
    const pending = new Map([
      ['c1', { decided: true, approved: true, op: 'write', path: 'a.md', content: 'body' }],
    ])
    const written = []
    applyConfirmationsToHistory(messages, pending, { write: (s) => written.push(s) })
    expect(readVaultFile(root, 'a.md')).toBe('body')
    expect(messages[0].content).toBe('✓ write applied to a.md')
    expect(written.join('')).toContain('✓ write applied to a.md')
  })

  it('records a declined operation without touching disk', () => {
    const root = activeVault()
    const messages = [
      { role: 'tool', tool_call_id: 'c1', content: 'Pending confirmation for write on a.md.' },
    ]
    const pending = new Map([
      ['c1', { decided: true, approved: false, op: 'write', path: 'a.md', content: 'body' }],
    ])
    applyConfirmationsToHistory(messages, pending, { write: () => {} })
    expect(messages[0].content).toBe('User declined this write operation.')
    expect(() => readVaultFile(root, 'a.md')).toThrow()
  })

  it('leaves already-resolved results alone', () => {
    const messages = [{ role: 'tool', tool_call_id: 'c1', content: '✓ write applied to a.md' }]
    const pending = new Map([
      ['c1', { decided: true, approved: true, op: 'write', path: 'a.md', content: 'other' }],
    ])
    applyConfirmationsToHistory(messages, pending, { write: () => {} })
    expect(messages[0].content).toBe('✓ write applied to a.md')
  })

  it('is a no-op without pending confirmations', () => {
    const messages = [{ role: 'tool', tool_call_id: 'c1', content: 'Pending confirmation' }]
    applyConfirmationsToHistory(messages, new Map(), { write: () => {} })
    expect(messages[0].content).toBe('Pending confirmation')
  })

  it('works without a response object', () => {
    const root = activeVault()
    const messages = [{ role: 'tool', tool_call_id: 'c1', content: 'Pending confirmation' }]
    applyConfirmationsToHistory(
      messages,
      new Map([['c1', { decided: true, approved: true, op: 'write', path: 'a.md', content: 'x' }]]),
      undefined,
    )
    expect(readVaultFile(root, 'a.md')).toBe('x')
  })
})

describe('runAgent', () => {
  it('reports a missing provider instead of calling the network', async () => {
    setVaultDir(makeTmpVault())
    const fetchSpy = stubFetch([[deltaChunk({ content: 'x' })]])
    const res = fakeRes()
    await runAgent({ res, messages: [{ role: 'user', content: 'hi' }], confirmations: [], mode: 'agent' })
    const frames = parseSse(res)
    expect(frames.find((f) => f.event === 'error').data.message).toMatch(/No AI provider configured/)
    expect(frames.at(-1).event).toBe('done')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs a tool call then answers', async () => {
    const root = configuredVault()
    const fetchSpy = stubFetch([TOOL_CALL_STREAM, FINAL_STREAM])
    const res = fakeRes()
    await runAgent({
      res,
      messages: [{ role: 'user', content: 'what notes do I have?' }],
      confirmations: [],
      mode: 'agent',
    })

    const frames = parseSse(res)
    const events = frames.map((f) => f.event)
    expect(events).toContain('info')
    expect(events).toContain('tool_call')
    expect(events).toContain('tool_result')
    expect(events).toContain('token')
    expect(events).not.toContain('error')

    const info = frames.find((f) => f.event === 'info').data
    expect(info).toMatchObject({ model: 'test-model', mode: 'agent' })

    const call = frames.find((f) => f.event === 'tool_call').data
    expect(call.name).toBe('list_notes')

    const toolResult = frames.find((f) => f.event === 'tool_result').data
    expect(toolResult.summary).toContain('Projects/ideas.md')

    expect(frames.filter((f) => f.event === 'token').map((f) => f.data.content).join('')).toBe(
      'found one note',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(root).toBeTruthy()
  })

  it('reports the proxy resolved from the vault settings', async () => {
    // Regression: the proxy used to be resolved from an empty object, so a
    // user-configured custom/system proxy was silently ignored by the agent.
    const root = makeTmpVault()
    setVaultDir(root)
    setLogDir(path.join(root, 'logs'))
    setAppDataDir(root)
    writeSettings({
      aiApiKey: 'sk-test',
      aiModel: 'test-model',
      proxyMode: 'custom',
      proxyUrl: 'http://user:pass@127.0.0.1:7890',
    })
    stubFetch([[deltaChunk({ content: 'hi' }), 'data: [DONE]\n\n']])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const info = parseSse(res).find((f) => f.event === 'info').data
    expect(info.proxy).toBe('http://***@127.0.0.1:7890/')
  })

  it('reports a direct connection when the vault has no proxy', async () => {
    configuredVault()
    stubFetch([[deltaChunk({ content: 'hi' }), 'data: [DONE]\n\n']])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    expect(parseSse(res).find((f) => f.event === 'info').data.proxy).toBe('(direct)')
  })

  it('reports accumulated usage in the done event', async () => {
    configuredVault()
    stubFetch([TOOL_CALL_STREAM, FINAL_STREAM])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const done = parseSse(res).find((f) => f.event === 'done')
    expect(done.data.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    })
  })

  it('blocks write tools in ask mode', async () => {
    configuredVault()
    stubFetch([
      [toolCallChunk(0, 'call_1', 'create_note', '{"path":"x.md","content":"c"}'), 'data: [DONE]\n\n'],
      [deltaChunk({ content: 'cannot do that' }), 'data: [DONE]\n\n'],
    ])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'ask' })
    const frames = parseSse(res)
    const refusal = frames.find((f) => f.event === 'tool_result').data.summary
    expect(refusal).toContain('Ask mode is read-only')
    expect(frames.some((f) => f.event === 'confirm_required')).toBe(false)
  })

  it('pauses for confirmation and does not write before approval', async () => {
    const root = configuredVault()
    stubFetch([
      [
        toolCallChunk(0, 'call_1', 'create_note', JSON.stringify({ path: 'x.md', content: 'body' })),
        'data: [DONE]\n\n',
      ],
    ])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const frames = parseSse(res)
    expect(frames.some((f) => f.event === 'confirm_required')).toBe(true)
    expect(frames.at(-1).data.assistantMessage).toBeTruthy()
    expect(() => readVaultFile(root, 'x.md')).toThrow()
  })

  it('applies the write when the run resumes with an approval', async () => {
    const root = configuredVault()
    stubFetch([[deltaChunk({ content: 'done' }), 'data: [DONE]\n\n']])
    const res = fakeRes()
    await runAgent({
      res,
      messages: [
        { role: 'user', content: 'create it' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'create_note', arguments: JSON.stringify({ path: 'x.md', content: 'body' }) },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'Pending confirmation for write on x.md.' },
      ],
      confirmations: [{ id: 'call_1', approved: true, op: 'write', path: 'x.md', content: 'body' }],
      mode: 'agent',
    })
    expect(readVaultFile(root, 'x.md')).toBe('body')
    const results = parseSse(res).filter((f) => f.event === 'tool_result').map((f) => f.data.summary)
    expect(results.some((s) => s.includes('✓ write applied to x.md'))).toBe(true)
  })

  it('leaves the vault untouched when the write is declined', async () => {
    const root = configuredVault()
    stubFetch([[deltaChunk({ content: 'ok' }), 'data: [DONE]\n\n']])
    const res = fakeRes()
    await runAgent({
      res,
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'create_note', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'Pending confirmation for write on x.md.' },
      ],
      confirmations: [{ id: 'call_1', approved: false, op: 'write', path: 'x.md', content: 'body' }],
      mode: 'agent',
    })
    expect(() => readVaultFile(root, 'x.md')).toThrow()
    const results = parseSse(res).filter((f) => f.event === 'tool_result').map((f) => f.data.summary)
    expect(results.some((s) => s.includes('user declined write on x.md'))).toBe(true)
  })

  it('sends an error event when the upstream request fails', async () => {
    configuredVault()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const frames = parseSse(res)
    expect(frames.find((f) => f.event === 'error').data.message).toContain('ECONNREFUSED')
    expect(frames.at(-1).event).toBe('done')
  })

  it('gives up after the maximum number of steps', async () => {
    configuredVault()
    const fetchSpy = stubFetch([TOOL_CALL_STREAM])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const frames = parseSse(res)
    expect(frames.find((f) => f.event === 'error').data.message).toBe(
      'Reached maximum agent steps.',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(32)
  })

  it('streams the assistant message including its tool calls', async () => {
    configuredVault()
    stubFetch([TOOL_CALL_STREAM, FINAL_STREAM])
    const res = fakeRes()
    await runAgent({ res, messages: [], confirmations: [], mode: 'agent' })
    const assistantFrames = parseSse(res).filter((f) => f.event === 'assistant_message')
    expect(assistantFrames[0].data.message.tool_calls).toHaveLength(1)
    expect(assistantFrames[0].data.message.tool_calls[0].function.name).toBe('list_notes')
  })
})
