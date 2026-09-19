import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons/Icon'
import { t } from '../i18n'
import { vaultImageUrl } from '../utils/isImage'

// Zoom limits and the multiplicative step used by the buttons. A step of 1.2
// keeps the perceived speed constant whether the user is at 5% or 2000%.
const MIN_SCALE = 0.05
const MAX_SCALE = 20
const ZOOM_STEP = 1.2
/** Wheel sensitivity: one notch (~100px of deltaY) lands near one step. */
const WHEEL_SENSITIVITY = 0.0025

export interface ImageViewerProps {
  /** Vault-relative path of the picture. */
  path: string
  /** File name, used as the alt text. */
  name?: string
}

interface Size {
  w: number
  h: number
}

interface Point {
  x: number
  y: number
}

type LoadStatus = 'loading' | 'ready' | 'failed'

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

/**
 * Read-only picture viewer opened as a tab.
 *
 * The bytes are never loaded into the tab state: the browser fetches them
 * through the vault image URL, so a large photo costs no more memory than the
 * decoded bitmap and `updateContent` can never clobber the file.
 *
 * Zoom/pan is a single `transform` on the image: `scale` is absolute (1 = one
 * image pixel per CSS pixel) and `offset` is the translation of the image
 * centre from the canvas centre, in layout pixels.
 */
export default function ImageViewer({ path, name }: ImageViewerProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null)

  const [natural, setNatural] = useState<Size | null>(null)
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [fitMode, setFitMode] = useState(true)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [dragging, setDragging] = useState(false)

  const url = useMemo(() => vaultImageUrl(path), [path])
  // Mirrors `scale` so a burst of wheel events (several per frame) can zoom
  // from the newest value instead of the one React has rendered so far.
  const scaleRef = useRef(1)

  const updateScale = useCallback((next: number) => {
    const clamped = clampScale(next)
    scaleRef.current = clamped
    setScale(clamped)
  }, [])

  // Canvas size drives "fit to window" and has to follow panel resizes.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fitting never magnifies a small picture, it would only make it blurry.
  const fitScale = useMemo(() => {
    if (!natural || !box.w || !box.h) return 1
    return Math.min(box.w / natural.w, box.h / natural.h, 1)
  }, [natural, box])

  const applyFit = useCallback(() => {
    setFitMode(true)
    updateScale(fitScale)
    setOffset({ x: 0, y: 0 })
  }, [fitScale, updateScale])

  // Keep a fitted picture fitted when the image arrives or the panel resizes.
  useEffect(() => {
    if (!fitMode) return
    updateScale(fitScale)
    setOffset({ x: 0, y: 0 })
  }, [fitMode, fitScale, updateScale])

  /**
   * Zoom by `factor`, keeping the point `anchor` (relative to the canvas
   * centre, layout px) pinned under the cursor:
   *   offset' = anchor - (scale'/scale) * (anchor - offset)
   */
  const zoomAt = useCallback(
    (factor: number, anchor: Point) => {
      const prev = scaleRef.current
      const next = clampScale(prev * factor)
      if (next === prev) return
      updateScale(next)
      setOffset((cur) => ({
        x: anchor.x - (next / prev) * (anchor.x - cur.x),
        y: anchor.y - (next / prev) * (anchor.y - cur.y),
      }))
      setFitMode(false)
    },
    [updateScale],
  )

  /**
   * Layout px per painted px. The app scales the whole layout with CSS zoom
   * (.app-layout { zoom: ... }), so pointer coordinates coming from the
   * viewport have to be divided before they can be mixed with layout values.
   */
  const layoutRatio = useCallback((): number => {
    const el = canvasRef.current
    if (!el) return 1
    const rect = el.getBoundingClientRect()
    return rect.width > 0 ? el.clientWidth / rect.width : 1
  }, [])

  // React registers `wheel` passively on the root, so preventDefault() only
  // works from a listener added here with `passive: false`.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const ratio = layoutRatio()
      const rect = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * WHEEL_SENSITIVITY), {
        x: (e.clientX - rect.left) * ratio - el.clientWidth / 2,
        y: (e.clientY - rect.top) * ratio - el.clientHeight / 2,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [layoutRatio, zoomAt])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready' || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const ratio = layoutRatio()
    setOffset({
      x: drag.ox + (e.clientX - drag.x) * ratio,
      y: drag.oy + (e.clientY - drag.y) * ratio,
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    // An SVG without intrinsic dimensions reports 0: fall back to the box the
    // browser gave it so the picture still has a usable size.
    setNatural({
      w: img.naturalWidth || img.clientWidth || 1,
      h: img.naturalHeight || img.clientHeight || 1,
    })
    setStatus('ready')
  }

  // Double click toggles between "fit" and "actual size".
  const toggleZoom = () => {
    if (fitMode) {
      setFitMode(false)
      updateScale(1)
      setOffset({ x: 0, y: 0 })
    } else {
      applyFit()
    }
  }

  const percent = Math.round(scale * 100)

  const imgStyle: React.CSSProperties = natural
    ? {
        width: natural.w,
        height: natural.h,
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        opacity: 1,
      }
    : // Before the bitmap arrives the picture is invisible anyway; contain it
      // so a huge photo cannot push a scrollbar into the canvas.
      { maxWidth: '100%', maxHeight: '100%', opacity: 0 }

  return (
    <div className="image-viewer">
      <div
        ref={canvasRef}
        className={`image-viewer-canvas${dragging ? ' dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={toggleZoom}
      >
        {status !== 'failed' && (
          <img
            className="image-viewer-img"
            src={url}
            alt={name ?? path}
            draggable={false}
            onLoad={handleLoad}
            onError={() => setStatus('failed')}
            style={imgStyle}
          />
        )}
        {status === 'loading' && <div className="image-viewer-spinner" aria-hidden="true" />}
        {status === 'failed' && (
          <div className="image-viewer-status">
            <Icon name="image" size={32} />
            <span>{t('image.loadFailed')}</span>
          </div>
        )}
      </div>

      <div className="image-viewer-toolbar">
        <button
          className="image-viewer-btn"
          onClick={() => zoomAt(1 / ZOOM_STEP, { x: 0, y: 0 })}
          title={t('image.zoomOut')}
          aria-label={t('image.zoomOut')}
          disabled={status !== 'ready'}
        >
          <Icon name="zoom-out" size={16} />
        </button>
        <button
          className="image-viewer-zoom"
          onClick={applyFit}
          title={t('image.reset')}
          disabled={status !== 'ready'}
        >
          {percent}%
        </button>
        <button
          className="image-viewer-btn"
          onClick={() => zoomAt(ZOOM_STEP, { x: 0, y: 0 })}
          title={t('image.zoomIn')}
          aria-label={t('image.zoomIn')}
          disabled={status !== 'ready'}
        >
          <Icon name="zoom-in" size={16} />
        </button>
        <span className="image-viewer-sep" />
        <button
          className="image-viewer-btn"
          onClick={applyFit}
          title={t('image.fit')}
          aria-label={t('image.fit')}
          disabled={status !== 'ready'}
        >
          <Icon name="fit-screen" size={16} />
        </button>
        <button
          className="image-viewer-btn image-viewer-btn-text"
          onClick={() => {
            setFitMode(false)
            updateScale(1)
            setOffset({ x: 0, y: 0 })
          }}
          title={t('image.actualSize')}
          disabled={status !== 'ready'}
        >
          1:1
        </button>
      </div>
    </div>
  )
}
