// Application-level configuration (decoupled from note-level settings.json).
// Stores the user-selected Vault root path.
export interface AppConfig {
  vaultPath?: string
}

export const APP_CONFIG_DEFAULTS: AppConfig = {}
