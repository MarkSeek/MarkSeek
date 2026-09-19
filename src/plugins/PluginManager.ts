// PluginManager: discovers enabled plugins from the backend, dynamically imports
// their ESM entries, and collects the contributions they register through the
// Plugin SDK. The editor waits on `ready()` before being created so every
// contributed Milkdown extension is available up-front.
//
// All plugin files are served same-origin at `/plugins/<id>/<entry>`, so no extra
// base URL is required in Electron or in the Vite dev middleware.
import { editorViewCtx } from '@milkdown/core'
import type {
  MarkseekPluginApi,
  PageRendererContribution,
  PluginInfo,
  SidebarPanelContribution,
} from '../../plugins/types'

class PluginManager {
  private extensions: unknown[] = []
  private panels: SidebarPanelContribution[] = []
  private pageRenderers: PageRendererContribution[] = []
  private editor: unknown = null
  private readyPromise: Promise<void> | null = null
  // Bumped whenever a contribution is registered so views can re-render as
  // plugins stream in (they load asynchronously, after the first paint).
  private contributionRevision = 0
  private listeners = new Set<() => void>()

  setEditor(editor: unknown): void {
    this.editor = editor
  }

  registerEditorExtension(plugin: unknown): void {
    this.extensions.push(plugin)
    this.notifyContributions()
  }

  registerSidebarPanel(panel: SidebarPanelContribution): void {
    this.panels.push(panel)
    this.notifyContributions()
  }

  registerPageRenderer(renderer: PageRendererContribution): void {
    this.pageRenderers.push(renderer)
    this.notifyContributions()
  }

  getExtensions(): unknown[] {
    return this.extensions
  }

  getPanels(): SidebarPanelContribution[] {
    return this.panels
  }

  /** The renderer that owns `filePath`, if a plugin registered one. */
  getPageRenderer(filePath: string): PageRendererContribution | undefined {
    return this.pageRenderers.find((renderer) => {
      try {
        return renderer.match(filePath)
      } catch {
        return false
      }
    })
  }

  /** Subscribe to contribution changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Snapshot for useSyncExternalStore: changes whenever contributions do. */
  getContributionRevision(): number {
    return this.contributionRevision
  }

  /** Resolves once all enabled plugins have been loaded and activated. */
  ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.load()
    return this.readyPromise
  }

  private notifyContributions(): void {
    this.contributionRevision += 1
    for (const listener of [...this.listeners]) listener()
  }

  private async load(): Promise<void> {
    let list: PluginInfo[] = []
    try {
      const res = await fetch('/api/plugins')
      if (!res.ok) {
        console.error('[plugins] /api/plugins responded', res.status)
        return
      }
      const data = (await res.json()) as { plugins?: PluginInfo[] }
      list = data.plugins ?? []
    } catch (err) {
      // Plugins are optional; a missing backend should not block the editor.
      console.error('[plugins] failed to fetch plugin list', err)
      return
    }
    console.info(`[plugins] discovered ${list.length} plugin(s):`, list.map((p) => p.id))
    for (const info of list) {
      if (!info.enabled) continue
      await this.loadPlugin(info)
    }
  }

  private async loadPlugin(info: PluginInfo): Promise<void> {
    try {
      const url = `/plugins/${encodeURIComponent(info.id)}/${info.entry}`
      const mod = await import(/* @vite-ignore */ url)
      const activate = mod.default
      if (typeof activate === 'function') {
        activate(this.getApi())
        console.info(`[plugins] activated "${info.id}"`)
      } else {
        console.error(`[plugins] "${info.id}" has no default export activate(api)`)
      }
    } catch (err) {
      console.error(`[plugins] failed to load "${info.id}"`, err)
    }
  }

  private getApi(): MarkseekPluginApi {
    // Set up early by setupPluginSdk() in src/plugins/sdk.ts.
    return window.markseek as MarkseekPluginApi
  }

  /** Insert a block node of `typeName` with `attrs` at the current selection. */
  insertNode(typeName: string, attrs?: Record<string, unknown>): void {
    const editor = this.editor as
      | { action: (fn: (ctx: import('@milkdown/ctx').Ctx) => void) => void }
      | null
    if (!editor) return
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx) as import('@milkdown/prose/view').EditorView
        const { state } = view
        const type = state.schema.nodes[typeName]
        if (!type) return
        const node = type.create(attrs ?? {})
        const tr = state.tr.replaceSelectionWith(node)
        view.dispatch(tr)
        view.focus()
      })
    } catch (err) {
      console.error('[plugins] insertNode failed', err)
    }
  }
}

export const pluginManager = new PluginManager()
