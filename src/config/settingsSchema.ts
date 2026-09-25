// Setting item schema definitions -- the core declaration file of the config framework.
// SettingsView renders controls from this; SettingsContext derives defaults and validation.
// To add a setting, just extend this file; no UI or storage changes needed.

import { THEME_IDS } from './themeIds'
import type { ThemeId } from './themeIds'
import { DEFAULT_SYNC_CONFIG } from './syncConfig'

export type SettingType =
  | 'select'
  | 'text'
  | 'number'
  | 'boolean'
  | 'providerList'
  | 'imageRuleList'
  | 'syncConfig'
  | 'zoom'

// Single model config (VS Code chat.ml style)
export interface ModelConfig {
  id: string // model id used to issue requests (nullable; falls back to name when empty)
  name: string // model display name
  url?: string // optional, overrides the provider endpoint (model-level address)
  toolCalling?: boolean // whether tool calling is supported
  vision?: boolean // whether vision / multimodal is supported
  maxInputTokens?: number // max input tokens
  maxOutputTokens?: number // max output tokens
}

// Single AI provider config (a complete set of access info, VS Code chat.ml style)
export interface ProviderConfig {
  id: string
  name: string
  vendor: string // vendor id, e.g. openai / azure / customendpoint
  apiKey: string
  apiType: string // API type, e.g. chat-completions
  baseURL: string // provider endpoint (maps to VS Code's url)
  model: string // the currently selected model id for this provider
  models: ModelConfig[] // all models added under this provider
}

// One attachment save rule: when the note being edited matches `pattern`, the
// screenshot goes to `target`.
//
// `pattern` is a regular expression tested against the note's vault-relative
// path (e.g. `Journals/2026/09-03.md`), NOT its absolute path — keeping it
// relative is what lets the same rules follow the vault when it moves.
// `target` is a vault-relative folder and may contain the placeholders
// {year} {month} {day} {noteName}.
export interface ImageRule {
  id: string
  pattern: string
  target: string
  enabled: boolean
}

export type SettingValue =
  | string
  | number
  | boolean
  | string[]
  | ProviderConfig[]
  | ImageRule[]
  | import('./syncConfig').SyncConfig

export interface SettingOption {
  label: string
  value: string
}

export interface SettingField {
  key: string
  type: SettingType
  label: string
  description?: string
  default: SettingValue
  options?: SettingOption[] // used by the select type
  min?: number // used by the number type
  max?: number
  step?: number
  unit?: string // unit suffix for the number type, defaults to 'px'
  placeholder?: string // used by the text type
}

export interface SettingGroup {
  id: string
  title: string
  description?: string
  fields: SettingField[]
}

// ===== Appearance theme =====
// The ids come from THEME_IDS (shared with the first-paint script); only the
// labels live here, so adding a theme is one edit in each of the two files.
const THEME_LABELS: Record<ThemeId, string> = {
  warm: 'settings.option.theme.warm',
  light: 'settings.option.theme.light',
  dark: 'settings.option.theme.dark',
}

const APPEARANCE: SettingGroup = {
  id: 'appearance',
  title: 'settings.group.appearance',
  description: 'settings.group.appearance.desc',
  fields: [
    {
      key: 'theme',
      type: 'select',
      label: 'settings.field.theme',
      description: 'settings.field.theme.desc',
      default: 'warm' as ThemeId,
      options: THEME_IDS.map((id) => ({ label: THEME_LABELS[id], value: id })),
    },
    {
      key: 'language',
      type: 'select',
      label: 'settings.field.language',
      description: 'settings.field.language.desc',
      default: 'en',
      options: [
        { label: 'settings.option.language.zh-CN', value: 'zh-CN' },
        { label: 'settings.option.language.en', value: 'en' },
      ],
    },
    {
      key: 'editorFontSize',
      type: 'number',
      label: 'settings.field.editorFontSize',
      description: 'settings.field.editorFontSize.desc',
      default: 14,
      min: 10,
      max: 24,
      step: 1,
    },
    {
      key: 'editorFont',
      type: 'text',
      label: 'settings.field.editorFont',
      description: 'settings.field.editorFont.desc',
      default: '',
      placeholder: 'settings.field.editorFont.placeholder',
    },
    {
      key: 'appZoom',
      type: 'zoom',
      label: 'settings.field.appZoom',
      description: 'settings.field.appZoom.desc',
      default: 100,
      min: 50,
      max: 200,
      step: 5,
      unit: '%',
    },
  ],
}

