import { useEffect, useRef } from 'react'
import { Icon } from './icons/Icon'
import { t } from '../i18n'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title = t('confirm.confirm'),
  message,
  confirmText = t('confirm.ok'),
  cancelText = t('confirm.cancel'),
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      // focus the confirm button after the dialog opens, for keyboard operation
      setTimeout(() => confirmRef.current?.focus(), 0)
    }
  }, [open])

  // close on Escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  // close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  if (!open) return null

  return (
    <div className="confirm-overlay" onClick={handleBackdropClick}>
      <div className="confirm-dialog">
        <div className="confirm-header">
          <Icon name="alert" size={20} />
          <span className="confirm-title">{title}</span>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button ref={confirmRef} className="confirm-btn confirm-btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
