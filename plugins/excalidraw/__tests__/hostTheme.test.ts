import { afterEach, describe, expect, it } from 'vitest'
import { hostBackground, hostTheme, watchHostTheme } from '../hostTheme'

// The panel layout the host renders (see src/components/ContentWrapper.tsx):
// the panel itself is transparent, its wrapper carries the theme colour.
function mountPanel(background: string): Element {
  document.body.innerHTML = `
    <div class="content-wrapper" style="background: ${background}">
      <div class="main-panel">
        <div class="editor-area"><div id="anchor"></div></div>
      </div>
    </div>`
  return document.getElementById('anchor')!
}

/** jsdom and browsers spell the same colour differently; compare either. */
function expectColor(actual: string, hex: string, rgb: string) {
  expect([hex, rgb]).toContain(actual)
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--bg-content')
})

describe('hostBackground', () => {
  it('returns the main panel colour in the dark theme', () => {
    expectColor(hostBackground(mountPanel('#2a2a30')), '#2a2a30', 'rgb(42, 42, 48)')
  })

  it('returns the main panel colour in the light theme', () => {
    expectColor(hostBackground(mountPanel('#ffffff')), '#ffffff', 'rgb(255, 255, 255)')
  })

  it('walks past transparent ancestors instead of reporting them', () => {
    // No colour anywhere on the panel: only the wrapper is painted.
    document.body.innerHTML = `
      <div style="background: #2a2a30">
        <div class="main-panel">
          <div class="editor-area"><div id="anchor"></div></div>
        </div>
      </div>`
    expectColor(hostBackground(document.getElementById('anchor')), '#2a2a30', 'rgb(42, 42, 48)')
  })

  it('falls back to --bg-content when nothing is painted', () => {
    document.body.innerHTML = '<div id="anchor"></div>'
    document.documentElement.style.setProperty('--bg-content', '#123456')
    expect(hostBackground(document.getElementById('anchor'))).toBe('#123456')
  })

  it('ignores the plugin’s own inner surface', () => {
    // A plugin container painted in another colour must not win over the panel.
    document.body.innerHTML = `
      <div class="content-wrapper" style="background: #2a2a30">
        <div class="main-panel">
          <div class="plugin-page" style="background: rgb(1, 2, 3)"><div id="anchor"></div></div>
        </div>
      </div>`
    expectColor(hostBackground(document.getElementById('anchor')), '#2a2a30', 'rgb(42, 42, 48)')
  })
})

describe('hostTheme', () => {
  it('follows <html data-theme>', () => {
    expect(hostTheme()).toBe('light')
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(hostTheme()).toBe('dark')
  })
})

describe('watchHostTheme', () => {
  it('notifies on every theme switch until unsubscribed', async () => {
    let calls = 0
    const stop = watchHostTheme(() => {
      calls++
    })
    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()
    expect(calls).toBe(1)
    document.documentElement.setAttribute('data-theme', 'light')
    await Promise.resolve()
    expect(calls).toBe(2)

    stop()
    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()
    expect(calls).toBe(2)
  })
})
