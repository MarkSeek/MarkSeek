import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons/Icon'
import { t } from '../../i18n'
import { useAgentChat } from '../../agent/useAgentChat'
import { useWorkspace } from '../../context/WorkspaceContext'
import { flattenMarkdownFiles } from '../../agent/mentions'
import {
  migrateLegacy,
  getActiveId,
  createConversation,
  updateConversationTitle,
  touchConversation,
  listConversations,
  isConversationEmpty,
} from '../../agent/conversationStore'
import { KEYS, convAgentKey } from '../../utils/storageKeys'
import ConversationHistory from './ConversationHistory'
import { MessageList } from './chat/MessageList'
import { Composer, type ChatMode } from './chat/Composer'

const DEFAULT_STORAGE_KEY = KEYS.chatBase.home

interface ChatPanelProps {
  quickActionPrompt?: string | null
  onPromptConsumed?: () => void
  storageKey?: string
  currentNote?: { path: string; content: string }
}

/**
 * Chat owns its own chrome: a slim conversation bar (history + new chat) and a
 * history layer that slides over the messages. Keeping both inside the chat
 * view means switching conversations never tears down the message state.
 */
export function ChatPanel({
  quickActionPrompt = null,
  onPromptConsumed = () => {},
  storageKey = DEFAULT_STORAGE_KEY,
  currentNote,
}: ChatPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [title, setTitle] = useState(() => t('chat.conversationTitleDefault'))

  useEffect(() => {
    migrateLegacy(storageKey)
    setActiveId(getActiveId(storageKey))
  }, [storageKey])

  // Re-read the name after a switch and after the first message auto-titles it.
  const refreshTitle = useCallback(() => {
    const current = activeId
      ? listConversations(storageKey).find((c) => c.id === activeId)
      : undefined
    setTitle(current?.title || t('chat.conversationTitleDefault'))
  }, [storageKey, activeId])

  useEffect(() => {
    refreshTitle()
  }, [refreshTitle])

  const startNewChat = useCallback(() => {
    setHistoryOpen(false)
    // Reuse the blank conversation instead of stacking empty entries.
    if (activeId && isConversationEmpty(storageKey, activeId)) return
    createConversation(storageKey, t('chat.conversationTitleDefault'))
    setActiveId(getActiveId(storageKey))
  }, [storageKey, activeId])

  const selectConversation = useCallback((id: string) => {
    setActiveId(id)
    setHistoryOpen(false)
  }, [])

  // Removing the open conversation promotes another id in the store (or none,
  // in which case the fallback below creates a fresh one).
  const handleDeleted = useCallback(
    (id: string) => {
      if (id !== activeId) return
      setActiveId(getActiveId(storageKey))
    },
    [activeId, storageKey],
  )

  if (!activeId) {
    // No conversation yet: create the first one.
    createConversation(storageKey, t('chat.conversationTitleDefault'))
    setActiveId(getActiveId(storageKey))
    return null
  }

  return (
    <div className="buddy-side-root">
      <div className="buddy-side-inner">
        <div className="rp-chrome-bar">
          <span className="rp-chrome-title" title={title}>
            {title}
          </span>
          <button
            type="button"
            className="rp-chrome-btn"
            title={t('chat.newChat')}
            aria-label={t('chat.newChat')}
            onClick={startNewChat}
          >
            <Icon name="plus" size={15} />
          </button>
          <button
            type="button"
            className={`rp-chrome-btn${historyOpen ? ' is-active' : ''}`}
            title={t('chat.historyTitle')}
            aria-label={t('chat.historyTitle')}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <Icon name="history" size={15} />
          </button>
        </div>

        <ChatPanelInner
          key={activeId}
          baseStorageKey={storageKey}
          conversationId={activeId}
          quickActionPrompt={quickActionPrompt}
          onPromptConsumed={onPromptConsumed}
          currentNote={currentNote}
          onTitleChange={refreshTitle}
        />
      </div>

      {historyOpen && (
        <div className="buddy-history-layer">
          <ConversationHistory
            baseStorageKey={storageKey}
            activeId={activeId}
            onSelect={selectConversation}
            onClose={() => setHistoryOpen(false)}
            onDeleted={handleDeleted}
            onDeleteAll={startNewChat}
          />
        </div>
      )}
    </div>
  )
}

