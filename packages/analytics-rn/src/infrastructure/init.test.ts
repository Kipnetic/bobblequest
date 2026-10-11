import type { ConfigRepository } from '@t/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoOpAnalyticsTracker } from './NoOpAnalyticsTracker'
import { PostHogRnAnalyticsTracker } from './PostHogRnAnalyticsTracker'
import { _resetAnalyticsSingleton, getAnalytics, initAnalytics } from './init'

// Mock posthog-react-native so PostHogRnAnalyticsTracker can construct without
// touching native modules (mirrors the pattern used by the tracker test file).
const mockPosthogInstance = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  alias: vi.fn(),
  group: vi.fn(),
  isFeatureEnabled: vi.fn(() => false),
  getFeatureFlags: vi.fn(() => ({})),
  captureException: vi.fn(),
  screen: vi.fn(),
  getSessionId: vi.fn(() => 'sess-1'),
  shutdown: vi.fn(() => Promise.resolve()),
}))

vi.mock('posthog-react-native', () => ({
  // Vitest 4 mocks called with `new` need a constructable implementation.
  PostHog: vi.fn(function PostHog() {
    return mockPosthogInstance
  }),
}))

const buildConfig = (overrides?: Partial<ConfigRepository>): ConfigRepository => {
  const base = {
    analytics: { apiKey: 'pk_test', host: 'https://test.posthog.com', enabled: true },
    system: { environment: 'production' as const },
  } as unknown as ConfigRepository
  return { ...base, ...overrides } as ConfigRepository
}

describe('initAnalytics / getAnalytics', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetAnalyticsSingleton()
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    _resetAnalyticsSingleton()
    warnSpy.mockRestore()
  })

  it('returns PostHogRnAnalyticsTracker when apiKey is present', () => {
    const tracker = initAnalytics(buildConfig())
    expect(tracker).toBeInstanceOf(PostHogRnAnalyticsTracker)
  })

  it('returns NoOpAnalyticsTracker and warns when apiKey is missing', () => {
    const tracker = initAnalytics(
      buildConfig({
        analytics: { apiKey: '', host: undefined, enabled: true },
      } as Partial<ConfigRepository>),
    )
    expect(tracker).toBeInstanceOf(NoOpAnalyticsTracker)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('apiKey'))
  })

  it('returns the same instance on subsequent calls (singleton)', () => {
    const a = initAnalytics(buildConfig())
    const b = initAnalytics(buildConfig())
    expect(a).toBe(b)
  })

  it('getAnalytics returns NoOp when not yet initialized', () => {
    const tracker = getAnalytics()
    expect(tracker).toBeInstanceOf(NoOpAnalyticsTracker)
  })

  it('getAnalytics returns the initialized instance after initAnalytics', () => {
    const initialized = initAnalytics(buildConfig())
    expect(getAnalytics()).toBe(initialized)
  })

  it('passes enabled=false through to PostHogRnAnalyticsTracker constructor', () => {
    const tracker = initAnalytics(
      buildConfig({
        analytics: { apiKey: 'pk_test', host: undefined, enabled: false },
      } as Partial<ConfigRepository>),
    ) as PostHogRnAnalyticsTracker
    // capture is a no-op when enabled=false; verifies the flag flowed through.
    tracker.capture('e', 'u', { k: 'v' })
    expect(mockPosthogInstance.capture).not.toHaveBeenCalled()
  })

  it('_resetAnalyticsSingleton clears cached instance so a fresh init runs', () => {
    const first = initAnalytics(buildConfig())
    _resetAnalyticsSingleton()
    const second = initAnalytics(buildConfig())
    expect(second).not.toBe(first)
  })

  it('forwards system.environment into the PostHog tracker', () => {
    const tracker = initAnalytics(
      buildConfig({
        system: { environment: 'development' as const },
      } as Partial<ConfigRepository>),
    ) as PostHogRnAnalyticsTracker
    tracker.capture('event', 'user-1', {})
    const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(payload.$environment).toBe('development')
  })

  it('forwards apiKey and host into the PostHog constructor', async () => {
    initAnalytics(buildConfig())
    const { PostHog } = await import('posthog-react-native')
    expect(PostHog).toHaveBeenCalledWith('pk_test', {
      host: 'https://test.posthog.com',
      captureAppLifecycleEvents: false,
    })
  })

  it('falls back to default host when config host is undefined', async () => {
    initAnalytics(
      buildConfig({
        analytics: { apiKey: 'pk_test', host: undefined, enabled: true },
      } as Partial<ConfigRepository>),
    )
    const { PostHog } = await import('posthog-react-native')
    expect(PostHog).toHaveBeenCalledWith('pk_test', {
      host: 'https://us.i.posthog.com',
      captureAppLifecycleEvents: false,
    })
  })
})