// ===== Editor behavior =====
const EDITOR: SettingGroup = {
  id: 'editor',
  title: 'settings.group.editor',
  description: 'settings.group.editor.desc',
  fields: [],
}

// ===== Images & Attachments =====
// Where screenshots / pasted images are stored. The rule list decides the
// folder per note; the default directory is the fallback when nothing matches.
const IMAGES: SettingGroup = {
  id: 'images',
  title: 'settings.group.images',
  description: 'settings.group.images.desc',
  fields: [
    {
      key: 'imageDefaultDir',
      type: 'text',
      label: 'settings.field.imageDefaultDir',
      description: 'settings.field.imageDefaultDir.desc',
      default: 'images',
      placeholder: 'settings.field.imageDefaultDir.placeholder',
    },
    {
      key: 'imageRules',
      type: 'imageRuleList',
      label: 'settings.field.imageRules',
      description: 'settings.field.imageRules.desc',
      default: [],
    },
  ],
}

// ===== AI features =====
const AI: SettingGroup = {
  id: 'ai',
  title: 'settings.group.ai',
  description: 'settings.group.ai.desc',
  fields: [
    {
      key: 'aiProviders',
      type: 'providerList',
      label: 'settings.field.aiProviders',
      description: 'settings.field.aiProviders.desc',
      default: [],
    },
  ],
}

// ===== Network proxy =====
// Network proxy is a global setting (not AI-specific): it applies to every
// outbound fetch from the backend, including AI chat and the agent loop.
const NETWORK: SettingGroup = {
  id: 'network',
  title: 'settings.group.network',
  description: 'settings.group.network.desc',
  fields: [
    {
      key: 'proxyMode',
      type: 'select',
      label: 'settings.field.proxyMode',
      description: 'settings.field.proxyMode.desc',
      default: 'direct',
      options: [
        { label: 'settings.option.proxyMode.direct', value: 'direct' },
        { label: 'settings.option.proxyMode.system', value: 'system' },
        { label: 'settings.option.proxyMode.custom', value: 'custom' },
      ],
    },
    {
      key: 'proxyUrl',
      type: 'text',
      label: 'settings.field.proxyUrl',
      description: 'settings.field.proxyUrl.desc',
      default: '',
      placeholder: 'settings.field.proxyUrl.placeholder',
    },
  ],
}

// ===== Layout =====
const LAYOUT: SettingGroup = {
  id: 'layout',
  title: 'settings.group.layout',
  description: 'settings.group.layout.desc',
  fields: [
    {
      key: 'leftWidth',
      type: 'number',
      label: 'settings.field.leftWidth',
      description: 'settings.field.leftWidth.desc',
      default: 260,
      min: 180,
      max: 420,
      step: 10,
    },
    {
      key: 'rightOpenDefault',
      type: 'boolean',
      label: 'settings.field.rightOpenDefault',
      description: 'settings.field.rightOpenDefault.desc',
      default: true,
    },
  ],
}

// ===== Sync =====
// A single custom field carries the whole nested sync config (provider-agnostic
// flags + each backend's private config under its id). All sync *configuration*
// lives here in Settings; the vault-side dialog only shows status + actions.
const SYNC: SettingGroup = {
  id: 'sync',
  title: 'settings.group.sync',
  description: 'settings.group.sync.desc',
  fields: [
    {
      key: 'sync',
      type: 'syncConfig',
      label: 'settings.field.sync',
      description: 'settings.field.sync.desc',
      default: DEFAULT_SYNC_CONFIG,
    },
  ],
}

export const SETTINGS_GROUPS: SettingGroup[] = [
  APPEARANCE,
  EDITOR,
  IMAGES,
  AI,
  NETWORK,
  LAYOUT,
  SYNC,
]

// Default config object derived from the schema
export const SETTINGS_DEFAULTS: Record<string, SettingValue> =
  SETTINGS_GROUPS.reduce((acc, group) => {
    group.fields.forEach((f) => {
      acc[f.key] = f.default
    })
    return acc
  }, { aiActiveProvider: '' } as Record<string, SettingValue>)

export type SettingsValues = Record<string, SettingValue>
