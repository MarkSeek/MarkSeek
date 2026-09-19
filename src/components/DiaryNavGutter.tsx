import { useState, useEffect, useRef, useMemo } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import { parseHeadings, buildTree, type HeadingNode } from '../utils/outline'
import { filePathToYmd } from '../utils/diaryPath'

function OutlineTree({
  tree,
  onNavigate,
}: {
  tree: HeadingNode[]
  onNavigate: (h: string) => void
}) {
  if (tree.length === 0) {
    return <div className="og-empty">{t('outline.empty')}</div>
  }
  const render = (nodes: HeadingNode[], depth: number) =>
    nodes.map((node, i) => (
      <div key={i}>
        <div
          className="og-outline-item"
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onNavigate(node.text)}
          title={node.text}
        >
          <span className="og-outline-chevron og-outline-chevron-empty" />
          <span className={`og-outline-marker level-${node.level}`}>H{node.level}</span>
          <span className="og-outline-text">{node.text}</span>
        </div>
        {node.children.length > 0 && (
          <div className="og-outline-children">{render(node.children, depth + 1)}</div>
        )}
      </div>
    ))
  return <div className="og-outline">{render(tree, 0)}</div>
}

export default function DiaryNavGutter({
  onNavigateHeading,
}: {
  onNavigateHeading?: (heading: string) => void
}) {
  const { activeTab } = useWorkspace()
  const [outlineOpen, setOutlineOpen] = useState(false)
  const gutterRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ymd = useMemo(
    () => (activeTab?.filePath ? filePathToYmd(activeTab.filePath) : null),
    [activeTab?.filePath],
  )

  const tree = useMemo(
    () => buildTree(parseHeadings(activeTab?.content ?? '')),
    [activeTab?.content]
  )

  // close the outline popup when clicking outside
  useEffect(() => {
    if (!outlineOpen) return
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        gutterRef.current &&
        !gutterRef.current.contains(e.target as Node)
      ) {
        setOutlineOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [outlineOpen])

  // only render on the diary virtual page
  if (!ymd || activeTab?.kind !== 'diary') return null

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const handleEnter = () => {
    cancelClose()
    setOutlineOpen(true)
  }
  const handleLeave = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOutlineOpen(false), 200)
  }
  const handleOutlineClick = () => {
    setOutlineOpen((v) => !v)
  }
  const handleNavigate = (text: string) => {
    cancelClose()
    setOutlineOpen(false)
    onNavigateHeading?.(text)
  }

  return (
    <div className="diary-nav-gutter-wrapper" ref={gutterRef}>
      {/* Outline */}
      <div
        className="diary-nav-outline"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <button
          type="button"
          className="diary-nav-btn"
          onClick={handleOutlineClick}
          title={t('outline.title')}
          aria-label={t('outline.title')}
        >
          <Icon name="menu" size={16} />
        </button>
        {outlineOpen && (
          <div className="diary-nav-outline-popup" ref={popupRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
            <div className="og-popup-header">
              <span className="og-popup-title">{t('outline.title')}</span>
            </div>
            <div className="og-popup-body">
              <OutlineTree tree={tree} onNavigate={handleNavigate} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
