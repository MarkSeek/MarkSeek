/** Global event names for each shortcut action (event bus, independent of any ctx method to avoid HMR stale instances missing methods).
 * Dispatched by useGlobalShortcuts and listened to uniformly inside WorkspaceContext, which calls the latest ctx methods.
 */
export const SHORTCUT_EVENTS = {
  search: 'markseek:act:search',
  openSettings: 'markseek:act:open-settings',
  newNote: 'markseek:act:new-note',
  newFolder: 'markseek:act:new-folder',
  save: 'markseek:act:save',
  closeTab: 'markseek:act:close-tab',
  nextTab: 'markseek:act:next-tab',
  prevTab: 'markseek:act:prev-tab',
  todayNote: 'markseek:act:today-note',
  prevDiary: 'markseek:act:prev-diary',
  nextDiary: 'markseek:act:next-diary',
  openCalendar: 'markseek:act:open-calendar',
  openLiteApp: 'markseek:act:open-lite-app',
  openHome: 'markseek:act:open-home',
} as const

export type ShortcutEventName = (typeof SHORTCUT_EVENTS)[keyof typeof SHORTCUT_EVENTS]
