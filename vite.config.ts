import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { build as esbuild } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Every .mjs under server/ , as Vite-facing specifiers.
 *
 * They are Node-side modules pulled in by the dynamic import() below, so they
 * never enter the browser module graph and the exclusion is defensive — but a
 * stale hand-maintained list was worse than no list, because it silently
 * stopped covering new route modules. Walking the directory cannot drift.
 */
function serverModules() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.mjs')) out.push('./' + path.relative(root, full))
    }
  }
  walk(path.join(root, 'server'))
  return out
}

/**
 * Inline src/firstPaint.ts into index.html as a classic (non-module) script.
 *
 * The theme and zoom must be applied before the first frame, which means the
 * code cannot wait for the module graph. It used to be hand-copied into
 * index.html — and that copy had already drifted from the source modules.
 */
function firstPaintPlugin() {
  return {
    name: 'markseek-first-paint',
    async transformIndexHtml(html) {
      const result = await esbuild({
        entryPoints: [path.join(root, 'src/firstPaint.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2018',
        minify: true,
        legalComments: 'none',
      })
      const code = result.outputFiles[0].text.trim()
      return html.replace('<!--first-paint-->', () => `<script>${code}</script>`)
    },
  }
}

export default defineConfig({
  optimizeDeps: {
    // The server-side modules under ./server are loaded at runtime via dynamic
    // import() inside the dev middleware. Excluding them from optimizeDeps
    // prevents Vite from pre-bundling them into node_modules/.vite/deps, which
    // would otherwise cache stale server code and silently ignore edits.
    exclude: serverModules(),
  },
  plugins: [
    react(),
    firstPaintPlugin(),
    {
      name: 'MarkSeek-files-api',
      async configureServer(server) {
        // Dev-only: point plugin discovery at the built plugin output so that
        // `npm run dev` can load plugins without the Electron main process.
        // Only pluginsDir is injected; appConfigDir/vaultPath are left to the
        // existing dev middleware defaults so vault behavior stays unchanged.
        const { initBackend } = await import('./server/runtime.mjs')
        initBackend({ pluginsDir: path.join(root, 'dist', 'plugins') })

        // The server-side modules are imported statically into the Vite dev
        // process and are NOT hot-reloaded by default. Restart the dev server
        // automatically when any file under server/ changes, so agent/API
        // fixes take effect without a manual restart.
        server.watcher.add('server/**')
        server.watcher.on('change', (file) => {
          if (file.includes('/server/')) {
            server.restart()
          }
        })
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next()
          const url = new URL(req.url, 'http://localhost')
          const { handleApi } = await import('./server/api.mjs')
          const handled = await handleApi(req, res, url)
          if (handled === true) return
          next()
        })
      },
    },
  ],
  server: {
    port: 9000,
    host: true,
  },
})
