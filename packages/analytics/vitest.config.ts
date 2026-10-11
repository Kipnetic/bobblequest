import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/stubLogging.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Vitest 4 matches coverage globs against absolute paths, so 'src/**'
        // also picked up @t/analytics-types sources; those are covered by
        // that package's own suite.
        '**/packages/analytics-types/**',
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/entities/ports/AnalyticsTracker.ts',
        'src/entities/ports/RequestAnalyticsTracker.ts',
        'src/entities/types/AnalyticsTrackerOptions.ts',
        'src/entities/types/Environment.ts',
        'src/entities/types/LlmEvent.ts',
        'src/entities/types/RevenueEvent.ts',
        'src/entities/types/Service.ts',
        'src/entities/types/ReservedSuperProps.ts',
        'src/entities/schemas/EventSchema.ts',
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
