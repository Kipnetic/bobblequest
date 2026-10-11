import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        // Entrypoints — cannot be unit-tested without a full runtime
        'src/index.ts',
        'src/worker.ts',
        'src/cron.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
    // Each project spells out its own `include`; the root declares none.
    //
    // Never narrow a suite with a `!`-negated glob in `test.include`: Vitest
    // appends `test.include` to `coverage.exclude`, where a negated pattern
    // excludes every source file (coverage reports 0/0 and the 100% threshold
    // passes vacuously), and `extends: true` copies it into each project's
    // include, cancelling the project's own pattern. Narrow with `exclude`.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/__tests__/integration/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/__tests__/integration/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
})
