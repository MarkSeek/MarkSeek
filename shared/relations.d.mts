// Type declarations for relations.mjs.
//
// The implementation is plain ESM so the Node backend and the TypeScript
// frontend can both import it without a build step; this file is what gives
// the frontend its types (`.d.mts` is the declaration form of `.mjs`).

/** What an outgoing link points at. */
export type LinkKind = 'file' | 'wiki' | 'external'

export interface NoteRef {
  /** file relative path, e.g. "docs/requirements.md" */
  path: string
  /** display name without extension */
  name: string
  /** optional matched line/text snippet for backlinks */
  snippet?: string
  /** wiki / file links open inside the app, external ones in the browser. */
  kind?: LinkKind
  /** full URL, for `external` links only */
  href?: string
  /**
   * Raw `[[target]]` text, for `wiki` links only. Resolution needs the whole
   * vault, which the panel only has at click time.
   */
  raw?: string
}

export interface TagEntry {
  tag: string
  /** other notes (excluding current) that share this tag */
  others: NoteRef[]
}

export interface TaskEntry {
  text: string
  done: boolean
}

export interface RelationResult {
  backLinks: NoteRef[]
  outLinks: NoteRef[]
  tags: TagEntry[]
  tasks: TaskEntry[]
}

export interface RelationInput {
  path: string
  content: string
}

export declare function parseOutLinks(note: RelationInput): NoteRef[]
export declare function parseBackLinks(
  current: RelationInput,
  all: RelationInput[],
): NoteRef[]
export declare function parseTags(note: RelationInput): string[]
export declare function parseTagMatrix(
  current: RelationInput,
  all: RelationInput[],
): TagEntry[]
export declare function parseTasks(note: RelationInput): TaskEntry[]
export declare function analyzeRelations(
  current: RelationInput,
  all: RelationInput[],
): RelationResult
