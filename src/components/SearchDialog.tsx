import { useState, useEffect, useRef, useMemo } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import type { TreeNode } from '../api/files'
import { Icon } from './icons/Icon'
import { t } from '../i18n'

interface SearchResult {
  path: string
  name: string
  matches: string[]
}

interface Props {
  open: boolean
  onClose: () => void
}

/** Recursively collect all file nodes */
function collectFiles(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.type === 'file') result.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return result
}

/** Highlight matched parts of the text with <mark> */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let last = 0
  let idx = lower.indexOf(q)
  while (idx !== -1) {
    // plain part before the match
    if (idx > last) parts.push(text.slice(last, idx))
    // highlighted part
    parts.push(<mark key={idx}>{text.slice(idx, idx + q.length)}</mark>)
    last = idx + q.length
    idx = lower.indexOf(q, last)
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : text
}

export default function SearchDialog({ open, onClose }: Props) {
  const { fileTree, openFile } = useWorkspace()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tag the current search with a sequence number; when the async result returns, compare it and
  // drop the result if it has changed (race-condition guard).
  const searchIdRef = useRef(0)

  // Cache with useMemo to avoid producing a new array reference on every render.
  const allFiles = useMemo(() => collectFiles(fileTree), [fileTree])
  const searchQuery = useMemo(() => query.trim().toLowerCase(), [query])

  // When the dialog opens, focus the input and clear the search.
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(-1)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Search logic (200ms debounce).
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    if (!searchQuery) {
      setResults([])
      setLoading(false)
      return
    }

    // Show loading when there are no results yet.
    setLoading(true)

    timerRef.current = setTimeout(async () => {
      // Tag the current search with a sequence number for race-condition guarding.
      const id = ++searchIdRef.current

      // ---- match by file name ----
      const nameMatches = allFiles.filter((f) =>
        f.name.toLowerCase().includes(searchQuery)
      )
      const res: SearchResult[] = nameMatches.map((f) => ({
        path: f.id,
        name: f.name,
        matches: [],
      }))

      // ---- content search (via the server API, for content that did not match a file name) ----
      if (searchQuery.length >= 1) {
        const matchedPaths = new Set(nameMatches.map((f) => f.id))
        const needContentSearch = allFiles.some((f) => !matchedPaths.has(f.id))
        if (needContentSearch) {
          try {
            const response = await fetch(
              `/api/files/search?q=${encodeURIComponent(searchQuery)}`
            )
            // Race detection: if the search has expired, drop this result.
            if (id !== searchIdRef.current) return
            if (response.ok) {
              const serverResults: SearchResult[] = await response.json()
              if (id !== searchIdRef.current) return
              // Only add results that did not match a file name (avoid duplicates).
              for (const sr of serverResults) {
                if (!matchedPaths.has(sr.path)) {
                  res.push(sr)
                }
              }
            }
          } catch {
            // If the server search fails, skip content search.
          }
        }
      }

      setResults(res)
      setSelectedIndex(-1)
      setLoading(false)
    }, 200)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [searchQuery, allFiles])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : prev
      )
      scrollToIndex(selectedIndex + 1)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
      scrollToIndex(selectedIndex - 1)
    }
    if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex]) {
      openFile(results[selectedIndex].path)
      onClose()
    }
  }

  const scrollToIndex = (idx: number) => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('.search-result-item')
    if (items[idx]) {
      items[idx].scrollIntoView({ block: 'nearest' })
    }
  }

  const handleResultClick = (path: string) => {
    openFile(path)
    onClose()
  }

  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div
        className="search-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-dialog-header">
          <Icon name="search-simple" size={18} className="search-dialog-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-dialog-input"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-dialog-close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="search-dialog-body" ref={listRef}>
          {loading && (
            <div className="search-dialog-loading">
              <span className="search-loading-dot" />
              {t('search.loading')}
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="search-dialog-empty">
              <Icon name="search-simple" size={36} strokeWidth={1.5} />
              <span>{t('search.noResult')}</span>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              <div className="search-result-count">
                {t('search.resultCount', { count: results.length })}
              </div>
              {results.map((r, i) => (
                <div
                  key={r.path}
                  className={`search-result-item${i === selectedIndex ? ' selected' : ''}`}
                  onClick={() => handleResultClick(r.path)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="search-result-name">
                    <Icon name="file-result" size={14} />
                    <span className="search-result-label">{highlightText(r.name, searchQuery)}</span>
                    <span className="search-result-path">{r.path}</span>
                  </div>
                  {r.matches.length > 0 && (
                    <div className="search-result-matches">
                      {r.matches.map((line, j) => (
                        <div key={j} className="search-result-line">
                          {highlightText(line, searchQuery)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {!query.trim() && (
            <div className="search-dialog-hint">
              {t('search.hint')}
            </div>
          )}
        </div>

        <div className="search-dialog-footer">
          <span className="search-footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span className="search-footer-hint">
            <kbd>Enter</kbd> open
          </span>
          <span className="search-footer-hint">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
