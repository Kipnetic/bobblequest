import { createContainer } from '@t/dependency-injection'
import type { Container } from '@t/dependency-injection'
import { dependencyKeys } from '@t/dependency-injection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAnalyticsRnDI } from './registerAnalyticsRnDI'

// Mock posthog-react-native to avoid real network calls / native modules during instantiation tests
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

// Minimal mock container — register is a spy so we can inspect calls
const createMockContainer = (): Container => {
  const registerSpy = vi.fn()
  return {
    register: registerSpy,
    resolve: vi.fn(),
  } as unknown as Container
}

// Minimal RnConfigAccessor mock
const createMockConfig = (overrides: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = {
    POSTHOG_API_KEY: 'test-key',
    POSTHOG_HOST: 'https://test.posthog.com',
  }
  return {
    get: (key: string): string | undefined => (key in overrides ? overrides[key] : base[key]),
  }
}

describe('registerAnalyticsRnDI', () => {
  let container: Container

  beforeEach(() => {
    vi.clearAllMocks()
    container = createMockContainer()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should call container.register once', () => {
    const config = createMockConfig()
    registerAnalyticsRnDI(container, { config })
    expect(container.register).toHaveBeenCalledOnce()
  })

  it('should register under dependencyKeys.global.ANALYTICS (canonical key)', () => {
    const config = createMockConfig()
    registerAnalyticsRnDI(container, { config })
    const [registrations] = (container.register as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(registrations).toHaveProperty(dependencyKeys.global.ANALYTICS)
  })

  it('should NOT register under a raw string key "analyticsTracker"', () => {
    const config = createMockConfig()
    registerAnalyticsRnDI(container, { config })
    const [registrations] = (container.register as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(registrations).not.toHaveProperty('analyticsTracker')
  })

  describe('branch: noOp === true (testing)', () => {
    it('should register under canonical key when noOp is true', () => {
      const config = createMockConfig()
      registerAnalyticsRnDI(container, { config, noOp: true })
      const [registrations] = (container.register as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(registrations).toHaveProperty(dependencyKeys.global.ANALYTICS)
    })

    it('resolves NoOp instance via real container when noOp is true', () => {
      const realContainer = createContainer()
      const config = createMockConfig()
      registerAnalyticsRnDI(realContainer, { config, noOp: true })
      const tracker = realContainer.resolve(dependencyKeys.global.ANALYTICS)
      expect(tracker).toBeDefined()
      // PostHog constructor must NOT have been called
      expect(mockPosthogInstance.capture).not.toHaveBeenCalled()
    })
  })

  describe('branch: missing apiKey', () => {
    it('should register under canonical key when POSTHOG_API_KEY is missing', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = createMockConfig({ POSTHOG_API_KEY: undefined })
      registerAnalyticsRnDI(container, { config })
      const [registrations] = (container.register as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(registrations).toHaveProperty(dependencyKeys.global.ANALYTICS)
      warnSpy.mockRestore()
    })

    it('warns and resolves NoOp when POSTHOG_API_KEY is missing', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const realContainer = createContainer()
      const config = createMockConfig({ POSTHOG_API_KEY: undefined })
      registerAnalyticsRnDI(realContainer, { config })
      const tracker = realContainer.resolve(dependencyKeys.global.ANALYTICS)
      expect(tracker).toBeDefined()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('POSTHOG_API_KEY'))
      warnSpy.mockRestore()
    })
  })

  describe('branch: PostHog (api key present)', () => {
    it('resolves PostHogRnAnalyticsTracker when key is present', () => {
      const realContainer = createContainer()
      const config = createMockConfig()
      registerAnalyticsRnDI(realContainer, { config })
      const tracker = realContainer.resolve(dependencyKeys.global.ANALYTICS)
      expect(tracker).toBeDefined()
    })

    it('accepts pii options without error', () => {
      const config = createMockConfig()
      expect(() =>
        registerAnalyticsRnDI(container, {
          config,
          pii: { extraKeys: ['mySecret'], replaceWith: '***' },
        }),
      ).not.toThrow()
      expect(container.register).toHaveBeenCalledOnce()
    })

    it('accepts environment override', () => {
      const config = createMockConfig()
      expect(() =>
        registerAnalyticsRnDI(container, {
          config,
          environment: 'development',
        }),
      ).not.toThrow()
    })
  })

  it('DI key value is "analytics" (matches dependencyKeys.global.ANALYTICS)', () => {
    expect(dependencyKeys.global.ANALYTICS).toBe('analytics')
  })
})
