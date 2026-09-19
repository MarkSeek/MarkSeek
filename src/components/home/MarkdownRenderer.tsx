import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str: string, lang?: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="buddy-side-code hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch (e) {
        // Deliberate fallthrough: a language hljs cannot parse degrades to the
        // escaped plain block below instead of breaking the whole render.
        if (import.meta.env.DEV) console.warn('[markdown] highlight failed:', e)
      }
    }
    // when no language is specified or highlighting fails, do a basic HTML escape
    const escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<pre class="buddy-side-code"><code>${escaped}</code></pre>`
  },
})

export default function MarkdownRenderer({ content }: { content: string }) {
  const html = useMemo(() => md.render(content), [content])
  return <div className="buddy-side-md" dangerouslySetInnerHTML={{ __html: html }} />
}
