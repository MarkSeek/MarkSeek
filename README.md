# MarkSeek

**Your Knowledge, Connected. Your Intelligence, Amplified.**

> 🌐 Also available in [简体中文](README.zh-CN.md).

## Preface · A Note From the Author

I am not a frontend or backend engineer, and I have no experience with HTML, TypeScript, or CSS. This application — from its very first line of code to packaging and release — was built **entirely with AI**.

It is, of course, far from perfect. There are still features I want but haven't built, and bugs are inevitable. But for my own daily notes, journaling, and diary, it already gets the job done.

What I want to say is this: in the age of AI, I believe **anyone can build their own AI notebook**. No single note-taking app will ever truly satisfy you, because the way you think and the way you capture ideas are unique to you. Rather than waiting for someone else to ship a "perfect" product, why not build one for yourself? MarkSeek is exactly that — a sample.

If you also want a knowledge space that understands you and belongs to you, I hope this gives you a little courage and a reference point: give it a try, and let AI help turn your ideas into reality.

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/MarkSeek/MarkSeek/actions/workflows/ci.yml/badge.svg)](https://github.com/MarkSeek/MarkSeek/actions/workflows/ci.yml)

MarkSeek is an AI-native knowledge workspace built around Markdown. Capture ideas, keep a daily journal, connect notes with wiki links, and let an AI agent read, search, and — with your approval — edit your personal knowledge base.

More than a note-taking app, MarkSeek turns isolated Markdown files into a living, queryable knowledge network. Every note becomes part of a larger context, so AI can understand, reason, and act on your behalf.

## Features

- **Markdown-First, WYSIWYG Editor** — Built on [Milkdown](https://milkdown.dev) (Crepe preset, Nord theme, CommonMark). Write in plain text with a clean, distraction-free experience, slash commands, and syntax highlighting.
- **Three-Panel Workspace** — A resizable layout: a left sidebar for navigation, the center editor, and a right panel that switches between **AI chat** and the **Relations** inspector. Panel state is saved per vault.
- **Wiki Links & Backlinks** — Link notes with `[[Note]]` syntax, with live autocomplete, ambiguous-link resolution, and one-click creation of missing notes. The right panel surfaces backlinks, outgoing links, and shared tags.
- **Daily Journal** — One Markdown note per day at `Journals/YYYY/YYYY-MM/YYYY-MM-DD.md`, with dedicated diary pages and navigation.
- **Tasks & Calendar** — Parse `- [ ]` checkboxes from your notes, view them in a monthly calendar, and toggle completion — the change is written straight back into the Markdown source.
- **AI Chat & Agent** — Chat with your notes from the right panel:
  - **Agent mode** — the model can list, search, read, and (after your confirmation) create, write, or append notes via a tool-calling loop streamed over SSE.
  - **Ask mode** — a read-only assistant that reasons over your notes without ever modifying them.
  - **Inline AI** — continue / rewrite / summarize directly inside the editor, proxied to your provider.
- **Local-First Vaults** — Your notes are plain `.md` files in a folder you choose. Switch between multiple vaults; settings are stored per vault in the app-data directory, never inside the notes.
- **Pluggable** — An extension system (`window.markseek` SDK) for custom editor nodes, themes, sidebar panels, and whole-page renderers (ships with an Excalidraw canvas, Mermaid diagrams, custom blocks, and a sample theme).
- **Multi-Provider AI** — Point MarkSeek at any OpenAI-compatible endpoint, manage several providers/models, and route outbound traffic through a direct / system / custom proxy. API keys stay on the server and are never sent to the browser.
- **Cross-Platform** — Runs as an Electron desktop app or as a self-hosted web build.

## Architecture

MarkSeek is an Electron desktop application with a web build:

- **Frontend** — React 18 + TypeScript, Vite 6, and Milkdown 7 (WYSIWYG Markdown editor). The renderer is a single-page app that talks to the backend over same-origin `/api/*` calls.
- **Backend** — A lightweight Node.js server in `server/` that serves the app and exposes the `/api/*` endpoints (files, settings, AI, agent, relations, tasks, plugins). In Electron the main process embeds this server; in the web build `app/app.js` (Node) serves the same code so dev and prod stay identical.
- **Shared core** — Pure helpers in `shared/` (`relations`, `wiki-link`, `journal-layout`) are imported as plain ESM by **both** the browser and the Node backend, so links, backlinks, and journal paths behave exactly the same on every side.
- **Layout** — Left sidebar (file tree, vault switch) · center editor (Milkdown + diary/calendar/lite-app pages) · right panel (AI chat / Relations).

```
src/        React UI: panels, editor, agent chat, i18n, contexts, api clients
server/     Node backend: /api routes, file system, AI provider, agent loop, settings
shared/     Plain-ESM helpers shared by browser and Node (relations, wiki links, journal layout)
electron/   Electron main process + preload (embeds the server)
app/        Static host used by the web/Node production build (app/app.js)
public/     Static assets (icons, svg)
plugins/    Source for built-in plugins (excalidraw, mermaid, custom-block, theme-sample)
```

## Getting Started

### Prerequisites

- Node.js >= 20
- npm (comes with Node)

### Install

```bash
npm install
```

### Development

```bash
npm run dev            # Vite dev server at http://localhost:9000 (API handled in-process)
npm run start:electron # launch the Electron app in debug mode
```

### Build & Run

```bash
npm run build          # type-check + build to dist/ (plus plugin bundles)
npm run start          # serve the production build via Node (app/app.js)
npm run preview        # preview the production build locally (Vite)
```

### Package Distributables (Electron)

```bash
npm run package        # package only (uncompressed app dir under out/)
npm run make           # package + build installers (zip / deb / rpm / dmg / AppImage)
```

On Windows, a Squirrel installer is produced; on Linux `deb`/`rpm` (with a ZIP/AppImage fallback when Squirrel's Mono/Wine toolchain is absent); on macOS `dmg`/`zip`. Code signing is opt-in via environment variables.

### Configuring AI

AI providers and API keys are configured from the in-app **Settings** panel (multi-provider, any OpenAI-compatible endpoint). Keys are stored **locally** in your per-vault app data and are **never** committed to the repository or exposed to the browser. See [SECURITY.md](SECURITY.md) for details.

## Testing & Quality

```bash
npm run check          # typecheck + run the test suite (vitest)
npm run test           # run tests once
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

The same checks run automatically in CI on every push and pull request.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding style, and the pull-request process before opening a PR.

## Security

Found a vulnerability? Please review [SECURITY.md](SECURITY.md) for how to report it responsibly.

## License

MarkSeek is released under the [MIT License](LICENSE).
