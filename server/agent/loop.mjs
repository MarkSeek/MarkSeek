// Agent module: the tool-calling loop.
// Runs an OpenAI-compatible chat completion with tools, executes tools, feeds
// results back, and streams progress to the client as SSE events. Write tools
// emit a confirm_required event and PAUSE; the loop resumes once the client
// sends the user's decision via /api/agent/confirm.
import { runTool, applyWrite, TOOL_DEFINITIONS } from './tools.mjs'
import { todayString } from '../notes-fs.mjs'
import { resolveProvider, buildCompletionEndpoint } from '../ai/provider.mjs'
import { readSettings } from '../settings.mjs'
import { resolveProxyUrl, maskProxyUrl } from '../proxy.mjs'
import { logError } from '../log.mjs'

const MAX_STEPS = 8

// Read-only subset: only list/search/read. Used by the "ask" mode so the model
// can reason over note content without any ability to create or modify files.
export const READ_ONLY_TOOL_NAMES = ['list_notes', 'search_notes', 'read_note', 'today_journal', 'read_journal']

export function resolveTools(mode) {
  if (mode === 'ask') {
    return TOOL_DEFINITIONS.filter((t) => READ_ONLY_TOOL_NAMES.includes(t.function.name))
  }
  return TOOL_DEFINITIONS
}

// Stream helpers ------------------------------------------------------------

function sse(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sendInfo(res, info) {
  sse(res, 'info', info)
}

function sendToken(res, content) {
  sse(res, 'token', { content })
}

function sendToolCall(res, id, name, args) {
  sse(res, 'tool_call', { id, name, args })
}

function sendToolResult(res, id, summary) {
  sse(res, 'tool_result', { id, summary })
}

function sendConfirm(res, req) {
  sse(res, 'confirm_required', req)
}

function sendError(res, message) {
  sse(res, 'error', { message })
}

function sendDone(res, assistantMsg, usage) {
  // Send the full assistant message (including reasoning_content and tool_calls)
  // so clients can persist it verbatim into history for the next resumed request.
  // `usage` carries the accumulated token count for the whole run (summed over
  // every completion step) so the UI can show a per-answer token statistic.
  sse(res, 'done', { assistantMessage: assistantMsg, usage: usage || undefined })
}

// Build the system prompt ----------------------------------------------------

export function buildSystemPrompt({ treeSummary, currentNote, mode, today }) {
  const readOnly = mode === 'ask'
  const parts = []
  if (readOnly) {
    parts.push(
      'You are MarkSeek Ask, a read-only assistant that answers questions about the user\'s local Markdown notes based strictly on their content.',
    )
  } else {
    parts.push(
      'You are MarkSeek Agent, a helpful assistant that answers questions about the user\'s local Markdown notes and can perform note operations when asked.',
    )
  }
  if (readOnly) {
    parts.push(
      'You have READ-ONLY access. Use the provided tools to search, list, and read notes before answering. You must NEVER create, modify, or write any note — if the user asks for changes, politely explain that you can only read and search notes.',
    )
  } else {
    parts.push(
      'Use the provided tools to search, list, and read notes before answering. When the user asks you to create or modify a note, call the corresponding write tool — the system will ask the user to confirm before anything is saved.',
    )
  }
  if (today) {
    parts.push(
      `Today's date is ${today} (server local time zone).`,
    )
    parts.push(
      'When the user asks about "today", "yesterday", "this week", a specific day, or their journal/diary, you MUST:\n' +
        '1. ANALYZE the target date FIRST from the question (use the date above; convert "yesterday" / "this week" to the exact YYYY-MM-DD date). Do NOT guess.\n' +
        '2. Use ONLY the dedicated tools `today_journal` (for today) or `read_journal` with that exact YYYY-MM-DD date.\n' +
        '3. STRICTLY LIMIT reads to the one date the user asked about. Do NOT call `list_notes`, do NOT call `search_notes`, and do NOT read any other date or unrelated note. Reading extra documents is forbidden — answer from the single targeted journal only.\n' +
        'Example: "open today\'s tasks" → call `today_journal` once and nothing else.',
    )
  }
  if (treeSummary) {
    parts.push('Current note tree:\n' + treeSummary)
  }
  if (currentNote && currentNote.path) {
    parts.push(
      `The user is currently viewing: ${currentNote.path}\nCurrent content:\n${currentNote.content}`,
    )
  }
  parts.push('Always cite the note paths you used. Be concise and factual.')
  return parts.join('\n\n')
}

// Sanitize the message list before sending it to the provider.
// OpenAI-compatible APIs reject a `role: "tool"` message unless it is preceded
// by an assistant message whose `tool_calls` contains a matching `id`. History
// rebuilt across multiple agent runs can drift out of this invariant (e.g. an
// assistant message serialized without its tool_calls, or a tool result
// orphaned by a truncated/merged conversation). We repair it with a
// position-independent pairing plus a final verification pass so the request
// is always valid, even on the 2nd/3rd run when prior tool turns are replayed.
export function sanitizeMessages(messages) {
  // Pass 1: discover every id that appears as a tool result AND every id that
  // appears inside an assistant tool_call. Only ids present in BOTH are valid.
  const toolResultIds = new Set()
  const callIds = new Set()
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) toolResultIds.add(m.tool_call_id)
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) if (c && c.id) callIds.add(c.id)
    }
  }

  // Pass 2: keep only tool_calls whose id has a corresponding tool result, and
  // only tool messages whose id has a corresponding assistant tool_call.
  const paired = []
  for (const m of messages) {
    if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
      if (calls.length) {
        const valid = calls.filter((c) => c && c.id && toolResultIds.has(c.id))
        if (valid.length) m.tool_calls = valid
        else delete m.tool_calls
      }
      paired.push(m)
    } else if (m.role === 'tool') {
      const id = m.tool_call_id
      if (id && toolResultIds.has(id) && callIds.has(id)) paired.push(m)
    } else {
      paired.push(m)
    }
  }

  // Pass 3: de-duplicate tool messages by tool_call_id. The history can hold
  // two tool results for the same call id across runs (a "Pending confirmation"
  // snapshot from confirm_required plus the resolved outcome re-emitted after
  // applyConfirmationsToHistory). A provider rejects a call id with >1 result,
  // so keep only the LAST occurrence for each id.
  const lastToolIndexByCall = new Map()
  paired.forEach((m, i) => {
    if (m.role === 'tool' && m.tool_call_id) lastToolIndexByCall.set(m.tool_call_id, i)
  })

  // Pass 4: final verification mirroring the provider's real rule — a
  // `role: "tool"` message must be immediately preceded (ignoring other tool
  // messages) by an assistant whose `tool_calls` contain its id. Any other
  // message (assistant/user) sitting between the two breaks the invariant.
  const out = []
  for (let i = 0; i < paired.length; i++) {
    const m = paired[i]
    if (m.role === 'tool') {
      const id = m.tool_call_id
      if (id && lastToolIndexByCall.get(id) !== i) continue // skip earlier duplicate
      let parentOk = false
      for (let j = out.length - 1; j >= 0; j--) {
        const p = out[j]
        if (p.role === 'tool') continue
        if (
          p.role === 'assistant' &&
          Array.isArray(p.tool_calls) &&
          p.tool_calls.some((c) => c && c.id === id)
        ) {
          parentOk = true
        }
        break
      }
      if (!parentOk) continue
    }
    out.push(m)
  }
  return out
}

