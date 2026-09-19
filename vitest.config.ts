import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two Vitest projects share one run:
//   - frontend: React components in jsdom
//   - backend:  server/**/*.mjs in plain Node (needs real fs/path/process, so
//               jsdom would break it)
// Coverage stays at the root level because it is a global-only option.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'frontend',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}', 'plugins/**/*.{test,spec}.{ts,tsx}'],
          restoreMocks: true,
          clearMocks: true,
        },
      },
      {
        test: {
          name: 'backend',
          globals: true,
          environment: 'node',
          include: ['server/**/*.{test,spec}.mjs'],
          // Each backend test file gets its own module registry so a mutated
          // global (vault dir, log dir, env) never leaks into another spec.
          isolate: true,
          restoreMocks: true,
          clearMocks: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}', 'server/**/*.mjs'],
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/**/*.d.ts',
        'server/**/__tests__/**',
        'plugins/**/__tests__/**',
      ],
    },
  },
})
