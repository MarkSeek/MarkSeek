import { useCallback, useEffect, useRef, useState } from 'react'

const MENU_WIDTH = 220

// Menus open upwards from their trigger. Measuring in viewport coordinates and
// portalling to <body> keeps them out of the input shell's `overflow: hidden`.
function anchorMenu(el: HTMLElement | null) {
  if (!el) return { left: 0, bottom: 0 }
  const r = el.getBoundingClientRect()
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)),
    bottom: Math.max(8, window.innerHeight - r.top + 6),
  }
}

/**
 * One dropdown anchored above its trigger.
 *
 * The mode and model selectors of the chat composer each used to re-implement
 * the same three behaviours — measure the anchor, dismiss on an outside click,
 * dismiss on any layout change — so the copies could drift apart.
 */
export function useAnchoredMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, bottom: 0 })
  // The trigger's wrapper: clicks inside it must not count as "outside".
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const show = useCallback(() => {
    setPos(anchorMenu(triggerRef.current))
    setOpen(true)
  }, [])
  const hide = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => (open ? hide() : show()), [open, hide, show])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The anchored position would go stale on any layout change, so just dismiss.
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open, hide])

  return { open, pos, wrapRef, triggerRef, menuRef, show, hide, toggle }
}