// Fetch one completion step --------------------------------------------------

/**
 * Add one step's token usage into the running totals. Providers report a
 * different subset of fields, so a missing `total_tokens` is derived.
 * @returns {{ totals: object, seen: boolean }} `seen` is false when the chunk
 *   carried no usable numbers (in which case the totals are unchanged).
 */
export function mergeUsage(totals, u) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const prompt = num(u && u.prompt_tokens)
  const completion = num(u && u.completion_tokens)
  const total = num(u && u.total_tokens) || (prompt || completion ? prompt + completion : 0)
  return {
    totals: {
      prompt_tokens: num(totals && totals.prompt_tokens) + prompt,
      completion_tokens: num(totals && totals.completion_tokens) + completion,
      total_tokens: num(totals && totals.total_tokens) + total,
    },
    seen: Boolean(prompt || completion || total),
  }
}

async function fetchCompletion({ apiKey, baseURL, model, messages, stream, tools }) {
  const upstream = buildCompletionEndpoint(baseURL)
  const body = {
    model,
    messages,
    stream: Boolean(stream),
    tools,
    tool_choice: 'auto',
    // Ask OpenAI-compatible providers to append a final chunk carrying token
    // usage. Providers that do not support the field simply ignore it.
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  }
  // Timeout so a blocked outbound connection (e.g. Electron direct mode behind
  // a firewall) does not hang forever with zero output. Surfaces the failure
  // instead of silently dropping the request.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let resp
  try {
    resp = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const cause = e && e.cause ? ` (cause: ${e.cause.message || e.cause})` : ''
    logError(`[markseek][agent] upstream fetch FAILED: ${e && e.message}${cause}`)
    throw e
  }
  clearTimeout(timer)
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    logError(`[markseek][agent] provider error ${resp.status}: ${txt.slice(0, 300)}`)
    throw new Error(`Provider error ${resp.status}: ${txt.slice(0, 300)}`)
  }
  return resp
}

