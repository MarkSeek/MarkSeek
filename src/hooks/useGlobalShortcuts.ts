import { useEffect, useRef } from 'react'
import type { WorkspaceContextValue } from '../context/WorkspaceContext'

export interface PanelToggles {
  onToggleLeft: () => void
  onToggleRight: () => void
}

export interface ShortcutAction {
  /** Combo identifier, e.g. 'mod+k' / 'mod+shift+n' / 'alt+arrowleft' */
  combo: string
  /** Synonym combos that trigger the same action (e.g. search supports both mod+k and mod+p) */
  aliases?: string[]
  /** i18n key, used for display in the settings panel */
  labelKey: string
  /** Whether to yield to the editor when it is focused (no interception) */
  deferToEditor?: boolean
  run: (ctx: WorkspaceContextValue, toggles: PanelToggles) => void
}

/** Offset the current diary tab's ymd by one day, returning YYYY-MM-DD; falls back to today when no diary tab is open */
function shiftDiaryYmd(ctx: WorkspaceContextValue, deltaDays: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const diaryTab = ctx.openTabs.find((t) => t.kind === 'diary')
  let base: Date
  if (diaryTab?.filePath) {
    const m = diaryTab.filePath.match(/(\d{4}-\d{2}-\d{2})/)
    base = m ? new Date(m[1] + 'T00:00:00') : new Date()
  } else {
    base = new Date()
  }
  base.setDate(base.getDate() + deltaDays)
  return fmt(base)
}

import { SHORTCUT_EVENTS } from './shortcutEvents'

/** Dispatch a shortcut action event (detail is passed through); every action that depends on ctx methods goes through the event bus,
 * listened to uniformly inside WorkspaceContext, which calls the latest ctx methods, fully avoiding the HMR stale-instance-missing-methods problem. */
const dispatch = (name: string, detail?: unknown) =>
  document.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }))

/** Global shortcut mapping table (defined centrally for easier extension and display)
 * Notes:
 *  - Items flagged deferToEditor yield to the editor's native shortcuts when the editor is focused (to avoid conflicts with Milkdown).
 *  - Combos hard-claimed by the browser (Ctrl+N new window, Ctrl+W close tab, Ctrl+Tab switch tab, Ctrl+D bookmark,
 *    Ctrl+Shift+C inspect element, Ctrl+K address bar, etc.) cannot be intercepted by the page, so idle mod+alt+* combos are used instead.
 *  - Except for the toggle panel switches (which call toggles directly), all actions are dispatched through the event bus and do not depend on ctx methods.
 */
