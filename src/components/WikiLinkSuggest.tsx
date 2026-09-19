import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import type { WikiLinkSuggestState } from '../utils/wikiLinkAutocomplete'
import { dirName, noteTitle } from '../utils/wikiLink'
import { Icon } from './icons/Icon'

interface WikiLinkSuggestProps {
  /** `null` while the caret is not inside an unfinished `[[`. */
  state: WikiLinkSuggestState | null
  /** Notes matching the query, most relevant first. */
  candidates: string[]
  /** Called with the note path (or the raw query for a not-yet-written note). */
  onPick: (value: string) => void
  onClose: () => void
}

/**
 * Completion popup for `[[`. It is anchored below the opening brackets and
 * never steals focus: mousedown is prevented so the caret stays in the editor
 * and the keyboard keeps driving both the list and the document.
 */
export default function WikiLinkSuggest({
  state,
  candidates,
  onPick,
  onClose,
}: WikiLinkSuggestProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const open = state !== null
  const query = state?.query.trim() ?? ''
  // With nothing to offer, the only action is "write this new note".
  const rows = candidates.length > 0 ? candidates : query ? [query] : []
  const isNew = candidates.length === 0

  useEffect(() => {
    setActive(0)
  }, [state])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (rows.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i + 1) % rows.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i - 1 + rows.length) % rows.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        onPick(rows[active])
      }
    }
    // Capture, so ProseMirror never sees these keys and the caret stays put.
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [open, rows, active, onPick, onClose])

  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!state || !el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let x = state.coords.x
    let y = state.coords.y
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, y - rect.height - 24)
    }
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [state])

  if (!state) return null

  return createPortal(
    <div
      ref={anchorRef}
      className="wiki-picker-anchor"
      style={{ position: 'fixed', left: state.coords.x, top: state.coords.y, zIndex: 2050 }}
      // Keep the caret in the editor: a plain mousedown would blur it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="wiki-picker wiki-suggest">
        <div className="wiki-suggest-hint">{t('wiki.suggestHint')}</div>
        {rows.map((value, i) => (
          <button
            key={value}
            type="button"
            className={`wiki-picker-item${i === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(value)}
          >
            <span className="wiki-picker-icon">
              <Icon name={isNew && i === 0 ? 'plus' : 'file'} size={14} />
            </span>
            <span className="wiki-picker-body">
              <span className="wiki-picker-name">
                {isNew && i === 0 ? t('wiki.createNew', { name: query }) : noteTitle(value)}
              </span>
              {!isNew && <span className="wiki-picker-path">{dirName(value) || value}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