// Parse the SSE completion stream into a final assistant message + tool calls.
// Returns { content, toolCalls, raw }. For non-streaming we still get a single object.
// `onContent` is invoked for every text delta as soon as it arrives, enabling
// true token-by-token streaming to the client (instead of buffering the whole
// answer and replaying it at the end).

export async function consumeCompletionStream(resp, { onContent } = {}) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoningContent = ''
  let toolCalls = [] // { index, id, name, argsBuffer }
  let finishReason = null
  // Token usage for this completion step. OpenAI-compatible providers append it
  // to the final chunk (often with an empty `choices` array) when the request
  // sets `stream_options.include_usage`.
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let json
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      // Read usage BEFORE the choice guard: providers commonly send it in a
      // trailing chunk whose `choices` array is empty.
      if (json.usage) usage = json.usage
      const choice = json.choices && json.choices[0]
      if (!choice) continue
      const delta = choice.delta || {}
      if (delta.content) {
        content += delta.content
        // True streaming: forward this delta to the client immediately.
        if (onContent) onContent(delta.content)
      }
      // Some providers (thinking/reasoner models) emit reasoning_content that
      // MUST be echoed back on the next request, so we capture it here.
      if (delta.reasoning_content) reasoningContent += delta.reasoning_content
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let slot = toolCalls.find((t) => t.index === tc.index)
          if (!slot) {
            slot = { index: tc.index, id: '', name: '', argsBuffer: '' }
            toolCalls.push(slot)
          }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name = tc.function.name
          if (tc.function?.arguments) slot.argsBuffer += tc.function.arguments
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }
  }

  const parsed = toolCalls.map((t) => {
    let args = {}
    try {
      args = t.argsBuffer ? JSON.parse(t.argsBuffer) : {}
    } catch {
      args = {}
    }
    return { id: t.id || `call_${t.index}`, name: t.name, args }
  })

  return { content, reasoningContent, toolCalls: parsed, finishReason, usage }
}

/**
 * Settle a write the user has already decided on. Approved writes are persisted
 * here (this is the ONLY place a decision turns into a file change), declined
 * ones only produce text.
 * @param {{ approved: boolean, op: string, path: string, content?: string }} decision
 * @returns {{ summary: string, content: string }} `summary` is shown to the
 *   user, `content` is what the model sees in the tool result.
 */
export function resolveWriteDecision(decision) {
  if (!decision.approved) {
    return {
      summary: `⨯ user declined ${decision.op} on ${decision.path}`,
      content: 'User declined this write operation.',
    }
  }
  const result = applyWrite(decision)
  const summary = result.ok
    ? `✓ ${decision.op} applied to ${decision.path}`
    : `✗ failed: ${result.error}`
  return { summary, content: summary }
}

// Apply pre-decided confirmations onto tool-result messages in the history.
// For a paused write the history already holds a tool message whose content
// begins with "Pending confirmation". We replace it with the real outcome so
// the model sees an accurate result and can finish the conversation.
export function applyConfirmationsToHistory(fullMessages, pendingConfirmations, res) {
  if (!pendingConfirmations || pendingConfirmations.size === 0) return
  for (const msg of fullMessages) {
    if (msg.role !== 'tool' || !msg.tool_call_id) continue
    const decision = pendingConfirmations.get(msg.tool_call_id)
    if (!decision || !decision.decided) continue
    if (typeof msg.content === 'string' && !msg.content.startsWith('Pending confirmation')) {
      continue // Already resolved earlier.
    }
    const outcome = resolveWriteDecision(decision)
    if (res) sendToolResult(res, msg.tool_call_id, outcome.summary)
    msg.content = outcome.content
  }
}

// The main agent run ---------------------------------------------------------
// `pendingConfirmations` maps a tool-call id -> { approved: boolean, op, path, content }.
// When a write tool pauses, we store its descriptor and continue once resumed.

