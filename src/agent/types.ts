// Frontend agent module: shared types for the note agent.

export type AgentRole = 'user' | 'assistant' | 'system'

export interface AgentMessage {
  role: AgentRole | 'tool'
  content: string
  // Echoed back from thinking/reasoner models; MUST be passed through on resume.
  reasoning_content?: string
  // Present on assistant messages that requested tool calls.
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  // Present on tool-result messages; links back to the assistant tool_call id.
  tool_call_id?: string
}

// A single tool-call activity shown in the UI log.
export interface ToolActivity {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'confirm' | 'error' | 'log'
}

// A pending write that needs user confirmation.
export interface ConfirmRequest {
  id: string
  op: 'create' | 'write' | 'append'
  path: string
  exists: boolean
  preview: string
  content: string
}

// Streaming events pushed by the backend SSE.
export type AgentStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; summary: string }
  | { type: 'confirm_required'; id: string; op: 'create' | 'write' | 'append'; path: string; exists: boolean; preview: string; content: string }
  | { type: 'assistant_message'; message: AgentMessage }
  | { type: 'info'; baseURL: string; model: string; provider?: string; proxy?: string; mode?: string }
  | { type: 'log'; line: string }
  | {
      type: 'done'
      assistantMessage?: AgentMessage
      // Token usage reported by the provider for the whole run. Absent when the
      // provider does not expose usage on a streaming response.
      usage?: AgentUsage
    }
  | { type: 'error'; message: string }

// Token usage for one agent run, summed over every completion step.
export interface AgentUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

// Per-answer statistics rendered under the assistant message.
export interface AgentMessageStats {
  tokens: number
  durationMs: number
}

// Context attached to each run (file tree + current note).
export interface AgentContext {
  treeSummary?: string
  currentNote?: { path: string; content: string }
}

// A user decision on a previously-paused write.
export interface Confirmation {
  id: string
  approved: boolean
  op: 'create' | 'write' | 'append'
  path: string
  content: string
}
