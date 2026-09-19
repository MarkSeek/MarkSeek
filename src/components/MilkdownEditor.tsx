import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AIProvider, AIPromptContext } from '@milkdown/crepe/feature/ai'
import { Crepe } from '@milkdown/crepe'
import {
  blockquoteSchema,
  bulletListSchema,
  headingSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
} from '@milkdown/preset-commonmark'
import { $prose, replaceAll } from '@milkdown/utils'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import { commandsCtx } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/core'
import type { EditorView } from '@milkdown/prose/view'
import '@milkdown/crepe/theme/common/style.css'
import { uploadImage } from '../api/files'
import { createVirtualCursor } from '../utils/virtualCursor'
import { parseSSE } from '../utils/sse'
import { t } from '../i18n'
import { useWorkspace } from '../context/WorkspaceContext'
import { pluginManager } from '../plugins/PluginManager'
import EditorContextMenu, { type EditorActionId, type EditorMenuState } from './EditorContextMenu'
import { createSlashMenuSizing } from '../utils/slashMenuSizing'
import { createFullWidthBracketInput } from '../utils/fullWidthBrackets'
import { createWikiLinkDecorations } from '../utils/wikiLinkDecorations'
import {
  createWikiLinkAutocomplete,
  isWikiAnchorOpen,
  type WikiLinkSuggestState,
} from '../utils/wikiLinkAutocomplete'
import { useWikiLinkOpen } from '../hooks/useWikiLinkOpen'
import WikiLinkSuggest from './WikiLinkSuggest'
import { collectMarkdownPaths } from '../utils/treeOps'
import { filterWikiCandidates, noteTitle, unescapeWikiLinks } from '../utils/wikiLink'

interface MilkdownEditorProps {
  value: string
  /** Custom AI provider, used with priority; falls back to the backend proxy when absent */
  aiProvider?: AIProvider
  onChange?: (value: string) => void
  /** When this value changes, scroll to the corresponding heading */
  targetHeading?: string | null
  /** Bumped when the document is replaced from the OUTSIDE (diary page turn,
   *  agent / calendar write). The editor then swaps the doc in place instead
   *  of remounting — a remount leaves a blank frame that can be painted. */
  contentVersion?: number
  /** Callback when a jump request has been consumed (scrolled to or abandoned); the parent clears targetHeading accordingly */
  onHeadingConsumed?: () => void
  /** The path of the file being edited (used to resolve markdown's internal relative links) */
  filePath?: string
}

/**
 * Resolve a markdown internal link (relative .md path) to a repo-absolute path
 * based on the directory of the current file.
 * E.g. for the current file notes/MarkSeek/Lite-App/README.md,
 * the link ./01-Architecture.md -> notes/MarkSeek/Lite-App/01-Architecture.md
 */
function resolveInternalLink(link: string, baseFilePath?: string): string | null {
  // Only handle relative links pointing at .md files (ignore http/https/anchors/absolute paths)
  if (!link) return null
  if (/^(https?:)?\/\//i.test(link) || link.startsWith('#') || link.startsWith('/')) {
    return null
  }
  if (!link.endsWith('.md')) return null

  const baseDir = baseFilePath ? baseFilePath.replace(/\/[^/]*$/, '') : ''
  // strip the ./ prefix
  const cleaned = link.replace(/^\.\//, '')
  const resolved = baseDir ? `${baseDir}/${cleaned}` : cleaned
  return resolved
}

// Backend-proxy AI provider: send every request to /api/ai/chat uniformly, where the
// backend reads settings.json (aiApiKey/aiBaseURL/aiModel) and proxies the upstream SSE stream.
// The frontend never holds the key nor connects to the upstream directly.
const backendAiProvider: AIProvider = async function* (context: AIPromptContext, signal: AbortSignal) {
  const { document, selection, instruction } = context
  const systemPrompt =
    'You are a professional Markdown document assistant, skilled at polishing, translating, summarizing and expanding text. Output only the revised body content, with no explanation.'
  const userParts: string[] = []
  if (document) userParts.push(`Here is the full document content:\n${document}`)
  if (selection) userParts.push(`Here is the content the user selected:\n${selection}`)
  userParts.push(`Instruction: ${instruction}`)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userParts.join('\n\n') },
  ]

  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`AI request failed (${res.status}): ${errText}`)
  }
  for await (const token of parseSSE(res.body, { signal })) {
    yield token
  }
}