export async function runAgent({ res, messages, context, confirmations, mode, proxyUrl }) {
  // Read the vault settings once: they carry BOTH the AI provider and the proxy
  // mode. Resolving the proxy from an empty object (as this used to do) silently
  // dropped the user's custom/system proxy and fell back to a direct connection.
  const settings = readSettings()
  const cfg = resolveProvider({ settings })
  if (!cfg) {
    sendError(res, 'No AI provider configured. Add one in Settings.')
    sendDone(res)
    return
  }
  // Surface provider info to the frontend console (F12) so the effective model
  // / baseURL / proxy are visible in one place without opening the main process.
  // The global dispatcher already applies the proxy to fetch; this only reports it.
  sendInfo(res, {
    baseURL: cfg.baseURL,
    model: cfg.model,
    provider: cfg.vendor,
    proxy: maskProxyUrl(resolveProxyUrl(settings, proxyUrl)),
    mode,
  })

  const isAsk = mode === 'ask'

  // Map of previously-paused write tool-call id -> user decision.
  const pendingConfirmations = new Map()
  for (const c of Array.isArray(confirmations) ? confirmations : []) {
    if (c && c.id) {
      pendingConfirmations.set(c.id, {
        decided: true,
        approved: Boolean(c.approved),
        op: c.op,
        path: c.path,
        content: c.content,
      })
    }
  }

  const systemPrompt = buildSystemPrompt({ ...(context || {}), mode, today: todayString() })
  const tools = resolveTools(mode)
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages]

  // Apply any pre-decided confirmations onto the tool-result messages already
  // present in the conversation. This guarantees approved writes are persisted
  // on resume even if the model does not re-invoke the tool.
  applyConfirmationsToHistory(fullMessages, pendingConfirmations, res)

  // Token usage accumulated across every completion step of this run. Multi-step
  // agent loops issue several completions, so the UI needs the sum of all of
  // them to report an honest per-answer token count.
  let usageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let usageSeen = false
  const accumulateUsage = (u) => {
    const merged = mergeUsage(usageTotals, u)
    if (!merged.seen) return
    usageTotals = merged.totals
    usageSeen = true
  }
  const usagePayload = () => (usageSeen ? { ...usageTotals } : undefined)

  let step = 0
  while (step < MAX_STEPS) {
    step++
    let resp
    try {
      resp = await fetchCompletion({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        model: cfg.model,
        // Repair the tool-call/tool-result pairing before every step: history
        // rebuilt across runs can drift out of the provider's invariant.
        messages: sanitizeMessages(fullMessages),
        stream: true,
        tools,
      })
    } catch (e) {
      sendError(res, e.message || 'Failed to reach the AI provider.')
      sendDone(res)
      return
    }

    const { content, reasoningContent, toolCalls, usage } = await consumeCompletionStream(resp, {
      // Push every text delta to the client as it arrives (true streaming).
      onContent: (text) => sendToken(res, text),
    })
    accumulateUsage(usage)

    // Accumulate the assistant message.
    const assistantMsg = { role: 'assistant', content: content || '' }
    // Echo reasoning_content back so providers in thinking mode don't reject the
    // resumed request (they require it to be passed through).
    if (reasoningContent) assistantMsg.reasoning_content = reasoningContent
    if (toolCalls.length) {
      assistantMsg.tool_calls = toolCalls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: JSON.stringify(t.args) },
      }))
    }
    fullMessages.push(assistantMsg)
    // Send the full assistant message (with reasoning_content + tool_calls) so the
    // client can accumulate it into history verbatim — required by thinking models
    // that reject resumed requests missing the echoed reasoning_content.
    sse(res, 'assistant_message', { message: assistantMsg })

    if (!toolCalls.length) {
      // No more tool calls: the answer is final.
      sendDone(res, undefined, usagePayload())
      return
    }

    // Execute each tool call.
    const toolResults = []
    let paused = false
    for (const tc of toolCalls) {
      // In read-only "ask" mode, block any write operation outright.
      if (isAsk && !READ_ONLY_TOOL_NAMES.includes(tc.name)) {
        sendToolCall(res, tc.id, tc.name, tc.args)
        const refusal =
          'Operation blocked: Ask mode is read-only and cannot create or modify notes.'
        sendToolResult(res, tc.id, refusal)
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: refusal })
        continue
      }
      sendToolCall(res, tc.id, tc.name, tc.args)
      const outcome = await runTool(tc.name, tc.args)

      if (outcome.kind === 'confirm_required') {
        // Check if the user already responded to this exact request.
        const prior = pendingConfirmations.get(tc.id)
        if (prior && prior.decided) {
          const settled = resolveWriteDecision(prior)
          sendToolResult(res, tc.id, settled.summary)
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: settled.content })
        } else {
          // Pause and ask the user.
          sendConfirm(res, { id: tc.id, ...outcome.value })
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Pending confirmation for ${outcome.value.op} on ${outcome.value.path}.`,
          })
          paused = true
        }
      } else {
        const summary = String(outcome.value).slice(0, 2000)
        sendToolResult(res, tc.id, summary)
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: summary })
      }
    }

    fullMessages.push(...toolResults)

    // If we paused for confirmation, stop the loop and let the client resume.
    if (paused) {
      sendDone(res, assistantMsg, usagePayload())
      return
    }
  }

  // `assistantMsg` is scoped to the loop body, so it is intentionally not
  // referenced here — the client already received it via `assistant_message`.
  sendError(res, 'Reached maximum agent steps.')
  sendDone(res, undefined, usagePayload())
}
