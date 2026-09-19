// Keep Crepe's slash menu inside the editor.
//
// The menu is a floating-ui overlay (placement `bottom-start` + `flip`) whose
// scrollable list carries a fixed `max-height` — 420px upstream, overridden to
// 300px in App.css. floating-ui only flips the menu when it does not fit in the
// *viewport*, so with an editor shorter than the window the menu hangs out of
// the editor box whenever the caret sits in its middle: the placement is legal
// as far as floating-ui is concerned, it just overflows the scroll container.
//
// This plugin caps the list to the room the editor actually has left in the
// direction the menu opens, and never lets the menu grow past 2/3 of the
// editor's height. The result is published as `--slash-menu-max-h` on the menu
// element, which App.css consumes — so the value is already in place on the
// frame the menu appears, instead of being corrected one frame later.
import { Plugin } from '@milkdown/prose/state'
import { appZoomScale } from './zoom'

/** Crepe's floating slash menu (block-edit feature). */
const MENU_SELECTOR = '.milkdown-slash-menu'
/** The scrollable part of it — the element that carries `max-height`. */
const LIST_SELECTOR = '.menu-groups'
/** Gap kept between the menu and the edge of the editor, in CSS px. */
const EDGE_MARGIN = 8
/** Floor for the list, in CSS px: a 20px-tall menu is unusable. */
const MIN_LIST_HEIGHT = 96
/** Share of the editor height the whole menu may occupy at most. */
const MAX_HEIGHT_RATIO = 2 / 3

/**
 * The box the menu has to stay inside: the nearest clipping ancestor, i.e. the
 * scroll container the editor lives in (`.editor-area` for notes,
 * `.diary-scroll` for the diary). The editor document itself is taller than
 * that, so measuring it would allow the menu to overflow again.
 */
function findClippingHost(from: HTMLElement): HTMLElement {
  let node = from.parentElement
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return node
    node = node.parentElement
  }
  return document.documentElement
}

export function createSlashMenuSizing(): Plugin {
  return new Plugin({
    view: (view) => {
      const root = view.dom.parentElement
      if (!root) return {}
      const host = findClippingHost(view.dom)

      let menu: HTMLElement | null = null
      let menuObserver: MutationObserver | undefined
      let frame = 0
      let applied = -1

      const findMenu = (): HTMLElement | null => {
        if (menu?.isConnected) return menu
        menu = root.querySelector<HTMLElement>(MENU_SELECTOR)
        return menu
      }

      const apply = () => {
        // Coalesce bursts (typing, scrolling) into one measurement per frame.
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          const el = findMenu()
          if (!el || el.dataset.show !== 'true') return
          const list = el.querySelector<HTMLElement>(LIST_SELECTOR)
          if (!list) return
          const menuRect = el.getBoundingClientRect()
          const listRect = list.getBoundingClientRect()
          if (menuRect.height <= 0) return

          const scale = appZoomScale()
          const hostRect = host.getBoundingClientRect()
          // `bottom-start` is the default placement; floating-ui flips the menu
          // above the caret when it does not fit. Compare the two to tell which
          // way it went — the budget differs per direction.
          let caretTop = menuRect.top
          let caretBottom = menuRect.bottom
          try {
            const coords = view.coordsAtPos(view.state.selection.from)
            caretTop = coords.top
            caretBottom = coords.bottom
          } catch {
            // Selection gone (menu on its way out): keep the measured edges.
          }
          const opensDownward = menuRect.top >= caretTop - 1

          // Measure the room from the CARET, not from the menu's current rect.
          // Using `menuRect` here made the budget track the menu's own rendered
          // height: as the list filtered down the menu climbed away from the
          // caret (detaching) and the cap shrank with it. Anchoring to the caret
          // keeps the budget stable and the menu glued to where "/" was typed.
          const room = opensDownward
            ? hostRect.bottom - caretBottom
            : caretTop - hostRect.top

          // The tab strip and paddings are part of the menu's own height, so
          // they have to come off the budget before it reaches the list.
          const chrome = menuRect.height - listRect.height
          const budget = Math.min(room - EDGE_MARGIN * scale, hostRect.height * MAX_HEIGHT_RATIO)
          const next = Math.round(Math.max(MIN_LIST_HEIGHT, (budget - chrome) / scale))
          if (Math.abs(next - applied) < 1) return
          applied = next
          el.style.setProperty('--slash-menu-max-h', `${next}px`)
        })
      }

      // The menu is appended to the editor root on its first show, so it has to
      // be picked up before it can be observed.
      const watchMenu = () => {
        const el = findMenu()
        if (!el || menuObserver) return
        menuObserver = new MutationObserver(apply)
        // `data-show` for open/close, `style` because floating-ui writes the
        // resolved top/left there once per keystroke.
        menuObserver.observe(el, { attributes: true, attributeFilter: ['data-show', 'style'] })
        apply()
      }

      const rootObserver = new MutationObserver(() => {
        if (!menu) watchMenu()
      })
      rootObserver.observe(root, { childList: true })

      const onScroll = () => apply()
      window.addEventListener('resize', apply)
      // Capture: the editor scrolls in its own container, not on the window.
      window.addEventListener('scroll', onScroll, true)
      let resizeObserver: ResizeObserver | undefined
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(apply)
        resizeObserver.observe(host)
      }
      watchMenu()

      return {
        update: apply,
        destroy: () => {
          if (frame) cancelAnimationFrame(frame)
          rootObserver.disconnect()
          menuObserver?.disconnect()
          resizeObserver?.disconnect()
          window.removeEventListener('resize', apply)
          window.removeEventListener('scroll', onScroll, true)
        },
      }
    },
  })
}
