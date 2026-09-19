// Sticky header measurement for the file tree.
//
// All measurements are in LAYOUT coordinates (offsetTop / scrollTop) rather than
// with getBoundingClientRect(), for two reasons:
//
//  1. `el.offsetTop` is relative to the offsetParent, and `.tree-section` is
//     position: relative — so a bare `el.offsetTop` is relative to the folder's
//     OWN group, not the scroll container, and is ~0 at every nested level. The
//     "was pushed up here by scrolling" test therefore never fired below level 0.
//
//  2. Layout-space measurement never reads the zoom factor, so the sticky test
//     stays correct under CSS `zoom` at every scale without mixing coordinate
//     systems.

export interface StickyMetrics {
  /** Natural (un-stuck) position relative to the scrollport, layout px */
  naturalTop: number
  /** Actually painted position (sticky pinning + push-out included), layout px */
  visualTop: number
  /** CSS sticky `top` threshold, layout px */
  stickyTop: number
}

/** Distance from `el`'s border box top to `root`'s padding box top, in layout px.
 *  Returns null if the offsetParent chain does not reach `root` (detached / display:none). */
export function offsetTopWithin(el: HTMLElement, root: HTMLElement): number | null {
  let y = 0
  let node: HTMLElement | null = el
  while (node && node !== root) {
    const parent = node.offsetParent as HTMLElement | null
    if (!parent) return null
    // offsetTop is measured from the offsetParent's PADDING edge, while the
    // parent's own offsetTop is measured to its BORDER edge. Add clientTop
    // (border width) for every hop except the last, which already lands on
    // root's padding edge.
    y += node.offsetTop + (parent === root ? 0 : parent.clientTop)
    node = parent
  }
  return y
}

/** Resolved CSS `top` of a sticky element, in layout px.
 *  Reading the resolved value (instead of `--tree-row-h`) keeps rem / calc based
 *  offsets working and removes the duplicated source of truth in JS. */
export function stickyOffsetTop(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).top) || 0
}

/** Bottom of the sticky containing block (= `el.parentElement`'s box), in the same
 *  coordinates as offsetTopWithin(). `.tree-section` has no border/padding, so its
 *  content / padding / border boxes all coincide. */
export function containingBlockBottom(el: HTMLElement, root: HTMLElement): number | null {
  const parent = el.parentElement
  if (!parent) return null
  const top = offsetTopWithin(parent, root)
  if (top === null) return null
  return top + parent.clientTop + parent.clientHeight
}

/**
 * Metrics of one sticky header. `visualTop` reproduces the browser's clamp, with
 * the push-out step applied LAST (it wins over pinning — a header whose group has
 * scrolled past is pushed up above its own sticky offset):
 *   top = min(max(stickyTop, naturalTop - scrollTop), containerBottom - scrollTop - height)
 * Returns null when the element is not measurable.
 */
export function stickyMetrics(
  el: HTMLElement,
  root: HTMLElement,
  scrollTop: number,
): StickyMetrics | null {
  const naturalTop = offsetTopWithin(el, root)
  const containerBottom = containingBlockBottom(el, root)
  if (naturalTop === null || containerBottom === null) return null
  const stickyTop = stickyOffsetTop(el)
  return {
    naturalTop,
    stickyTop,
    visualTop: Math.min(
      Math.max(stickyTop, naturalTop - scrollTop),
      containerBottom - scrollTop - el.offsetHeight,
    ),
  }
}

/**
 * True only for a header that is genuinely held by sticky positioning. Three
 * conditions, so a top-level header that merely sits at the container top (not
 * scrolled, or collapsed) does not get a separator line:
 *   1. the container really scrolled;
 *   2. the header is painted at its sticky offset;
 *   3. its natural position is BELOW that offset, i.e. scrolling pushed it up.
 */
export function isPinned(m: StickyMetrics, scrollTop: number): boolean {
  return (
    scrollTop > 0 &&
    Math.abs(m.visualTop - m.stickyTop) <= 0.5 &&
    m.naturalTop > m.stickyTop + 0.5
  )
}

/**
 * The pinned header that sits lowest in the stack (`stickyTop` is largest, i.e.
 * the deepest nesting level). Only that one draws the bottom separator, so a
 * chain of pinned ancestors does not turn into a line per folder.
 * @returns {HTMLElement | null} null when nothing is pinned.
 */
export function findBottomPinned(
  headers: Iterable<HTMLElement>,
  root: HTMLElement,
  scrollTop: number,
): HTMLElement | null {
  let bottom: HTMLElement | null = null
  let bottomStickyTop = -Infinity
  for (const el of headers) {
    const m = stickyMetrics(el, root, scrollTop)
    if (!m || !isPinned(m, scrollTop)) continue
    if (m.stickyTop > bottomStickyTop) {
      bottomStickyTop = m.stickyTop
      bottom = el
    }
  }
  return bottom
}
