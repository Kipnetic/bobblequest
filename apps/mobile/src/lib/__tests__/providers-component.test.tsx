/**
 * Tests for the Providers and TrpcProvider components in providers.tsx.
 *
 * All native/Expo/third-party dependencies are mocked — no native runtime required.
 */
import { act, render } from '@testing-library/react'
import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Capture httpBatchLink options so we can invoke the headers callback directly
// (lines 27-37 of providers.tsx are inside the closure — only covered when called).
// ---------------------------------------------------------------------------
type HeadersFn = () => Promise<Record<string, string>>
let capturedHeadersFn: HeadersFn | undefined

vi.mock('@trpc/client', () => ({
  httpBatchLink: vi.fn((opts: { url: string; headers: HeadersFn }) => {
    capturedHeadersFn = opts.headers
    return {}
  }),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../composition', () => ({
  getContainer: vi.fn(() => ({
    resolve: vi.fn(() => ({
      posthog: { apiKey: 'ph_test_key', host: 'https://eu.posthog.com' },
      auth: { clerkPublishableKey: 'pk_test_key' },
      revenueCat: { appleApiKey: '', googleApiKey: '' },
      client: { trpcUrl: 'https://api.test/trpc' },
    })),
  })),
}))

vi.mock('../clerk', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getClerkPublishableKey: vi.fn(() => 'pk_test_key'),
  tokenCache: {},
  useAuth: vi.fn(() => ({ getToken: vi.fn().mockResolvedValue('test_token') })),
}))

vi.mock('../billing/RevenueCatProvider', () => ({
  RevenueCatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../analytics-bridge', () => ({
  ClerkAnalyticsBridge: () => null,
}))

vi.mock('../trpc', () => ({
  trpc: {
    createClient: vi.fn((config: { links: unknown[] }) => {
      // Execute the link factory — this triggers httpBatchLink() and captures headersFn.
      config.links.forEach(() => {})
      return {}
    }),
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
  getTrpcUrl: vi.fn(() => 'https://api.test/trpc'),
}))

vi.mock('@tanstack/react-query', () => ({
  // Vitest 4 mocks called with `new` need a constructable implementation.
  QueryClient: vi.fn(class {}),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('posthog-react-native', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePostHog: vi.fn(() => ({
    getSessionId: vi.fn(() => 'session-id'),
    getDistinctId: vi.fn(() => 'distinct-id'),
  })),
}))

vi.mock('@t/dependency-injection', () => ({
  dependencyKeys: {
    global: { CONFIG: 'config' },
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Providers', () => {
  it('renders children inside all nested providers', async () => {
    const { Providers } = await import('../providers')

    let container!: HTMLElement
    await act(async () => {
      const result = render(
        <Providers>
          <span data-testid="child">hello</span>
        </Providers>,
      )
      container = result.container
    })

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('hello')
  })

  it('exports Providers as a function', async () => {
    const mod = await import('../providers')
    expect(typeof mod.Providers).toBe('function')
  })
})

describe('TrpcProvider headers callback', () => {
  it('builds auth headers with session/distinct IDs when token and posthog are present', async () => {
    // Render Providers to trigger TrpcProvider mount (which calls trpc.createClient
    // and thus httpBatchLink — capturing the headers fn).
    const { Providers } = await import('../providers')

    await act(async () => {
      render(
        <Providers>
          <span>child</span>
        </Providers>,
      )
    })

    expect(capturedHeadersFn).toBeDefined()
    const headers = await capturedHeadersFn!()

    expect(headers.authorization).toBe('Bearer test_token')
    expect(headers['x-posthog-session-id']).toBe('session-id')
    expect(headers['x-posthog-distinct-id']).toBe('distinct-id')
  })

  it('omits posthog headers when posthog returns no session/distinct IDs', async () => {
    const { usePostHog } = await import('posthog-react-native')
    vi.mocked(usePostHog).mockReturnValueOnce({
      getSessionId: vi.fn(() => null),
      getDistinctId: vi.fn(() => null),
    } as unknown as ReturnType<typeof usePostHog>)

    capturedHeadersFn = undefined

    const { Providers } = await import('../providers')

    await act(async () => {
      render(
        <Providers>
          <span>child</span>
        </Providers>,
      )
    })

    expect(capturedHeadersFn).toBeDefined()
    const headers = await capturedHeadersFn!()

    expect(headers['x-posthog-session-id']).toBeUndefined()
    expect(headers['x-posthog-distinct-id']).toBeUndefined()
  })

  it('omits authorization header when getToken returns null', async () => {
    const { useAuth } = await import('../clerk')
    vi.mocked(useAuth).mockReturnValueOnce({
      getToken: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof useAuth>)

    capturedHeadersFn = undefined

    const { Providers } = await import('../providers')

    await act(async () => {
      render(
        <Providers>
          <span>child</span>
        </Providers>,
      )
    })

    expect(capturedHeadersFn).toBeDefined()
    const headers = await capturedHeadersFn!()

    expect(headers.authorization).toBeUndefined()
  })
})
