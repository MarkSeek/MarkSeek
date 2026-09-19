// Excalidraw plugin — drawable canvases in two places:
//
//   * inside a Markdown note (`::excalidraw`), as a block node view;
//   * as the whole editor area, for `*.excalidraw.md` canvas notes (./page.tsx),
//     registered through the Plugin SDK's `registerPageRenderer`.
//
// Both share one on-disk format: a fenced code block (```excalidraw) holding the
// Excalidraw scene JSON, so a drawing round-trips with plain Markdown. In the
// editor the block writes edits back into the node's `scene` attribute; the page
// renderer writes them back as the note's content.
//
// This entry is bundled as a standalone ESM by vite.plugins.config.ts, including
// its own React + ReactDOM + @excalidraw/excalidraw copy, so it is fully
// self-contained and shares no React instance with the host app's node view.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { serializeAsJSON } from '@excalidraw/excalidraw'
// Since 0.18 the package is ESM-only and ships its stylesheet separately
// instead of injecting it from the bundle. `?inline` turns it into a string so
// it can travel inside this plugin's single-file build: Vite's lib mode would
// otherwise emit a sibling `.css` that nothing ever loads.
import excalidrawCss from '@excalidraw/excalidraw/index.css?inline'
import { createCanvasPageRenderer } from './page'
import {
  applyStoredBackground,
  followsThemeBackground,
  sceneWithThemeCanvas,
  THEME_CANVAS_BG,
} from './scene'
import { hostBackground } from './hostTheme'
import { ThemedCanvas } from './theme'

// The Plugin SDK is provided on window.markseek; we only depend on it, never on
// application modules, to stay dependency-free at load time.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PluginApi = any

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// The block size is persisted inside the scene JSON under this key so it
// round-trips with the Markdown fence; the theme-background metadata (see
// ./scene.ts) rides along the same way. Excalidraw ignores unknown top-level
// keys, so the drawing still opens unchanged in any other app.
const SIZE_KEY = 'markseekSize'
const MIN_W = 240
const MIN_H = 220
const MAX_H = 1600

interface BlockSize {
  /** CSS pixels. 0 means "use the default" (full column width / default height). */
  w: number
  h: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function readSize(scene: string): BlockSize {
  const meta = safeParse(scene)?.[SIZE_KEY]
  const w = Number(meta && meta.w)
  const h = Number(meta && meta.h)
  return {
    w: Number.isFinite(w) && w >= MIN_W ? Math.round(w) : 0,
    h: Number.isFinite(h) && h >= MIN_H ? Math.round(h) : 0,
  }
}

// The host app scales the whole layout with CSS zoom; pointer deltas and
// getBoundingClientRect() are in scaled pixels while inline styles use the
// unscaled CSS pixels of the zoomed subtree, so convert between the two.
function zoomScale(): number {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-scale'),
  )
  return Number.isFinite(value) && value > 0 ? value : 1
}

// Milkdown's markdown parser resolves every mdast node with the FIRST schema
// node whose `parseMarkdown.match` returns true, walking the schema in
// registration order (@milkdown/transformer/src/parser/state.ts). Crepe
// registers the CommonMark preset — whose `code_block` node matches every
// `type === 'code'` fence — before any plugin node, so ```excalidraw was always
// swallowed by code_block and reopened as a plain code block.
//
// Renaming the fence to a custom mdast type in a remark transformer makes
// code_block's `type === 'code'` test fail, leaving this plugin's node as the
// only match. Serialization is unaffected: Milkdown stringifies with
// `remark.stringify`, which runs the compiler only, never transformers.
const EXCALIDRAW_MDAST_TYPE = 'msExcalidraw'

function remarkExcalidrawFence() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node.type === 'code' && node.lang === 'excalidraw') {
        node.type = EXCALIDRAW_MDAST_TYPE
      }
      if (Array.isArray(node.children)) node.children.forEach(walk)
    }
    walk(tree)
  }
}

