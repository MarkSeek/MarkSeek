// Platform detection shared by every keyboard-shortcut hint in the UI.
//
// Duplicated in two components before (`navigator.platform` is deprecated, so
// one place is also the only place to swap in a better source later).
// Resolved once at module load: the platform cannot change during a session.
const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform

/** True on macOS / iOS, where shortcuts use ⌘ instead of Ctrl. */
export const isMac = /Mac|iPhone|iPad/.test(PLATFORM)
