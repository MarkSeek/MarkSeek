import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import MarkdownRenderer from '../MarkdownRenderer'
import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import type { AgentChatMessage } from '../../../agent/useAgentChat'
import type { ConfirmRequest, ToolActivity } from '../../../agent/types'
import { MessageStats } from './MessageStats'
import { ActivityLog } from './ActivityLog'
import { ConfirmCard } from './ConfirmCard'

interface MessageListProps {
  messages: AgentChatMessage[]
  streaming: boolean
  activities: ToolActivity[]
  /** Every write the current run paused on, oldest first. */
  pendingConfirms: ConfirmRequest[]
  error: string | null
  onResolveConfirm: (id: string, approved: boolean) => void
  /** Answer every queued write at once; used when the run paused on several. */
  onResolveAllConfirms: (approved: boolean) => void
  /**
   * Owned by the parent because sending is an explicit intent to follow the
   * answer, and the send button lives in the composer.
   */
  stickToBottomRef: MutableRefObject<boolean>
}

/**
 * The scrollable transcript: messages, the tool activity log, the write
 * confirmation card and the error card.
 *
 * It owns the viewport and its autoscroll. Autoscroll only runs while the
 * viewport is already pinned near the bottom, so scrolling up to read earlier
 * messages pauses it and a long stream can never yank the view back down.
 */
export function MessageList({
  messages,
  streaming,
  activities,
  pendingConfirms,
  error,
  onResolveConfirm,
  onResolveAllConfirms,
  stickToBottomRef,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const messagesInnerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  // Scroll the message container to its very bottom. Token streams call this
  // many times per second, so calls are coalesced into a single frame.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const top = el.scrollHeight - el.clientHeight
      if (top <= 0) return
      // Direct scrollTop assignment beats scrollIntoView during streaming: a
      // smooth animation is cancelled by the very next chunk, which leaves the
      // viewport lagging behind the text.
      if (smooth) {
        el.scrollTo({ top, behavior: 'smooth' })
      } else {
        el.scrollTop = top
        // Late-rendered markdown (images, code blocks) grows the content after
        // this frame, so pin once more on the next one.
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - el.clientHeight
        })
      }
    })
  }, [])

  // Track whether the user is still at the bottom.
  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance <= 64
  }, [stickToBottomRef])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  // Content height can also grow WITHOUT a new message (markdown images
  // finishing load, activity rows expanding), so re-pin on resize as well.
  useEffect(() => {
    const el = messagesInnerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom(false)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToBottom, stickToBottomRef])

  // Everything the viewport should follow: new messages, streamed tokens
  // (content length), activity rows, confirm/error cards and run-state flips.
  const lastContentLength = messages[messages.length - 1]?.content.length ?? 0
  useEffect(() => {
    if (!stickToBottomRef.current) return
    // Smooth while idle (a new message just landed), instant while streaming
    // so the view keeps up with the text.
    scrollToBottom(!streaming)
  }, [
    messages.length,
    lastContentLength,
    activities.length,
    pendingConfirms,
    error,
    streaming,
    scrollToBottom,
    stickToBottomRef,
  ])

  const resolveConfirm = (id: string, approved: boolean) => {
    // Deciding is an explicit intent to follow the answer: re-pin the viewport
    // even if the user had scrolled up to read earlier messages.
    stickToBottomRef.current = true
    onResolveConfirm(id, approved)
  }

  const resolveAllConfirms = (approved: boolean) => {
    stickToBottomRef.current = true
    onResolveAllConfirms(approved)
  }

  return (
    <div className="buddy-side-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
      <div className="buddy-side-messages-inner" ref={messagesInnerRef}>
        {messages.length === 0 && !streaming && (
          <div className="buddy-side-empty">{t('chat.agentIntro')}</div>
        )}
        {messages.map((msg, i) => {
          // Statistics belong to a FINISHED answer only: never show them
          // on the bubble that is still streaming.
          const isLast = i === messages.length - 1
          const showStats = msg.role === 'assistant' && !!msg.stats && !(streaming && isLast)
          return (
            <div key={i} className={`buddy-side-msg buddy-side-msg-${msg.role}`}>
              <div className="buddy-side-msg-content">
                <MarkdownRenderer content={msg.content} />
                {showStats && msg.stats && <MessageStats content={msg.content} stats={msg.stats} />}
              </div>
            </div>
          )
        })}
        {streaming && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="buddy-side-msg buddy-side-msg-assistant">
            <div className="buddy-side-msg-content">
              <span className="buddy-side-cursor">▊</span>
            </div>
          </div>
        )}
        <ActivityLog activities={activities} />
        {/* Several writes paused at once: one decision for all of them beats
            answering card by card. */}
        {pendingConfirms.length > 1 && (
          <div className="agent-confirm-batch">
            <span className="agent-confirm-batch-count">
              {t('chat.confirmBatch', { n: pendingConfirms.length })}
            </span>
            <button
              type="button"
              className="agent-confirm-card-allow"
              onClick={() => resolveAllConfirms(true)}
            >
              {t('chat.confirmWriteAll')}
            </button>
            <button
              type="button"
              className="agent-confirm-card-deny"
              onClick={() => resolveAllConfirms(false)}
            >
              {t('chat.declineWriteAll')}
            </button>
          </div>
        )}
        {pendingConfirms.map((req, i) => (
          <ConfirmCard
            key={req.id}
            request={req}
            index={pendingConfirms.length > 1 ? i + 1 : undefined}
            total={pendingConfirms.length > 1 ? pendingConfirms.length : undefined}
            onResolve={(approved) => resolveConfirm(req.id, approved)}
          />
        ))}
        {error && (
          <div className="agent-error-card">
            <div className="agent-error-card-head">
              <Icon name="alert" size={14} />
              <span>{t('chat.agentErrorTitle')}</span>
            </div>
            <pre className="agent-error-card-message">{error}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
