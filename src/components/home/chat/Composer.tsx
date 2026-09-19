import { useCallback, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../icons/Icon'
import { t } from '../../../i18n'
import { useSettings } from '../../../context/SettingsContext'
import type { ProviderConfig } from '../../../config/settingsSchema'
import { useAnchoredMenu } from './useAnchoredMenu'

// Mirrors the backend's agent mode verbatim (server/agent/index.mjs) so no
// mapping is needed when the value is sent: 'ask' runs the loop with read-only
// tools, 'agent' also allows writes (behind a confirmation).
export type ChatMode = 'ask' | 'agent'

interface ComposerProps {
  /** The chat column, used to cap the resize at half of its height. */
  panelRef: RefObject<HTMLDivElement>
  inputRef: RefObject<HTMLTextAreaElement>
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  /** While a write awaits confirmation the only valid answer is Allow/Decline. */
  sendBlocked: boolean
}

/** Current model key (id first, fall back to name) */
const modelKey = (m: { id?: string; name?: string }) => m.id || m.name || ''

/**
 * The input area: resize handle, top toolbar, text box and the mode / model
 * selectors. Dropdowns are portalled to <body> so the input shell's
 * `overflow: hidden` cannot clip them.
 */
export function Composer({
  panelRef,
  inputRef,
  mode,
  onModeChange,
  input,
  onInputChange,
  onSend,
  onStop,
  streaming,
  sendBlocked,
}: ComposerProps) {
  const [inputAreaHeight, setInputAreaHeight] = useState<number | undefined>(undefined)
  const inputAreaRef = useRef<HTMLDivElement | null>(null)
  const topAreaRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const modeMenu = useAnchoredMenu()
  const modelMenu = useAnchoredMenu()

  const { values, set } = useSettings()
  const providers: ProviderConfig[] = Array.isArray(values.aiProviders)
    ? (values.aiProviders as ProviderConfig[])
    : []
  const activeProviderId = values.aiActiveProvider as string
  // the active provider in effect: match aiActiveProvider first, otherwise take the first
  const activeProvider: ProviderConfig | undefined =
    providers.find((p) => p.id === activeProviderId) ?? providers[0]

  const activeModel: string =
    activeProvider && activeProvider.models.length > 0
      ? activeProvider.models.some((m) => modelKey(m) === activeProvider.model)
        ? activeProvider.model
        : modelKey(activeProvider.models[0])
      : (activeProvider?.model ?? '')

  // merge all providers' models so they can be picked directly
  const allModels = providers.flatMap((p) =>
    p.models.map((m) => {
      const key = modelKey(m)
      return {
        providerId: p.id,
        key,
        label: m.name || m.id || key,
        providerName: p.name || p.baseURL || 'Unnamed',
      }
    }),
  )

  const currentModelValue =
    activeProvider && activeModel ? `${activeProvider.id}::${activeModel}` : ''
  const currentModelLabel =
    allModels.find((m) => `${m.providerId}::${m.key}` === currentModelValue)?.label ??
    t('chat.selectModel')

  const toggleModelMenu = () => {
    if (allModels.length === 0) return
    modelMenu.toggle()
  }

  const handleModelChange = (combined: string) => {
    const sep = combined.indexOf('::')
    if (sep < 0) return
    const pid = combined.slice(0, sep)
    const mkey = combined.slice(sep + 2)
    // switch to the corresponding provider and select that model
    set('aiActiveProvider', pid as never)
    set(
      'aiProviders',
      providers.map((p) => (p.id === pid ? { ...p, model: mkey } : p)) as never,
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  // Drag the handle on top of the input area to resize its height.
  // Up: capped at half of the right panel; Down: keep the top toolbar visible.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = inputAreaRef.current?.getBoundingClientRect().height ?? 0
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 0
    const maxHeight = panelHeight > 0 ? Math.floor(panelHeight / 2) : 600
    // Minimum: the top toolbar's bottom meets the shell's bottom. The input
    // area's own height must absorb the resize handle (10px) and its bottom
    // padding (10px) on top of the shell's top padding + gap + bottom padding.
    const topArea = topAreaRef.current
    const minHeight = topArea ? topArea.getBoundingClientRect().height + 30 : 74
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      setInputAreaHeight(Math.max(minHeight, Math.min(startHeight + delta, maxHeight)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [panelRef])

  return (
    <>
      <div
        className="buddy-side-input-area"
        ref={inputAreaRef}
        style={inputAreaHeight !== undefined ? { height: inputAreaHeight } : undefined}
      >
        <div
          className="buddy-side-resize-handle"
          onMouseDown={startResize}
          title={t('chat.resizeInput')}
        />
        <div className="buddy-side-input-shell">
          {/* Top icon toolbar */}
          <div className="buddy-side-top-area" ref={topAreaRef}>
            <div className="buddy-side-top-left">
              <button
                className="buddy-side-icon-btn"
                title={t('chat.mention')}
                onClick={() => onInputChange(input + '@')}
              >
                <Icon name="at" size={16} />
              </button>
              <button
                className="buddy-side-icon-btn"
                title={t('chat.uploadImage')}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="upload" size={16} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length) {
                  const names = Array.from(files).map((f) => f.name).join(', ')
                  onInputChange((input ? input + '\n' : '') + `[Image: ${names}]`)
                }
                e.target.value = ''
              }}
            />
          </div>

          {/* Input box + bottom toolbar: shared highlighted container */}
          <div className="buddy-side-input-body">
            <div className="buddy-side-main-area">
              <textarea
                ref={inputRef}
                className="buddy-side-input"
                placeholder={mode === 'agent' ? t('chat.agentPlaceholder') : t('chat.placeholder')}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={streaming}
              />
            </div>

            {/* Bottom selector bar + send */}
            <div className="buddy-side-input-bottom">
              <div
                className="buddy-side-bottom-left buddy-side-mode-switch"
                ref={modeMenu.wrapRef}
              >
                <button
                  ref={modeMenu.triggerRef}
                  type="button"
                  className={`buddy-side-selector${modeMenu.open ? ' buddy-side-selector-active' : ''}`}
                  title={t('chat.mode')}
                  onClick={modeMenu.toggle}
                >
                  <Icon name={mode === 'agent' ? 'robot' : 'mode'} size={15} />
                  <span className="buddy-side-selector-label">
                    {mode === 'agent' ? t('chat.modeAgent') : t('chat.modeAsk')}
                  </span>
                  <Icon name="chevron-down" size={13} />
                </button>
              </div>

              {/* Model selector (merges all providers); popup style matches Ask/Agent */}
              <div
                className="buddy-side-selector buddy-side-model-select"
                title={t('chat.selectModel')}
                ref={modelMenu.wrapRef}
              >
                <button
                  ref={modelMenu.triggerRef}
                  type="button"
                  className={`buddy-side-model-trigger${modelMenu.open ? ' buddy-side-selector-active' : ''}`}
                  onClick={toggleModelMenu}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    color="currentColor"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 14.5V17C7 18.6569 8.34315 20 10 20"></path>
                    <path d="M9 16L8.41421 15.2612C7.74755 14.4204 7.41421 14 7 14C6.58579 14 6.25245 14.4204 5.58579 15.2612L5 16"></path>
                    <path d="M4.72746 9.87764C5.10404 10 5.56936 10 6.5 10C7.43064 10 7.89596 10 8.27254 9.87764C9.03364 9.63035 9.63035 9.03364 9.87764 8.27254C10 7.89596 10 7.43064 10 6.5C10 5.56936 10 5.10404 9.87764 4.72746C9.63035 3.96636 9.03364 3.36965 8.27254 3.12236C7.89596 3 7.43064 3 6.5 3C5.56936 3 5.10404 3 4.72746 3.12236C3.96636 3.36965 3.36965 3.96636 3.12236 4.72746C3 5.10404 3 5.56936 3 6.5C3 7.43064 3 7.89596 3.12236 8.27254C3.36965 9.03364 3.96636 9.63035 4.72746 9.87764Z"></path>
                    <path d="M15.7275 20.8776C16.104 21 16.5694 21 17.5 21C18.4306 21 18.896 21 19.2725 20.8776C20.0336 20.6303 20.6303 20.0336 20.8776 19.2725C21 18.896 21 18.4306 21 17.5C21 16.5694 21 16.104 20.8776 15.7275C20.6303 14.9664 20.0336 14.3697 19.2725 14.1224C18.896 14 18.4306 14 17.5 14C16.5694 14 16.104 14 15.7275 14.1224C14.9664 14.3697 14.3697 14.9664 14.1224 15.7275C14 16.104 14 16.5694 14 17.5C14 18.4306 14 18.896 14.1224 19.2725C14.3697 20.0336 14.9664 20.6303 15.7275 20.8776Z"></path>
                    <path d="M17.5 4.625V6.5M17.5 6.5V8.375M17.5 6.5H16M17.5 6.5H19M20.5 6.5L19.1987 6.06623C18.6015 5.86716 18.1328 5.39853 17.9338 4.80132L17.5 3.5L17.0662 4.80132C16.8672 5.39853 16.3985 5.86716 15.8013 6.06623L14.5 6.5L15.8013 6.93377C16.3985 7.13284 16.8672 7.60147 17.0662 8.19868L17.5 9.5L17.9338 8.19868C18.1328 7.60147 18.6015 7.13284 19.1987 6.93377L20.5 6.5Z"></path>
                  </svg>
                  {allModels.length > 0 ? (
                    <span className="buddy-side-selector-label">{currentModelLabel}</span>
                  ) : (
                    <span className="buddy-side-selector-label">{t('chat.noModel')}</span>
                  )}
                  <Icon name="chevron-down" size={13} />
                </button>
              </div>

              <div className="buddy-side-bottom-right">
                {streaming ? (
                  <button
                    className="buddy-side-icon-btn buddy-side-stop"
                    onClick={onStop}
                    title={t('chat.stop')}
                  >
                    <Icon name="stop" size={14} />
                  </button>
                ) : (
                  <button
                    className="buddy-side-icon-btn buddy-side-send"
                    onClick={onSend}
                    // While a write awaits confirmation the only valid answer is
                    // Allow / Decline, so sending is blocked until it is resolved.
                    disabled={!input.trim() || sendBlocked}
                    title={t('chat.send')}
                  >
                    <Icon name="send" size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {modeMenu.open &&
        createPortal(
          <div
            ref={modeMenu.menuRef}
            className="buddy-side-mode-menu"
            style={{ left: modeMenu.pos.left, bottom: modeMenu.pos.bottom }}
          >
            {(['ask', 'agent'] as ChatMode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`buddy-side-mode-item${mode === value ? ' buddy-side-mode-item-active' : ''}`}
                onClick={() => {
                  onModeChange(value)
                  modeMenu.hide()
                }}
              >
                <Icon name={value === 'agent' ? 'robot' : 'mode'} size={15} />
                <span className="buddy-side-mode-item-label">
                  {value === 'agent' ? t('chat.modeAgent') : t('chat.modeAsk')}
                </span>
                {mode === value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {modelMenu.open &&
        allModels.length > 0 &&
        createPortal(
          <div
            ref={modelMenu.menuRef}
            className="buddy-side-mode-menu buddy-side-model-menu"
            style={{ left: modelMenu.pos.left, bottom: modelMenu.pos.bottom }}
          >
            {allModels.map((m) => {
              const value = `${m.providerId}::${m.key}`
              const active = value === currentModelValue
              return (
                <button
                  type="button"
                  key={value}
                  className={`buddy-side-mode-item${active ? ' buddy-side-mode-item-active' : ''}`}
                  onClick={() => {
                    handleModelChange(value)
                    modelMenu.hide()
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    color="currentColor"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 14.5V17C7 18.6569 8.34315 20 10 20"></path>
                    <path d="M9 16L8.41421 15.2612C7.74755 14.4204 7.41421 14 7 14C6.58579 14 6.25245 14.4204 5.58579 15.2612L5 16"></path>
                    <path d="M4.72746 9.87764C5.10404 10 5.56936 10 6.5 10C7.43064 10 7.89596 10 8.27254 9.87764C9.03364 9.63035 9.63035 9.03364 9.87764 8.27254C10 7.89596 10 7.43064 10 6.5C10 5.56936 10 5.10404 9.87764 4.72746C9.63035 3.96636 9.03364 3.36965 8.27254 3.12236C7.89596 3 7.43064 3 6.5 3C5.56936 3 5.10404 3 4.72746 3.12236C3.96636 3.36965 3.36965 3.96636 3.12236 4.72746C3 5.10404 3 5.56936 3 6.5C3 7.43064 3 7.89596 3.12236 8.27254C3.36965 9.03364 3.96636 9.63035 4.72746 9.87764Z"></path>
                    <path d="M15.7275 20.8776C16.104 21 16.5694 21 17.5 21C18.4306 21 18.896 21 19.2725 20.8776C20.0336 20.6303 20.6303 20.0336 20.8776 19.2725C21 18.896 21 18.4306 21 17.5C21 16.5694 21 16.104 20.8776 15.7275C20.6303 14.9664 20.0336 14.3697 19.2725 14.1224C18.896 14 18.4306 14 17.5 14C16.5694 14 16.104 14 15.7275 14.1224C14.9664 14.3697 14.3697 14.9664 14.1224 15.7275C14 16.104 14 16.5694 14 17.5C14 18.4306 14 18.896 14.1224 19.2725C14.3697 20.0336 14.9664 20.6303 15.7275 20.8776Z"></path>
                    <path d="M17.5 4.625V6.5M17.5 6.5V8.375M17.5 6.5H16M17.5 6.5H19M20.5 6.5L19.1987 6.06623C18.6015 5.86716 18.1328 5.39853 17.9338 4.80132L17.5 3.5L17.0662 4.80132C16.8672 5.39853 16.3985 5.86716 15.8013 6.06623L14.5 6.5L15.8013 6.93377C16.3985 7.13284 16.8672 7.60147 17.0662 8.19868L17.5 9.5L17.9338 8.19868C18.1328 7.60147 18.6015 7.13284 19.1987 6.93377L20.5 6.5Z"></path>
                  </svg>
                  <span className="buddy-side-mode-item-label">
                    {m.label} ({m.providerName})
                  </span>
                  {active && <Icon name="check" size={14} />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
