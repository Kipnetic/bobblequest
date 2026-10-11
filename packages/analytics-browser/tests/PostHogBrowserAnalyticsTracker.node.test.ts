// @vitest-environment node
/**
 * Node-environment tests for PostHogBrowserAnalyticsTracker.
 * Run with environment: 'node' so typeof window === 'undefined' is true.
 * Covers the SSR guard branches that cannot be exercised in jsdom.
 */
import type { Environment, Service } from '@t/analytics-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogBrowserAnalyticsTracker } from '../src/infrastructure/PostHogBrowserAnalyticsTracker'

const mockPosthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  alias: vi.fn(),
  group: vi.fn(),
  isFeatureEnabled: vi.fn(() => false),
  featureFlags: { getFlagVariants: vi.fn(() => ({})) },
  captureException: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: mockPosthog }))

describe('PostHogBrowserAnalyticsTracker (node/SSR — window undefined)', () => {
  const mockEnvironment: Environment = 'production'
  const mockService: Service = 'web'
  const mockApiKey = 'test-key'
  const mockHost = 'https://test.posthog.com'

  let tracker: PostHogBrowserAnalyticsTracker

  beforeEach(() => {
    vi.clearAllMocks()
    tracker = new PostHogBrowserAnalyticsTracker({
      environment: mockEnvironment,
      service: mockService,
      apiKey: mockApiKey,
      host: mockHost,
      enabled: true,
    })
  })

  it('should not init posthog when window is undefined', () => {
    expect(mockPosthog.init).not.toHaveBeenCalled()
  })

  it('capture should be a no-op when window is undefined', () => {
    tracker.capture('evt', 'user-1', { prop: 'val' })
    expect(mockPosthog.capture).not.toHaveBeenCalled()
  })

  it('captureException should be a no-op when window is undefined', () => {
    tracker.captureException(new Error('err'), 'user-1')
    expect(mockPosthog.captureException).not.toHaveBeenCalled()
  })

  it('identify should be a no-op when window is undefined', () => {
    tracker.identify('user-1', { name: 'Alice' })
    expect(mockPosthog.identify).not.toHaveBeenCalled()
  })

  it('alias should be a no-op when window is undefined', () => {
    tracker.alias('user-1', 'anon-1')
    expect(mockPosthog.alias).not.toHaveBeenCalled()
  })

  it('group should be a no-op when window is undefined', () => {
    tracker.group('org', 'org-1', { name: 'Acme' })
    expect(mockPosthog.group).not.toHaveBeenCalled()
  })

  it('isFeatureEnabled should return false when window is undefined', async () => {
    const result = await tracker.isFeatureEnabled('flag', 'user-1')
    expect(result).toBe(false)
    expect(mockPosthog.isFeatureEnabled).not.toHaveBeenCalled()
  })

  it('getAllFlags should return empty object when window is undefined', async () => {
    const result = await tracker.getAllFlags('user-1')
    expect(result).toEqual({})
    expect(mockPosthog.featureFlags.getFlagVariants).not.toHaveBeenCalled()
  })

  it('captureRevenue should be a no-op when window is undefined', () => {
    tracker.captureRevenue({ distinctId: 'u1', amount: 10, currency: 'USD', meta: {}, groups: {} })
    expect(mockPosthog.capture).not.toHaveBeenCalled()
  })

  it('captureLlm should be a no-op when window is undefined', () => {
    tracker.captureLlm({
      traceId: 't1',
      model: 'gpt-4',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
      meta: {},
    })
    expect(mockPosthog.capture).not.toHaveBeenCalled()
  })

  it('capturePageView should be a no-op when window is undefined', () => {
    tracker.capturePageView('/page')
    expect(mockPosthog.capture).not.toHaveBeenCalled()
  })

  it('captureScreen should be a no-op when window is undefined', () => {
    tracker.captureScreen('HomeScreen')
    expect(mockPosthog.capture).not.toHaveBeenCalled()
  })

  it('setSuperProperties should be a no-op when window is undefined', () => {
    tracker.setSuperProperties({ prop: 'val' })
    expect(mockPosthog.register).not.toHaveBeenCalled()
  })

  it('clearSuperProperties should be a no-op when window is undefined', () => {
    tracker.clearSuperProperties()
    expect(mockPosthog.reset).not.toHaveBeenCalled()
  })
})
