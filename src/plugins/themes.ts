// Dynamic theme registry for plugin-contributed color themes.
//
// A plugin registers a theme via `api.registerTheme({ id, label, css })`. The CSS
// is injected as a <style data-plugin-theme> element so it can override the base
// CSS variables under `:root[data-theme="<id>"]`. The registry is read by the
// settings UI to extend the built-in theme list.
import type { PluginThemeContribution } from '../../plugins/types'

const themes: PluginThemeContribution[] = []
const styleEls = new Map<string, HTMLStyleElement>()

export function registerTheme(theme: PluginThemeContribution): void {
  if (themes.some((t) => t.id === theme.id)) return
  themes.push(theme)

  const el = document.createElement('style')
  el.setAttribute('data-plugin-theme', theme.id)
  el.textContent = `\n${theme.css}\n`
  document.head.appendChild(el)
  styleEls.set(theme.id, el)
}

export function unregisterTheme(id: string): void {
  const idx = themes.findIndex((t) => t.id === id)
  if (idx === -1) return
  themes.splice(idx, 1)
  const el = styleEls.get(id)
  if (el) el.remove()
  styleEls.delete(id)
}

export function getPluginThemes(): PluginThemeContribution[] {
  return themes.slice()
}
