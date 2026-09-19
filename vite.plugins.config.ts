// Separate Vite build for the reference plugins. Invoke once per plugin via the
// PLUGIN_NAME env var:
//   cross-env PLUGIN_NAME=excalidraw vite build --config vite.plugins.config.ts
// Each plugin is bundled as a single self-contained ESM file into
// `dist/plugins/<name>/index.js` (plus its `plugin.json` manifest). The Electron
// main process seeds these into the global userData/plugins directory on launch.
//
// Inline dynamic imports keep every plugin in one file so there are no shared
// chunks to resolve at runtime — the renderer only needs `/plugins/<id>/index.js`.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import fs from 'fs'

const name = process.env.PLUGIN_NAME
if (!name) {
  throw new Error('PLUGIN_NAME env var is required (excalidraw|custom-block|theme-sample)')
}

function copyManifest() {
  return {
    name: `copy-manifest-${name}`,
    closeBundle() {
      const src = resolve(__dirname, `plugins/${name}/plugin.json`)
      const dstDir = resolve(__dirname, `dist/plugins/${name}`)
      if (!fs.existsSync(src)) return
      fs.mkdirSync(dstDir, { recursive: true })
      fs.copyFileSync(src, resolve(dstDir, 'plugin.json'))
    },
  }
}

export default defineConfig({
  // Plugins are standalone browser bundles; never copy the app's public/ assets
  // (e.g. the app icon) into every plugin output folder.
  publicDir: false,
  plugins: [react(), copyManifest()],
  define: {
    // Excalidraw 0.18 no longer reads `process.env` itself, but transitive
    // dependencies still branch on NODE_ENV; a browser bundle has no `process`.
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: `dist/plugins/${name}`,
    emptyOutDir: true,
    // Excalidraw >= 0.18 transpiles its locales to ESM using arbitrary module
    // namespace identifier names (`export { english as "en-us" }`), which Vite's
    // default browser target cannot emit. Bump to es2022.
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, `plugins/${name}/index.tsx`),
      name: 'plugin',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'index.js',
      },
    },
    minify: false,
  },
})
