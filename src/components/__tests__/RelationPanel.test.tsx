import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ openFile: vi.fn() }),
}))
vi.mock('../../hooks/useWikiLinkOpen', () => ({
  useWikiLinkOpen: () => ({ openWikiLink: vi.fn(), pickerNode: null }),
}))

import RelationPanel from '../RelationPanel'

const RESULT = {
  backLinks: [{ path: 'b.md', name: 'b', snippet: '[[a]]' }],
  outLinks: [{ path: 'c.md', name: 'c', kind: 'file' }],
  tags: [{ tag: 'tagX', others: [{ path: 'c.md', name: 'c' }] }],
  tasks: [
    { done: false, text: 'todo one' },
    { done: true, text: 'todo two' },
  ],
}

interface MockOptions {
  // Override the body returned by the relations endpoint (defaults to RESULT).
  relationsBody?: unknown
  // Make the relations endpoint reject instead of resolving.
  relationsError?: Error
}

// The panel issues two requests: POST /api/relations and
// GET /api/sync/file-history. Route them to distinct fixtures so the history
// fetch never inherits the relations shape (which lacks a `history` field).
function mockFetch(opts: MockOptions = {}) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/sync/file-history')) {
      return { ok: true, json: async () => ({ initialized: true, history: [] }) }
    }
    if (opts.relationsError) throw opts.relationsError
    return {
      ok: true,
      json: async () => (opts.relationsBody ?? RESULT),
    }
  }) as unknown as typeof fetch
}

// Locate the (latest) relations call among all fetches (the panel also hits
// file-history, and re-rendering with a new note issues extra relations calls).
function relationsCall(): [string, RequestInit] {
  const calls = (globalThis.fetch as unknown as Mock).mock.calls as [string, RequestInit][]
  const relCalls = calls.filter((c) => String(c[0]).includes('/api/relations'))
  const call = relCalls[relCalls.length - 1]
  if (!call) throw new Error('relations endpoint was never called')
  return call
}

describe('RelationPanel', () => {
  it('asks the backend once and renders what it sends back', async () => {
    mockFetch()
    render(<RelationPanel currentNote={{ path: 'a.md', content: 'live text' }} />)

    await waitFor(() =>
      expect((globalThis.fetch as unknown as Mock).mock.calls).toContainEqual(
        expect.arrayContaining([expect.stringContaining('/api/relations')]),
      ),
    )
    const [url, init] = relationsCall()
    expect(url).toBe('/api/relations')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ path: 'a.md', content: 'live text' })

    expect(await screen.findByText('b')).toBeTruthy()
    expect(await screen.findByText('todo one')).toBeTruthy()
  })

  it('debounces: typing changes the note text without refetching per keystroke', async () => {
    mockFetch()
    const { rerender } = render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)
    rerender(<RelationPanel currentNote={{ path: 'a.md', content: 'v2' }} />)
    rerender(<RelationPanel currentNote={{ path: 'a.md', content: 'v3' }} />)

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as Mock).mock.calls as [string, RequestInit][]
      const relCalls = calls.filter((c) => String(c[0]).includes('/api/relations'))
      expect(relCalls).toHaveLength(1)
    })
    expect(JSON.parse(String(relationsCall()[1].body)).content).toBe('v3')
  })

  it('refetches when a different note is opened', async () => {
    mockFetch()
    const { rerender } = render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as Mock).mock.calls as [string, RequestInit][]
      expect(calls.filter((c) => String(c[0]).includes('/api/relations'))).toHaveLength(1)
    })

    rerender(<RelationPanel currentNote={{ path: 'b.md', content: 'other' }} />)
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as Mock).mock.calls as [string, RequestInit][]
      expect(calls.filter((c) => String(c[0]).includes('/api/relations'))).toHaveLength(2)
    })
    expect(JSON.parse(String(relationsCall()[1].body)).path).toBe('b.md')
  })

  it('survives a failed request instead of emptying the panel', async () => {
    mockFetch({ relationsError: new Error('network down') })
    render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as Mock).mock.calls as [string, RequestInit][]
      expect(calls.some((c) => String(c[0]).includes('/api/relations'))).toBe(true)
    })
    // The chrome bar still names the open note; no crash, no thrown error.
    expect(screen.getByTitle('a.md')).toBeTruthy()
  })

  it('renders the empty state when there is no open note', async () => {
    mockFetch()
    render(<RelationPanel />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
