// Reading the host's look: the colour a drawing has to blend into and the
// light/dark flag Excalidraw expects.
//
// Excalidraw paints its own canvas background — white by default — while the
// surface a drawing sits on is the main panel, whose colour is a CSS variable
// that changes with the theme (built-in ones as well as plugin themes, see
// src/plugins/themes.ts). So the colour is read back from the DOM instead of
// being mirrored in a palette here: the panel's computed background is the only
// value that is right for every theme, which is exactly what "the canvas
// follows the main panel" means.
//
// Kept free of React and Excalidraw imports so it can be unit-tested in jsdom.

/** The host's editor column (see src/components/ContentWrapper.tsx). */
const MAIN_PANEL_SELECTOR = '.main-panel'

/** `getComputedStyle` reports "no colour" as fully transparent black. */
const TRANSPARENT_RE = /^rgba\(\s*0,\s*0,\s*0,\s*0(?:\.0+)?\s*\)$/

function painted(color: string): string | null {
  const value = color.trim()
  if (!value || value === 'transparent' || TRANSPARENT_RE.test(value)) return null
  return value
}

/**
 * The background a drawing has to blend into: the first painted ancestor of the
 * main panel around `from` — the panel's own background, not a plugin's inner
 * surface.
 */
export function hostBackground(from?: Element | null): string {
  const panel =
    (from && from.closest(MAIN_PANEL_SELECTOR)) || document.querySelector(MAIN_PANEL_SELECTOR)
  let node: Element | null = panel || from || null
  while (node) {
    const color = painted(getComputedStyle(node).backgroundColor)
    if (color) return color
    node = node.parentElement
  }
  // Nothing painted up to <html>: fall back to the variable the panel uses.
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--bg-content').trim() || '#ffffff'
  )
}

/** Map the host theme (`<html data-theme>`) to Excalidraw's light/dark enum. */
export function hostTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/**
 * Call `onChange` whenever the host theme — and with it the panel background —
 * changes. Returns the unsubscribe function.
 */
export function watchHostTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}
