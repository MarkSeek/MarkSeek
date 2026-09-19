# Contributing to MarkSeek

Thanks for your interest in improving MarkSeek! This guide covers the basics for
setting up a development environment, the coding conventions we follow, and how to
submit changes.

## Development Setup

1. **Prerequisites** — Node.js >= 20 and npm.
2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run the app**

   ```bash
   npm run dev             # web dev server at http://localhost:9000
   npm run start:electron  # Electron desktop app in debug mode
   ```

## Project Conventions

- **Language** — All code and code comments are written in **English**. User-facing
  copy and documentation translations may use other languages, but the source and
  comments stay English (see `CODEBUDDY.md`).
- **TypeScript** — The project is strictly typed (`strict: true`). Run
  `npm run typecheck` to verify.
- **Formatting** — Keep diffs focused and avoid unrelated refactors.

## Testing & Quality Gates

Before opening a pull request, make sure the standard checks pass:

```bash
npm run check   # runs `npm run typecheck` + `npm run test` (vitest)
```

The same checks run automatically in CI on every push and pull request.

## Branching & Pull Requests

- Fork the repository and create a feature branch from `main` (e.g.
  `feat/short-description` or `fix/short-description`).
- Keep commits small and descriptive.
- Open a PR against `main` and fill in the pull-request template, including the
  self-check list (type-check and tests passing).
- Link any related issues in the PR description.

## Reporting Bugs & Ideas

- Use the GitHub issue templates (bug report / feature request) under
  `.github/ISSUE_TEMPLATE`.
- For security-sensitive issues, follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.

## Code of Conduct

Be respectful and constructive. We want MarkSeek to be a welcoming project for
contributors of all backgrounds.
