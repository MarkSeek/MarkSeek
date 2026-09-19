import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import type { AgentMessageStats } from '../../../agent/types'

// 1.2k reads better than 1200 once answers get long.
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

// Sub-second answers keep milliseconds; anything longer is shown in seconds.
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

// Clipboard write with a legacy fallback for non-secure contexts (http LAN).
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path below */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * Statistics row shown under a finished answer: copy button, token count and
 * the wall-clock time the answer took. Credits and like/dislike actions are
 * intentionally not part of this product.
 */
export function MessageStats({ content, stats }: { content: string; stats: AgentMessageStats }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    const ok = await copyText(content)
    setCopied(ok ? 'ok' : 'fail')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied('idle'), 1600)
  }

  const copyLabel =
    copied === 'ok' ? t('chat.copied') : copied === 'fail' ? t('chat.copyFailed') : t('chat.copy')

  return (
    <div className="buddy-msg-stats">
      <button
        type="button"
        className={`buddy-msg-stat-btn${copied !== 'idle' ? ' is-active' : ''}`}
        onClick={handleCopy}
        title={copyLabel}
        aria-label={copyLabel}
      >
        <Icon name={copied === 'ok' ? 'check' : 'copy'} size={12} />
        <span>{copyLabel}</span>
      </button>
      <span className="buddy-msg-stat" title={t('chat.tokens')}>
        <Icon name="spark" size={11} />
        <span>{formatTokens(stats.tokens)} Tokens</span>
      </span>
      <span className="buddy-msg-stat" title={t('chat.duration')}>
        <Icon name="clock" size={11} />
        <span>{formatDuration(stats.durationMs)}</span>
      </span>
    </div>
  )
}
