import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { parseHeadings, buildTree, type HeadingNode } from '../utils/outline'
import { Icon } from './icons/Icon'
import { t } from '../i18n'

function OutlineItem({
  node, depth, onNavigate,
}: {
  node: HeadingNode
  depth: number
  onNavigate: (text: string) => void
}) {
  const hasChildren = node.children.length > 0
  const [expanded, setExpanded] = useState(true)

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(v => !v)
  }

  const handleClick = () => {
    onNavigate(node.text)
  }

  return (
    <div>
      <div
        className="og-outline-item"
        style={{ paddingLeft: `${depth * 14}px` }}
        onClick={handleClick}
        title={node.text}
      >
        {hasChildren ? (
          <span className="og-outline-chevron" onClick={handleToggle}>
            <Icon name="chevron-right" size={10} style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s' }} />
          </span>
        ) : (
          <span className="og-outline-chevron og-outline-chevron-empty" />
        )}
        <span className={`og-outline-marker level-${node.level}`}>H{node.level}</span>
        <span className="og-outline-text">{node.text}</span>
      </div>
      {hasChildren && expanded && (
        <div className="og-outline-children">
          {node.children.map((child, i) => (
            <OutlineItem key={i} node={child} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

function OutlineTree({
  tree, onNavigate,
}: {
  tree: HeadingNode[]
  onNavigate: (h: string) => void
}) {
  if (tree.length === 0) {
    return <div className="og-empty">{t('outline.empty')}</div>
  }
  return (
    <div className="og-outline">
      {tree.map((node, i) => (
        <OutlineItem key={i} node={node} depth={0} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

export default function OutlineGutter({
  onNavigateHeading,
}: {
  onNavigateHeading?: (heading: string) => void
}) {
  const { activeTab } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState(false)
  const [overflowing, setOverflowing] = useState(true)
  const popupRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinRef = useRef(pin)
  useEffect(() => { pinRef.current = pin }, [pin])

  // Detect whether the editor area content overflows (needs scrolling).
  // If everything is visible, do not show the outline indicator.
  useEffect(() => {
    const editorArea = document.querySelector('.editor-area') as HTMLElement | null
    if (!editorArea) return
    const check = () => {
      setOverflowing(editorArea.scrollHeight > editorArea.clientHeight + 2)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(editorArea)
    const mo = new MutationObserver(check)
    mo.observe(editorArea, { subtree: true, childList: true, characterData: true })
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [activeTab?.id])

  // when content no longer overflows, close the popup and unpin
  useEffect(() => {
    if (!overflowing) {
      setOpen(false)
      setPin(false)
    }
  }, [overflowing])

  const tree = useMemo(() => {
    if (!activeTab) return []
    return buildTree(parseHeadings(activeTab.content))
  }, [activeTab?.content])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handleOpen = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose])

  // delayed close: give the cursor time to travel from the indicator to the popup (there is a gap between them)
  const handleLeave = useCallback(() => {
    if (pin) return
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 220)
  }, [pin, cancelClose])

  // close on outside click (when pinned, stays open and pinned)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (pinRef.current) return
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        gutterRef.current &&
        !gutterRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => () => cancelClose(), [cancelClose])

  const handleNavigate = useCallback((text: string) => {
    onNavigateHeading?.(text)
  }, [onNavigateHeading])

  // only show when an editable document is open and content overflows (needs scrolling); the image viewer has no outline
  if (!activeTab || activeTab.id.startsWith('__') || activeTab.kind === 'image' || !overflowing) {
    return null
  }

  return (
    <div
      className={`outline-gutter-wrapper${(open || pin) ? ' og-open' : ''}`}
      onMouseEnter={handleOpen}
      onMouseLeave={handleLeave}
      ref={gutterRef}
    >
      {/* Three-line icon (always shown) */}
      <div className="outline-gutter-icon" title={t('outline.title')}>
        <Icon name="menu" size={16} />
      </div>
      {/* Popup panel */}
      {(open || pin) && (
        <div
          className="outline-gutter-popup"
          ref={popupRef}
          onMouseEnter={handleOpen}
          onMouseLeave={handleLeave}
        >
          <div className="og-popup-header">
            <span className="og-popup-title">{t('outline.title')}</span>
            <button
              className={`og-pin-btn${pin ? ' pinned' : ''}`}
              onClick={() => setPin(v => !v)}
              title={pin ? t('outline.unpin') : t('outline.pin')}
            >
              <Icon name="pin" size={13} filled={pin} />
            </button>
          </div>
          <div className="og-popup-body">
            <OutlineTree tree={tree} onNavigate={handleNavigate} />
          </div>
        </div>
      )}
    </div>
  )
}
