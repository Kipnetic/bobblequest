import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @t/* workspace packages for Vitest (Vite doesn't follow bun
      // workspace symlinks; we point it directly to the source).
      '@t/analytics-types': resolve(root, 'packages/analytics-types/src/index.ts'),
      '@t/config': resolve(root, 'packages/config/src/index.ts'),
      '@t/dependency-injection': resolve(root, 'packages/dependency-injection/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup/stubLogging.ts'],
    // *.node.test.ts files opt into the node environment with a
    // `// @vitest-environment node` comment (environmentMatchGlobs was removed
    // in Vitest 4).
    environment: 'jsdom',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/index.ts',
        'src/types.ts',
        'src/infrastructure/NoOpAnalyticsTracker.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
