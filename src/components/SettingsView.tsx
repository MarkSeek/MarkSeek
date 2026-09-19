import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../context/SettingsContext'
import { getPluginThemes } from '../plugins/themes'
import {
  SETTINGS_GROUPS,
  type SettingField,
  type ProviderConfig,
  type ModelConfig,
  type ImageRule,
} from '../config/settingsSchema'
import { previewImageDir, type ImageDirPreview } from '../api/files'
import { t, useTranslation } from '../i18n'
import { pluginText } from '../plugins/manifestI18n'
import type { PluginInfo } from '../../plugins/types'
import { Icon } from './icons/Icon'
import { SettingsRawModal } from './SettingsRawModal'
import { SHORTCUTS } from '../hooks/useGlobalShortcuts'
import { isMac } from '../utils/platform'

const MOD_LABEL = isMac ? '⌘' : 'Ctrl'

function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      if (part === 'mod') return MOD_LABEL
      if (part === 'shift') return isMac ? '⇧' : 'Shift'
      if (part === 'alt') return isMac ? '⌥' : 'Alt'
      if (part === 'arrowleft') return '←'
      if (part === 'arrowright') return '→'
      if (part === 'space') return 'Space'
      return part.toUpperCase()
    })
    .join(isMac ? '' : '+')
}

// ===== Settings outline model =====
// One entry per rendered card, plus one sub-entry per field, so the sidebar can
// jump straight to a single setting instead of only to a group.
interface OutlineItem {
  id: string // logical id, shared with the DOM anchor through anchorId()
  titleKey: string
}

interface OutlineSection extends OutlineItem {
  items: OutlineItem[]
}

const OUTLINE: OutlineSection[] = [
  ...SETTINGS_GROUPS.map((group) => ({
    id: `section-${group.id}`,
    titleKey: group.title,
    items: group.fields.map((f) => ({ id: `field-${f.key}`, titleKey: f.label })),
  })),
  { id: 'section-shortcuts', titleKey: 'settings.group.shortcuts', items: [] },
  { id: 'section-plugins', titleKey: 'settings.group.plugins', items: [] },
]

const anchorId = (id: string) => `settings-anchor-${id}`

// Every anchor in document order; the scroll spy walks this list top to bottom.
const ANCHORS: string[] = OUTLINE.flatMap((s) => [s.id, ...s.items.map((i) => i.id)])

// Distance from the top of the scroller at which an anchor counts as "current".
const SPY_OFFSET = 96

