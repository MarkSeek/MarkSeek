// Generic host for a whole-page renderer contributed by a plugin.
//
// The host has no idea what is being rendered: a plugin registers a renderer
// for the files it owns (see `registerPageRenderer` in the Plugin SDK) and this
// component only wires the lifecycle — mount once per file, hand edits back
// through `onChange`, destroy when the tab goes away.
//
// Mounting is imperative, exactly like a node view: the renderer receives a
// container element and brings its own framework and React root, so it is never
// forced to share the host's React instance.
import { useEffect, useRef } from 'react'
import type { PageRendererContribution } from '../../plugins/types'

export interface PluginPageProps {
  renderer: PageRendererContribution
  /** Path of the rendered file; changing it remounts the page. */
  filePath: string
  /**
   * Content at mount time. Later changes are ignored on purpose: the caller
   * keys this component by the file's revision, so an outside write remounts
   * the page while the renderer's own edits never come back through here.
   */
  content: string
  onChange: (content: string) => void
}

export default function PluginPage({
  renderer,
  filePath,
  content,
  onChange,
}: PluginPageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const contentRef = useRef(content)
  contentRef.current = content

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handle = renderer.mount(container, {
      filePath,
      content: contentRef.current,
      onChange: (next) => onChangeRef.current(next),
    })
    return () => handle.destroy()
  }, [renderer, filePath])

  return <div className="plugin-page" ref={containerRef} />
}
