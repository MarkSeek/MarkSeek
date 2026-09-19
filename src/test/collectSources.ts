// Shared helper for source-scanning guardrail tests (i18n keys, storage keys).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Vitest runs from the project root, so `src` is always resolvable from cwd.
export const SRC_DIR = join(process.cwd(), 'src')

/** Recursively collect .ts/.tsx files, skipping `__tests__` directories. */
export function collectSources(dir: string = SRC_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') collectSources(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Read every source file once as { file, source } pairs. */
export function readSources(): { file: string; source: string }[] {
  return collectSources().map((file) => ({ file, source: readFileSync(file, 'utf8') }))
}