function FieldControl({ field }: { field: SettingField }) {
  const { values, set } = useSettings()
  const value = values[field.key as keyof typeof values]

  switch (field.type) {
    case 'select': {
      // Merge built-in theme options with themes contributed by plugins so that a
      // plugin-installed theme (e.g. the "Midnight" sample) shows up in the list.
      const options =
        field.key === 'theme'
          ? [
              ...(field.options ?? []),
              ...getPluginThemes().map((p) => ({ label: p.label, value: p.id })),
            ]
          : field.options
      return (
        <select
          className="setting-control setting-select"
          value={String(value)}
          onChange={(e) => set(field.key as keyof typeof values, e.target.value)}
        >
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.label)}
            </option>
          ))}
        </select>
      )
    }

    case 'text':
      return (
        <input
          type="text"
          className="setting-control setting-input"
          value={String(value)}
          placeholder={field.placeholder ? t(field.placeholder) : field.placeholder}
          onChange={(e) => set(field.key as keyof typeof values, e.target.value)}
        />
      )

    case 'number':
      return (
        <div className="setting-number-wrap">
          <input
            type="number"
            className="setting-control setting-number"
            value={Number(value)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) =>
              set(field.key as keyof typeof values, Number(e.target.value))
            }
          />
          <span className="setting-number-unit">{field.unit ?? 'px'}</span>
        </div>
      )

    case 'zoom': {
      const raw = Number(value)
      const current = Number.isFinite(raw) ? raw : 100
      const min = field.min ?? 50
      const max = field.max ?? 200
      const step = field.step ?? 5
      const pct = max > min ? (current - min) / (max - min) : 0
      const trackBg = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct * 100}%, var(--border) ${pct * 100}%, var(--border) 100%)`
      return (
        <div className="setting-number-wrap setting-zoom-wrap">
          <input
            type="range"
            className="setting-control setting-zoom-slider"
            style={{ background: trackBg }}
            value={current}
            min={min}
            max={max}
            step={step}
            onChange={(e) =>
              set(field.key as keyof typeof values, Number(e.target.value))
            }
          />
          <span className="setting-number-unit setting-zoom-value">
            {current}{field.unit ?? '%'}
          </span>
        </div>
      )
    }

    case 'boolean':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          className={`setting-toggle ${value ? 'is-on' : ''}`}
          onClick={() => set(field.key as keyof typeof values, !value)}
        >
          <span className="setting-toggle-knob" />
        </button>
      )

    case 'providerList': {
      const providers: ProviderConfig[] = Array.isArray(value) ? (value as ProviderConfig[]) : []

      const updateProviders = (next: ProviderConfig[]) => {
        set('aiProviders', next as never)
      }

      const genId = () => 'p_' + Math.random().toString(36).slice(2, 9)

      const addProvider = () => {
        const id = genId()
        const next: ProviderConfig[] = [
          ...providers,
          { id, name: `${t('settings.providerDefaultName')} ${providers.length + 1}`, vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', baseURL: 'https://api.deepseek.com', model: '', models: [] },
        ]
        updateProviders(next)
        // the first provider is set as active automatically
        if (providers.length === 0) set('aiActiveProvider', id as never)
      }

      const removeProvider = (id: string) => {
        const next = providers.filter((p) => p.id !== id)
        updateProviders(next)
        // if the active provider is deleted, fall back to the first in the list
        if ((values.aiActiveProvider as unknown as string) === id) {
          set('aiActiveProvider', (next[0]?.id ?? '') as never)
        }
      }

      const patchProvider = (id: string, patch: Partial<ProviderConfig>) => {
        updateProviders(providers.map((p) => (p.id === id ? { ...p, ...patch } : p)))
      }

      const addModelTo = (id: string, draft: Partial<ModelConfig>) => {
        const m: ModelConfig = {
          id: (draft.id ?? '').trim(),
          name: (draft.name ?? '').trim(),
          url: (draft.url ?? '').trim(),
          toolCalling: Boolean(draft.toolCalling),
          vision: Boolean(draft.vision),
          maxInputTokens: draft.maxInputTokens,
          maxOutputTokens: draft.maxOutputTokens,
        }
        if (!m.id && !m.name) return
        const p = providers.find((x) => x.id === id)
        if (!p) return
        const key = m.id || m.name
        if (p.models.some((x) => (x.id || x.name) === key)) return
        const models = [...p.models, m]
        patchProvider(id, { models })
        // if there is no current model yet, auto-set it to the one just added
        if (!p.model) patchProvider(id, { model: key })
      }

      const removeModelFrom = (id: string, key: string) => {
        const p = providers.find((x) => x.id === id)
        if (!p) return
        const models = p.models.filter((m) => (m.id || m.name) !== key)
        const model = p.model === key ? (models[0]?.id || models[0]?.name || '') : p.model
        patchProvider(id, { models, model })
      }

      const patchModel = (id: string, key: string, patch: Partial<ModelConfig>) => {
        const p = providers.find((x) => x.id === id)
        if (!p) return
        const models = p.models.map((m) =>
          (m.id || m.name) === key ? { ...m, ...patch } : m,
        )
        patchProvider(id, { models })
      }

      return (
        <div className="provider-list">
          {providers.length === 0 && (
            <p className="provider-empty">{t('settings.noProviders')}</p>
          )}

          {providers.map((p) => (
            <ProviderTableRow
              key={p.id}
              provider={p}
              onPatch={(patch) => patchProvider(p.id, patch)}
              onRemove={() => removeProvider(p.id)}
              onAddModel={(draft) => addModelTo(p.id, draft)}
              onRemoveModel={(key) => removeModelFrom(p.id, key)}
              onPatchModel={(key, patch) => patchModel(p.id, key, patch)}
            />
          ))}

          <button type="button" className="provider-add-btn" onClick={addProvider}>
            {t('settings.addProvider')}
          </button>
        </div>
      )
    }

    case 'imageRuleList':
      return <ImageRuleList />

    default:
      return null
  }
}

/**
 * Compile a rule pattern exactly the way the backend does: an empty or broken
 * regex simply never matches, so typos degrade to "no hit" instead of an error.
 */
function isValidPattern(pattern: string): boolean {
  if (!pattern.trim()) return false
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

// A single save-rule card: name + path regex + target directory + enable/disable + move up/down.
function RuleCard({
  rule,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
}: {
  rule: ImageRule
  index: number
  total: number
  onPatch: (patch: Partial<ImageRule>) => void
  onRemove: () => void
  onMove: (delta: number) => void
}) {
  const patternInvalid = rule.pattern.trim() !== '' && !isValidPattern(rule.pattern)
  // Only nag about a missing destination once the rule actually has a pattern —
  // a freshly added blank card should not open covered in warnings.
  const targetMissing = rule.pattern.trim() !== '' && rule.target.trim() === ''

  return (
    <div className="image-rule-card">
      <div className="image-rule-grid">
        <div className="provider-field">
          <input
            type="text"
            className={`setting-control setting-input ${patternInvalid ? 'is-invalid' : ''}`}
            value={rule.pattern}
            placeholder={t('settings.imageRule.patternPlaceholder')}
            onChange={(e) => onPatch({ pattern: e.target.value })}
          />
          {patternInvalid && (
            <span className="image-rule-error">{t('settings.imageRule.invalidPattern')}</span>
          )}
        </div>
        <div className="provider-field">
          <input
            type="text"
            className={`setting-control setting-input ${targetMissing ? 'is-invalid' : ''}`}
            value={rule.target}
            placeholder={t('settings.imageRule.targetPlaceholder')}
            onChange={(e) => onPatch({ target: e.target.value })}
          />
          {targetMissing && (
            <span className="image-rule-error">{t('settings.imageRule.emptyTarget')}</span>
          )}
        </div>
      </div>

      <div className="image-rule-actions">
        <button
          type="button"
          className="image-rule-move"
          title={t('settings.imageRule.moveUp')}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="image-rule-move"
          title={t('settings.imageRule.moveDown')}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="provider-remove"
          title={t('settings.imageRule.delete')}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
    </div>
  )
}

// Rule list + test box: changes take effect immediately (persistence is debounced by SettingsContext).
function ImageRuleList() {
  const { values, set } = useSettings()
  const rules: ImageRule[] = Array.isArray(values.imageRules)
    ? (values.imageRules as ImageRule[])
    : []
  const [testPath, setTestPath] = useState('')
  const [testState, setTestState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [testResult, setTestResult] = useState<ImageDirPreview | null>(null)

  const update = (next: ImageRule[]) => set('imageRules', next)

  const patchRule = (id: string, patch: Partial<ImageRule>) =>
    update(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const removeRule = (id: string) => update(rules.filter((r) => r.id !== id))

  const addRule = () =>
    update([
      ...rules,
      {
        id: 'r_' + Math.random().toString(36).slice(2, 9),
        pattern: '',
        target: '',
        enabled: true,
      },
    ])

  // Array order is the priority, so reordering is a splice rather than a rank field.
  const moveRule = (index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= rules.length) return
    const next = [...rules]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    update(next)
  }

  const runTest = async () => {
    if (!testPath.trim()) return
    setTestState('loading')
    try {
      // The in-memory rules are sent along: the settings write is debounced, so
      // a rule edited seconds ago may not be on disk yet.
      const result = await previewImageDir(
        testPath.trim(),
        rules,
        typeof values.imageDefaultDir === 'string' ? values.imageDefaultDir : '',
      )
      setTestResult(result)
      setTestState('done')
    } catch (e) {
      console.error('Failed to resolve image save directory', e)
      setTestState('error')
    }
  }

  return (
    <div className="image-rule-list">
      {rules.length === 0 && <p className="provider-empty">{t('settings.imageRule.empty')}</p>}

      {rules.length > 0 && (
        <div className="image-rule-head-row">
          <div className="image-rule-grid">
            <span className="image-rule-col-label">{t('settings.imageRule.pattern')}</span>
            <span className="image-rule-col-label">{t('settings.imageRule.target')}</span>
          </div>
          <div className="image-rule-actions-spacer" />
        </div>
      )}

      {rules.map((r, i) => (
        <RuleCard
          key={r.id}
          rule={r}
          index={i}
          total={rules.length}
          onPatch={(patch) => patchRule(r.id, patch)}
          onRemove={() => removeRule(r.id)}
          onMove={(delta) => moveRule(i, delta)}
        />
      ))}

      <button type="button" className="provider-add-btn image-rule-add" onClick={addRule}>
        + {t('settings.imageRule.add')}
      </button>

      <div className="image-rule-test">
        <div className="image-rule-test-row">
          <input
            type="text"
            className="setting-control setting-input"
            value={testPath}
            placeholder={t('settings.imageRule.testInput')}
            onChange={(e) => setTestPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runTest()
            }}
          />
          <button
            type="button"
            className="image-rule-test-btn"
            disabled={!testPath.trim() || testState === 'loading'}
            onClick={() => void runTest()}
          >
            {t('settings.imageRule.test')}
          </button>
        </div>

        {testState === 'idle' && <p className="image-rule-hint">{t('settings.imageRule.testHint')}</p>}
        {testState === 'error' && (
          <p className="image-rule-error">{t('settings.imageRule.testFailed')}</p>
        )}
        {testState === 'done' && testResult && (
          <div className="image-rule-result">
            <code className="image-rule-result-dir">{testResult.dir}</code>
            <span className="image-rule-result-src">
              {testResult.ruleId
                ? t('settings.imageRule.testMatched')
                : t('settings.imageRule.testDefault')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// A single model card: by default shows only ID + name; advanced fields can be expanded.
function ModelCard({
  model,
  onPatch,
  onRemove,
}: {
  model: ModelConfig
  onPatch: (patch: Partial<ModelConfig>) => void
  onRemove: () => void
}) {
  const [adv, setAdv] = useState(false)
  return (
    <div className="model-card">
      <div className="model-card-main">
        <input
          type="text"
          className="setting-control setting-input"
          value={model.id}
          placeholder={t('settings.modelIdPlaceholder')}
          onChange={(e) => onPatch({ id: e.target.value })}
        />
        <input
          type="text"
          className="setting-control setting-input"
          value={model.name}
          placeholder={t('settings.modelNamePlaceholder')}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <button
          type="button"
          className={`model-card-adv ${adv ? 'is-on' : ''}`}
          onClick={() => setAdv((v) => !v)}
          title={t('settings.advanced')}
        >
          {adv ? '▾' : '▸'} {t('settings.advanced')}
        </button>
        <button
          type="button"
          className="model-list-remove"
          title="Delete model"
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      {adv && (
        <div className="model-card-adv-fields">
          <div className="model-adv-row">
              <label className="model-adv-check">
                <input
                  type="checkbox"
                  checked={Boolean(model.toolCalling)}
                  onChange={(e) => onPatch({ toolCalling: e.target.checked })}
                />
                {t('settings.toolCalling')}
              </label>
              <label className="model-adv-check">
                <input
                  type="checkbox"
                  checked={Boolean(model.vision)}
                  onChange={(e) => onPatch({ vision: e.target.checked })}
                />
                {t('settings.vision')}
              </label>
              <div className="model-adv-field model-adv-token">
                <label>{t('settings.maxInputTokens')}</label>
              <input
                type="number"
                className="setting-control setting-input"
                value={model.maxInputTokens ?? ''}
                placeholder="128000"
                onChange={(e) =>
                  onPatch({ maxInputTokens: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </div>
              <div className="model-adv-field model-adv-token">
                <label>{t('settings.maxOutputTokens')}</label>
              <input
                type="number"
                className="setting-control setting-input"
                value={model.maxOutputTokens ?? ''}
                placeholder="16000"
                onChange={(e) =>
                  onPatch({ maxOutputTokens: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// A single provider card (vertical grouping + two-column grid) + an expandable model subtable.
function ProviderTableRow({
  provider,
  onPatch,
  onRemove,
  onAddModel,
  onRemoveModel,
  onPatchModel,
}: {
  provider: ProviderConfig
  onPatch: (patch: Partial<ProviderConfig>) => void
  onRemove: () => void
  onAddModel: (draft: Partial<ModelConfig>) => void
  onRemoveModel: (key: string) => void
  onPatchModel: (key: string, patch: Partial<ModelConfig>) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Partial<ModelConfig>>({})

  const submitModel = () => {
    if (!draft.id?.trim() && !draft.name?.trim()) return
    onAddModel(draft)
    setDraft({})
  }

  const modelKey = (m: ModelConfig) => m.id || m.name || ''

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <input
          type="text"
          className="provider-name-input"
          value={provider.name}
          placeholder={t('settings.providerNamePlaceholder')}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <div className="provider-card-actions">
          <button
            type="button"
            className="provider-row-toggle"
            title={open ? t('settings.collapseModels') : t('settings.expandModels')}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'} {t('settings.models')} ({provider.models.length})
          </button>
          <button
            type="button"
            className="provider-remove"
            title={t('settings.deleteProvider')}
            onClick={onRemove}
          >
            ×
          </button>
        </div>
      </div>

      <div className="provider-grid">
        <div className="provider-field">
          <label>{t('settings.vendor')}</label>
          <input
            type="text"
            className="setting-control setting-input"
            value={provider.vendor}
            placeholder="customendpoint"
            onChange={(e) => onPatch({ vendor: e.target.value })}
          />
        </div>
        <div className="provider-field">
          <label>{t('settings.apiType')}</label>
          <input
            type="text"
            className="setting-control setting-input"
            value={provider.apiType}
            placeholder="chat-completions"
            onChange={(e) => onPatch({ apiType: e.target.value })}
          />
        </div>
        <div className="provider-field">
          <label>{t('settings.apiKey')}</label>
          <input
            type="password"
            className="setting-control setting-input"
            value={provider.apiKey}
            placeholder={t('settings.apiKeyPlaceholder')}
            onChange={(e) => onPatch({ apiKey: e.target.value })}
          />
        </div>
        <div className="provider-field">
          <label>{t('settings.baseURL')}</label>
          <input
            type="text"
            className="setting-control setting-input"
            value={provider.baseURL}
            placeholder="https://api.deepseek.com"
            onChange={(e) => onPatch({ baseURL: e.target.value })}
          />
        </div>
      </div>

      {open && (
        <div className="model-subtable-wrap">
          <div className="model-list">
            {provider.models.map((m) => {
              const key = modelKey(m)
              return (
                <ModelCard
                  key={key}
                  model={m}
                  onPatch={(patch) => onPatchModel(key, patch)}
                  onRemove={() => onRemoveModel(key)}
                />
              )
            })}
            {provider.models.length === 0 && (
              <p className="model-list-empty">{t('settings.noModels')}</p>
            )}
          </div>

          <div className="model-add-row">
            <input
              type="text"
              className="setting-control setting-input model-add-id"
              placeholder={t('settings.modelIdPlaceholder')}
              value={draft.id ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            />
            <input
              type="text"
              className="setting-control setting-input model-add-name"
              placeholder={t('settings.modelNamePlaceholder')}
              value={draft.name ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitModel()
              }}
            />
            <button type="button" className="model-list-add-btn" onClick={submitModel}>
              {t('settings.addModel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Plugin management card: lists plugins discovered by the backend, with an
// enable/disable toggle per plugin. Toggling persists via the backend and the
// change takes effect on next app reload (plugins are loaded before the editor).
function PluginsCard({ id, flash }: { id: string; flash: boolean }) {
  const { lang } = useTranslation()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [error, setError] = useState(false)
  const [reloadHint, setReloadHint] = useState(false)

  useEffect(() => {
    fetch('/api/plugins')
      .then((r) => r.json())
      .then((data) => {
        if (!data || !Array.isArray(data.plugins)) throw new Error('bad payload')
        setPlugins(data.plugins)
      })
      .catch(() => setError(true))
  }, [])

  const toggle = async (id: string, next: boolean) => {
    const prev = plugins
    setPlugins((list) => list.map((p) => (p.id === id ? { ...p, enabled: next } : p)))
    setReloadHint(true)
    try {
      await fetch(`/api/plugins/${id}/${next ? 'enable' : 'disable'}`, {
        method: 'POST',
      })
    } catch {
      setPlugins(prev)
    }
  }

  return (
    <section id={id} className={`settings-card${flash ? ' is-flash' : ''}`}>
      <div className="settings-card-head">
        <h2>{t('settings.group.plugins')}</h2>
        <p className="settings-card-desc">{t('settings.group.plugins.desc')}</p>
      </div>
      <div className="settings-rows">
        {error && <div className="settings-row-desc">{t('settings.plugins.loadError')}</div>}
        {plugins.map((p) => {
          // Plugin manifests carry their own translations; fall back to the
          // manifest defaults when the active language is not covered.
          const text = pluginText(p, lang)
          return (
            <div key={p.id} className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">
                  {text.name}
                  <span className="plugin-version">{t('settings.plugins.version', { version: p.version })}</span>
                </span>
                {text.description && (
                  <span className="settings-row-desc">{text.description}</span>
                )}
              </div>
              <div className="settings-row-control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.enabled}
                  className={`setting-toggle ${p.enabled ? 'is-on' : ''}`}
                  onClick={() => toggle(p.id, !p.enabled)}
                >
                  <span className="setting-toggle-knob" />
                </button>
              </div>
            </div>
          )
        })}
        {plugins.length === 0 && !error && (
          <div className="settings-row-desc">{t('settings.plugins.builtinHint')}</div>
        )}
        {reloadHint && (
          <div className="settings-row-desc plugin-reload-hint">
            {t('settings.plugins.reloadHint')}
          </div>
        )}
      </div>
    </section>
  )
}

// Sticky sidebar that mirrors the cards below; clicking an entry scrolls the
// matching anchor into view and the current entry is highlighted while scrolling.
function SettingsOutline({
  activeId,
  onJump,
}: {
  activeId: string
  onJump: (id: string) => void
}) {
  // A field anchor highlights its own entry and marks the parent section too.
  const activeSection = OUTLINE.find(
    (s) => s.id === activeId || s.items.some((i) => i.id === activeId),
  )

  return (
    <nav className="settings-outline" aria-label={t('outline.title')}>
      <div className="settings-outline-title">{t('outline.title')}</div>
      <div className="settings-outline-list">
        {OUTLINE.map((section) => (
          <div key={section.id} className="settings-outline-group">
            <button
              type="button"
              className={`settings-outline-item settings-outline-section${
                activeSection?.id === section.id ? ' is-current' : ''
              }${activeId === section.id ? ' is-active' : ''}`}
              aria-current={activeId === section.id ? 'true' : undefined}
              onClick={() => onJump(section.id)}
            >
              {t(section.titleKey)}
            </button>
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-outline-item settings-outline-field${
                  activeId === item.id ? ' is-active' : ''
                }`}
                aria-current={activeId === item.id ? 'true' : undefined}
                onClick={() => onJump(item.id)}
              >
                {t(item.titleKey)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  )
}

