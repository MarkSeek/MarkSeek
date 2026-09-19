// Theme ids the CSS (and the first-paint script) actually implement.
//
// Tiny and dependency-free on purpose: src/firstPaint.ts imports this and is
// inlined into index.html as a classic script, so pulling in the settings
// schema here would drag every i18n label into the critical first paint.
//
// The user-facing labels live in the settings schema (src/config/settingsSchema.ts);
// the backend mirrors this list in server/settings-schema.mjs (`THEMES`). Both
// are asserted equal by contract tests on each side.
export const THEME_IDS = ['warm', 'light', 'dark']

export type ThemeId = (typeof THEME_IDS)[number]
