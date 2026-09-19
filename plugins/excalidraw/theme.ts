// The Excalidraw surface that follows the host: one component shared by the
// block inside a note (./index.tsx) and the full-page canvas (./page.tsx).
//
// Two things come from the host — the light/dark flag for Excalidraw's own
// chrome and the main-panel colour for the drawing — which is what
// ./hostTheme.ts reads out of the DOM.
//
// The colour is not pushed into the canvas: a theme-following drawing keeps a
// transparent canvas (THEME_CANVAS_BG) and the panel behind it paints. Excalidraw
// only repaints its static canvas when elements, size or its own theme change,
// so an `appState`-only background update is not something to rely on — CSS is.
import React from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import { hostBackground, hostTheme, watchHostTheme } from './hostTheme'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ThemedCanvasProps {
  /** Scene Excalidraw starts from; read once, on mount. */
  initialData?: any
  onChange: (elements: any, appState: any, files: any) => void
  /** Element the panel background is resolved from. */
  anchor: Element
  /** Called with the panel background on mount and after every theme change. */
  onBackground: (color: string) => void
}

/**
 * Wraps `<Excalidraw>` so the drawing follows the host: its own light/dark
 * chrome comes from `data-theme`, and the panel colour is published on mount
 * and on every theme switch.
 */
export function ThemedCanvas(props: ThemedCanvasProps): React.ReactElement {
  const { initialData, onChange, anchor, onBackground } = props
  const [theme, setTheme] = React.useState(hostTheme)
  // Read through a ref so a new closure on every parent render does not
  // re-subscribe the theme watcher.
  const publishRef = React.useRef(onBackground)
  publishRef.current = onBackground

  React.useEffect(() => {
    const publish = () => {
      setTheme(hostTheme())
      publishRef.current(hostBackground(anchor))
    }
    publish()
    return watchHostTheme(publish)
  }, [anchor])

  return React.createElement(Excalidraw, { initialData, onChange, theme })
}
