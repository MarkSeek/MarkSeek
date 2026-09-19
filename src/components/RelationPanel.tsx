import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchRelations } from '../api/relations'
import type { NoteRef, RelationResult } from '../utils/relations'
import { useWikiLinkOpen } from '../hooks/useWikiLinkOpen'
import { t } from '../i18n'
import { readJsonMigrated, writeJson } from '../utils/storage'
import { KEYS } from '../utils/storageKeys'
import { RelationIcon } from './icons/RelationIcon'
import { Icon } from './icons/Icon'
import {
  PanelBody,
  PanelChip,
  PanelEmpty,
  PanelRow,
  PanelSection,
  PanelSkeleton,
  PanelView,
} from './PanelShell'

interface RelationPanelProps {
  currentNote?: { path: string; content: string }
}

type SectionId = 'backLinks' | 'outLinks' | 'tags' | 'tasks'

const SECTION_IDS: SectionId[] = ['backLinks', 'outLinks', 'tags', 'tasks']

const SECTION_LABEL: Record<SectionId, string> = {
  backLinks: 'relations.backLinks',
  outLinks: 'relations.outLinks',
  tags: 'relations.tags',
  tasks: 'relations.tasks',
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

export default function RelationPanel({ currentNote }: RelationPanelProps) {
  const { openFile } = useWorkspace()
  const [loading, setLoading] = useState(false)
  // The backend owns the scan now: one request per note, result kept as-is.
  const [result, setResult] = useState<RelationResult | null>(null)
  // Sections the user switched off; persisted so the choice survives a reload.
  const [hidden, setHidden] = useState<SectionId[]>(() =>
    loadIds(HIDDEN_KEY, []),
  )
  // Sections folded to their header only; the explicit choice is persisted.
  const [openMap, setOpenMap] = useState<OpenMap>(loadOpen)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

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

  // Wikilinks share the editor's behaviour: one match opens, several ask.
  const { openWikiLink, pickerNode } = useWikiLinkOpen()

  const open = (path: string) => {
    void openFile(path)
  }

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
      <PanelView>
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
  ]

  // Section headers always render (with their live count); only the rows are
  // omitted when a section has no hits, so no "none" placeholder is needed.
  const visibleBlocks = blocks.filter((b) => !hidden.includes(b.id))
  const fileName = currentNote.path.split('/').pop() ?? currentNote.path

  return (
    <PanelView>
      {/* Same chrome bar as the chat view: context title on the left,
          actions pushed to the right edge. */}
      <div className="rp-chrome-bar">
        <span className="rp-chrome-title" title={currentNote.path}>
          {fileName}
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
              // No explicit choice yet: empty sections start folded.
              const isOpen = openMap[b.id] ?? counts[b.id] > 0
              return (
                <PanelSection
                  key={b.id}
                  title={t(SECTION_LABEL[b.id])}
                  count={counts[b.id]}
                  collapsible
                  open={isOpen}
                  onToggle={() => toggleCollapsed(b.id, isOpen)}
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
    </PanelView>
  )
}
