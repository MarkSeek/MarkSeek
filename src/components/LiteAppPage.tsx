import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TextFileViewer from './TextFileViewer'
import {
  listDir,
  readFile,
  writeFile,
  deleteFileOnDisk,
  type DirEntry,
} from '../api/files'
import { LITEAPP_DIR, useWorkspace } from '../context/WorkspaceContext'
import { useSettings } from '../context/SettingsContext'
import { t } from '../i18n'
import { readRawMigrated, removeRaw, writeRaw } from '../utils/storage'
import { KEYS } from '../utils/storageKeys'

const STANDARD_FILES = ['index.html', 'style.css', 'script.js'] as const
const PAGE_SIZE = 6

// Keys used before the storage layer was unified were dropped for this release;
// only the current `markseek.*` keys are consulted.

// A soft palette tuned to the warm orange-brown-beige theme (card header background / icon foreground / icon text color).
const CARD_PALETTE: Array<{ bg: string; fg: string; on: string }> = [
  { bg: '#fbeede', fg: '#c2703a', on: '#ffffff' },
  { bg: '#f3e7e1', fg: '#b5563f', on: '#ffffff' },
  { bg: '#eef0e6', fg: '#7c8a43', on: '#ffffff' },
  { bg: '#e8eef0', fg: '#3f7c8a', on: '#ffffff' },
  { bg: '#efe6f0', fg: '#8a4f93', on: '#ffffff' },
  { bg: '#e6ede9', fg: '#3f8a6b', on: '#ffffff' },
  { bg: '#f0ebe2', fg: '#a9803f', on: '#ffffff' },
  { bg: '#eae3ea', fg: '#9a5a7a', on: '#ffffff' },
]

// Dark-theme version of the same palette family (text stays readable).
const CARD_PALETTE_DARK: Array<{ bg: string; fg: string; on: string }> = [
  { bg: '#3a2f26', fg: '#e0a06a', on: '#1a1a1e' },
  { bg: '#3a2a24', fg: '#e09a7a', on: '#1a1a1e' },
  { bg: '#2c3326', fg: '#a9c46a', on: '#1a1a1e' },
  { bg: '#22323a', fg: '#7cc1d6', on: '#1a1a1e' },
  { bg: '#32263a', fg: '#c79ad6', on: '#1a1a1e' },
  { bg: '#22362e', fg: '#7cc6a6', on: '#1a1a1e' },
  { bg: '#36302a', fg: '#d6b072', on: '#1a1a1e' },
  { bg: '#322a32', fg: '#c79ab0', on: '#1a1a1e' },
]

function colorFor(name: string): { bg: string; fg: string; on: string } {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const palette = dark ? CARD_PALETTE_DARK : CARD_PALETTE
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function appDisplayName(fileName: string): string {
  return fileName.replace(/\.html$/i, '')
}

// Whitelist of CSS variables the host app's current theme exposes to lite apps.
// Lite apps consume these variables directly, so they need no theme palette of their own — theme switching is free.
const THEME_VAR_KEYS = [
  '--bg-content',
  '--bg-hover',
  '--bg-hover-strong',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-muted',
  '--text-on-accent',
  '--border',
  '--border-light',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--green',
]

// Read the host app's key theme CSS variables under the current theme and inject the whole
// bundle into the lite-app iframe, so the lite app "parasitizes" the host theme and follows
// warm/light/dark automatically.
function getThemeVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  if (typeof window === 'undefined') return vars
  const cs = getComputedStyle(document.documentElement)
  for (const key of THEME_VAR_KEYS) {
    const v = cs.getPropertyValue(key).trim()
    if (v) vars[key] = v
  }
  return vars
}

