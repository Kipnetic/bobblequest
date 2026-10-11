import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      // Vitest 4 matches coverage globs against absolute paths, so these
      // would also match @t/logging-types sources; exclude that package (it
      // has its own suite) and keep the type-only entities out of the totals.
      include: ['*.ts', 'dependency-injection/**', 'infrastructure/**', 'lifecycle/**'],
      exclude: [
        '**/packages/logging-types/**',
        '**/*.test.ts',
        '__tests__/**',
        'vitest.config.ts',
        '**/index.ts',
      ],
      // Floor at measured coverage (2026-10-11): winstonLogger's pretty-print
      // paths and the OTLP transport's circuit breaker lack tests. Raise, never lower.
      thresholds: {
        statements: 74,
        branches: 63,
        functions: 84,
        lines: 74,
      },
    },
  },
})
