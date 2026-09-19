// Shared plugin types for the MarkSeek plugin system.
//
// A plugin is a folder under the global plugins directory containing:
//   - plugin.json  : the manifest (id, name, entry, contributes)
//   - <entry>      : an ESM module whose default export is `activate(api)`
//
// The renderer loads enabled plugins before the editor is created and collects
// the contributions they register through the Plugin SDK (`window.markseek`).
import type { Lang } from '../src/i18n'

export interface PluginThemeContribution {
  id: string
  label: string
  css: string
}

export interface PluginManifestContributes {
  themes?: { id: string; label: string }[]
  editorExtensions?: { type: 'node' | 'mark'; name: string }[]
}

/**
 * Translated copy shipped inside `plugin.json`.
 *
 * Plugins are self-contained folders, so their translations travel with them
 * instead of living in the app dictionaries — that also lets third-party plugins
 * be translated without a host release. The root `name` / `description` stay the
 * fallback for any language a plugin does not cover.
 */
export interface PluginManifestText {
  name?: string
  description?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** ESM entry relative to the plugin folder, e.g. "index.js". */
  entry: string
  contributes?: PluginManifestContributes
  /** Localized name/description keyed by language, e.g. `{ "zh-CN": { … } }`. */
  i18n?: Partial<Record<Lang, PluginManifestText>>
}

/** Plugin as returned by GET /api/plugins (manifest + enabled flag). */
export interface PluginInfo extends PluginManifest {
  enabled: boolean
}

export interface SidebarPanelContribution {
  id: string
  title: string
  render: (container: HTMLElement) => void
}

/**
 * What the host hands to a page renderer: the file it is showing, its content,
 * and the one way back — `onChange`. Renderers never touch the file system,
 * sessions or i18n: they report new content and the host saves it like the
 * content of any other editor.
 */
export interface PageRendererContext {
  /** Path of the file being rendered, relative to the vault. */
  filePath: string
  /** Current content of the file. */
  content: string
  /** Report new content; the host buffers it as a draft and autosaves it. */
  onChange: (content: string) => void
}

/**
 * A mounted page. The host destroys it whenever the tab goes away; renderers
 * are expected to flush a pending edit before returning from `destroy`.
 */
export interface PageRendererHandle {
  destroy: () => void
}

/**
 * A whole-main-panel page for the files a plugin owns.
 *
 * This is the page-level counterpart of a node view: where a node view draws
 * inside a Markdown document, a page renderer takes over the entire editor
 * area for a file (e.g. a `*.excalidraw.md` canvas note). Mounting is
 * imperative — the host only supplies a container — so a renderer is free to
 * bring its own framework and React root, exactly like node views do.
 */
export interface PageRendererContribution {
  id: string
  /** Whether this renderer owns `filePath`. */
  match: (filePath: string) => boolean
  /** Mount a page into `container` and return its handle. */
  mount: (container: HTMLElement, ctx: PageRendererContext) => PageRendererHandle
  /** Optional icon name from the host icon set, shown on the file's tab. */
  icon?: string
}

/**
 * The API surface exposed to plugins through `window.markseek`. A plugin never
 * imports application modules directly — it only relies on this SDK so it stays
 * dependency-free and shares the same Milkdown/React instances as the host app.
 */
export interface MarkseekPluginApi {
  /** The host application's React instance (for node views, etc.). */
  React: typeof import('react')
  /** Create a React root bound to the host React (use for node views). */
  createRoot: (container: HTMLElement) => import('react-dom/client').Root
  /** Define a Milkdown node schema (Milkdown `$node`). */
  $node: typeof import('@milkdown/utils').$node
  /** Attach a node/mark view to a Milkdown type (Milkdown `$view`). */
  $view: typeof import('@milkdown/utils').$view
  /** Wrap a ProseMirror plugin as a Milkdown plugin (Milkdown `$prose`). */
  $prose: typeof import('@milkdown/utils').$prose
  /** Wrap a remark (markdown) plugin as a Milkdown plugin (Milkdown `$remark`). */
  $remark: typeof import('@milkdown/utils').$remark
  /** ProseMirror input rule helper that inserts a node. */
  nodeInputRule: (
    regexp: RegExp,
    type: unknown,
    getAttrs?: (match: RegExpMatchArray) => Record<string, unknown> | null,
  ) => unknown
  /** ProseMirror input rules plugin factory. */
  inputRules: typeof import('@milkdown/prose/inputrules').inputRules
  /** Tiny helper to merge attribute objects (Milkdown has no built-in one). */
  mergeAttributes: (...attrs: Record<string, unknown>[]) => Record<string, unknown>
  /** Register a Milkdown extension (node/mark/remark/view) to inject into the editor. */
  registerEditorExtension: (plugin: unknown) => void
  /** Register a new color theme (CSS variables + label) contributed by a plugin. */
  registerTheme: (theme: PluginThemeContribution) => void
  /** Register a custom sidebar panel. */
  registerSidebarPanel: (panel: SidebarPanelContribution) => void
  /**
   * Register a whole-page renderer for the files this plugin owns. The host
   * mounts it into the editor area instead of the Markdown editor whenever a
   * matching file is opened.
   */
  registerPageRenderer: (renderer: PageRendererContribution) => void
  /** Read the current settings map. */
  getSettings: () => Record<string, unknown>
  /** Insert a block node of the given type at the current selection. */
  insertNode: (typeName: string, attrs?: Record<string, unknown>) => void
}

declare global {
  interface Window {
    markseek?: MarkseekPluginApi
    __markseekEditor?: { editor: unknown } | null
  }
}
