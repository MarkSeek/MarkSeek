// Effective zoom of the app layout.
//
// `--app-zoom-scale` is a unitless number written on <html> (App.tsx for the
// live setting, firstPaint.ts for the pre-paint default) and consumed by
// `.app-layout { zoom: var(--app-zoom-scale, 1) }` in App.css.
//
// Anything measured with getBoundingClientRect()/coordsAtPos() is already
// multiplied by that zoom, while lengths assigned to elements living INSIDE the
// zoomed subtree get scaled once more by the browser. Divide by the value
// returned here to convert a measured (visual) length into the CSS px such an
// element expects.
export function appZoomScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-scale')
  const scale = parseFloat(raw)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}
