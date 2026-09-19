// Every localStorage key the app owns, in one place.
//
// All keys live under the `markseek.` prefix. Legacy aliases from earlier
// brand renames are intentionally dropped: this release does not migrate old
// data, so a stale key is never read or promoted.
export const STORAGE_PREFIX = 'markseek.'

export const KEYS = {
  /** Session snapshot, scoped per vault inside the payload. */
  session: 'markseek.session.v1',
  /** Recently opened notes. */
  recent: 'markseek.recent.v1',
  lang: 'markseek.lang',
  theme: 'markseek.theme',
  liteAppActive: 'markseek.liteapp.active',
  liteAppMode: 'markseek.liteapp.mode',
  relationSections: 'markseek.relation.sections',
  relationOpen: 'markseek.relation.open',
  /** Payload of the task being dragged from the calendar. */
  dragTask: 'markseek.drag.task',
  /** Base keys of the two chat surfaces; conversations hang off them. */
  chatBase: {
    home: 'markseek.chat.home',
    right: 'markseek.chat.right',
  },
} as const

/**
 * Simple key renames, mapped to their replacement. With data migration removed
 * for this release this map is empty — old keys are never read or promoted.
 */
export const LEGACY_KEYS: Record<string, string> = {}

/**
 * Sidebar widths that predate the session snapshot. They are read once and
 * folded into `session.layout` instead of being kept alive.
 */
export const LEGACY_WIDTH_KEYS = {
  left: 'leftSidebarWidth',
  right: 'rightPanelWidth',
} as const

/* ======== Conversations ========
 * Conversations hang off a chat base key. Legacy bases from earlier brand
 * names are dropped for this release, so every getter only targets the
 * current `markseek.*` key.
 */

/** Fallback bases for a chat surface. Intentionally empty (no migration). */
export function legacyChatBases(_base: string): readonly string[] {
  return []
}

/** Conversation list of one chat surface. */
export function convMetaKey(base: string): string {
  return `markseek.conv.meta.${base}`
}

export function legacyConvMetaKeys(_base: string): readonly string[] {
  return []
}

/** Id of the conversation that was last open. */
export function convActiveKey(base: string): string {
  return `markseek.conv.active.${base}`
}

export function legacyConvActiveKeys(_base: string): readonly string[] {
  return []
}

/** Plain chat messages of one conversation. */
export function convMessagesKey(base: string, id: string): string {
  return `markseek.conv.msgs.${base}.${id}`
}

export function legacyConvMessagesKeys(_base: string, _id: string): readonly string[] {
  return []
}

/** Agent chat messages of one conversation. */
export function convAgentKey(base: string, id: string): string {
  return `markseek.conv.agent.${base}.${id}`
}

export function legacyConvAgentKeys(_base: string, _id: string): readonly string[] {
  return []
}

/** Every key a chat surface can own, for bulk operations. */
export function allConvKeys(base: string): string[] {
  return [convMetaKey(base), convActiveKey(base)]
}
