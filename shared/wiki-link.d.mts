// Type declarations for wiki-link.mjs.
//
// The implementation is plain ESM so the Node backend and the TypeScript
// frontend can both import it without a build step; this file is what gives
// the frontend its types (`.d.mts` is the declaration form of `.mjs`).

export declare const WIKI_LINK_RE: RegExp

export interface WikiTarget {
  /** Path-ish part, e.g. "dir1/file1" */
  target: string
  /** Text after `|`, shown instead of the target when present. */
  alias?: string
  /** Text after `#`, a heading inside the target note. */
  anchor?: string
}

export type WikiLinkResult =
  | { status: 'unique'; path: string }
  | { status: 'ambiguous'; candidates: string[]; target: string }
  | { status: 'missing'; target: string; createPath: string }

export interface ResolveOptions {
  /** Every markdown path in the vault, relative to its root. */
  paths: string[]
  /** Path of the note the link was written in; drives relative matches. */
  fromPath?: string
}

export declare function unescapeWikiLinks(md: string): string
export declare function cleanWikiText(text: string): string
export declare function dirName(p: string): string
export declare function baseName(p: string): string
export declare function noteTitle(p: string): string
export declare function parseWikiTarget(raw: string): WikiTarget
export declare function suggestCreatePath(target: string, fromPath?: string): string
export declare function resolveWikiLink(
  raw: string,
  options: ResolveOptions,
): WikiLinkResult
export declare function filterWikiCandidates(
  query: string,
  options: ResolveOptions & { limit?: number },
): string[]
