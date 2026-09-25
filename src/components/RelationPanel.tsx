import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchRelations } from '../api/relations'
import type { NoteRef, RelationResult } from '../utils/relations'
import { useWikiLinkOpen } from '../hooks/useWikiLinkOpen'
import { t } from '../i18n'
import { formatFullTime, formatRelativeTime } from '../utils/timeFormat'
import { fileIconName } from '../utils/fileIcon'
import HistoryView from './HistoryView'
import { readJsonMigrated, writeJson } from '../utils/storage'
import { KEYS } from '../utils/storageKeys'
import { RelationIcon } from './icons/RelationIcon'
import { Icon } from './icons/Icon'
import {
  PanelBody,
  PanelChip,
  PanelEmpty,
  PanelNone,
  PanelRow,
  PanelSection,
  PanelSkeleton,
  PanelView,
} from './PanelShell'

interface RelationPanelProps {
  currentNote?: { path: string; content: string }
}

/** One commit touching the current note, as returned by /api/sync/file-history. */
interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  email: string
  date: string
}

/** Commit history of a single note (git log filtered by filepath). */
async function fetchFileHistory(path: string): Promise<{ initialized: boolean; history: CommitInfo[] }> {
  const res = await fetch(`/api/sync/file-history?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Failed to load file history')
  return res.json()
}

type SectionId = 'backLinks' | 'outLinks' | 'tags' | 'tasks' | 'history'

const SECTION_IDS: SectionId[] = ['backLinks', 'outLinks', 'tags', 'tasks', 'history']

// History rows shown before the "show all" expander; keeps the panel compact
// when a note has a long commit log (the backend caps at 50 commits).
const HISTORY_PREVIEW_COUNT = 10

const SECTION_LABEL: Record<SectionId, string> = {
  backLinks: 'relations.backLinks',
  outLinks: 'relations.outLinks',
  tags: 'relations.tags',
  tasks: 'relations.tasks',
  history: 'relations.history',
}

/** Leading glyph of each section head; replaces the plain accent bar. */
const SECTION_ICON: Record<SectionId, ReactNode> = {
  backLinks: <Icon name="link" size={12} />,
  outLinks: <Icon name="outgoing" size={12} />,
  tags: <Icon name="tag" size={12} />,
  tasks: <Icon name="tasks" size={12} />,
  history: <Icon name="history" size={12} />,
}

const HIDDEN_KEY = KEYS.relationSections
const OPEN_KEY = KEYS.relationOpen

/**
 * Wait this long after the note (or its text) changes before asking the
 * backend. Typing fires one change per keystroke, and every request used to
 * mean a full vault scan.
 */
const REQUEST_DEBOUNCE_MS = 200

/**
 * Explicit open choices (true = expanded). Missing entries fall back to the
 * default rule: sections with hits open, empty ones stay folded.
 */
type OpenMap = Partial<Record<SectionId, boolean>>

function toOpenMap(raw: unknown): OpenMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: OpenMap = {}
  for (const id of SECTION_IDS) {
    const value = (raw as Record<string, unknown>)[id]
    if (typeof value === 'boolean') out[id] = value
  }
  return out
}

function loadOpen(): OpenMap {
  return readJsonMigrated<OpenMap>(
    OPEN_KEY,
    [],
    {},
    toOpenMap,
  )
}

/** Sliders glyph for the display (section filter) button. */
function DisplayGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      color="currentColor"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"
        strokeLinejoin="round"
      />
      <path d="M8.5 10C7.67157 10 7 9.32843 7 8.5C7 7.67157 7.67157 7 8.5 7C9.32843 7 10 7.67157 10 8.5C10 9.32843 9.32843 10 8.5 10Z" />
      <path d="M15.5 17C16.3284 17 17 16.3284 17 15.5C17 14.6716 16.3284 14 15.5 14C14.6716 14 14 14.6716 14 15.5C14 16.3284 14.6716 17 15.5 17Z" />
      <path d="M10 8.5L17 8.5" strokeLinecap="round" />
      <path d="M14 15.5L7 15.5" strokeLinecap="round" />
    </svg>
  )
}

/** Reads back a persisted list of section ids, dropping unknown values. */
function loadIds(key: string, legacyKeys: readonly string[] = []): SectionId[] {
  return readJsonMigrated<SectionId[]>(key, legacyKeys, [], (raw) =>
    Array.isArray(raw)
      ? raw.filter((x): x is SectionId => SECTION_IDS.includes(x as SectionId))
      : null,
  )
}

/**
 * One git commit in the history list. Compact two-line layout: the commit
 * message is the primary line, the short hash and a relative timestamp sit
 * underneath in muted text. The full timestamp is kept on the hover title.
 */
function HistoryCommitRow({
  commit,
  onSelect,
}: {
  commit: CommitInfo
  onSelect: () => void
}) {
  const ts = new Date(commit.date).getTime()
  return (
    <button
      type="button"
      className="rpp-hrow"
      onClick={onSelect}
      title={`${commit.message}\n${formatFullTime(ts)}`}
    >
      <span className="rpp-hrow-dot" aria-hidden="true" />
      <span className="rpp-hrow-body">
        <span className="rpp-hrow-msg">{commit.message}</span>
        <span className="rpp-hrow-meta">
          <span className="rpp-hrow-hash">{commit.shortHash}</span>
          <span className="rpp-hrow-time">{formatRelativeTime(ts)}</span>
        </span>
      </span>
    </button>
  )
}

export default function RelationPanel({ currentNote }: RelationPanelProps) {
  const { openFile, activeTab, updateContent, refreshOpenFile } = useWorkspace()
  const [loading, setLoading] = useState(false)
  // The backend owns the scan now: one request per note, result kept as-is.
  const [result, setResult] = useState<RelationResult | null>(null)
  // Sections the user switched off; persisted so the choice survives a reload.
  const [hidden, setHidden] = useState<SectionId[]>(() =>
    loadIds(HIDDEN_KEY, []),
  )
  // Sections folded to their header only; the explicit choice is persisted.
  const [openMap, setOpenMap] = useState<OpenMap>(loadOpen)
  // History uses its own, non-persisted collapsed state so a stale persisted
  // "open" value can never force it expanded again. It defaults to collapsed
  // and only an in-session manual toggle opens it.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Git commit history of the current note; independent from the relations scan.
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyInitialized, setHistoryInitialized] = useState(true)
  // The commit whose preview modal is open (null = closed).
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  // Long logs start truncated to HISTORY_PREVIEW_COUNT rows; the "show all"
  // expander reveals the rest inside a height-capped, scrollable list.
  const [showAllHistory, setShowAllHistory] = useState(false)
  // Transient confirmation shown after a restore.
  const [toast, setToast] = useState<string | null>(null)

  // Close the display menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // Ask the backend for this note's relations. The scan runs in Node, so this
  // costs one request and no main-thread work.
  const notePath = currentNote?.path
  const noteContent = currentNote?.content
  useEffect(() => {
    if (!notePath) {
      setResult(null)
      setLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      fetchRelations(notePath, noteContent, controller.signal)
        .then((next) => {
          if (cancelled) return
          setResult(next)
          setLoading(false)
        })
        .catch(() => {
          // Cancelled or failed: keep whatever is already on screen rather
          // than emptying the panel on a transient error.
          if (!cancelled) setLoading(false)
        })
    }, REQUEST_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [notePath, noteContent])

  // File history reflects the committed (on-disk) state, so it depends only on
  // the note path, not its live draft. `silent` skips the loading skeleton so a
  // background re-fetch (expand / commit) doesn't flicker the existing rows.
  const loadHistory = useCallback((path: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    let cancelled = false
    if (!silent) setHistoryLoading(true)
    const timer = setTimeout(() => {
      fetchFileHistory(path)
        .then((res) => {
          if (cancelled) return
          setHistoryInitialized(res.initialized)
          setHistory(res.history)
          if (!silent) setHistoryLoading(false)
        })
        .catch(() => {
          if (!cancelled && !silent) setHistoryLoading(false)
        })
    }, REQUEST_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Initial fetch when the note opens. The preview truncation resets too, so
  // switching notes never inherits the previous note's "show all" state.
  useEffect(() => {
    setShowAllHistory(false)
    if (!notePath) {
      setHistory([])
      setHistoryInitialized(true)
      setHistoryLoading(false)
      return
    }
    return loadHistory(notePath)
  }, [notePath, loadHistory])

  // The history section is collapsed by default; re-fetch the moment the user
  // expands it so the rows are never stale on first view.
  useEffect(() => {
    if (historyOpen && notePath) return loadHistory(notePath, { silent: true })
  }, [historyOpen, notePath, loadHistory])

  // A git commit/sync can land well after the note opened, so the list would
  // otherwise stay frozen on the version fetched at open time. The api layer
  // broadcasts 'markseek:committed' after any operation that changes the git
  // log (commit / sync / pull) — see src/api/sync.ts.
  useEffect(() => {
    if (!notePath) return
    let cancel: (() => void) | null = null
    const onCommitted = () => {
      if (cancel) cancel()
      cancel = loadHistory(notePath, { silent: true })
    }
    document.addEventListener('markseek:committed', onCommitted)
    return () => {
      document.removeEventListener('markseek:committed', onCommitted)
      if (cancel) cancel()
    }
  }, [notePath, loadHistory])

  // Auto-dismiss the restore confirmation.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  // Wikilinks share the editor's behaviour: one match opens, several ask.
  const { openWikiLink, pickerNode } = useWikiLinkOpen()

  const open = (path: string) => {
    void openFile(path)
  }

  // Replace the current note's editor buffer with a historical version.
  // `refreshOpenFile` drives `replaceContent`, which bumps the tab `rev` so the
  // Crepe editor swaps the document in place (the on-screen view updates);
  // `updateContent` then re-buffers the restored text so the debounced autosave
  // still persists it to disk and fires the sync-on-save hook.
  const restoreVersion = useCallback(
    async (content: string) => {
      const id = activeTab?.id
      const path = currentNote?.path
      if (!id || !path) return
      await refreshOpenFile(path, content)
      updateContent(id, content)
      setSelectedCommit(null)
      setToast(t('relations.restored'))
    },
    [currentNote, activeTab, refreshOpenFile, updateContent],
  )

  /**
   * Open one outgoing link: external ones go to the browser, wikilinks are
   * resolved against the vault, everything else is already a vault path.
   * The menu is anchored to the row so it appears where the click landed.
   */
  const openOutLink = (link: NoteRef, e: ReactMouseEvent) => {
    if (link.kind === 'external' && link.href) {
      window.open(link.href, '_blank', 'noopener,noreferrer')
      return
    }
    if (link.kind === 'wiki' && link.raw) {
      const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect()
      openWikiLink(link.raw, {
        fromPath: currentNote?.path,
        coords: rect ? { x: rect.left, y: rect.bottom } : undefined,
      })
      return
    }
    void openFile(link.path)
  }

  const toggleSection = (id: SectionId) => {
    setHidden((prev) => {
      const isHidden = prev.includes(id)
      // Always keep at least one block on screen.
      if (isHidden || prev.length < SECTION_IDS.length - 1) {
        const next = isHidden ? prev.filter((x) => x !== id) : [...prev, id]
        writeJson(HIDDEN_KEY, next)
        return next
      }
      return prev
    })
  }

  const toggleCollapsed = (id: SectionId, currentlyOpen: boolean) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: !currentlyOpen }
      writeJson(OPEN_KEY, next)
      return next
    })
  }

  if (!currentNote) {
    return (
      <PanelView className="rpp-view-relations">
        <PanelEmpty
          fill
          icon={<RelationIcon size={20} />}
          title={t('relations.empty')}
          hint={t('relations.emptyHint')}
        />
      </PanelView>
    )
  }

  const backLinks = result?.backLinks ?? []
  const outLinks = result?.outLinks ?? []
  const tags = result?.tags ?? []
  const tasks = result?.tasks ?? []

  const counts: Record<SectionId, number> = {
    backLinks: backLinks.length,
    outLinks: outLinks.length,
    tags: tags.length,
    tasks: tasks.length,
    history: history.length,
  }

  const blocks: { id: SectionId; body: ReactNode }[] = [
    {
      id: 'backLinks',
      body: backLinks.map((b) => (
        <PanelRow
          key={b.path}
          icon={<Icon name="file" size={14} />}
          label={b.name}
          sub={b.snippet}
          onClick={() => open(b.path)}
        />
      )),
    },
    {
      id: 'outLinks',
      body: outLinks.map((o) => (
        <PanelRow
          key={o.path}
          icon={
            <Icon
              name={o.kind === 'external' ? 'external-link' : o.kind === 'wiki' ? 'link' : 'file'}
              size={14}
            />
          }
          label={o.name}
          sub={o.kind === 'external' ? o.href : o.kind === 'wiki' ? `[[${o.raw}]]` : o.path}
          onClick={(e) => openOutLink(o, e)}
        />
      )),
    },
    {
      id: 'tags',
      body: tags.map((tg) => (
        <div key={tg.tag} className="rpp-block">
          <PanelChip>#{tg.tag}</PanelChip>
          {tg.others.map((o) => (
            <PanelRow
              key={o.path}
              icon={<Icon name="file" size={14} />}
              label={o.name}
              onClick={() => open(o.path)}
            />
          ))}
        </div>
      )),
    },
    {
      id: 'tasks',
      body: (
        <>
          <div className="rpp-summary">
            <span className="rpp-summary-item">
              {t('relations.todo')}
              <b>{tasks.filter((x) => !x.done).length}</b>
            </span>
            <span className="rpp-summary-item">
              {t('relations.done')}
              <b>{tasks.filter((x) => x.done).length}</b>
            </span>
          </div>
          {tasks.map((tk, i) => (
            <PanelRow
              key={i}
              icon={
                <span className={`rpp-check${tk.done ? ' is-done' : ''}`}>
                  {tk.done && <Icon name="check" size={10} />}
                </span>
              }
              label={tk.text}
              dimmed={tk.done}
            />
          ))}
        </>
      ),
    },
    {
      id: 'history',
      body: historyLoading ? (
        <PanelSkeleton rows={3} />
      ) : !historyInitialized ? (
        <PanelNone text={t('relations.historyNoRepo')} />
      ) : history.length === 0 ? (
        <PanelNone text={t('relations.historyEmpty')} />
      ) : (
        <div className={showAllHistory ? 'rpp-hlist rpp-hlist-open' : 'rpp-hlist'}>
          {(showAllHistory ? history : history.slice(0, HISTORY_PREVIEW_COUNT)).map((c) => (
            <HistoryCommitRow
              key={c.hash}
              commit={c}
              onSelect={() => setSelectedCommit(c)}
            />
          ))}
          {history.length > HISTORY_PREVIEW_COUNT && !showAllHistory && (
            <button
              type="button"
              className="rpp-hmore"
              onClick={() => setShowAllHistory(true)}
            >
              {t('relations.historyShowAll', { n: history.length })}
            </button>
          )}
        </div>
      ),
    },
  ]

  // Section headers always render (with their live count); only the rows are
  // omitted when a section has no hits, so no "none" placeholder is needed.
  const visibleBlocks = blocks.filter((b) => !hidden.includes(b.id))
  const fileName = currentNote.path.split('/').pop() ?? currentNote.path

  return (
    <PanelView className="rpp-view-relations">
      {/* Same chrome bar as the chat view: context title on the left,
          actions pushed to the right edge. */}
      <div className="rp-chrome-bar">
        <span className="rp-chrome-title" title={currentNote.path}>
          <Icon
            name={fileIconName(currentNote.path)}
            size={13}
            className="rp-chrome-file-icon"
          />
          <span className="rp-chrome-title-text">{fileName}</span>
        </span>
        <div className="rp-chrome-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`rp-chrome-btn${menuOpen ? ' is-active' : ''}`}
            title={t('relations.display')}
            aria-label={t('relations.display')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <DisplayGlyph />
          </button>
          {menuOpen && (
            <div className="rp-chrome-menu" role="menu">
              <div className="rp-chrome-menu-label">{t('relations.display')}</div>
              {SECTION_IDS.map((id) => {
                const on = !hidden.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className={`rp-chrome-menu-item${on ? ' is-on' : ''}`}
                    onClick={() => toggleSection(id)}
                  >
                    <span className="rp-chrome-menu-check">
                      {on && <Icon name="check" size={11} />}
                    </span>
                    <span className="rp-chrome-menu-text">{t(SECTION_LABEL[id])}</span>
                    <span className="rp-chrome-menu-count">{counts[id]}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {loading && !result ? (
        <PanelBody>
          <PanelSkeleton rows={4} />
        </PanelBody>
      ) : (
        <PanelBody>
          {visibleBlocks.length > 0 ? (
            visibleBlocks.map((b) => {
              // No explicit choice yet: empty sections start folded. History
              // has its own non-persisted state that always defaults to folded.
              const isOpen =
                b.id === 'history'
                  ? historyOpen
                  : openMap[b.id] ?? counts[b.id] > 0
              const onToggle =
                b.id === 'history'
                  ? () => setHistoryOpen((v) => !v)
                  : () => toggleCollapsed(b.id, isOpen)
              return (
                <PanelSection
                  key={b.id}
                  title={t(SECTION_LABEL[b.id])}
                  count={counts[b.id]}
                  icon={SECTION_ICON[b.id]}
                  collapsible
                  open={isOpen}
                  onToggle={onToggle}
                >
                  {b.body}
                </PanelSection>
              )
            })
          ) : (
            // Only reachable when every section is switched off in Display.
            <PanelEmpty
              fill
              icon={<RelationIcon size={20} />}
              title={t('relations.noRelations')}
              hint={t('relations.noRelationsHint')}
            />
          )}
        </PanelBody>
      )}
      {pickerNode}
      {selectedCommit && notePath && (
        <HistoryView
          notePath={notePath}
          commit={selectedCommit}
          onClose={() => setSelectedCommit(null)}
          onRestore={restoreVersion}
        />
      )}
      {toast && <div className="rpp-toast">{toast}</div>}
    </PanelView>
  )
}
