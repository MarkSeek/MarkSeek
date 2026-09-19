import { describe, expect, it } from 'vitest'
import { fileIconName, isExcalidrawFile } from '../fileIcon'

describe('isExcalidrawFile', () => {
  it('matches both on-disk flavours of a canvas note', () => {
    expect(isExcalidrawFile('draw/sketch.excalidraw')).toBe(true)
    expect(isExcalidrawFile('draw/sketch.excalidraw.md')).toBe(true)
  })

  it('ignores case and unrelated notes', () => {
    expect(isExcalidrawFile('draw/Sketch.EXCALIDRAW')).toBe(true)
    expect(isExcalidrawFile('draw/sketch.md')).toBe(false)
    expect(isExcalidrawFile('draw/excalidraw')).toBe(false)
  })
})

describe('fileIconName', () => {
  it('picks the canvas icon before anything else', () => {
    expect(fileIconName('draw/sketch.excalidraw')).toBe('excalidraw')
    expect(fileIconName('draw/sketch.excalidraw.md')).toBe('excalidraw')
  })

  it('picks the picture icon for images and the file icon elsewhere', () => {
    expect(fileIconName('images/shot.png')).toBe('image')
    expect(fileIconName('notes/idea.md')).toBe('file')
  })
})
