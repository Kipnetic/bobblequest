import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'next dev -p 3002',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    env: {
      SITE_URL: 'http://localhost:3002',
      // Without a PostHog key the composition root refuses to start unless
      // analytics is disabled explicitly.
      POSTHOG_ENABLED: process.env.POSTHOG_ENABLED ?? 'false',
    },
  },
})
