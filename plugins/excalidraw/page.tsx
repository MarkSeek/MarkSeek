// Full-page Excalidraw canvas for `*.excalidraw.md` and `*.excalidraw` files.
//
// This is the page-level counterpart of the embedded block in ./index.tsx:
// there the drawing lives inside a Markdown document, here it takes over the
// whole editor area. The file extension decides the on-disk format (see
// ./scene.ts): a `*.excalidraw.md` note keeps the drawing in a ```excalidraw
// fence so it round-trips with Markdown, while a bare `*.excalidraw` file is
// stored as the raw Excalidraw scene JSON — no fence, openable in any Excalidraw
// app directly.
//
// The renderer is registered through the Plugin SDK (`registerPageRenderer`);
// the host only supplies a container element and a way to report new content,
// and never learns what is mounted inside.
//
// React and ReactDOM come from this bundle, not from `api.React`: the plugin is
// built standalone (see vite.plugins.config.ts), so Excalidraw's hooks resolve
// against this copy — mounting it with the host's React would dispatch hooks on
// the wrong instance. Same reasoning as the node view in ./index.tsx.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { serializeAsJSON } from '@excalidraw/excalidraw'
import {
  followsThemeBackground,
  isCanvasFile,
  isRawCanvasFile,
  parseCanvasDoc,
  parseScene,
  sceneWithThemeCanvas,
  serializeCanvasDoc,
  THEME_CANVAS_BG,
  writeThemeBackground,
} from './scene'
import { hostBackground } from './hostTheme'
import { ThemedCanvas } from './theme'
import type { PageRendererContribution } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Idle time after the last edit before the scene is handed back upstream. */
const SAVE_DELAY = 400

/** Build the page renderer this plugin contributes for canvas notes. */
export function createCanvasPageRenderer(): PageRendererContribution {
  return {
    id: 'excalidraw-canvas',
    // Name of an icon in the host icon set, used on the file's tab. It is the
    // same drawing-sheet icon the tree and the recent list show.
    icon: 'excalidraw',
    match: isCanvasFile,
    mount(container, ctx) {
      const host = document.createElement('div')
      host.className = 'ms-canvas-page'
      container.appendChild(host)

      // Bare `*.excalidraw` files store the raw scene JSON; `*.excalidraw.md`
      // notes keep the drawing in a fenced block (see ./scene.ts).
      const raw = isRawCanvasFile(ctx.filePath)

      // `initialData` is read once, on mount, so the document is parsed here:
      // the host remounts the page whenever another scene has to load.
      const doc = parseCanvasDoc(ctx.content, raw)
      const scene = parseScene(doc.scene)

      // A drawing with no background of its own keeps a transparent canvas, so
      // the panel behind it — and therefore the theme — supplies the colour.
      // `background` remembers that colour, which is what gets stored in the
      // file. (See THEME_CANVAS_BG in ./scene.ts.)
      let background = hostBackground(container)
      let followsTheme = followsThemeBackground(scene)
      const initialData = scene
        ? // Frame the existing drawing on open.
          { ...(followsTheme ? sceneWithThemeCanvas(scene) : scene), scrollToContent: true }
        : // A note without a drawing yet gets an empty one on the panel.
          sceneWithThemeCanvas(null)

      // Last content handed upstream, so re-serializing an unchanged scene
      // never marks the file dirty.
      let last = ctx.content
      let pending: string | null = null
      let timer: ReturnType<typeof setTimeout> | null = null

      const flush = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        const next = pending
        pending = null
        if (next == null || next === last) return
        last = next
        ctx.onChange(next)
      }

      const root = createRoot(host)
      root.render(
        React.createElement(ThemedCanvas, {
          initialData,
          anchor: container,
          onBackground: (color: string) => {
            background = color
          },
          onChange: (elements: any, appState: any, files: any) => {
            // Excalidraw hands the canvas background back: anything but the
            // transparent marker means the user picked their own, and from
            // then on the theme leaves it alone.
            if (
              followsTheme &&
              appState.viewBackgroundColor &&
              appState.viewBackgroundColor !== THEME_CANVAS_BG
            ) {
              followsTheme = false
            }
            pending = serializeCanvasDoc(
              {
                ...doc,
                scene: writeThemeBackground(
                  serializeAsJSON(elements, appState, files, 'local'),
                  followsTheme ? background : null,
                ),
              },
              raw,
            )
            if (timer) clearTimeout(timer)
            timer = setTimeout(flush, SAVE_DELAY)
          },
        }),
      )

      return {
        destroy: () => {
          // Hand a pending edit over: the debounce has not fired yet and the
          // canvas is about to be destroyed.
          flush()
          if (timer) clearTimeout(timer)
          root.unmount()
          host.remove()
        },
      }
    },
  }
}
