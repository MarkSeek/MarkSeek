import { useEffect, useRef } from 'react'

interface ResizableSplitterProps {
  onResize: (deltaX: number) => void
  // Hide the handle (e.g. when its adjacent panel is collapsed) so it no
  // longer occupies layout space.
  hidden?: boolean
}

export default function ResizableSplitter({ onResize, hidden = false }: ResizableSplitterProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    let isDragging = false
    let startX = 0

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      isDragging = true
      startX = e.clientX
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const delta = e.clientX - startX
      startX = e.clientX
      onResizeRef.current(delta)
    }

    const onMouseUp = () => {
      isDragging = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    handle.addEventListener('mousedown', onMouseDown)

    return () => {
      handle.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div
      ref={handleRef}
      className={`resize-handle${hidden ? ' resize-handle-hidden' : ''}`}
    />
  )
}
