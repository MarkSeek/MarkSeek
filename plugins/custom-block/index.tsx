// Custom-block plugin — a minimal example of extending Markdown with a special
// display element. It registers a `callout` block node that renders as a styled
// info/warning box. The node round-trips through a fenced code block
// (```callout <type>) so it stays valid Markdown, and typing `::callout` on an
// empty line inserts one.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PluginApi = any

const ICONS: Record<string, string> = {
  note: '💡',
  tip: '✅',
  warning: '⚠️',
  danger: '🔥',
}

export default function activate(api: PluginApi): void {
  const { $node, $view, $prose, nodeInputRule, inputRules } = api

  injectStyles()

  const calloutNode = $node('callout', () => ({
    group: 'block',
    content: 'inline*',
    marks: '',
    attrs: {
      type: { default: 'note' },
    },
    parseMarkdown: {
      match: (node: any) =>
        node.type === 'code' && typeof node.lang === 'string' && node.lang.startsWith('callout'),
      runner: (state: any, node: any, type: any) => {
        const ctype = (node.lang.split(':')[1] || 'note').trim() || 'note'
        state.openNode(type, { type: ctype })
        if (node.value) state.addText(node.value)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node: any) => node.type.name === 'callout',
      runner: (state: any, node: any) => {
        state.addNode('code', undefined, node.textContent, {
          lang: `callout:${node.attrs.type}`,
        })
      },
    },
  }))

  const calloutView = $view(calloutNode, () => {
    return (node: any) => {
      const dom = document.createElement('div')
      dom.className = `ms-callout ms-callout-${node.attrs.type}`

      const icon = document.createElement('span')
      icon.className = 'ms-callout-icon'
      icon.textContent = ICONS[node.attrs.type] || ICONS.note

      const body = document.createElement('div')
      body.className = 'ms-callout-body'

      dom.appendChild(icon)
      dom.appendChild(body)

      // contentDOM lets ProseMirror render the node's inline content into `body`,
      // so the callout stays fully editable.
      return { dom, contentDOM: body }
    }
  })

  const calloutInput = $prose((ctx: any) => {
    const type = calloutNode.type(ctx)
    return inputRules({
      rules: [nodeInputRule(/^::callout$/, type)],
    })
  })

  api.registerEditorExtension(calloutNode)
  api.registerEditorExtension(calloutView)
  api.registerEditorExtension(calloutInput)
}

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'custom-block')
  style.textContent = `
.ms-callout {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f6f8);
  border-left: 4px solid var(--accent, #06b6d4);
  margin: 8px 0;
  font-size: var(--editor-font-size, 15px);
}
.ms-callout-icon { line-height: 1.6; }
.ms-callout-body { flex: 1; min-width: 0; }
.ms-callout-warning { border-left-color: #f59e0b; }
.ms-callout-danger { border-left-color: #ef4444; }
.ms-callout-tip { border-left-color: #22c55e; }
`
  document.head.appendChild(style)
}
