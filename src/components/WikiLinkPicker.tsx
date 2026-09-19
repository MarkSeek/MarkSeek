import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { dirName, noteTitle } from '../utils/wikiLink'
import { Icon } from './icons/Icon'

/**
 * Floating menu shown when a `[[wiki link]]` does not resolve to exactly one
 * note: it either names several notes (pick one) or none at all (optionally
 * create it).
 */
export interface WikiLinkPickerState {
  /** Viewport coordinates of the click; the anchor is `fixed`. */
  x: number
  y: number
  /** The raw target the user wrote inside the brackets. */
  target: string
  /** Notes whose name matches; empty when the target is missing. */
  candidates: string[]
  /** Path the "create" entry would write to; empty when already resolved. */
  createPath: string
}

interface WikiLinkPickerProps {
  state: WikiLinkPickerState | null
  onPick: (path: string) => void
  onCreate: (path: string) => void
  onClose: () => void
}

export default function WikiLinkPicker({ state, onPick, onCreate, onClose }: WikiLinkPickerProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const open = state !== null
  // Number of rows (candidates + the optional create entry) decides what the
  // arrow keys can reach.
  const rowCount = state ? state.candidates.length + (state.createPath ? 1 : 0) : 0

  useEffect(() => {
    setActive(0)
  }, [state])

  // Dismiss on anything that invalidates the click position, and let the
  // keyboard drive the list while it is open.
  useEffect(() => {
    if (!open || !state) return
    const onMouseDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (rowCount === 0 ? 0 : (i + 1) % rowCount))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (state.createPath && active === 0) {
          onCreate(state.createPath)
          return
        }
        const idx = active - (state.createPath ? 1 : 0)
        const picked = state.candidates[idx]
        if (picked) onPick(picked)
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [open, state, active, rowCount, onPick, onCreate, onClose])

  // Keep the menu inside the viewport. The rect is already zoom-scaled, so
  // comparing it against window.innerWidth is correct under the app zoom.
  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!state || !el) return
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

  if (!state) return null

  // "Create" sits at the front: when the target is missing it is the only
  // action, and when several notes share the name it stays one keystroke away.
  const hasCreate = Boolean(state.createPath)
  const createIndex = 0
  const firstCandidate = hasCreate ? 1 : 0

  return createPortal(
    <div
      ref={anchorRef}
      className="wiki-picker-anchor"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 2100 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The anchor carries no zoom so left/top map 1:1 onto the click; the
          inner wrapper restores the app zoom for visual consistency. */}
      <div className="wiki-picker">
        <div className="wiki-picker-head">
          {state.candidates.length > 0
            ? t('wiki.pickTitle')
            : t('wiki.missingTitle', { name: state.target })}
        </div>
        {state.candidates.length > 0 && (
          <div className="wiki-picker-hint">{t('wiki.pickHint')}</div>
        )}

        {hasCreate && (
          <button
            type="button"
            className={`wiki-picker-item is-create${createIndex === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(createIndex)}
            onClick={() => onCreate(state.createPath)}
          >
            <span className="wiki-picker-icon">
              <Icon name="plus" size={14} />
            </span>
            <span className="wiki-picker-body">
              <span className="wiki-picker-name">{t('wiki.create')}</span>
              <span className="wiki-picker-path">
                {t('wiki.createHint', { path: state.createPath })}
              </span>
            </span>
          </button>
        )}

        {state.candidates.length > 0 && (
          <>
            {hasCreate && <div className="wiki-picker-sep" />}
            {state.candidates.map((path, i) => {
              const index = firstCandidate + i
              return (
                <button
                  key={path}
                  type="button"
                  className={`wiki-picker-item${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(path)}
                >
                  <span className="wiki-picker-icon">
                    <Icon name="file" size={14} />
                  </span>
                  <span className="wiki-picker-body">
                    <span className="wiki-picker-name">{noteTitle(path)}</span>
                    <span className="wiki-picker-path">{dirName(path) || path}</span>
                  </span>
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