function runUrl(id: string, themeVars?: Record<string, string>): string {
  let p = id.replace(/^\.LiteApp\//, '')
  if (!/\.html?$/i.test(p)) p = p.replace(/\/$/, '') + '/index.html'
  const base = '/liteapp/' + p
  const params: string[] = []
  if (themeVars && Object.keys(themeVars).length) {
    params.push('themeVars=' + encodeURIComponent(JSON.stringify(themeVars)))
  }
  return params.length ? `${base}?${params.join('&')}` : base
}

/** Standard directory-style lite-app template */
function liteAppDirTemplates(name: string): Record<string, string> {
  return {
    'index.html': `<!doctype html>
<html lang="${t('lite.htmlLang')}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${name} ${t('lite.appSuffix')}" />
  <title>${name}</title>
  <link rel="stylesheet" href="style.css" />
  <script>
    // Consume the theme variables injected by the host app (?themeVars=) so the lite app follows the host theme
    (function () {
      try {
        var raw = new URLSearchParams(location.search).get('themeVars');
        if (raw) {
          var vars = JSON.parse(decodeURIComponent(raw));
          for (var k in vars) document.documentElement.style.setProperty(k, vars[k]);
        }
      } catch (e) {
        // Not swallowed: a malformed theme payload must not stop the app from
        // booting, but it should still be visible in the iframe console.
        console.warn('[markseek][liteapp] failed to apply theme vars:', e);
      }
    })();
  </script>
</head>
<body>
  <main class="card">
    <header class="head">
      <h1>${name}</h1>
      <p>${t('lite.dirTemplateDesc')}</p>
    </header>
    <section class="body">
      <p>${t('lite.dirTemplateEdit')}</p>
    </section>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
    'style.css': `:root { --bg: var(--bg-content, #f8f4f1); --fg: var(--text-primary, #1f2937); --card: #ffffff; --accent-a: var(--accent, #0891b2); --accent-b: var(--accent-hover, #06b6d4); --code: var(--bg-hover, #f5f6f8); }
* { box-sizing: border-box; }
body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; padding: 28px 32px;
  background: var(--bg); color: var(--fg); min-height: 100vh; }
.card { max-width: 760px; margin: 0 auto; background: var(--card); border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.12); overflow: hidden; }
.head { padding: 22px 28px; background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #fff; }
.head h1 { margin: 0; font-size: 20px; font-weight: 600; }
.head p { margin: 6px 0 0; font-size: 13px; opacity: .85; }
.body { padding: 20px 28px 28px; font-size: 14px; }
code { background: var(--code); padding: 2px 6px; border-radius: 6px; font-size: 13px; }`,
    'script.js': `// ${name} ${t('lite.scriptComment')}
`,
  }
}

/** Fetch the lite-app list (directory scan) */

interface AppItem {
  id: string
  name: string
  kind: 'dir' | 'file'
  mtime: number
}

export default function LiteAppPage({ active = true }: { active?: boolean }) {
  const { openFile, openDiary } = useWorkspace()
  useSettings()
  const [apps, setApps] = useState<AppItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(() =>
    readRawMigrated(KEYS.liteAppActive, []),
  )
  const [mode, setMode] = useState<'run' | 'edit'>(() => {
    const v = readRawMigrated(KEYS.liteAppMode, [])
    return v === 'run' || v === 'edit' ? v : 'run'
  })

  // Persist the current lite-app view so that after a task click jumps to the diary, the whole
  // LiteAppPage is not unmounted and remounted back to the initial list (clicks should not "return to the initial state").
  useEffect(() => {
    if (activeId) writeRaw(KEYS.liteAppActive, activeId)
    else removeRaw(KEYS.liteAppActive)
  }, [activeId])
  useEffect(() => {
    writeRaw(KEYS.liteAppMode, mode)
  }, [mode])
  const [files, setFiles] = useState<DirEntry[]>([])
  const [editFile, setEditFile] = useState('index.html')
  const [code, setCode] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'created'>('recent')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)
  const [descMap, setDescMap] = useState<Record<string, string>>({})
  const [menuId, setMenuId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // The lite-app iframe requests the host app to open content via postMessage
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'liteapp:open-diary') {
        // open the diary virtual page and jump to the given date; ymd looks like 'YYYY-MM-DD'
        const ymd = data.ymd
        if (typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
          openDiary(ymd).catch((err) => console.error('Lite app failed to open diary:', err))
        }
      } else if (data.type === 'liteapp:open') {
        // open a normal file path (relative to notes/)
        const path = data.path
        if (typeof path === 'string' && path.trim()) {
          openFile(path.trim()).catch((err) => console.error('Lite app failed to open file:', err))
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [openFile, openDiary])

  const refresh = useCallback(async () => {
    try {
      const entries = await listDir(LITEAPP_DIR)
      const items: AppItem[] = entries.map((e) =>
        e.type === 'folder'
          ? { id: e.id, name: e.name, kind: 'dir', mtime: e.mtime }
          : { id: e.id, name: appDisplayName(e.name), kind: 'file', mtime: e.mtime }
      )
      setApps(items)
    } catch (e) {
      console.error('Failed to load lite apps:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // seed + initial load (runs only while the lite-app tab is active, to avoid pointless requests when not open)
  useEffect(() => {
    if (!active) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // lazy-load descriptions (only while active)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    apps.forEach(async (app) => {
      if (descMap[app.id]) return
      try {
        const target = app.kind === 'dir' ? `${app.id}/index.html` : app.id
        const html = await readFile(target)
        const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)
        const desc = m?.[1]?.trim() || t('lite.defaultDesc')
        if (!cancelled) setDescMap((prev) => ({ ...prev, [app.id]: desc }))
      } catch {
        if (!cancelled) setDescMap((prev) => ({ ...prev, [app.id]: t('lite.defaultDesc') }))
      }
    })
    return () => { cancelled = true }
  }, [apps, descMap])

  // close the menu on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current || !menuId) return
      const target = e.target as Node
      if (!menuRef.current.contains(target)) setMenuId(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuId])

  const activeApp = useMemo(() => apps.find((a) => a.id === activeId) || null, [apps, activeId])

  // switch apps (read only while the lite-app tab is active; no request when not open)
  useEffect(() => {
    if (!active) return
    if (!activeId) {
      setFiles([])
      setCode('')
      setLoadError(false)
      return
    }
    ;(async () => {
      try {
        const app = apps.find((a) => a.id === activeId)
        if (app?.kind === 'dir') {
          const sub = await listDir(activeId)
          setFiles(sub.filter((s) => s.type === 'file'))
          setEditFile((prev) => (sub.some((s) => s.name === prev) ? prev : 'index.html'))
        } else {
          setFiles([])
        }
        const target = app?.kind === 'dir' ? `${activeId}/index.html` : activeId
        setCode(await readFile(target))
        setLoadError(false)
      } catch (e) {
        console.error('Failed to read lite app:', e)
        setLoadError(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active])

  // switch files while editing
  useEffect(() => {
    if (!activeId || mode !== 'edit') return
    const app = apps.find((a) => a.id === activeId)
    if (app?.kind !== 'dir') return
    ;(async () => {
      try {
        setCode(await readFile(`${activeId}/${editFile}`))
      } catch (e) {
        console.error('Failed to read file:', e)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFile, mode])

  const filteredApps = useMemo(() => {
    let arr = apps
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      arr = arr.filter((a) => a.name.toLowerCase().includes(q))
    }
    arr = [...arr].sort((a, b) => {
      if (sort === 'recent') return b.mtime - a.mtime
      return a.mtime - b.mtime
    })
    return arr
  }, [apps, query, sort])

  const total = filteredApps.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => setPage(1), [query, sort])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageApps = useMemo(
    () => filteredApps.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredApps, page]
  )

  const openRun = (id: string) => {
    setActiveId(id)
    setMode('run')
    setMenuId(null)
  }

  const openEdit = (id: string) => {
    setActiveId(id)
    setMode('edit')
    setMenuId(null)
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const tpl = liteAppDirTemplates(name)
      for (const f of STANDARD_FILES) {
        await writeFile(`${LITEAPP_DIR}/${name}/${f}`, tpl[f])
      }
      setActiveId(`${LITEAPP_DIR}/${name}`)
      setMode('edit')
      setNewName('')
      setCreateOpen(false)
      await refresh()
    } catch (e) {
      console.error('Failed to create lite app:', e)
    }
  }

  const handleSave = async () => {
    if (!activeId) return
    try {
      const app = apps.find((a) => a.id === activeId)
      const target = app?.kind === 'dir' ? `${activeId}/${editFile}` : activeId
      await writeFile(target, code)
      refresh()
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  const handleDelete = async (id: string) => {
    const app = apps.find((a) => a.id === id)
    const label = app?.kind === 'file' ? appDisplayName(app.name) : app?.name ?? ''
    if (!confirm(`Delete "${label}"?`)) return
    try {
      await deleteFileOnDisk(id)
      if (activeId === id) setActiveId(null)
      setMenuId(null)
      await refresh()
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  return (
    <div className="liteapp-page">
      {!activeApp && (
      <header className="la-header">
        <h2 className="la-page-title">{t('lite.manage')}</h2>
        <div className="la-toolbar">
          <div className="la-actions">
            <div className="la-sort">
              <button
                className={sort === 'recent' ? 'active' : ''}
                onClick={() => setSort('recent')}
              >
                {t('lite.sortRecent')}
              </button>
              <button
                className={sort === 'created' ? 'active' : ''}
                onClick={() => setSort('created')}
              >
                {t('lite.sortCreated')}
              </button>
            </div>
            {createOpen ? (
              <div className="la-create-inline">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder={t('lite.namePlaceholder')}
                  autoFocus
                />
                <button className="la-btn-primary" onClick={handleCreate}>{t('lite.create')}</button>
                <button className="la-btn-ghost" onClick={() => { setCreateOpen(false); setNewName('') }}>{t('lite.cancel')}</button>
              </div>
            ) : (
              <>
                <input
                  className="la-search"
                  placeholder={t('lite.searchPlaceholder')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="la-btn-primary" onClick={() => setCreateOpen(true)}>{t('lite.newApp')}</button>
              </>
            )}
          </div>
        </div>
      </header>
      )}

      {!activeApp && (
      <div className="la-grid">
        {loading && <div className="la-empty">{t('lite.loading')}</div>}
        {!loading && pageApps.length === 0 && (
          <div className="la-empty">{t('lite.emptyHintFull')}</div>
        )}
        {pageApps.map((app) => (
          <div key={app.id} className={`la-card${activeId === app.id ? ' active' : ''}${menuId === app.id ? ' open' : ''}`}>
            <div
              className="la-card-head"
              style={{ background: colorFor(app.name).bg }}
              onClick={() => openRun(app.id)}
            >
              <span
                className="la-card-letter"
                style={{ background: colorFor(app.name).fg, color: colorFor(app.name).on }}
              >
                {app.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="la-card-head-text">
                <h3 className="la-card-title">{app.name}</h3>
              </div>
            </div>
            <div className="la-card-body" onClick={() => openRun(app.id)}>
              <p className="la-card-desc">{descMap[app.id] || t('lite.defaultDesc')}</p>
              <div className="la-card-meta">{t('lite.updated')} {fmtDate(app.mtime)}</div>
            </div>
            <div className="la-card-actions">
              <button className="la-btn-ghost" onClick={() => openEdit(app.id)}>{t('lite.edit')}</button>
              <div className="la-card-tools">
                <button
                  className="la-btn-icon"
                  onClick={(e) => { e.stopPropagation(); openRun(app.id) }}
                  title={t('lite.run')}
                >
                  ▶
                </button>
                <div className="la-menu-wrap" ref={menuId === app.id ? menuRef : undefined}>
                  <button
                    className="la-btn-icon"
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === app.id ? null : app.id) }}
                  >
                    ⋯
                  </button>
                  {menuId === app.id && (
                    <div className="la-menu">
                      <button onClick={() => openRun(app.id)}>{t('lite.run')}</button>
                      <button className="danger" onClick={() => handleDelete(app.id)}>{t('lite.delete')}</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {!activeApp && totalPages > 1 && (
        <div className="la-pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t('lite.prevPage')}</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{t('lite.nextPage')}</button>
          <span className="la-total">{t('lite.totalCount', { count: total })}</span>
        </div>
      )}

      {activeApp && (
        <div className="la-detail">
          <div className="la-detail-bar">
            <nav className="la-detail-crumbs">
              <button className="la-crumb-back" onClick={() => setActiveId(null)}>
                {t('lite.title')}
              </button>
              <span className="la-crumb-sep">/</span>
              <span className="la-crumb-name">{activeApp.name}</span>
            </nav>
            <div className="la-detail-actions">
              {mode === 'edit' && (
                <>
                  <button className="la-btn-primary" onClick={handleSave}>{t('lite.save')}</button>
                  <button className="la-btn-ghost" onClick={() => setMode('run')}>{t('lite.done')}</button>
                </>
              )}
            </div>
          </div>
          {loadError ? (
            <div className="la-empty">
              <p>{t('lite.cannotRead', { name: activeApp.name })}</p>
              <p className="la-empty-hint">{t('lite.fileMissing')}</p>
              <button className="la-btn-ghost" onClick={() => setActiveId(null)}>
                {t('lite.backToList')}
              </button>
            </div>
          ) : mode === 'run' ? (
            <div className="la-frame-wrap">
              <iframe
                className="la-frame"
                title={activeApp.name}
                sandbox="allow-scripts allow-same-origin"
                src={runUrl(activeId!, getThemeVars())}
              />
            </div>
          ) : (
            <div className="la-edit">
              {activeApp.kind === 'dir' && (
                <div className="la-edit-tabs">
                  {files.map((f) => (
                    <button
                      key={f.id}
                      className={editFile === f.name ? 'active' : ''}
                      onClick={() => setEditFile(f.name)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="la-code-shell">
                <TextFileViewer
                  value={code}
                  onChange={setCode}
                  path={activeApp.kind === 'dir' ? editFile : activeId ?? editFile}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
