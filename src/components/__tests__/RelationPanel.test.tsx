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

function mockFetch(impl: () => Promise<unknown>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
}

function lastCall() {
  const calls = (globalThis.fetch as unknown as Mock).mock.calls
  return calls[calls.length - 1]
}

describe('RelationPanel', () => {
  it('asks the backend once and renders what it sends back', async () => {
    mockFetch(async () => ({ ok: true, json: async () => RESULT }))
    render(<RelationPanel currentNote={{ path: 'a.md', content: 'live text' }} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = lastCall()
    expect(url).toBe('/api/relations')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ path: 'a.md', content: 'live text' })

    expect(await screen.findByText('b')).toBeTruthy()
    expect(await screen.findByText('todo one')).toBeTruthy()
  })

  it('debounces: typing changes the note text without refetching per keystroke', async () => {
    mockFetch(async () => ({ ok: true, json: async () => RESULT }))
    const { rerender } = render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)
    rerender(<RelationPanel currentNote={{ path: 'a.md', content: 'v2' }} />)
    rerender(<RelationPanel currentNote={{ path: 'a.md', content: 'v3' }} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(lastCall()[1].body).content).toBe('v3')
  })

  it('refetches when a different note is opened', async () => {
    mockFetch(async () => ({ ok: true, json: async () => RESULT }))
    const { rerender } = render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))

    rerender(<RelationPanel currentNote={{ path: 'b.md', content: 'other' }} />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(lastCall()[1].body).path).toBe('b.md')
  })

  it('survives a failed request instead of emptying the panel', async () => {
    mockFetch(async () => {
      throw new Error('network down')
    })
    render(<RelationPanel currentNote={{ path: 'a.md', content: 'v1' }} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    // The chrome bar still names the open note; no crash, no thrown error.
    expect(screen.getByTitle('a.md')).toBeTruthy()
  })

  it('renders the empty state when there is no open note', async () => {
    mockFetch(async () => ({ ok: true, json: async () => RESULT }))
    render(<RelationPanel />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
