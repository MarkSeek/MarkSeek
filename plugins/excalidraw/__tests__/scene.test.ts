import { describe, expect, it } from 'vitest'
import {
  followsThemeBackground,
  isCanvasFile,
  isRawCanvasFile,
  parseCanvasDoc,
  parseScene,
  sceneWithThemeCanvas,
  serializeCanvasDoc,
  THEME_BG_KEY,
  THEME_CANVAS_BG,
  writeThemeBackground,
} from '../scene'

describe('isCanvasFile', () => {
  it('recognises canvas notes', () => {
    expect(isCanvasFile('sketch.excalidraw.md')).toBe(true)
    expect(isCanvasFile('a/b/Sketch.EXCALIDRAW.MD')).toBe(true)
    expect(isCanvasFile('sketch.excalidraw')).toBe(true)
  })

  it('leaves ordinary notes to the editor', () => {
    expect(isCanvasFile('note.md')).toBe(false)
    expect(isCanvasFile('__diary__')).toBe(false)
  })
})

describe('isRawCanvasFile', () => {
  it('treats bare .excalidraw files as raw JSON', () => {
    expect(isRawCanvasFile('sketch.excalidraw')).toBe(true)
    expect(isRawCanvasFile('a/b/Sketch.EXCALIDRAW')).toBe(true)
  })

  it('does not flag .excalidraw.md notes as raw', () => {
    expect(isRawCanvasFile('sketch.excalidraw.md')).toBe(false)
    expect(isRawCanvasFile('note.md')).toBe(false)
  })
})

describe('parseCanvasDoc', () => {
  it('splits a note into its text and its drawing', () => {
    const doc = parseCanvasDoc('# Title\n\n```excalidraw\n{"type":"excalidraw"}\n```\n\ntail\n')
    expect(doc.prefix).toBe('# Title')
    expect(doc.scene).toBe('{"type":"excalidraw"}')
    expect(doc.suffix).toBe('tail')
  })

  it('treats a note without a fence as text with an empty drawing', () => {
    const doc = parseCanvasDoc('# Title\n')
    expect(doc).toEqual({ prefix: '# Title', scene: '', suffix: '' })
  })
})

describe('serializeCanvasDoc', () => {
  it('round-trips a note and keeps the text around the drawing', () => {
    const md = '# Title\n\n```excalidraw\n{"type":"excalidraw"}\n```\n\ntail\n'
    const doc = parseCanvasDoc(md)
    const next = serializeCanvasDoc({ ...doc, scene: '{"type":"excalidraw","v":2}' })
    expect(parseCanvasDoc(next)).toEqual({
      prefix: '# Title',
      scene: '{"type":"excalidraw","v":2}',
      suffix: 'tail',
    })
  })

  it('appends a fence to a note that has none', () => {
    const doc = parseCanvasDoc('# Title\n')
    expect(serializeCanvasDoc({ ...doc, scene: '{}' })).toBe('# Title\n\n```excalidraw\n{}\n```\n')
  })
})

describe('raw .excalidraw files', () => {
  it('parses the whole file as the scene JSON', () => {
    const doc = parseCanvasDoc('{"type":"excalidraw","elements":[]}', true)
    expect(doc).toEqual({ prefix: '', scene: '{"type":"excalidraw","elements":[]}', suffix: '' })
  })

  it('serializes the whole file as the scene JSON (no fence)', () => {
    const doc = parseCanvasDoc('', true)
    expect(serializeCanvasDoc({ ...doc, scene: '{"type":"excalidraw"}' }, true)).toBe(
      '{"type":"excalidraw"}',
    )
  })

  it('round-trips without introducing Markdown', () => {
    const raw = '{"type":"excalidraw","version":2}'
    const doc = parseCanvasDoc(raw, true)
    expect(serializeCanvasDoc(doc, true)).toBe(raw)
  })
})

describe('parseScene', () => {
  it('parses a scene', () => {
    expect(parseScene('{"type":"excalidraw"}')).toEqual({ type: 'excalidraw' })
  })

  it('returns null instead of throwing on malformed scenes', () => {
    expect(parseScene('')).toBeNull()
    expect(parseScene('not json')).toBeNull()
    expect(parseScene('"a string"')).toBeNull()
  })
})

describe('followsThemeBackground', () => {
  it('follows the theme until the drawing claims a background of its own', () => {
    expect(followsThemeBackground(null)).toBe(true)
    expect(followsThemeBackground({ type: 'excalidraw' })).toBe(true)
    expect(followsThemeBackground({ [THEME_BG_KEY]: true })).toBe(true)
  })

  it('stops following once the user picked a background', () => {
    expect(followsThemeBackground({ [THEME_BG_KEY]: false })).toBe(false)
  })
})

describe('writeThemeBackground', () => {
  it('stores the panel colour on a theme-driven drawing', () => {
    const json = writeThemeBackground('{"type":"excalidraw"}', 'rgb(42, 42, 48)')
    const data = JSON.parse(json)
    expect(data[THEME_BG_KEY]).toBe(true)
    expect(data.appState.viewBackgroundColor).toBe('rgb(42, 42, 48)')
  })

  it('keeps the rest of appState', () => {
    const json = writeThemeBackground('{"appState":{"gridSize":20}}', '#2a2a30')
    expect(JSON.parse(json).appState).toEqual({ gridSize: 20, viewBackgroundColor: '#2a2a30' })
  })

  it('drops the mark when the drawing keeps its own background', () => {
    const json = writeThemeBackground(
      writeThemeBackground('{"type":"excalidraw"}', 'rgb(42, 42, 48)'),
      null,
    )
    const data = JSON.parse(json)
    expect(data[THEME_BG_KEY]).toBeUndefined()
    expect(data.appState.viewBackgroundColor).toBe('rgb(42, 42, 48)')
  })

  it('leaves malformed scenes untouched', () => {
    expect(writeThemeBackground('not json', 'rgb(42, 42, 48)')).toBe('not json')
  })
})

describe('sceneWithThemeCanvas', () => {
  it('leaves the canvas of an existing scene transparent', () => {
    const scene = sceneWithThemeCanvas({ type: 'excalidraw', elements: [{ id: 'a' }] })
    expect(scene.elements).toEqual([{ id: 'a' }])
    expect(scene.appState).toEqual({ viewBackgroundColor: THEME_CANVAS_BG })
  })

  it('keeps the rest of appState', () => {
    const scene = sceneWithThemeCanvas({
      appState: { gridSize: 20, viewBackgroundColor: '#ffffff' },
    })
    expect(scene.appState).toEqual({ gridSize: 20, viewBackgroundColor: THEME_CANVAS_BG })
  })

  it('starts a scene from nothing', () => {
    expect(sceneWithThemeCanvas(null)).toEqual({
      appState: { viewBackgroundColor: THEME_CANVAS_BG },
    })
  })
})