export default function MilkdownEditor({
  value,
  aiProvider,
  onChange,
  targetHeading,
  contentVersion,
  onHeadingConsumed,
  filePath,
}: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const { openFile, fileTree } = useWorkspace()
  // Wikilink support: one resolver for clicks, one popup for typing `[[`.
  const { openWikiLink, pickerNode } = useWikiLinkOpen()
  const notePaths = useMemo(() => collectMarkdownPaths(fileTree), [fileTree])
  const notePathsRef = useRef(notePaths)
  notePathsRef.current = notePaths
  const [suggest, setSuggest] = useState<WikiLinkSuggestState | null>(null)
  const suggestRef = useRef(suggest)
  suggestRef.current = suggest
  // `[[` anchor the user dismissed with Escape: stay quiet until they start a
  // link somewhere else.
  const dismissedFromRef = useRef<number | null>(null)
  // keep the latest filePath / openFile in refs for the once-bound container click listener to read
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  const openWikiRef = useRef(openWikiLink)
  openWikiRef.current = openWikiLink
  // keep the latest onChange in a ref so the effect closure does not capture a stale reference
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // keep the latest onHeadingConsumed in a ref so callback identity changes do not re-trigger the jump effect
  const onHeadingConsumedRef = useRef(onHeadingConsumed)
  onHeadingConsumedRef.current = onHeadingConsumed
  // debounced save timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest value / contentVersion, read by the in-place replacement effect
  // below — the mount effect has `[]` deps and must not depend on them.
  const valueRef = useRef(value)
  valueRef.current = value
  const versionRef = useRef(contentVersion ?? 0)
  versionRef.current = contentVersion ?? 0
  // The version currently loaded into the editor.
  const appliedVersionRef = useRef(contentVersion ?? 0)
  // Set while an outside value is being swapped in: that document change is
  // not a user edit, so it must neither be reported nor persisted.
  const applyingExternalRef = useRef(false)
  // Right-click menu: viewport position of the cursor plus the context the
  // items need (whether anything is selected).
  const [menu, setMenu] = useState<EditorMenuState>({
    visible: false,
    x: 0,
    y: 0,
    hasSelection: false,
  })

  const closeMenu = useCallback(
    () => setMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev)),
    [],
  )

  // Stable so the ProseMirror plugin can be created once and still reach React.
  const handleSuggestChange = useCallback((next: WikiLinkSuggestState | null) => {
    // Leaving the `[[` context forgets a dismissal as soon as the brackets it
    // referred to are gone: retyping `[[` at the very same offset is a NEW
    // link, and it used to stay silent forever because only the offset was
    // remembered.
    if (!next && dismissedFromRef.current !== null) {
      const view = viewRef.current
      if (!view || !isWikiAnchorOpen(view.state.doc, dismissedFromRef.current)) {
        dismissedFromRef.current = null
      }
    }
    // The anchor was dismissed earlier (Esc, scroll, ...): it stays quiet
    // until the user starts a link somewhere else.
    if (next && dismissedFromRef.current === next.from) return
    setSuggest(next)
  }, [])

  const closeSuggest = useCallback(() => {
    dismissedFromRef.current = suggestRef.current?.from ?? null
    setSuggest(null)
  }, [])

  /**
   * Write the picked note into the link being typed.
   * A bare name is enough while it is unique; otherwise the vault path goes in
   * so the link still resolves to exactly one note later on.
   */
  const applySuggestion = useCallback((value: string) => {
    const view = viewRef.current
    const current = suggestRef.current
    dismissedFromRef.current = current?.from ?? null
    setSuggest(null)
    if (!view || !current) return

    // `value` is either a vault path or the query typed for a note that does
    // not exist yet; only the former can be shortened to its name.
    const isPath = notePathsRef.current.includes(value)
    const title = noteTitle(value)
    const ambiguous =
      isPath && notePathsRef.current.filter((p) => noteTitle(p) === title).length > 1
    const label = !isPath ? value : ambiguous ? value.replace(/\.(md|markdown)$/i, '') : title

    const { doc } = view.state
    // The user may already have typed the closing brackets: swallow them
    // instead of leaving `]]]]` behind.
    const closing =
      doc.textBetween(current.to, Math.min(current.to + 2, doc.content.size)) === ']]' ? 2 : 0
    const to = Math.min(current.to + closing, doc.content.size)
    view.dispatch(view.state.tr.insertText(`[[${label}]]`, current.from, to).scrollIntoView())
    view.focus()
  }, [])

  const suggestCandidates = useMemo(
    () =>
      suggest
        ? filterWikiCandidates(suggest.query, { paths: notePaths, fromPath: filePath })
        : [],
    [suggest, notePaths, filePath],
  )

  /**
   * Run one right-click menu action against the live editor.
   *
   * Everything is dispatched through Milkdown's `commandsCtx` (not raw
   * ProseMirror transactions) so the built-in history, Markdown serializer and
   * clipboard plugins stay authoritative. The block conversions deliberately
   * skip Crepe's `ClearTextInCurrentBlock`: that command deletes the whole
   * current block, which is right for a slash menu whose block only holds the
   * "/query" text, but would wipe the paragraph the user right-clicked in.
   */
  const runMenuAction = useCallback((id: EditorActionId) => {
    const crepe = crepeRef.current
    const view = viewRef.current
    if (!crepe || !view) return
    setMenu((prev) => ({ ...prev, visible: false }))

    // Cut / copy go through the native command on purpose: Crepe ships the
    // Milkdown clipboard plugin, so what lands on the clipboard is Markdown —
    // navigator.clipboard.writeText() would flatten it to plain text.
    if (id === 'cut' || id === 'copy') {
      view.focus()
      const ok = document.execCommand(id)
      if (!ok) console.error('[editor] clipboard command failed:', id)
      return
    }

    if (id === 'selectAll') {
      const { state } = view
      // ProseMirror-level select all: execCommand('selectAll') would select the
      // whole page instead of just the document.
      const from = state.doc.resolve(0)
      const to = state.doc.resolve(state.doc.content.size)
      view.dispatch(state.tr.setSelection(TextSelection.between(from, to)))
      view.focus()
      return
    }

    // The menu is portalled into `body`, so clicking an item moves focus out of
    // the editor; take it back before the command reads the selection.
    view.focus()
    crepe.editor.action((ctx) => {
      const commands = ctx.get(commandsCtx)
      switch (id) {
        case 'undo':
          commands.call('Undo')
          break
        case 'redo':
          commands.call('Redo')
          break
        case 'text':
          commands.call('SetBlockType', { nodeType: paragraphSchema.type(ctx) })
          break
        case 'h1':
        case 'h2':
        case 'h3':
          commands.call('SetBlockType', {
            nodeType: headingSchema.type(ctx),
            attrs: { level: id === 'h1' ? 1 : id === 'h2' ? 2 : 3 },
          })
          break
        case 'quote':
          commands.call('WrapInBlockType', { nodeType: blockquoteSchema.type(ctx) })
          break
        case 'bullet':
          commands.call('WrapInBlockType', { nodeType: bulletListSchema.type(ctx) })
          break
        case 'ordered':
          commands.call('WrapInBlockType', { nodeType: orderedListSchema.type(ctx) })
          break
        case 'task':
          commands.call('WrapInBlockType', {
            nodeType: listItemSchema.type(ctx),
            attrs: { checked: false },
          })
          break
      }
    })
  }, [])

  /** Replace the whole document in place, without rebuilding the editor. */
  const applyExternalValue = useCallback((md: string) => {
    const crepe = crepeRef.current
    // Not created yet: `defaultValue` (or the ready callback) covers it.
    if (!crepe || !viewRef.current) return
    // Drop the pending debounced emit — its markdown belongs to the previous
    // document and would be written back over the one we are about to load.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    applyingExternalRef.current = true
    try {
      // flush=true re-creates the state, so history and plugin state are
      // cleared exactly like the old remount did — minus the DOM teardown.
      // `view.updateState` rewrites the DOM synchronously, so the outgoing
      // document stays on screen until the incoming one replaces it.
      crepe.editor.action(replaceAll(md, true))
    } finally {
      applyingExternalRef.current = false
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // True once this mount's cleanup has run. The ProseMirror save plugin below
    // is registered on a Crepe instance that can outlive the effect (its
    // create() is async), so it must stop emitting afterwards.
    let disposed = false

    // Every mount gets its own inner mount node instead of using the React
    // container directly. React reuses the same host node when it re-runs an
    // effect (StrictMode's mount → cleanup → mount, dev only), so two Crepe
    // instances would otherwise append their `.milkdown` to the very same
    // element: the outgoing document sits on top of the incoming one and the
    // content visibly flashes in the middle before it settles at the top.
    // Isolating each instance in its own node makes that impossible — whatever
    // a discarded instance inserts goes into a detached subtree.
    const mount = document.createElement('div')
    mount.style.height = '100%'
    container.appendChild(mount)

    // Decide the AI provider: a custom provider takes priority, otherwise the backend proxy.
    // The provider is never null (backendAiProvider is the fallback), so AI is always available
    // and the AI items in the slash menu and right-click menu always appear.
    const provider = aiProvider ?? backendAiProvider

    // Image upload callback: match the save rule by the current note path and drop the file
    // into the configured directory.
    // Must read filePathRef, not filePath — this callback is defined inside the once-run mount
    // effect, so the filePath in the closure would stay frozen at mount time forever.
    const imageUploadHandler = async (file: File): Promise<string> => {
      return uploadImage(file, filePathRef.current)
    }

    // Load enabled plugins and collect their Milkdown extensions BEFORE the
    // editor is created — nodes/marks cannot be added to a live editor without a
    // full reconfigure, so we await the plugin contributions up-front.
    let crepeInstance: Crepe | null = null
    let editorReady: Promise<unknown> | null = null
    void (async () => {
      if (disposed) return
      await pluginManager.ready()
      if (disposed) return
      const crepe = new Crepe({
      root: mount,
      defaultValue: value,
      features: { [Crepe.Feature.AI]: true },
      featureConfigs: {
        // Disable Crepe's built-in virtual cursor: it positions the caret with
        // raw viewport offsets, which get double-scaled by the outer CSS zoom
        // (.app-layout) and drift with the zoom level. A zoom-aware fork is
        // registered below instead (see src/utils/virtualCursor.ts).
        [Crepe.Feature.Cursor]: { virtual: false },
        [Crepe.Feature.ImageBlock]: {
          onUpload: imageUploadHandler,
        },
        [Crepe.Feature.AI]: { provider },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            const aiGroup = builder.addGroup('ai', t('editor.aiGroup'))
            const aiActions = [
              { key: 'improve', label: t('editor.aiImprove'), instruction: t('editor.aiImproveHint') },
              { key: 'translate', label: t('editor.aiTranslate'), instruction: t('editor.aiTranslateHint') },
              { key: 'summarize', label: t('editor.aiSummarize'), instruction: t('editor.aiSummarizeHint') },
              { key: 'outline', label: t('editor.aiOutline'), instruction: t('editor.aiOutlineHint') },
            ]
            aiActions.forEach(({ key, label, instruction }) => {
              aiGroup.addItem(key, {
                label,
                icon: '✨',
                onRun: (ctx) => {
                  try {
                    const cmd = ctx.get(commandsCtx)
                    cmd?.call('RunAI', { instruction, label })
                  } catch (e) { console.error('[AI slash]', e) }
                },
              })
            })
            aiGroup.addItem('custom-ai', {
              label: t('editor.aiCustom'),
              icon: '💬',
              onRun: (ctx) => {
                const input = window.prompt(t('editor.aiCustomPrompt'))
                if (!input) return
                try {
                  const cmd = ctx.get(commandsCtx)
                  cmd?.call('RunAI', { instruction: input })
                } catch (e) { console.error('[AI slash]', e) }
              },
            })
          },
        },
      },
    })

    // The default commonmark `list_item` schema has no `checked` attribute and
    // no `- [ ]` / `- [x]` serialization. As a result, clicking a task-list
    // checkbox only flips the UI without changing the document, so the state is
    // never persisted. Extend the schema so the `checked` attribute is kept in
    // sync with markdown.
    const taskListItem = listItemSchema.extendSchema((origin) => (ctx) => {
      const base = origin(ctx)
      return {
        ...base,
        attrs: {
          ...base.attrs,
          checked: {
            default: null,
            validate: 'boolean|null',
          },
        },
        parseMarkdown: {
          match: ({ type }) => type === 'listItem',
          runner: (state, node, type) => {
            const label = node.label != null ? `${node.label}.` : '•'
            const listType = node.label != null ? 'ordered' : 'bullet'
            const spread = node.spread != null ? `${node.spread}` : 'true'
            state.openNode(type, {
              label,
              listType,
              spread,
              checked: node.checked == null ? null : node.checked,
            })
            state.next(node.children)
            state.closeNode()
          },
        },
        toMarkdown: {
          match: (node) => node.type.name === 'list_item',
          runner: (state, node) => {
            const checked = node.attrs.checked
            state.openNode('listItem', undefined, {
              spread: node.attrs.spread,
              checked: checked == null ? null : checked,
            })
            state.next(node.content)
            state.closeNode()
          },
        },
      }
    })
    crepe.editor.use(taskListItem)

    // A ProseMirror plugin that persists document changes. We use the plugin's
    // `view.update` hook (instead of overriding dispatchTransaction) so that all
    // of Crepe's built-in interactions — mouse selection, checkbox toggling,
    // etc. — keep working. This reliably catches checkbox toggles, which
    // Crepe's `markdownUpdated` listener does NOT fire on.
    const savePlugin = $prose(
      () =>
        new Plugin({
          view() {
            return {
              update(view, prevState) {
                // A discarded instance can still finish initializing after its
                // cleanup ran; its edits must not reach the (new) tab.
                if (disposed) return
                // The document is being swapped in from outside (date change,
                // outside write): this is not a user edit. Without the guard,
                // the replacement itself would be echoed back as an edit and
                // persisted (and marked dirty) right after loading.
                if (applyingExternalRef.current) return
                if (prevState.doc.eq(view.state.doc)) return
                // Drop any pending debounced save: a newer change supersedes it.
                if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
                // Remark escapes a `[` in prose, which would leave `\[\[target]]`
                // on disk. Restore the brackets so the file keeps real links.
                const md = unescapeWikiLinks(crepe.getMarkdown())
                // A task checkbox toggle only changes a node attribute, so the
                // document text is unchanged while the doc itself differs. Treat
                // such a discrete change as IMMEDIATE; text edits are debounced
                // so a burst of keystrokes collapses into one write.
                const isAttributeOnlyChange =
                  prevState.doc.textContent === view.state.doc.textContent
                if (isAttributeOnlyChange) {
                  onChangeRef.current?.(md)
                } else {
                  saveTimerRef.current = setTimeout(() => {
                    onChangeRef.current?.(md)
                  }, 250)
                }
              },
            }
          },
        }),
    )
    crepe.editor.use(savePlugin)

    // Keep the floating slash menu inside the editor: its list would otherwise
    // keep the upstream fixed height and overflow the editor whenever the caret
    // sits in the middle of the document.
    crepe.editor.use($prose(() => createSlashMenuSizing()))

    // Zoom-aware virtual caret. Same look & DOM as Crepe's built-in one, but
    // divides measured offsets by the effective zoom so it stays glued to the
    // text under the outer CSS zoom at any zoom level.
    crepe.editor.use($prose(() => createVirtualCursor()))

    // A Chinese IME types the full-width `【`: turn a completed `【【` into the
    // `[[` that wiki links need.
    crepe.editor.use($prose(() => createFullWidthBracketInput()))

    // `[[wiki link]]`: styled as a link (brackets dimmed) and clickable,
    // without becoming a schema node — the markdown keeps its brackets.
    crepe.editor.use($prose(() => createWikiLinkDecorations()))
    // Completes `[[` with the notes of the vault.
    crepe.editor.use($prose(() => createWikiLinkAutocomplete(handleSuggestChange)))

    // Inject every editor extension contributed by enabled plugins.
    for (const ext of pluginManager.getExtensions()) {
      crepe.editor.use(ext as never)
    }

    editorReady = crepe.create()
    editorReady
      .then((editor: any) => {
        if (disposed) return
        pluginManager.setEditor(editor)
        const view = editor.ctx.get(editorViewCtx)
        viewRef.current = view

        // A page turn / outside write landed while this instance was still
        // being created: there was no view to swap the doc into back then, so
        // do it now with the newest value.
        if (versionRef.current !== appliedVersionRef.current) {
          appliedVersionRef.current = versionRef.current
          applyExternalValue(valueRef.current)
        }
      })
      .catch(console.error)

    crepeRef.current = crepe
    crepeInstance = crepe
    })()

    return () => {
      disposed = true
      viewRef.current = null
      // Drop the pending debounced emit: the editor is going away (date switch,
      // outside write, tab change) and its buffered markdown belongs to the old
      // document. Firing it after unmount would push stale content back.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      crepeRef.current = null
      // Take this instance's subtree out of the document immediately: anything
      // the pending create() still inserts lands in the detached `mount`, so it
      // can never be painted next to the next instance's document.
      mount.remove()
      // The real teardown has to wait for create() to settle: calling destroy()
      // while the editor is still `OnCreate` makes Milkdown defer it by 50ms,
      // which is long enough to be painted.
      if (editorReady) {
        editorReady
          .catch(() => undefined)
          .then(() => crepeInstance?.destroy())
          .catch(console.error)
      }
    }
  }, []) // key={activeTabId} in MainPanel remounts on tab switch

  // Content replaced from the outside (diary page turn, agent / calendar
  // write): swap the document in place instead of remounting.
  //
  // This used to be "rev changes -> key changes -> Crepe destroyed & rebuilt".
  // React detaches the old DOM during commit, while the new instance only gets
  // its document back once this module's passive effect has run crepe.create()
  // — and whether a vsync lands inside that gap is random (readFile's response
  // arrives at a different phase of the frame every time). That is where the
  // "sometimes flashes" on a diary page turn comes from.
  // Replacing in place keeps the outgoing document on screen until the same
  // synchronous dispatch puts the incoming one there, so there is no gap that
  // can be painted at all. Layout effect (not passive): the swap lands in the
  // same commit as the state change, so the new document is on screen in the
  // very next paint instead of one frame later.
  useLayoutEffect(() => {
    if (versionRef.current === appliedVersionRef.current) return
    // Still initializing: there is no view to swap into, the ready callback
    // picks it up. Leave appliedVersionRef behind so it can detect the gap.
    if (!viewRef.current) return
    appliedVersionRef.current = versionRef.current
    applyExternalValue(valueRef.current)
  }, [contentVersion, applyExternalValue])

  // Intercept in-editor markdown link clicks: relative .md links open a new tab inside the
  // app instead of letting the browser open a new web tab. Other links (http/anchors) keep
  // their native behavior.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // `[[target]]`: resolved against the vault, which may ask the reader to
      // pick one of several notes or to create the missing one.
      const wiki = target?.closest('[data-wikilink]')
      if (wiki) {
        e.preventDefault()
        e.stopPropagation()
        openWikiRef.current(wiki.getAttribute('data-wikilink') || '', {
          fromPath: filePathRef.current,
          coords: { x: e.clientX, y: e.clientY },
        })
        return
      }
      const anchor = target?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      const resolved = resolveInternalLink(href, filePathRef.current)
      if (!resolved) return
      // internal .md link: prevent the browser's default navigation and open inside the app
      e.preventDefault()
      e.stopPropagation()
      void openFileRef.current(resolved)
    }

    container.addEventListener('click', onClick, true)
    return () => container.removeEventListener('click', onClick, true)
  }, [])

  // Right-click inside the editor: show the app's own action menu instead of
  // the browser's native one (spellcheck, "save image", …). Bound once, like
  // the click interceptor above. Covers every surface that mounts this
  // component — notes and the diary page alike.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onContextMenu = (e: MouseEvent) => {
      // Someone deeper already claimed the right-click (a plugin menu, say):
      // leave it alone instead of stacking ours on top.
      if (e.defaultPrevented) return
      // Always consumed: the document must never also get the native menu,
      // even when the editor is still initializing and no action can run.
      e.preventDefault()
      e.stopPropagation()
      const view = viewRef.current
      if (!view) return
      // Right-clicking outside the selection is already handled by
      // ProseMirror's own mousedown handling, so the selection read here is
      // the one the user sees.
      setMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        hasSelection: !view.state.selection.empty,
      })
    }

    container.addEventListener('contextmenu', onContextMenu)
    return () => container.removeEventListener('contextmenu', onContextMenu)
  }, [])

  // When an outline heading is clicked, scroll to the matching heading element in the editor.
  //
  // The jump request is one-shot: whether or not it hits, after handling it we notify the parent
  // via onHeadingConsumed to clear targetHeading. If it lingered, every later editor rebuild
  // (external write bumps rev -> key changes, returning to a tab, diary page turn) would replay
  // this scroll and yank the viewport — already at the top — back to the previously clicked
  // heading; the "clicking the same heading twice does nothing" bug also comes from this
  // (value unchanged -> effect does not re-run).
  useEffect(() => {
    if (!targetHeading) return
    const container = containerRef.current
    if (!container) return
    // wait a tick to ensure the editor has rendered
    const id = setTimeout(() => {
      const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      for (const tag of tags) {
        const els = container.querySelectorAll(tag)
        for (const el of els) {
          if (el.textContent?.trim() === targetHeading) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            onHeadingConsumedRef.current?.()
            return
          }
        }
      }
      // not found: still consume it, otherwise the lingering request would fire again on the next rebuild
      onHeadingConsumedRef.current?.()
    }, 100)
    return () => clearTimeout(id)
  }, [targetHeading])

  return (
    <>
      <div ref={containerRef} style={{ height: '100%' }} />
      <EditorContextMenu state={menu} onAction={runMenuAction} onClose={closeMenu} />
      <WikiLinkSuggest
        state={suggest}
        candidates={suggestCandidates}
        onPick={applySuggestion}
        onClose={closeSuggest}
      />
      {pickerNode}
    </>
  )
}
