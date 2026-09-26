import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import { mentionName, type MentionTarget } from '../../../agent/mentions'

interface MentionMenuProps {
  /** Viewport coordinates (left / bottom) where the menu is portalled. */
  pos: { left: number; bottom: number }
  /** Already-filtered candidate notes. */
  files: MentionTarget[]
  /** True once the user has typed a filter query; only then is an empty list
   *  a genuine "no matches" state rather than the initial search prompt. */
  queryActive: boolean
  activeIndex: number
  onSelect: (path: string) => void
  onHover: (index: number) => void
  menuRef: RefObject<HTMLDivElement>
}

/**
 * The `@` note picker. Portalled to <body> so the input shell's
 * `overflow: hidden` cannot clip it; styled to match the mode/model menus.
 * Keyboard navigation is owned by the Composer (it intercepts the textarea
 * keys), this component only renders and keeps the active row in view.
 */
export function MentionMenu({
  pos,
  files,
  queryActive,
  activeIndex,
  onSelect,
  onHover,
  menuRef,
}: MentionMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return createPortal(
    <div
      ref={menuRef}
      className="buddy-side-mode-menu buddy-side-mention-menu"
      style={{ left: pos.left, bottom: pos.bottom }}
    >
      <div className="buddy-side-mention-head">{t('chat.mentionTitle')}</div>
      <div className="buddy-side-mention-scroll">
        {files.length === 0 ? (
          <div className="buddy-side-mention-empty">
            {queryActive ? t('chat.noMentionNotes') : t('chat.mentionHint')}
          </div>
        ) : (
          files.map((f, i) => (
            <button
              key={f.path}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              className={`buddy-side-mode-item${i === activeIndex ? ' buddy-side-mode-item-active' : ''}`}
              // Prevent the textarea from blurring before the click registers.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(f.path)
              }}
              onMouseEnter={() => onHover(i)}
            >
              <Icon name="file" size={15} />
              <span className="buddy-side-mode-item-label buddy-side-mention-label">
                <span className="buddy-side-mention-name">{mentionName(f.path)}</span>
                <span className="buddy-side-mention-path">{f.path}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
