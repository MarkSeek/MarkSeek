// Mermaid plugin — render ```mermaid fenced code blocks as live diagrams inside
// the MarkSeek editor, and let the user edit the diagram source inline.
//
// On-disk format: a fenced code block (```mermaid) holding the diagram source,
// so a diagram round-trips with plain Markdown. In the editor the block renders
// the source to an SVG through the `mermaid` package and shows an editable
// source box below it by default.
//
// This entry is bundled as a standalone ESM by vite.plugins.config.ts. It imports
// `mermaid` directly; Vite's lib mode inlines it into the single plugin file, so
// the plugin is self-contained and shares no `mermaid` instance with the host.
import mermaid from 'mermaid'
// The Plugin SDK is provided on window.markseek; we only depend on it, never on
// application modules, to stay dependency-free at load time.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PluginApi = any

// Same fence-collision problem as the excalidraw plugin (see that plugin):
// CommonMark's `code_block` matches every `type === 'code'` fence BEFORE this
// node, so a ```mermaid block would be swallowed as a plain code block. A remark
// transformer renames the fence's mdast type so only this node matches it.
const MERMAID_MDAST_TYPE = 'msMermaid'
const DEFAULT_SOURCE = 'graph TD\n  A[Start] --> B[End]'

// Track the mermaid theme so we only re-initialize when it actually flips.
let mermaidTheme: string | null = null
function appTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default'
}
function ensureMermaid(): void {
  const theme = appTheme()
  // Re-initialize whenever the theme flips so the next render picks it up.
  if (mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
    mermaidTheme = theme
  }
}

let renderSeq = 0
async function renderSvg(code: string): Promise<string> {
  ensureMermaid()
  const id = `ms-mermaid-${Date.now()}-${renderSeq++}`
  const { svg } = await mermaid.render(id, code)
  return svg
}

function remarkMermaidFence() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node.type === 'code' && node.lang === 'mermaid') {
        node.type = MERMAID_MDAST_TYPE
      }
      if (Array.isArray(node.children)) node.children.forEach(walk)
    }
    walk(tree)
  }
}

