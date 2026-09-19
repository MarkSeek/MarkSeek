import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { isMac } from '../utils/platform'

export interface EditorMenuState {
  visible: boolean
  /** Viewport coordinates of the cursor; the anchor is `fixed`, so they map 1:1. */
  x: number
  y: number
  /** Selection is non-empty — cut / copy are only offered then. */
  hasSelection: boolean
}

export type EditorActionId =
  | 'undo' | 'redo' | 'cut' | 'copy' | 'selectAll'
  | 'text' | 'h1' | 'h2' | 'h3' | 'quote'
  | 'bullet' | 'ordered' | 'task'

interface MenuItem {
  id: EditorActionId
  label: string
  /** Accelerator hint rendered on the right, already formatted for the platform. */
  shortcut?: string
  /** Item only makes sense with a non-empty selection. */
  needsSelection?: boolean
}

// Accelerator hints. `isMac` also decides the separator: macOS writes ⌘⇧Z,
// Windows/Linux writes Ctrl+Shift+Z.
const MOD = isMac ? '⌘' : 'Ctrl'
const ALT = isMac ? '⌥' : 'Alt'
const SHIFT = isMac ? '⇧' : 'Shift'
const combo = (...parts: string[]) => parts.join(isMac ? '' : '+')

/**
 * Menu definition. Shortcuts mirror the keymaps Milkdown actually installs
 * (commonmark: Mod-Alt-0..6 / Mod-Shift-b), so the hints never advertise a key
 * that does nothing.
 */
function buildGroups(): MenuItem[][] {
  return [
    [
      { id: 'undo', label: t('editor.ctx.undo'), shortcut: combo(MOD, 'Z') },
      { id: 'redo', label: t('editor.ctx.redo'), shortcut: combo(MOD, SHIFT, 'Z') },
      { id: 'cut', label: t('editor.ctx.cut'), shortcut: combo(MOD, 'X'), needsSelection: true },
      { id: 'copy', label: t('editor.ctx.copy'), shortcut: combo(MOD, 'C'), needsSelection: true },
      { id: 'selectAll', label: t('editor.ctx.selectAll'), shortcut: combo(MOD, 'A') },
    ],
    [
      { id: 'text', label: t('editor.ctx.text'), shortcut: combo(MOD, ALT, '0') },
      { id: 'h1', label: t('editor.ctx.h1'), shortcut: combo(MOD, ALT, '1') },
      { id: 'h2', label: t('editor.ctx.h2'), shortcut: combo(MOD, ALT, '2') },
      { id: 'h3', label: t('editor.ctx.h3'), shortcut: combo(MOD, ALT, '3') },
      { id: 'quote', label: t('editor.ctx.quote'), shortcut: combo(MOD, SHIFT, 'B') },
    ],
    [
      { id: 'bullet', label: t('editor.ctx.bullet') },
      { id: 'ordered', label: t('editor.ctx.ordered') },
      { id: 'task', label: t('editor.ctx.task') },
    ],
  ]
}

export default function EditorContextMenu({ state, onAction, onClose }: {
  state: EditorMenuState
  onAction: (id: EditorActionId) => void
  onClose: () => void
}) {
  const anchorRef = useRef<HTMLDivElement>(null)

  // Dismiss on anything that invalidates the cursor position or the context:
  // a click outside, Escape, a resize, a window blur, or a scroll anywhere in
  // the page (the editor scrolls in its own container, hence capture phase).
  useEffect(() => {
    if (!state.visible) return
    const onMouseDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [state.visible, onClose])

  // Keep the menu inside the viewport. Measured after layout and applied
  // straight to the DOM: a state round-trip would paint one frame at the
  // unclamped position first. The rect is already zoom-scaled, so comparing it
  // against window.innerWidth is correct under the app zoom.
  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!state.visible || !el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let x = state.x
    let y = state.y
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [state])

  if (!state.visible) return null

  return createPortal(
    <div
      ref={anchorRef}
      className="editor-context-menu-anchor"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 2000 }}
      // The menu lives in `body`, outside the editor container, so the editor's
      // own contextmenu handler never sees this — block the native menu here too.
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The anchor carries no `zoom` so left/top map 1:1 onto the cursor; the
          inner wrapper restores the app zoom for visual consistency. */}
      <div className="editor-context-menu">
        {buildGroups().map((group, index) => (
          <div key={index} className="editor-context-group">
            {index > 0 && <div className="editor-context-sep" />}
            {group.map((item) => {
              const disabled = !!item.needsSelection && !state.hasSelection
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`editor-context-item${disabled ? ' disabled' : ''}`}
                  disabled={disabled}
                  onClick={() => onAction(item.id)}
                >
                  <span className="editor-context-label">{item.label}</span>
                  {item.shortcut ? <span className="editor-context-shortcut">{item.shortcut}</span> : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
