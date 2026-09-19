// Session restore for a single tab. The rule this guards is simple but easy to
// break: a picture must never be read as text, because the bytes would land in
// the tab content (and could later be written back over the file).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from '../../../api/files'
import { buildRestoredTab } from '../buildRestoredTab'

vi.mock('../../../api/files', () => ({ readFile: vi.fn() }))

const readFileMock = vi.mocked(readFile)

beforeEach(() => {
  readFileMock.mockResolvedValue('')
})

describe('buildRestoredTab', () => {
  it('re-reads a note from disk', async () => {
    readFileMock.mockResolvedValue('# hello')

    const tab = await buildRestoredTab({ id: 'notes/a.md', path: 'notes/a.md' })

    expect(readFileMock).toHaveBeenCalledWith('notes/a.md')
    expect(tab).toMatchObject({ id: 'notes/a.md', name: 'a', content: '# hello', kind: 'file' })
  })

  it('restores a picture without touching the disk', async () => {
    const tab = await buildRestoredTab({
      id: 'images/shot.png',
      path: 'images/shot.png',
      kind: 'image',
    })

    expect(readFileMock).not.toHaveBeenCalled()
    expect(tab).toEqual({
      id: 'images/shot.png',
      name: 'shot.png',
      path: 'images/shot.png',
      content: '',
      dirty: false,
      kind: 'image',
    })
  })

  it('still recognises a picture when the snapshot lost its kind', async () => {
    const tab = await buildRestoredTab({ id: 'images/shot.webp', path: 'images/shot.webp' })

    expect(readFileMock).not.toHaveBeenCalled()
    expect(tab?.kind).toBe('image')
  })
})
