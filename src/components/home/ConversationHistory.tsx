import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons/Icon'
import { getLang, t } from '../../i18n'
import {
  deleteAllConversations,
  deleteConversation,
  isConversationEmpty,
  listConversations,
  type ConversationMeta,
} from '../../agent/conversationStore'
import ConfirmDialog from '../ConfirmDialog'
import {
  PanelBody,
  PanelButton,
  PanelEmpty,
  PanelRow,
  PanelSearch,
  PanelSection,
  PanelView,
  ViewHeader,
} from '../PanelShell'

interface ConversationHistoryProps {
  baseStorageKey: string
  activeId: string | null
  /** Switch to another conversation; the host closes this layer. */
  onSelect: (id: string) => void
  onClose: () => void
  /** Fired after a single conversation is removed. */
  onDeleted?: (id: string) => void
  /** Fired after every conversation is removed. */
  onDeleteAll?: () => void
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' })
  if (seconds < 60) return t('chat.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 30) return rtf.format(-days, 'day')
  const months = Math.floor(days / 30)
  if (months < 12) return rtf.format(-months, 'month')
  const years = Math.floor(months / 12)
  return rtf.format(-years, 'year')
}

function groupLabel(date: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - itemDay.getTime()) / 86400000)
  if (diffDays === 0) return t('chat.historyToday')
  if (diffDays === 1) return t('chat.historyYesterday')
  if (diffDays >= 2 && diffDays <= 6) return t('chat.historyDaysAgo', { n: diffDays })
  return t('chat.historyEarlier')
}

export default function ConversationHistory({
  baseStorageKey,
  activeId,
  onSelect,
  onClose,
  onDeleted,
  onDeleteAll,
}: ConversationHistoryProps) {
  const [query, setQuery] = useState('')
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ConversationMeta | null>(null)
  const [conversations, setConversations] = useState<ConversationMeta[]>(() =>
    listConversations(baseStorageKey)
  )

  useEffect(() => {
    setConversations(listConversations(baseStorageKey))
  }, [baseStorageKey])

  const visible = useMemo(
    () => conversations.filter((c) => !isConversationEmpty(baseStorageKey, c.id)),
    [conversations, baseStorageKey]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((c) => c.title.toLowerCase().includes(q))
  }, [visible, query])

  const groups = useMemo(() => {
    const now = new Date()
    const map = new Map<string, ConversationMeta[]>()
    for (const conv of filtered) {
      const label = groupLabel(new Date(conv.updatedAt), now)
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(conv)
    }
    return Array.from(map.entries())
  }, [filtered])

  const isEmpty = visible.length === 0
  const noResults = filtered.length === 0 && query.trim().length > 0

  const handleDeleteAll = () => {
    deleteAllConversations(baseStorageKey)
    setShowDeleteAll(false)
    setConversations([])
    onDeleteAll?.()
  }

  const handleDeleteOne = () => {
    if (!pendingDelete) return
    const removed = pendingDelete.id
    deleteConversation(baseStorageKey, removed)
    setPendingDelete(null)
    setConversations(listConversations(baseStorageKey))
    onDeleted?.(removed)
  }

  return (
    <PanelView className="rpp-view-history">
      <ViewHeader
        onBack={onClose}
        backTitle={t('chat.close')}
        backIcon="close"
        title={t('chat.historyTitle')}
        count={visible.length}
        actions={
          <PanelButton
            label={t('chat.deleteAll')}
            icon="trash"
            danger
            disabled={isEmpty}
            onClick={() => setShowDeleteAll(true)}
          />
        }
      />

      <PanelSearch value={query} onChange={setQuery} placeholder={t('chat.searchHistory')} />

      <PanelBody>
        {isEmpty ? (
          <PanelEmpty
            icon={<Icon name="chat" size={20} />}
            title={t('chat.emptyHistory')}
            hint={t('chat.emptyHistoryHint')}
          />
        ) : noResults ? (
          <PanelEmpty icon={<Icon name="search" size={20} />} title={t('chat.noHistoryResults')} />
        ) : (
          groups.map(([label, items]) => (
            <PanelSection key={label} title={label} count={items.length}>
              {items.map((conv) => {
                const isActive = conv.id === activeId
                return (
                  <PanelRow
                    key={conv.id}
                    icon={<Icon name="chat" size={14} />}
                    label={conv.title}
                    active={isActive}
                    onClick={() => onSelect(conv.id)}
                    meta={
                      <>
                        {isActive && (
                          <span className="rpp-row-flag">{t('chat.currentConversation')}</span>
                        )}
                        <span className="rpp-row-time">{formatRelativeTime(conv.updatedAt)}</span>
                      </>
                    }
                    actions={[
                      {
                        icon: 'trash',
                        title: t('chat.deleteChat'),
                        danger: true,
                        onClick: () => setPendingDelete(conv),
                      },
                    ]}
                  />
                )
              })}
            </PanelSection>
          ))
        )}
      </PanelBody>

      <ConfirmDialog
        open={showDeleteAll}
        title={t('chat.deleteAll')}
        message={t('chat.deleteAllConfirm')}
        confirmText={t('chat.deleteAll')}
        cancelText={t('confirm.cancel')}
        onConfirm={handleDeleteAll}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('chat.deleteChat')}
        message={t('chat.deleteConfirm')}
        confirmText={t('chat.deleteChat')}
        cancelText={t('confirm.cancel')}
        onConfirm={handleDeleteOne}
        onCancel={() => setPendingDelete(null)}
      />
    </PanelView>
  )
}
