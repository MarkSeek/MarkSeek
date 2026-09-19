import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { runStorageMigrations } from './utils/storageMigrate'
import { setupPluginSdk } from './plugins/sdk'

// Applying the theme before the first frame has moved to an inline script in index.html's <head> (earlier, zero flash).
// The theme value is persisted in localStorage and written by SettingsContext.

// Install the Plugin SDK on window.markseek before any plugin is loaded.
setupPluginSdk()

// Promote the renamed keys before anything reads them, so the first frame
// already sees the current names.
runStorageMigrations()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