export default function activate(api: PluginApi): void {
  const { $node, $view, $prose, $remark, nodeInputRule, inputRules } = api

  injectStyles()

  const excalidrawNode = $node('excalidraw', () => ({
    group: 'block',
    atom: true,
    // Not draggable: the whole surface is an interactive canvas. With
    // `draggable: true` ProseMirror marks the node DOM draggable and the browser
    // starts a native node drag on pointer-down inside it, so dragging a shape
    // also dragged the entire block (and scrolled the page).
    draggable: false,
    isolating: true,
    attrs: {
      scene: { default: '' },
    },
    parseMarkdown: {
      // Matches the custom mdast type produced by remarkExcalidrawFence above,
      // not `type === 'code'` — see EXCALIDRAW_MDAST_TYPE.
      match: (node: any) => node.type === EXCALIDRAW_MDAST_TYPE,
      runner: (state: any, node: any, type: any) => {
        state.openNode(type, { scene: node.value || '' })
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node: any) => node.type.name === 'excalidraw',
      runner: (state: any, node: any) => {
        state.addNode('code', undefined, node.attrs.scene || '', { lang: 'excalidraw' })
      },
    },
  }))

  const excalidrawView = $view(excalidrawNode, () => {
    return (node: any, view: any, getPos: any) => {
      const dom = document.createElement('div')
      dom.className = 'ms-excalidraw'
      // Defensive: never let the browser start a native drag of this block, even
      // if an ancestor is draggable. `stopEvent` below cannot stop a native
      // HTML5 drag — it has to be prevented here.
      dom.draggable = false
      dom.addEventListener('dragstart', (event: Event) => {
        if (dom.contains(event.target as Node)) event.preventDefault()
      })

      const header = document.createElement('div')
      header.className = 'ms-excalidraw-header'
      header.textContent = 'Excalidraw'

      const canvas = document.createElement('div')
      canvas.className = 'ms-excalidraw-canvas'

      // Corner handle: drag it to resize the drawing.
      const resizeHandle = document.createElement('div')
      resizeHandle.className = 'ms-excalidraw-resize'
      resizeHandle.title = 'Drag to resize'

      dom.appendChild(header)
      dom.appendChild(canvas)
      dom.appendChild(resizeHandle)

      const stored = node.attrs.scene ? safeParse(node.attrs.scene) : null
      let saveTimer: ReturnType<typeof setTimeout> | null = null
      // Track the last serialized scene so we only write back when it actually
      // changed. Excalidraw fires onChange on every pointer move; without this
      // guard the node view would re-dispatch and trigger a save on each tick.
      let currentScene: string = node.attrs.scene || ''
      // The scene as stored on the node (including the size metadata), so a
      // resize can be written back without re-serializing the drawing.
      let storedScene: string = currentScene
      let size: BlockSize = readSize(currentScene)

      // A block with no background of its own keeps a transparent canvas, so
      // the panel it sits in — and therefore the theme — supplies the colour.
      // `background` remembers that colour, which is what gets stored in the
      // note. (See THEME_CANVAS_BG in ./scene.ts.)
      let background = hostBackground(dom)
      let followsTheme = followsThemeBackground(stored)
      const initialData: any = followsTheme ? sceneWithThemeCanvas(stored) : stored

      /**
       * Returns the scene with this app's metadata embedded (or stripped when
       * unset): the block size plus whatever ./scene.ts stores for the
       * background. All in one parse/stringify pass: onChange runs on every
       * pointer move.
       */
      const writeMeta = (scene: string): string => {
        const data = safeParse(scene)
        if (!data || typeof data !== 'object') return scene
        if (size.w || size.h) data[SIZE_KEY] = { w: size.w, h: size.h }
        else delete data[SIZE_KEY]
        applyStoredBackground(data, followsTheme ? background : null)
        return JSON.stringify(data)
      }

      const applySize = () => {
        dom.style.width = size.w ? `${size.w}px` : ''
        canvas.style.height = size.h ? `${size.h}px` : ''
      }
      applySize()

      const persistSize = () => {
        const next = writeMeta(storedScene)
        if (next === storedScene) return
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        storedScene = next
        currentScene = next
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'scene', next))
      }

      // Drag the corner handle. Pointer capture keeps the gesture alive even
      // when the cursor leaves the 12px handle.
      resizeHandle.addEventListener('pointerdown', (event: PointerEvent) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const scale = zoomScale()
        const startX = event.clientX
        const startY = event.clientY
        const startW = size.w || dom.getBoundingClientRect().width / scale
        const startH = size.h || canvas.getBoundingClientRect().height / scale
        const parentW = dom.parentElement
          ? dom.parentElement.getBoundingClientRect().width / scale
          : startW
        const maxW = Math.max(MIN_W, parentW)
        resizeHandle.setPointerCapture(event.pointerId)
        dom.classList.add('is-resizing')

        const onMove = (ev: PointerEvent) => {
          size = {
            w: Math.round(clamp(startW + (ev.clientX - startX) / scale, MIN_W, maxW)),
            h: Math.round(clamp(startH + (ev.clientY - startY) / scale, MIN_H, MAX_H)),
          }
          applySize()
        }
        const onUp = () => {
          resizeHandle.removeEventListener('pointermove', onMove)
          resizeHandle.removeEventListener('pointerup', onUp)
          resizeHandle.removeEventListener('pointercancel', onUp)
          dom.classList.remove('is-resizing')
          document.body.style.userSelect = ''
          persistSize()
        }
        resizeHandle.addEventListener('pointermove', onMove)
        resizeHandle.addEventListener('pointerup', onUp)
        resizeHandle.addEventListener('pointercancel', onUp)
        document.body.style.userSelect = 'none'
      })

      const root = createRoot(canvas)
      root.render(
        React.createElement(ThemedCanvas, {
          initialData,
          anchor: dom,
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
            // Re-attach the block metadata: serializeAsJSON() knows nothing
            // about them, so a stroke would drop them from the note.
            const scene = writeMeta(serializeAsJSON(elements, appState, files, 'local'))
            if (scene === currentScene) return
            const pos = typeof getPos === 'function' ? getPos() : null
            if (pos == null) return
            if (saveTimer) clearTimeout(saveTimer)
            saveTimer = setTimeout(() => {
              currentScene = scene
              storedScene = scene
              // The node may have been replaced by an external update; only write
              // back when the stored scene still differs from what we produced.
              if (view.state.doc.nodeAt(pos)?.attrs.scene === scene) return
              const tr = view.state.tr.setNodeAttribute(pos, 'scene', scene)
              view.dispatch(tr)
            }, 400)
          },
        }),
      )

      return {
        dom,
        // Excalidraw is an atom node with no contentDOM. Without an update()
        // method ProseMirror would destroy and recreate the whole view on every
        // attribute change, which resets the canvas and breaks drawing. We keep
        // the same mounted instance when only attrs change.
        update: (next: any) => {
          if (next.type !== node.type) return false
          if (next.attrs.scene !== node.attrs.scene) {
            currentScene = next.attrs.scene || ''
            storedScene = currentScene
            // Pick up a size changed elsewhere (undo, external edit) without
            // resetting the mounted canvas.
            const nextSize = readSize(currentScene)
            if (nextSize.w !== size.w || nextSize.h !== size.h) {
              size = nextSize
              applySize()
            }
          }
          node = next
          return true
        },
        // Only swallow events that originate inside the canvas, so editor
        // shortcuts keep working when focus is outside the drawing.
        stopEvent: (event: Event) => dom.contains(event.target as Node),
        ignoreMutation: () => true,
        destroy: () => {
          if (saveTimer) clearTimeout(saveTimer)
          root.unmount()
        },
      }
    }
  })

  // Typing `::excalidraw` on an empty line inserts a fresh drawing block.
  const excalidrawInput = $prose((ctx: any) => {
    const type = excalidrawNode.type(ctx)
    return inputRules({
      rules: [nodeInputRule(/^::excalidraw$/, type)],
    })
  })

  // Rename ```excalidraw fences in the mdast so the CommonMark `code_block`
  // parser cannot claim them before this plugin's node gets a chance.
  const excalidrawRemark = $remark('excalidrawRemark', () => remarkExcalidrawFence)

  api.registerEditorExtension(excalidrawRemark)
  api.registerEditorExtension(excalidrawNode)
  api.registerEditorExtension(excalidrawView)
  api.registerEditorExtension(excalidrawInput)

  // Whole-page canvas for `*.excalidraw.md` notes. The host decides when to
  // mount it (any file this renderer matches) and owns saving; this plugin only
  // draws.
  api.registerPageRenderer(createCanvasPageRenderer())
}

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'excalidraw')
  // Excalidraw's own stylesheet first; everything below overrides it.
  style.textContent = excalidrawCss
  style.textContent += `
/* --- Whole-page canvas (registered via registerPageRenderer) -------------
   Mounted inside the host's generic .plugin-page container, which already
   fills the editor area; this only has to fill that container.
   --------------------------------------------------------------------- */
.ms-canvas-page {
  width: 100%;
  height: 100%;
  position: relative;
  /* Follow the main-panel background so it adapts to light/dark themes. */
  background: var(--bg-content);
}

/* Excalidraw's narrow-viewport rule gives the root min-height: 100vh and
   vertical padding, which would make it taller than the editor area: every
   overlay inside it (canvas, toolbars) would then sit partly outside the
   visible, interactive area. Pin the root to the page. */
.ms-canvas-page .excalidraw {
  position: relative;
  min-height: 0 !important;
  height: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* --- The drawing sits on the main panel ----------------------------------
   A drawing that follows the theme keeps a transparent canvas (see
   THEME_CANVAS_BG in ./scene.ts), so the colour comes from the surface
   behind it — the host's .ms-canvas-page / .ms-excalidraw, both painted with
   --bg-content. Excalidraw paints nothing there itself, but its root does
   carry a background in some builds; drop it so the panel colour is what the
   user sees, and so a canvas that has not repainted yet cannot flash white.
   --------------------------------------------------------------------- */
.ms-canvas-page .excalidraw,
.ms-excalidraw-canvas .excalidraw {
  background: transparent !important;
}

/* --- Cancel the host zoom on the drawing surface -------------------------
   Excalidraw measures its container in CLIENT px and then uses that number as
   a LAYOUT px when it sizes its canvases:

       appState.width  = excalidrawContainer.getBoundingClientRect().width
       canvas.style.width = appState.width + "px"          // LAYOUT px
       canvas.width       = appState.width * devicePixelRatio

   Inside the host's zoomed subtree (.app-layout { zoom: var(--app-zoom-scale) })
   1 layout px is painted as s client px, so the canvas comes out s times wider
   and taller than the container that measured it: the drawing is magnified,
   clipped along the right/bottom edge, and the bitmap's appState.width units
   end up stretched over (appState.width * s) client px.

   Pointer mapping assumes 1:1, so a click is resolved at
   offsetLeft + (clientX - offsetLeft) * s instead of clientX — off by
   distanceFromTheCanvasOrigin * (s - 1), which makes every shape but the ones
   in the top-left corner impossible to select.

   A percentage is resolved in LAYOUT space, so 100% renders at exactly the
   client size the container reported: the canvas fills the container, the
   backing store maps 1:1 onto the painted device pixels (keeps it crisp), and
   Excalidraw's coordinate maths is correct again at any host zoom.

   !important is required: Excalidraw rewrites both properties as inline
   styles on every render (StaticCanvas.tsx / InteractiveCanvas.tsx).
   Both canvases are position:absolute against .excalidraw, which the rules
   above pin to the host container, so 100% is the whole drawing area.
   --------------------------------------------------------------------- */
.ms-canvas-page .excalidraw__canvas,
.ms-excalidraw-canvas .excalidraw__canvas {
  width: 100% !important;
  height: 100% !important;
}

/* --- Counter the host zoom on the text editor overlay -------------------
   The canvas above is fixed because Excalidraw paints it as a bitmap whose
   width:100% makes the painted device pixels map 1:1 onto the container at
   any host zoom. The text editor is a different beast: it is a real HTML
   textarea (.excalidraw-wysiwyg) positioned with left/top taken straight from
   getViewportCoords, which returns CLIENT px (getBoundingClientRect is
   zoom-aware). Inside the host's zoomed subtree (.app-layout { zoom: s }) that
   client-px offset is laid out as LAYOUT px and then repainted s times larger,
   so the caret lands offsetFromCanvasOrigin * (s - 1) away from where the click
   was — exactly the off-by-distance bug, but for text only (shapes on the
   canvas bitmap are unaffected, which is why drawing still feels right).

   The textarea is position:absolute, so its left/top are resolved against its
   containing block. We make this container that block (position:absolute;
   inset:0, origin at the canvas top-left) and counter-zoom it by 1/s. Now the
   client-px offset is scaled back to LAYOUT px correctly, while the text size
   stays right because Excalidraw already scales the glyphs by its own zoom in
   the textarea's transform — net visual zoom is s * (1/s) * excalidrawZoom,
   matching the (host-zoom-independent) canvas. At s = 1 the calc() is a no-op,
   so 100% zoom is unchanged.

   pointer-events:none keeps the overlay from swallowing canvas clicks; the
   textarea re-enables them so the caret stays editable.
   --------------------------------------------------------------------- */
.ms-canvas-page .excalidraw .excalidraw-textEditorContainer,
.ms-excalidraw-canvas .excalidraw .excalidraw-textEditorContainer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  zoom: calc(1 / var(--app-zoom-scale)) !important;
}
.ms-canvas-page .excalidraw .excalidraw-textEditorContainer .excalidraw-wysiwyg,
.ms-excalidraw-canvas .excalidraw .excalidraw-textEditorContainer .excalidraw-wysiwyg {
  pointer-events: auto;
}

.ms-excalidraw {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
  /* Follow the main-panel background so it adapts to light/dark themes. */
  background: var(--bg-content);
  /* Anchors the resize handle and keeps a dragged width inside the column. */
  position: relative;
  max-width: 100%;
}

/* Corner drag handle: resizes the block (see the pointer handlers in the
   node view). Sized generously for touch, visually just two ticks. */
.ms-excalidraw-resize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border-right: 2px solid var(--border, #d1d5db);
  border-bottom: 2px solid var(--border, #d1d5db);
  border-bottom-right-radius: 3px;
  cursor: nwse-resize;
  opacity: 0.55;
  z-index: 2;
  touch-action: none;
  transition: opacity 0.15s, border-color 0.15s;
}
.ms-excalidraw:hover .ms-excalidraw-resize {
  opacity: 1;
}
.ms-excalidraw-resize:hover,
.ms-excalidraw.is-resizing .ms-excalidraw-resize {
  opacity: 1;
  border-color: var(--accent, #06b6d4);
}
.ms-excalidraw-header {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.ms-excalidraw-canvas {
  /* Tall enough for the vertical toolbar rail (see below) plus the canvas. */
  height: 420px;
  position: relative;
  /* The canvas is transparent while the drawing follows the theme, so this is
     the surface the drawing actually sits on: the main-panel colour. */
  background: var(--bg-content);
  /* Keep the page from panning/zooming while the user draws on the canvas. */
  touch-action: none;
}

/* --- Vertical toolbar on the left (narrow layout only) --------------------
   Excalidraw ships two UIs and picks one from the width of its container:
     * wide  - the shape toolbar sits horizontally in the top grid
              (Stack Stack_horizontal Island App-toolbar). That layout is
              left exactly as Excalidraw draws it.
     * narrow - the shape toolbar moves to the top bar and the tool actions
              (menu / undo / redo / duplicate / delete) live in the
              full-canvas bottom bar. That bottom bar is turned into a
              vertical rail docked to the left edge.
   Collapsing the side panels widens the note, so Excalidraw can switch from
   one to the other at runtime - which is why every rule below is scoped to
   .App-bottom-bar, the element that only exists in the narrow layout.
   Selectors are qualified with .ms-excalidraw-canvas .excalidraw so they
   outrank Excalidraw's own (.excalidraw .X) rules on specificity alone.
   --------------------------------------------------------------------- */

/* Excalidraw's narrow-viewport rule gives the root min-height: 100vh and
   vertical padding, which makes it taller than the note block: every overlay
   inside it (canvas, toolbars) would then sit partly outside the visible,
   interactive area. Pin the root to the block. */
.ms-excalidraw-canvas .excalidraw {
  position: relative;
  min-height: 0 !important;
  height: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}

/* 1. The bottom bar already covers the whole canvas (top/bottom/left/right:
      0) and is a flex row with pointer-events: none. Keep the toolbar in flow
      and let the bar place it: vertically centred, docked to the left.
      It must NOT be absolutely positioned: the Island wrapping it is
      position: relative and collapses to zero height once its only child
      leaves the flow, which would clip the toolbar to a sliver. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar {
  align-items: center;
  justify-content: flex-start;
}

.ms-excalidraw-canvas .excalidraw .App-bottom-bar > .Island {
  width: auto;
  min-width: 0;
  max-width: none;
  margin-left: 0.5rem;
  padding: 0.25rem;
  /* The Island is a column, so the shape-actions panel and the rail stacked
     on top of each other. Put them side by side instead. */
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

/* 2. The toolbar itself becomes a vertical column. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar .App-toolbar {
  width: auto;
}

.ms-excalidraw-canvas .excalidraw .App-bottom-bar .App-toolbar-content {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0.125rem;
  padding: 0.375rem 0.25rem;
}

/* Stack.Row is a CSS grid (grid-auto-flow: column); stack its cells too. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar .Stack_horizontal {
  grid-auto-flow: row;
  grid-auto-columns: auto;
  grid-template-columns: min-content;
  grid-template-rows: none;
  justify-items: center;
}

/* Dividers separate the tools vertically instead of horizontally. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar .App-toolbar__divider {
  width: 1.5rem;
  height: 1px;
  margin: 0.25rem 0;
}

/* The extra-tools popover opens beside the rail instead of below it. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar .App-toolbar__extra-tools-dropdown {
  top: 0;
  left: calc(100% + 0.5rem);
  right: auto;
  margin-top: 0;
}

/* 3. Selecting a shape opens the shape-actions panel (.App-mobile-menu >
      .panelColumn) inside the same Island. DOM order is [panel, toolbar], so
      reorder to keep the rail on the left and show the panel beside it.
      The panel is width: 100% / bottom-aligned by default, which only makes
      sense in the full-width bar. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar > .Island > .App-mobile-menu {
  order: 2;
  width: auto;
  max-width: 260px;
  max-height: 380px;
  margin-bottom: 0;
}

.ms-excalidraw-canvas .excalidraw .App-bottom-bar > .Island > .App-toolbar {
  order: 1;
}

/* 4. Popups opened from the rail (main menu, ...). .dropdown-menu is
      absolutely positioned against the rail's Island, and Excalidraw's mobile
      rule (bottom: 55px; left: 0; width: 100%) was written for a full-width
      bar: inside the narrow rail it covers the tools, squeezes to the rail's
      width and can spill past the canvas. Open these beside the rail instead
      and cap their height so the whole menu stays inside the drawing. */
.ms-excalidraw-canvas .excalidraw .App-bottom-bar .dropdown-menu {
  top: 0;
  bottom: auto;
  left: calc(100% + 0.5rem);
  right: auto;
  width: auto;
  margin: 0;
  z-index: 10;
}

.ms-excalidraw-canvas .excalidraw .App-bottom-bar .dropdown-menu .dropdown-menu-container {
  /* .dropdown-menu-container defaults to calc(100vh - 150px), which is taller
     than the note block and would be clipped by the canvas. */
  max-height: 310px;
}
`
  document.head.appendChild(style)
}
