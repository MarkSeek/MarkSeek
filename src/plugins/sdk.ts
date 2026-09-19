// Plugin SDK: exposes the capabilities a plugin can rely on through
// `window.markseek`. Plugins never import application modules directly — they
// only use this SDK, which guarantees they share the same Milkdown/React
// instances as the host app and stay dependency-free.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { $node, $view, $prose, $remark } from '@milkdown/utils'
import { InputRule, inputRules } from '@milkdown/prose/inputrules'
import type { NodeType } from '@milkdown/prose/model'
import type {
  MarkseekPluginApi,
  PageRendererContribution,
  PluginThemeContribution,
} from '../../plugins/types'
import { pluginManager } from './PluginManager'
import { registerTheme } from './themes'

// Milkdown's `@milkdown/utils` does not re-export `nodeInputRule`; provide a
// small ProseMirror-backed implementation so plugins can register an input rule
// that inserts a node (e.g. typing `::excalidraw` inserts a drawing block).
function nodeInputRule(
  regexp: RegExp,
  type: unknown,
  getAttrs?: (match: RegExpMatchArray) => Record<string, unknown> | null,
): InputRule {
  const nodeType = type as NodeType
  return new InputRule(regexp, (state, match, start) => {
    // Default to an empty attr object when no getAttrs is supplied; only an
    // explicit `null` from getAttrs cancels the rule. The previous default of
    // `null` made every rule without getAttrs a silent no-op.
    const attrs = getAttrs ? getAttrs(match as RegExpMatchArray) : {}
    if (attrs === null) return null
    const $start = state.doc.resolve(start)
    if ($start.depth < 1) return null
    // The matched text lives inside a textblock (e.g. a paragraph). A block-level
    // atom cannot be placed inline, so replace that whole textblock with the node
    // rather than the matched character range — otherwise canReplaceWith() fails
    // (a block node is not a valid inline child of the paragraph) and nothing is
    // inserted.
    const blockStart = $start.before($start.depth)
    const blockEnd = $start.after($start.depth)
    const $parent = state.doc.resolve(blockStart)
    const index = $parent.index()
    if (!$parent.parent.canReplaceWith(index, index + 1, nodeType)) {
      return null
    }
    return state.tr.replaceWith(blockStart, blockEnd, nodeType.create(attrs))
  })
}

function mergeAttributes(...attrs: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...attrs)
}

/**
 * Install the Plugin SDK on `window.markseek`. Must run once, before any plugin
 * is loaded (called from src/main.tsx at module load).
 */
export function setupPluginSdk(): void {
  const api: MarkseekPluginApi = {
    React,
    createRoot,
    $node,
    $view,
    $prose,
    $remark,
    nodeInputRule,
    inputRules,
    mergeAttributes,
    registerEditorExtension: (plugin) => pluginManager.registerEditorExtension(plugin),
    registerTheme: (theme: PluginThemeContribution) => registerTheme(theme),
    registerSidebarPanel: (panel) => pluginManager.registerSidebarPanel(panel),
    registerPageRenderer: (renderer: PageRendererContribution) =>
      pluginManager.registerPageRenderer(renderer),
    getSettings: () => ((window as any).__markseekSettings ?? {}) as Record<string, unknown>,
    insertNode: (typeName, attrs) => pluginManager.insertNode(typeName, attrs),
  }
  window.markseek = api
}
