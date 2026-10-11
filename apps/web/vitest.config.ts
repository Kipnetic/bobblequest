import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      '__tests__/**/*.test.ts',
      '__tests__/**/*.test.tsx',
    ],
    environment: 'jsdom',
    globals: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/components/ui/**',
        'src/middleware.ts',
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
