import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandQuery, resetExpandCache } from '../queryExpand.mjs'

const cfg = { apiKey: 'k', baseURL: 'https://api.example.com/v1', model: 'm' }

function mockFetchOnce(body) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => body,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetExpandCache()
})

describe('expandQuery', () => {
  it('returns the query verbatim when it is too short (<=2 chars)', async () => {
    expect(await expandQuery('AI', cfg)).toEqual(['AI'])
    expect(await expandQuery('会议', cfg)).toEqual(['会议'])
  })

  it('does not call the provider for short queries', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expandQuery('OK', cfg)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the model and parses a JSON array of terms', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ choices: [{ message: { content: '["search","box","ui"]' } }] }))
    expect(await expandQuery('search box', cfg)).toEqual(['search', 'box', 'ui'])
  })

  it('strips markdown code fences around the JSON', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({ choices: [{ message: { content: '```json\n["a","b"]\n```' } }] }),
    )
    expect(await expandQuery('something long enough', cfg)).toEqual(['a', 'b'])
  })

  it('falls back to the original query when the model returns junk', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ choices: [{ message: { content: 'no json here' } }] }))
    expect(await expandQuery('a reasonably long query', cfg)).toEqual(['a reasonably long query'])
  })

  it('falls back when the provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await expandQuery('a reasonably long query', cfg)).toEqual(['a reasonably long query'])
  })

  it('caps the number of terms', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({ choices: [{ message: { content: '["1","2","3","4","5","6","7","8"]' } }] }),
    )
    const terms = await expandQuery('a reasonably long query here', cfg)
    expect(terms.length).toBeLessThanOrEqual(6)
  })

  it('caches results for the same normalized query', async () => {
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: '["x","y"]' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await expandQuery('Same Query', cfg)
    await expandQuery('same query', cfg)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