export const SHORTCUTS: ShortcutAction[] = [
  {
    combo: 'mod+k',
    aliases: ['mod+p'],
    labelKey: 'shortcuts.search',
    run: () => dispatch(SHORTCUT_EVENTS.search),
  },
  {
    combo: 'mod+b',
    labelKey: 'shortcuts.toggleLeft',
    // yield to Milkdown's bold (Mod-b) when the editor is focused
    deferToEditor: true,
    run: (_ctx, toggles) => toggles.onToggleLeft(),
  },
  {
    combo: 'mod+\\',
    labelKey: 'shortcuts.toggleRight',
    run: (_ctx, toggles) => toggles.onToggleRight(),
  },
  {
    combo: 'mod+,',
    labelKey: 'shortcuts.openSettings',
    run: () => dispatch(SHORTCUT_EVENTS.openSettings),
  },
  {
    // the original mod+n is claimed by the browser's "new window", so use mod+alt+n
    combo: 'mod+alt+n',
    labelKey: 'shortcuts.newNote',
    run: () => dispatch(SHORTCUT_EVENTS.newNote),
  },
  {
    // the original mod+shift+n is claimed by the browser's "incognito window", so use mod+alt+f (folder)
    combo: 'mod+alt+f',
    labelKey: 'shortcuts.newFolder',
    run: () => dispatch(SHORTCUT_EVENTS.newFolder),
  },
  {
    combo: 'mod+s',
    labelKey: 'shortcuts.save',
    // always intercept the browser's "save page" default and save the active file directly
    run: (ctx) => {
      if (ctx.activeTabId) dispatch(SHORTCUT_EVENTS.save, ctx.activeTabId)
    },
  },
  {
    // the original mod+w is claimed by the browser's "close tab", so use mod+alt+w
    combo: 'mod+alt+w',
    labelKey: 'shortcuts.closeTab',
    run: (ctx) => {
      if (ctx.activeTabId) dispatch(SHORTCUT_EVENTS.closeTab, ctx.activeTabId)
    },
  },
  {
    // the original mod+tab is claimed by the browser's "switch tab", so use mod+shift+[ (yields in edit mode)
    combo: 'mod+shift+[',
    labelKey: 'shortcuts.nextTab',
    deferToEditor: true,
    run: () => dispatch(SHORTCUT_EVENTS.nextTab),
  },
  {
    // the original mod+shift+tab is claimed, so use mod+shift+]
    combo: 'mod+shift+]',
    labelKey: 'shortcuts.prevTab',
    deferToEditor: true,
    run: () => dispatch(SHORTCUT_EVENTS.prevTab),
  },
  {
    // the original mod+d is claimed by the browser's "bookmark", so use mod+alt+d
    combo: 'mod+alt+d',
    labelKey: 'shortcuts.todayNote',
    run: () => dispatch(SHORTCUT_EVENTS.todayNote),
  },
  {
    combo: 'alt+arrowleft',
    labelKey: 'shortcuts.prevDiary',
    // yield to ProseMirror's word-by-word cursor movement when the editor is focused
    deferToEditor: true,
    run: (ctx) => dispatch(SHORTCUT_EVENTS.prevDiary, shiftDiaryYmd(ctx, -1)),
  },
  {
    combo: 'alt+arrowright',
    labelKey: 'shortcuts.nextDiary',
    deferToEditor: true,
    run: (ctx) => dispatch(SHORTCUT_EVENTS.nextDiary, shiftDiaryYmd(ctx, 1)),
  },
  {
    // the original mod+shift+c is claimed by DevTools' "inspect element", so use mod+alt+c
    combo: 'mod+alt+c',
    labelKey: 'shortcuts.openCalendar',
    run: () => dispatch(SHORTCUT_EVENTS.openCalendar),
  },
  {
    combo: 'mod+shift+a',
    labelKey: 'shortcuts.openLiteApp',
    run: () => dispatch(SHORTCUT_EVENTS.openLiteApp),
  },
]

const comboToKey = (e: KeyboardEvent): string => {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  let key = e.key.toLowerCase()
  // Under Shift, punctuation becomes its shifted symbol (e.g. Ctrl+Shift+[ has e.key '{'); restore the base symbol
  const shiftPunct: Record<string, string> = {
    '{': '[', '}': ']', '<': ',', '>': '.', '?': '/', '!': '1', '@': '2',
    '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9',
    ')': '0', '+': '=', _: '-', '|': '\\', '~': '`',
  }
  if (e.shiftKey && shiftPunct[key]) key = shiftPunct[key]
  if (key === ' ') key = 'space'
  parts.push(key)
  return parts.join('+')
}

const isEditing = (): boolean => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  // editor focused (Milkdown renders as a contenteditable inside .milkdown)
  if (el.closest('.milkdown') && (el as HTMLElement).isContentEditable) return true
  // other editable areas: input / textarea / contenteditable
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

/** Mount the global keyboard shortcut listener; dependencies are held in refs to avoid rebuilding the listener repeatedly */
export function useGlobalShortcuts(getCtx: () => WorkspaceContextValue, toggles: PanelToggles): void {
  const ctxRef = useRef(getCtx)
  ctxRef.current = getCtx
  const togglesRef = useRef(toggles)
  togglesRef.current = toggles

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = comboToKey(e)
      const action = SHORTCUTS.find(
        (s) => s.combo === combo || (s.aliases?.includes(combo) ?? false),
      )
      if (!action) return
      // edit-mode avoidance: only keys flagged deferToEditor (e.g. mod+s) yield to the editor's native handling;
      // other shortcuts still fire when the editor is focused, so common operations are not swallowed.
      if (isEditing() && action.deferToEditor) return
      // handle in the capture phase so it is not swallowed by editor/component stopPropagation
      e.preventDefault()
      e.stopPropagation()
      if (combo === 'mod+k' || combo === 'mod+p') {
        // debug: confirm the search shortcut is hit (safe to remove when no longer needed)
        console.debug('[shortcut] search hit', combo, 'editing=', isEditing())
      }
      action.run(ctxRef.current(), togglesRef.current)
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])
}
