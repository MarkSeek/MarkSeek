import { describe, expect, it } from 'vitest'
import { parseSSE } from '../sse'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

async function collect(chunks: string[]): Promise<string[]> {
  const out: string[] = []
  for await (const token of parseSSE(streamOf(chunks))) out.push(token)
  return out
}

describe('parseSSE', () => {
  it('yields the delta content of every data frame', async () => {
    expect(await collect([delta('Hel'), delta('lo')])).toEqual(['Hel', 'lo'])
  })

  it('reassembles frames split across chunk boundaries', async () => {
    const frame = delta('streamed')
    const cut = Math.floor(frame.length / 2)
    expect(await collect([frame.slice(0, cut), frame.slice(cut)])).toEqual(['streamed'])
  })

  it('stops at [DONE] and drops whatever follows', async () => {
    const tokens = await collect([delta('a'), 'data: [DONE]\n\n', delta('b')])
    expect(tokens).toEqual(['a'])
  })

  it('skips blank lines, comments and unparsable frames', async () => {
    const tokens = await collect(['\n', ': ping\n\n', 'data: not-json\n\n', delta('ok')])
    expect(tokens).toEqual(['ok'])
  })

  it('skips frames without a text delta', async () => {
    const emptyDelta = 'data: {"choices":[{"delta":{"content":""}}]}\n\n'
    const noDelta = 'data: {"choices":[{}]}\n\n'
    expect(await collect([emptyDelta, noDelta, delta('kept')])).toEqual(['kept'])
  })

  it('yields nothing when the response has no body', async () => {
    expect(await collect([])).toEqual([])
    const out: string[] = []
    for await (const token of parseSSE(null)) out.push(token)
    expect(out).toEqual([])
  })
})
