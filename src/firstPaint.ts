// First paint: apply the saved theme and zoom before the browser draws
// anything, so the page never flashes the wrong colours or scale.
//
// This file is NOT part of the app bundle. The `markseek-first-paint` plugin
// (vite.config.ts) compiles it into a standalone IIFE and inlines it into
// index.html, which is the only way to run code before the module graph loads.
//
// Keep it dependency-light and synchronous: it runs inside <head>, before
// React, before any network stack the app controls.

import { THEME_IDS } from './config/themeIds'

// Secret-free settings projection (see server/settings-schema.mjs).
const SETTINGS_URL = '/api/settings/public'

const ZOOM_MIN = 50
const ZOOM_MAX = 200

function applyTheme(raw: unknown): void {
  if (typeof raw === 'string' && THEME_IDS.includes(raw)) {
    document.documentElement.setAttribute('data-theme', raw)
  }
}

function applyZoom(raw: unknown): void {
  // appZoom is always an explicit percentage; fall back to 100% when absent/garbage.
  const explicit = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
  const zoom = Number.isFinite(explicit)
    ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, explicit))
    : 100
  const root = document.documentElement
  root.style.setProperty('--app-zoom', `${zoom}%`)
  root.style.setProperty('--app-zoom-scale', String(zoom / 100))
}

// A synchronous XHR is normally indefensible. Here it is the point: the
// alternative is a paint with the default theme followed by a repaint.
try {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', SETTINGS_URL, false)
  xhr.send()
  if (xhr.status === 200) {
    const settings = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>
    applyTheme(settings.theme)
    applyZoom(settings.appZoom)
  }
} catch {
  // No backend yet (or no settings file): the CSS defaults are good enough.
}