export default function SettingsView() {
  const { ready } = useSettings()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState(ANCHORS[0] ?? '')
  const [flashId, setFlashId] = useState<string | null>(null)

  // Scroll spy: the last anchor above the probe line owns the highlight.
  useEffect(() => {
    const root = scrollRef.current
    const content = contentRef.current
    if (!root || !content) return
    let frame = 0
    const measure = () => {
      frame = 0
      const line = root.getBoundingClientRect().top + SPY_OFFSET
      let current = ANCHORS[0] ?? ''
      for (const id of ANCHORS) {
        const el = document.getElementById(anchorId(id))
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      // Tail sections are shorter than the viewport and can never cross the
      // probe line, so pin the last one once the scroller bottoms out.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        current = ANCHORS[ANCHORS.length - 1] ?? current
      }
      setActiveId(current)
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }
    measure()
    root.addEventListener('scroll', schedule, { passive: true })
    // Content height changes (expanding shortcuts, plugins loading) shift every
    // anchor, so re-measure instead of waiting for the next scroll.
    const ro = new ResizeObserver(schedule)
    ro.observe(content)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      root.removeEventListener('scroll', schedule)
      ro.disconnect()
    }
  }, [ready])

  useEffect(() => {
    if (!flashId) return
    const timer = setTimeout(() => setFlashId(null), 1200)
    return () => clearTimeout(timer)
  }, [flashId])

  const jumpTo = (id: string) => {
    // The shortcut list is collapsed by default; open it so the target exists.
    if (id === 'section-shortcuts') setShortcutsOpen(true)
    setActiveId(id)
    setFlashId(id)
    const el = document.getElementById(anchorId(id))
    el?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'start',
    })
  }

  if (!ready) {
    return <div className="settings-loading">{t('settings.loading')}</div>
  }

  return (
    <div className="settings-view" ref={scrollRef}>
      <header className="settings-header">
        <div className="settings-header-main">
          <h1>{t('settings.title')}</h1>
          <p className="settings-subtitle">{t('settings.subtitle')}</p>
        </div>
        <button
          type="button"
          className="settings-edit-raw-btn"
          onClick={() => setRawOpen(true)}
        >
          <Icon name="pen" size={14} /> {t('settings.editRaw')}
        </button>
      </header>

      <div className="settings-body">
        <SettingsOutline activeId={activeId} onJump={jumpTo} />

        <div className="settings-groups" ref={contentRef}>
          {SETTINGS_GROUPS.map((group) => {
            const sectionId = `section-${group.id}`
            return (
              <section
                key={group.id}
                id={anchorId(sectionId)}
                className={`settings-card${flashId === sectionId ? ' is-flash' : ''}`}
              >
                <div className="settings-card-head">
                  <h2>{t(group.title)}</h2>
                  {group.description && (
                    <p className="settings-card-desc">{t(group.description)}</p>
                  )}
                </div>
                <div className="settings-rows">
                  {group.fields.map((field) => {
                    const fieldId = `field-${field.key}`
                    return (
                      <div
                        key={field.key}
                        id={anchorId(fieldId)}
                        className={`settings-row ${
                          field.type === 'providerList' || field.type === 'imageRuleList'
                            ? 'settings-row--full'
                            : ''
                        }${flashId === fieldId ? ' is-flash' : ''}`}
                      >
                        <div className="settings-row-label">
                          <span className="settings-row-name">{t(field.label)}</span>
                          {field.description && (
                            <span className="settings-row-desc">{t(field.description)}</span>
                          )}
                        </div>
                        <div className="settings-row-control">
                          <FieldControl field={field} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <section
            id={anchorId('section-shortcuts')}
            className={`settings-card${flashId === 'section-shortcuts' ? ' is-flash' : ''}`}
          >
            <div className="settings-card-head">
              <div className="settings-card-head-text">
                <h2>{t('settings.group.shortcuts')}</h2>
                <p className="settings-card-desc">{t('settings.group.shortcuts.desc')}</p>
              </div>
              <button
                type="button"
                className={`settings-card-toggle${shortcutsOpen ? ' is-open' : ''}`}
                title={shortcutsOpen ? t('settings.collapse') : t('settings.expand')}
                onClick={() => setShortcutsOpen((v) => !v)}
              >
                <Icon name="chevron-toggle" size={18} />
              </button>
            </div>
            {shortcutsOpen && (
              <div className="settings-rows shortcuts-list">
                {SHORTCUTS.map((s) => {
                  const combos = [s.combo, ...(s.aliases ?? [])]
                  return (
                    <div key={s.combo} className="settings-row shortcut-row">
                      <div className="settings-row-label">
                        <span className="settings-row-name">{t(s.labelKey)}</span>
                      </div>
                      <div className="settings-row-control">
                        {combos.map((c) => (
                          <kbd key={c} className="shortcut-keys">
                            {formatCombo(c)}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <PluginsCard
            id={anchorId('section-plugins')}
            flash={flashId === 'section-plugins'}
          />
        </div>
      </div>

      <footer className="settings-footer">{t('settings.footer')}</footer>
      {rawOpen && <SettingsRawModal onClose={() => setRawOpen(false)} />}
    </div>
  )
}