export default function activate(api: PluginApi): void {
  const { $node, $view, $prose, $remark, nodeInputRule, inputRules } = api

  injectStyles()

  const mermaidNode = $node('mermaid', () => ({
    group: 'block',
    atom: true,
    draggable: false,
    isolating: true,
    // Keep the block from being selected as a node when the user clicks inside
    // the source textarea — an atom NodeSelection would steal focus back from
    // the textarea and hide the caret.
    selectable: false,
    attrs: { source: { default: '' } },
    parseMarkdown: {
      // Matches the custom mdast type produced by remarkMermaidFence above, not
      // `type === 'code'` — see MERMAID_MDAST_TYPE.
      match: (node: any) => node.type === MERMAID_MDAST_TYPE,
      runner: (state: any, node: any, type: any) => {
        state.openNode(type, { source: node.value || '' })
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node: any) => node.type.name === 'mermaid',
      runner: (state: any, node: any) => {
        state.addNode('code', undefined, node.attrs.source || '', { lang: 'mermaid' })
      },
    },
  }))

  const mermaidView = $view(mermaidNode, () => {
    return (node: any, view: any, getPos: any) => {
      const dom = document.createElement('div')
      dom.className = 'ms-mermaid'

      const header = document.createElement('div')
      header.className = 'ms-mermaid-header'
      const title = document.createElement('span')
      title.className = 'ms-mermaid-title'
      title.textContent = 'Mermaid'
      const toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      toggleBtn.className = 'ms-mermaid-toggle'
      toggleBtn.textContent = 'Show source'
      const applyBtn = document.createElement('button')
      applyBtn.type = 'button'
      applyBtn.className = 'ms-mermaid-apply'
      applyBtn.textContent = 'Apply'
      // Group the source toggle and Apply on the right side of the header.
      const actions = document.createElement('div')
      actions.className = 'ms-mermaid-actions'
      actions.appendChild(toggleBtn)
      actions.appendChild(applyBtn)
      header.appendChild(title)
      header.appendChild(actions)

      const body = document.createElement('div')
      body.className = 'ms-mermaid-body'

      const renderWrap = document.createElement('div')
      renderWrap.className = 'ms-mermaid-render-wrap'

      const render = document.createElement('div')
      render.className = 'ms-mermaid-render'

      // The SVG is rendered inside a canvas wrapper so we can apply CSS `zoom`
      // to scale the whole diagram without touching the source editor.
      const canvas = document.createElement('div')
      canvas.className = 'ms-mermaid-canvas'
      render.appendChild(canvas)

      const editor = document.createElement('div')
      editor.className = 'ms-mermaid-editor'
      const textarea = document.createElement('textarea')
      textarea.className = 'ms-mermaid-source'
      textarea.spellcheck = false
      editor.appendChild(textarea)

      // Zoom controls, pinned to the diagram corner so they never scroll away.
      let zoom = 1
      const MIN_ZOOM = 0.2
      const MAX_ZOOM = 3
      const ZOOM_STEP = 0.1
      const zoomBar = document.createElement('div')
      zoomBar.className = 'ms-mermaid-zoom'
      const makeZoomBtn = (label: string, title: string) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ms-mermaid-zoom-btn'
        b.textContent = label
        b.title = title
        return b
      }
      const zoomOutBtn = makeZoomBtn('−', 'Zoom out')
      const zoomLabel = document.createElement('span')
      zoomLabel.className = 'ms-mermaid-zoom-label'
      zoomLabel.title = 'Click to reset zoom'
      zoomLabel.textContent = '100%'
      const zoomInBtn = makeZoomBtn('+', 'Zoom in')
      zoomBar.appendChild(zoomOutBtn)
      zoomBar.appendChild(zoomLabel)
      zoomBar.appendChild(zoomInBtn)
      // Zoom controls live in the header, to the left of "Show source".
      actions.insertBefore(zoomBar, toggleBtn)
      renderWrap.appendChild(render)

      // Natural size of the current SVG, measured on render (mermaid emits
      // `width="100%"` with no height, so we can't rely on the attributes).
      let natW = 0
      let natH = 0
      const applyZoom = () => {
        zoomLabel.textContent = `${Math.round(zoom * 100)}%`
        const svgEl = canvas.querySelector('svg')
        if (!svgEl) return
        // Scale the SVG itself (transform does not affect layout, so we also
        // resize the canvas wrapper to the scaled dimensions — that keeps the
        // scroll area correct and avoids the layout-collapse we got from using
        // CSS `zoom` on the wrapper).
        svgEl.style.transformOrigin = 'top left'
        svgEl.style.transform = zoom === 1 ? 'none' : `scale(${zoom})`
        const w = natW || parseFloat(svgEl.getAttribute('width') || '')
        const h = natH || parseFloat(svgEl.getAttribute('height') || '')
        if (w && h) {
          canvas.style.width = `${w * zoom}px`
          canvas.style.height = `${h * zoom}px`
        } else {
          canvas.style.width = ''
          canvas.style.height = ''
        }
      }
      const setZoom = (next: number) => {
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100))
        applyZoom()
      }
      zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP))
      zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP))
      zoomLabel.addEventListener('click', () => setZoom(1))

      body.appendChild(renderWrap)
      body.appendChild(editor)
      dom.appendChild(header)
      dom.appendChild(body)

      // Drag handle in the bottom-right corner to resize the diagram block.
      const MIN_W = 220
      const MIN_H = 120
      const resizeHandle = document.createElement('div')
      resizeHandle.className = 'ms-mermaid-resize'
      resizeHandle.title = 'Drag to resize the diagram'
      dom.appendChild(resizeHandle)
      let resizing = false
      const onResizeMove = (e: PointerEvent) => {
        if (!resizing) return
        const blockRect = dom.getBoundingClientRect()
        const w = Math.max(MIN_W, e.clientX - blockRect.left)
        const renderRect = render.getBoundingClientRect()
        const h = Math.max(MIN_H, e.clientY - renderRect.top)
        dom.style.width = `${w}px`
        render.style.height = `${h}px`
        // Let the user grow the viewport past the default 70vh cap.
        render.style.maxHeight = 'none'
      }
      const onResizeUp = () => {
        if (!resizing) return
        resizing = false
        window.removeEventListener('pointermove', onResizeMove)
        window.removeEventListener('pointerup', onResizeUp)
        document.body.style.userSelect = ''
      }
      resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()
        resizing = true
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', onResizeMove)
        window.addEventListener('pointerup', onResizeUp)
      })

      let currentSource = node.attrs.source || ''
      let showingSource = false
      let destroyed = false

      const showError = (message: string) => {
        canvas.innerHTML = ''
        const pre = document.createElement('pre')
        pre.className = 'ms-mermaid-error'
        pre.textContent = message
        canvas.appendChild(pre)
      }

      const draw = async (code: string) => {
        if (!code.trim()) {
          canvas.innerHTML = ''
          const hint = document.createElement('div')
          hint.className = 'ms-mermaid-empty'
          hint.textContent = 'Empty diagram — type Mermaid code below and click Apply.'
          canvas.appendChild(hint)
          return
        }
        try {
          const svg = await renderSvg(code)
          if (destroyed) return
          canvas.innerHTML = svg
          // Measure the rendered SVG so zoom has a real basis (mermaid's
          // `width="100%"` + missing height can't be read from attributes).
          const svgEl = canvas.querySelector('svg')
          if (svgEl) {
            svgEl.style.transform = 'none'
            const r = svgEl.getBoundingClientRect()
            if (r.width && r.height) {
              natW = r.width
              natH = r.height
            }
          }
          applyZoom()
        } catch (err) {
          if (destroyed) return
          showError(err instanceof Error ? err.message : String(err))
        }
      }

      // Re-render when the app theme changes (light / warm / dark).
      const themeObserver = new MutationObserver(() => {
        mermaidTheme = null
        draw(currentSource)
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })

      const setSourceVisible = (visible: boolean) => {
        showingSource = visible
        editor.classList.toggle('is-hidden', !visible)
        toggleBtn.textContent = visible ? 'Hide source' : 'Show source'
        if (visible) textarea.focus()
      }
      const applySource = () => {
        const next = textarea.value
        if (next === currentSource) return
        currentSource = next
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null) {
          view.dispatch(view.state.tr.setNodeAttribute(pos, 'source', next))
        }
        draw(next)
      }

      toggleBtn.addEventListener('click', () => setSourceVisible(!showingSource))
      applyBtn.addEventListener('click', applySource)
      // Keep ProseMirror's root handlers from seeing interactions that start
      // inside the source textarea, so clicking/selecting never blurs it.
      const keepFocus = (e: Event) => e.stopPropagation()
      textarea.addEventListener('mousedown', keepFocus)
      textarea.addEventListener('touchstart', keepFocus)
      textarea.addEventListener('click', keepFocus)
      // Commit edits when the textarea loses focus, so leaving the field never
      // drops what was typed.
      textarea.addEventListener('blur', applySource)
      // Double-click the diagram to reveal (and focus) the source box.
      render.addEventListener('dblclick', () => {
        if (!showingSource) setSourceVisible(true)
        textarea.focus()
      })

      // ProseMirror does NOT call update() on the initial mount, so the textarea
      // must be seeded with the parsed source here — otherwise the diagram would
      // render but the source box would be empty after reopening a note.
      textarea.value = currentSource
      // Source is hidden by default; reveal it with the toggle or by
      // double-clicking the diagram.
      setSourceVisible(false)
      applyZoom()
      draw(currentSource)

      return {
        dom,
        // An atom node with no contentDOM: without update() ProseMirror would
        // destroy and recreate the whole view on every attribute change, which
        // would lose the mounted diagram. Keep the same instance when only
        // attrs change.
        update: (next: any) => {
          if (next.type !== node.type) return false
          node = next
          if (next.attrs.source !== currentSource) {
            currentSource = next.attrs.source || ''
            textarea.value = currentSource
            draw(currentSource)
          }
          return true
        },
        // Swallow every event that originates inside the block so editor
        // shortcuts keep working when focus is outside the diagram, while the
        // buttons / textarea still receive their own events (stopEvent only
        // tells ProseMirror to ignore the event, it does not block the DOM).
        stopEvent: (event: Event) => dom.contains(event.target as Node),
        ignoreMutation: () => true,
        destroy: () => {
          destroyed = true
          themeObserver.disconnect()
          window.removeEventListener('pointermove', onResizeMove)
          window.removeEventListener('pointerup', onResizeUp)
        },
      }
    }
  })

  // Typing `::mermaid` on an empty line inserts a fresh diagram block.
  const mermaidInput = $prose((ctx: any) => {
    const type = mermaidNode.type(ctx)
    return inputRules({
      rules: [nodeInputRule(/^::mermaid$/, type, () => ({ source: DEFAULT_SOURCE }))],
    })
  })

  // Rename ```mermaid fences in the mdast so the CommonMark `code_block` parser
  // cannot claim them before this plugin's node gets a chance.
  const mermaidRemark = $remark('mermaidRemark', () => remarkMermaidFence)

  api.registerEditorExtension(mermaidRemark)
  api.registerEditorExtension(mermaidNode)
  api.registerEditorExtension(mermaidView)
  api.registerEditorExtension(mermaidInput)
}

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'mermaid')
  style.textContent = `
.ms-mermaid {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
  background: var(--bg-content);
  position: relative;
  max-width: 100%;
}
.ms-mermaid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.ms-mermaid-header button {
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-elevated, #fff);
  color: var(--text-primary, #111);
  cursor: pointer;
}
.ms-mermaid-header button:hover {
  border-color: var(--accent, #06b6d4);
}
.ms-mermaid-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ms-mermaid-body {
  padding: 10px;
}
/* Bottom-right drag handle for resizing the diagram block. */
.ms-mermaid-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 3;
  border-bottom-right-radius: 8px;
  background: linear-gradient(135deg, transparent 50%, var(--border, #e5e7eb) 50%);
}
.ms-mermaid-resize:hover {
  background: linear-gradient(135deg, transparent 50%, var(--accent, #06b6d4) 50%);
}
.ms-mermaid-render-wrap {
  position: relative;
}
.ms-mermaid-render {
  overflow: auto;
  max-height: 70vh;
}
.ms-mermaid-canvas {
  display: block;
}
.ms-mermaid-render svg {
  display: block;
}
/* Zoom controls, shown in the header to the left of "Show source". They reuse
   the same sizing as the header buttons so the row stays visually even. */
.ms-mermaid-zoom {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ms-mermaid-zoom-btn {
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 2px 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-elevated, #fff);
  color: var(--text-primary, #111);
  cursor: pointer;
}
.ms-mermaid-zoom-btn:hover {
  border-color: var(--accent, #06b6d4);
}
.ms-mermaid-zoom-label {
  font-size: 12px;
  line-height: 1;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary, #6b7280);
}
.ms-mermaid-zoom-label:hover {
  background: var(--bg-hover, #f3f4f6);
}
.ms-mermaid-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
/* Visibility is driven by this class, not the "hidden" attribute: an author
   "display: flex" rule would outrank the UA "[hidden] { display: none }". */
.ms-mermaid-editor.is-hidden {
  display: none;
}
.ms-mermaid-source {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #111);
  caret-color: var(--text-primary, #111);
  cursor: text;
  box-sizing: border-box;
}
.ms-mermaid-error {
  color: #b91c1c;
  background: rgba(254, 226, 226, 0.6);
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  white-space: pre-wrap;
  overflow: auto;
  max-height: 240px;
  margin: 0;
}
:root[data-theme='dark'] .ms-mermaid-error {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.35);
  border-color: #7f1d1d;
}
.ms-mermaid-empty {
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}
`
  document.head.appendChild(style)
}
