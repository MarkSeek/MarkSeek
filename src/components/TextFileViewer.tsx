import { useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js'

interface TextFileViewerProps {
  value: string
  onChange: (content: string) => void
  /** File path (with extension) used to pick a highlight.js language. */
  path?: string
}

// Map a file extension to a highlight.js language name. Unknown / plain
// extensions resolve to undefined so the file renders as raw text.
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', html: 'xml', htm: 'xml',
  xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', md: 'markdown',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', conf: 'ini', sql: 'sql', rs: 'rust', go: 'go',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', rb: 'ruby', dockerfile: 'dockerfile', makefile: 'makefile',
}

function langFromPath(path?: string): string | undefined {
  if (!path) return undefined
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return undefined
  const lang = EXT_LANG[ext]
  return lang && hljs.getLanguage(lang) ? lang : undefined
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Produce the colored HTML for the backdrop. Falls back to plain escaped text
// when no language is known (txt / csv / unknown) so large files stay cheap.
function renderHighlight(text: string, lang: string | undefined): string {
  if (lang) {
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    } catch {
      // Fall through to escaped plain text on any parse failure.
    }
  }
  return escapeHtml(text)
}

/**
 * Plain text editor used for non-Markdown files. It deliberately avoids Crepe
 * (the Milkdown/Markdown editor) so that images, html, json, ... are shown as
 * raw text rather than being parsed as Markdown.
 *
 * Rendering is an overlay: a transparent `<textarea>` sits on top for input and
 * the caret, while a `<pre>` underneath shows the highlight.js colored output.
 * A line-number gutter is synced to the textarea scroll. All three layers share
 * identical font metrics so glyphs line up to the pixel.
 *
 * The textarea stays uncontrolled: `value` is only written back when it differs
 * from what the user has typed, so outside writes (agent edits) land without
 * clobbering in-progress keystrokes or resetting the caret.
 */
export default function TextFileViewer({ value, onChange, path }: TextFileViewerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const lang = useMemo(() => langFromPath(path), [path])

  const [html, setHtml] = useState(() => renderHighlight(value, lang))
  const [lineCount, setLineCount] = useState(() => value.split('\n').length)

  // Mirror the textarea scroll onto the backdrop (x+y) and gutter (y only).
  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (backdropRef.current) {
      backdropRef.current.scrollTop = ta.scrollTop
      backdropRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  // Outside writes (agent edits, session restore) land without clobbering the
  // caret: only write back when the textarea content actually differs. The
  // highlight and line count are always refreshed, because in uncontrolled
  // usage React may also update the DOM value via defaultValue and the layer
  // below must stay in sync (LiteApp edit mode).
  useEffect(() => {
    const ta = taRef.current
    if (ta && ta.value !== value) {
      ta.value = value
    }
    setHtml(renderHighlight(value, lang))
    setLineCount(value.split('\n').length)
  }, [value, lang])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setHtml(renderHighlight(text, lang))
    setLineCount(text.split('\n').length)
    onChange(text)
  }

  const lineNumbers = useMemo(() => {
    let s = ''
    for (let i = 1; i <= lineCount; i++) s += i + '\n'
    return s
  }, [lineCount])

  return (
    <div className="text-file-viewer">
      <div className="text-file-viewer-gutter" ref={gutterRef} aria-hidden="true">
        {lineNumbers}
      </div>
      <div className="text-file-viewer-editor">
        <pre className="text-file-viewer-backdrop" ref={backdropRef} aria-hidden="true">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={taRef}
          className="text-file-viewer-input"
          defaultValue={value}
          spellCheck={false}
          onChange={handleChange}
          onScroll={syncScroll}
        />
      </div>
    </div>
  )
}
