# Security Policy

## Supported Versions

MarkSeek is in active development (pre-1.0). Security fixes are applied to the
latest `main` branch and released in subsequent versions.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub
issue. Instead, report it privately so we can triage and ship a fix before
disclosure:

- Use **GitHub Security Advisories**: open a private vulnerability report from the
  "Security" tab of the repository.
- If you cannot use the above, email the maintainers (see the repository
  description / profile for contact).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (or a proof-of-concept).
- Any suggested mitigation, if known.

We will acknowledge receipt within a few days and keep you informed as we work on
a fix.

## Handling Secrets & API Keys

MarkSeek requires AI provider API keys to use its AI features. To keep the project
safe for open source:

- **API keys are stored locally only** — in the per-vault `settings` file or OS
  key storage, never in the source code.
- **Never commit secrets.** The repository's `.gitignore` excludes `.env`,
  `.env.local`, and `*.log`. Do not bypass these rules.
- The AI provider configuration is read from runtime settings
  (`server/ai/provider.mjs`) and environment variables; signing credentials for
  desktop builds are supplied via environment variables at build time
  (`forge.config.mjs`), not hardcoded.
- If you accidentally commit a secret, rotate it immediately and remove it from
  history (e.g. with `git filter-repo`) before reporting.

## Supply-Chain & Dependencies

- Dependency versions are pinned via `package-lock.json`, which is committed for
  reproducible installs.
- Run `npm audit` and keep dependencies up to date. If you find a vulnerable
  dependency, report it through the private channel above.
