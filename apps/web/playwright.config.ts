import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'next dev --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Stub required NEXT_PUBLIC_* vars so the dev server starts without a real
    // .env file. Tests that need live Clerk credentials skip via
    // test.skip(!process.env.CLERK_PUBLISHABLE_KEY, ...).
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? 'sk_test_e2estub',
      NEXT_PUBLIC_TRPC_URL: process.env.NEXT_PUBLIC_TRPC_URL ?? 'http://localhost:3001/trpc',
      NEXT_PUBLIC_REVENUECAT_PUBLIC_API_KEY:
        process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_API_KEY ?? '',
      // Without a PostHog key the composition root refuses to start unless
      // analytics is disabled explicitly.
      POSTHOG_ENABLED: process.env.POSTHOG_ENABLED ?? 'false',
    },
  },
})
