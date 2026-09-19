import { useEffect, useState } from 'react'
import { Icon } from './icons/Icon'

interface WindowControlsProps {
  maximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

// Custom window-control buttons for frameless Electron windows (Windows/Linux).
// macOS keeps native traffic lights and never renders this component.
export function WindowControls({ maximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  // Suppress hover/click until the first real pointer move: when this group is
  // freshly mounted (e.g. right panel toggled between rp-header and the editor
  // tabs bar), a stationary cursor may already sit over the close button and
  // the browser recomputes :hover for it, flashing the red close hover state.
  // Freeze the whole group until the mouse actually moves.
  const [suppressPointer, setSuppressPointer] = useState(true)

  useEffect(() => {
    if (!suppressPointer) return
    const onMove = () => setSuppressPointer(false)
    window.addEventListener('pointermove', onMove, { once: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [suppressPointer])

  return (
    <div
      className={`win-titlebar-btns${suppressPointer ? ' pointer-suppressed' : ''}`}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="win-titlebar-btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={onMinimize}
      >
        <Icon name="minimize" />
      </button>
      <button
        type="button"
        className="win-titlebar-btn"
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={onToggleMaximize}
      >
        <Icon name={maximized ? 'maximize-restore' : 'maximize'} />
      </button>
      <button
        type="button"
        className="win-titlebar-btn win-titlebar-btn-close"
        title="Close"
        aria-label="Close"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}
