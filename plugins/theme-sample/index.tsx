// Theme-sample plugin — a minimal example showing how a plugin can contribute a
// brand-new color theme. It registers a theme whose CSS variables override the
// base app variables under `:root[data-theme="midnight"]`, so once enabled the
// theme appears in the settings "Theme" dropdown and is applied like a built-in.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PluginApi = any

const THEME_ID = 'midnight'

const THEME_CSS = `:root[data-theme="${THEME_ID}"] {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --border: #334155;
  --accent: #22d3ee;
  --accent-soft: rgba(34, 211, 238, 0.16);
  --editor-bg: #0f172a;
  --editor-text: #e2e8f0;
  --sidebar-bg: #111c33;
  --card-bg: #1e293b;
}`

export default function activate(api: PluginApi): void {
  api.registerTheme({
    id: THEME_ID,
    label: 'Midnight',
    css: THEME_CSS,
  })
}