interface ChatPanelInnerProps extends ChatPanelProps {
  baseStorageKey: string
  conversationId: string
  /** Raised after the conversation is auto-titled from the first message. */
  onTitleChange?: () => void
}

/**
 * One conversation: it owns the run state (mode, agent hook, auto-titling) and
 * composes the transcript and the input area. Everything presentational lives
 * in ./chat.
 */
function ChatPanelInner({
  quickActionPrompt = null,
  onPromptConsumed = () => {},
  baseStorageKey,
  conversationId,
  currentNote,
  onTitleChange = () => {},
}: ChatPanelInnerProps) {
  // If the conversation already has a real (non-default) title, keep it.
  const [titleSet, setTitleSet] = useState(() => {
    const meta = listConversations(baseStorageKey).find((c) => c.id === conversationId)
    return !!meta && meta.title !== t('chat.conversationTitleDefault')
  })
  const [mode, setMode] = useState<ChatMode>('ask')
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Shared with the transcript: sending re-pins the viewport even if the user
  // had scrolled up to read earlier messages.
  const stickToBottomRef = useRef(true)

  const workspace = useWorkspace()
  // Flat list of mentionable Markdown notes, derived from the live file tree.
  const mentionFiles = useMemo(
    () => flattenMarkdownFiles(workspace.fileTree),
    [workspace.fileTree],
  )

  // When the agent mutates notes, refresh any open tabs and the file tree so the
  // calendar / diary / editor views reflect the new content immediately.
  const handleAgentMutation = useCallback(
    (paths: string[]) => {
      const diaryTab = workspace.openTabs.find((t) => t.kind === 'diary')
      const ymdOf = (p: string) => /(\d{4}-\d{2}-\d{2})\.md$/.exec(p)?.[1] ?? null

      for (const p of paths) {
        // Refresh every open tab. The diary virtual page is matched by its
        // `filePath`, so it takes exactly the same route as a note: the stale
        // editor buffer is dropped and the editor rebuilds from disk.
        workspace.refreshOpenFile(p)
        // A journal entry the diary is not currently showing: mirror it into
        // the file tree. `addDiaryFile` expects a plain 'YYYY-MM-DD'.
        if (p.startsWith('Journals/') && diaryTab?.filePath !== p) {
          const ymd = ymdOf(p)
          if (ymd) workspace.addDiaryFile(ymd)
        }
      }
      workspace.loadFileTree()
      workspace.bumpTasks()
    },
    [workspace],
  )

  const agent = useAgentChat(
    currentNote,
    convAgentKey(baseStorageKey, conversationId),
    handleAgentMutation,
  )

  // handle a quick-action prompt trigger
  useEffect(() => {
    if (quickActionPrompt) {
      setInput(quickActionPrompt)
      onPromptConsumed()
      inputRef.current?.focus()
    }
  }, [quickActionPrompt, onPromptConsumed])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    // Sending is an explicit intent to follow the answer: re-pin the viewport
    // even if the user had scrolled up to read earlier messages.
    stickToBottomRef.current = true
    // Auto-title the conversation from the first user message.
    if (!titleSet) {
      updateConversationTitle(baseStorageKey, conversationId, text)
      setTitleSet(true)
      onTitleChange()
    } else {
      touchConversation(baseStorageKey, conversationId)
    }
    // 'ask' runs the loop with read-only tools; 'agent' also allows writes.
    agent.send(input, mode)
    setInput('')
  }

  return (
    <div className="buddy-side-inner" ref={panelRef}>
      <MessageList
        messages={agent.messages}
        streaming={agent.streaming}
        activities={agent.activities}
        // The queue is only ever filled in agent mode: ask mode blocks writes
        // outright, so it can never pause on one. Rendering it unconditionally
        // keeps the card visible if the run was started in another mode.
        pendingConfirms={agent.pendingConfirms}
        error={agent.error}
        onResolveConfirm={agent.resolveConfirm}
        onResolveAllConfirms={agent.resolveAllConfirms}
        onOpenNote={workspace.openFile}
        stickToBottomRef={stickToBottomRef}
      />
      <Composer
        panelRef={panelRef}
        inputRef={inputRef}
        mode={mode}
        onModeChange={setMode}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onStop={agent.stop}
        streaming={agent.streaming}
        sendBlocked={agent.pendingConfirms.length > 0}
        files={mentionFiles}
      />
    </div>
  )
}
