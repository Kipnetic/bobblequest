import type { Environment, Service } from '@t/analytics-types'
import { REDACTED_PLACEHOLDER } from '@t/analytics-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogBrowserAnalyticsTracker } from '../src/infrastructure/PostHogBrowserAnalyticsTracker'

// vi.mock is hoisted — use vi.hoisted() so mockPosthog is available in the factory
const mockPosthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  alias: vi.fn(),
  group: vi.fn(),
  // posthog-js returns undefined before flags have loaded
  isFeatureEnabled: vi.fn((): boolean | undefined => false),
  featureFlags: {
    getFlagVariants: vi.fn((): Record<string, boolean | string> | undefined => ({
      flag_a: true,
      flag_b: 'v2',
    })),
  },
  captureException: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('posthog-js', () => ({
  default: mockPosthog,
}))

describe('PostHogBrowserAnalyticsTracker', () => {
  let tracker: PostHogBrowserAnalyticsTracker
  const mockEnvironment: Environment = 'production'
  const mockService: Service = 'web'
  const mockApiKey = 'test-key'
  const mockHost = 'https://test.posthog.com'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {})
    tracker = new PostHogBrowserAnalyticsTracker({
      environment: mockEnvironment,
      service: mockService,
      apiKey: mockApiKey,
      host: mockHost,
      enabled: true,
    })
  })

  describe('constructor', () => {
    it('should initialize posthog with correct parameters', () => {
      expect(mockPosthog.init).toHaveBeenCalledWith(
        mockApiKey,
        expect.objectContaining({
          api_host: mockHost,
          defaults: '2026-01-30',
          capture_pageview: false,
          person_profiles: 'identified_only',
        }),
      )
    })

    it('should use default host when host is undefined', () => {
      vi.clearAllMocks()
      new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: undefined,
        enabled: true,
      })
      expect(mockPosthog.init).toHaveBeenCalledWith(
        mockApiKey,
        expect.objectContaining({
          api_host: 'https://us.i.posthog.com',
          defaults: '2026-01-30',
          capture_pageview: false,
          person_profiles: 'identified_only',
        }),
      )
    })
  })

  describe('capture', () => {
    it('should call posthog.capture with stamped properties', () => {
      tracker.capture('test-event', 'test-user-id', { prop: 'value' })
      expect(mockPosthog.capture).toHaveBeenCalledWith('test-event', {
        prop: 'value',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should call posthog.capture with empty props when no properties passed', () => {
      tracker.capture('test-event', 'test-user-id')
      expect(mockPosthog.capture).toHaveBeenCalledWith('test-event', {
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should include $groups when groups are provided', () => {
      tracker.capture('test-event', 'test-user-id', { prop: 'val' }, { company: 'acme' })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.$groups).toEqual({ company: 'acme' })
    })

    it('should not call posthog.capture when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.capture('test-event', 'test-user-id')
      expect(mockPosthog.capture).not.toHaveBeenCalled()
    })

    it('should scrub PII keys from properties', () => {
      tracker.capture('test-event', 'user-1', {
        safeKey: 'safe value',
        email: 'user@example.com',
        password: 'secret123',
      })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.email).toBe(REDACTED_PLACEHOLDER)
      expect(payload.password).toBe(REDACTED_PLACEHOLDER)
      expect(payload.safeKey).toBe('safe value')
    })

    it('should scrub email content pattern from values', () => {
      tracker.capture('test-event', 'user-1', { userInfo: 'user@example.com' })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.userInfo).toBe(REDACTED_PLACEHOLDER)
    })

    it('should preserve reserved super-props through scrubbing', () => {
      tracker.capture('test-event', 'user-1', {
        $environment: 'staging',
        $service: 'api',
        $session_id: 'sess-abc',
      })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      // After stampAndStrip, $environment and $service are always overwritten with tracker values.
      // Reserved keys are stripped from caller input then re-stamped.
      expect(payload.$environment).toBe(mockEnvironment)
      expect(payload.$service).toBe(mockService)
    })

    it('should apply custom pii extraKeys', () => {
      const customTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { extraKeys: ['myCustomKey'] },
      })
      customTracker.capture('test-event', 'user-1', { myCustomKey: 'should-be-redacted' })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.myCustomKey).toBe(REDACTED_PLACEHOLDER)
    })

    it('should apply custom pii allowKeys (skip redaction)', () => {
      const customTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { allowKeys: ['email'] },
      })
      customTracker.capture('test-event', 'user-1', { email: 'user@example.com' })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.email).toBe('user@example.com')
    })

    it('should apply custom pii replaceWith placeholder', () => {
      const customTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { replaceWith: '***' },
      })
      customTracker.capture('test-event', 'user-1', { email: 'user@example.com' })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.email).toBe('***')
    })

    it('should be idempotent on double-capture (same scrubbed payload twice)', () => {
      const properties = { email: 'user@example.com', safe: 'value' }
      tracker.capture('evt', 'u1', properties)
      tracker.capture('evt', 'u1', properties)
      const [, first] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      const [, second] = mockPosthog.capture.mock.calls[1] as [string, Record<string, unknown>]
      expect(first.email).toBe(REDACTED_PLACEHOLDER)
      expect(second.email).toBe(REDACTED_PLACEHOLDER)
      expect(first.safe).toBe('value')
      expect(second.safe).toBe('value')
    })
  })

  describe('identify', () => {
    it('should call posthog.identify with stamped traits', () => {
      tracker.identify('test-user-id', { name: 'Test User' })
      expect(mockPosthog.identify).toHaveBeenCalledWith('test-user-id', {
        name: 'Test User',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from traits', () => {
      tracker.identify('user-1', { name: 'Alice', email: 'alice@example.com' })
      // identify(distinctId, traits) — second arg
      const [, traitArg] = mockPosthog.identify.mock.calls[0] as [string, Record<string, unknown>]
      expect(traitArg.email).toBe(REDACTED_PLACEHOLDER)
      expect(traitArg.name).toBe('Alice')
    })

    it('should call posthog.identify with no traits', () => {
      tracker.identify('user-1')
      expect(mockPosthog.identify).toHaveBeenCalledWith('user-1', {
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('alias', () => {
    it('should call posthog.alias with alias and distinctId', () => {
      tracker.alias('user-123', 'anon-456')
      expect(mockPosthog.alias).toHaveBeenCalledWith('anon-456', 'user-123')
    })

    it('should not call posthog.alias when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.alias('user-123', 'anon-456')
      expect(mockPosthog.alias).not.toHaveBeenCalled()
    })
  })

  describe('captureException', () => {
    it('should call posthog.captureException with error and stamped properties', () => {
      const error = new Error('Test error')
      tracker.captureException(error, 'test-user-id')
      expect(mockPosthog.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          $environment: mockEnvironment,
          $service: mockService,
          $exception_message: 'Test error',
          $exception_type: 'Error',
        }),
      )
    })

    it('should scrub PII from exception properties', () => {
      const error = new Error('err')
      tracker.captureException(error, 'user-1', { email: 'x@y.com', safe: 'ok' })
      const [, payload] = mockPosthog.captureException.mock.calls[0] as [
        Error,
        Record<string, unknown>,
      ]
      expect(payload.email).toBe(REDACTED_PLACEHOLDER)
      expect(payload.safe).toBe('ok')
    })
  })

  describe('group', () => {
    it('should call posthog.group with stamped traits', () => {
      tracker.group('org', 'org-123', { name: 'Test Org' })
      expect(mockPosthog.group).toHaveBeenCalledWith('org', 'org-123', {
        name: 'Test Org',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from group traits', () => {
      tracker.group('org', 'org-1', { contactEmail: 'admin@corp.com' })
      const [, , traits] = mockPosthog.group.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(traits.contactEmail).toBe(REDACTED_PLACEHOLDER)
    })

    it('should call posthog.group with no traits', () => {
      tracker.group('org', 'org-1')
      expect(mockPosthog.group).toHaveBeenCalledWith('org', 'org-1', {
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('captureRevenue', () => {
    it('should call posthog.capture with $revenue event', () => {
      tracker.captureRevenue({
        distinctId: 'test-user-id',
        amount: 99.99,
        currency: 'USD',
        meta: {},
        groups: {},
      })
      expect(mockPosthog.capture).toHaveBeenCalledWith('$revenue', {
        amount: 99.99,
        currency: 'USD',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from revenue meta', () => {
      tracker.captureRevenue({
        distinctId: 'user-1',
        amount: 10,
        currency: 'USD',
        meta: { cardNumber: '4111111111111111', plan: 'pro' },
        groups: {},
      })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.cardNumber).toBe(REDACTED_PLACEHOLDER)
      expect(payload.plan).toBe('pro')
    })

    it('should handle captureRevenue with no meta', () => {
      tracker.captureRevenue({
        distinctId: 'user-1',
        amount: 5,
        currency: 'USD',
        groups: {},
      })
      expect(mockPosthog.capture).toHaveBeenCalledWith('$revenue', {
        amount: 5,
        currency: 'USD',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('captureLlm', () => {
    it('should call posthog.capture with $ai_generation event', () => {
      tracker.captureLlm({
        traceId: 'trace-123',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
        meta: {},
      })
      expect(mockPosthog.capture).toHaveBeenCalledWith('$ai_generation', {
        $ai_model: 'gpt-4',
        $ai_input_tokens: 100,
        $ai_output_tokens: 50,
        $ai_latency: 200,
        $ai_trace_id: 'trace-123',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from LLM meta', () => {
      tracker.captureLlm({
        traceId: 'trace-1',
        model: 'gpt-4',
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 100,
        meta: { userEmail: 'user@example.com', prompt: 'hello' },
      })
      const [, payload] = mockPosthog.capture.mock.calls[0] as [string, Record<string, unknown>]
      expect(payload.userEmail).toBe(REDACTED_PLACEHOLDER)
      expect(payload.prompt).toBe('hello')
    })

    it('should handle captureLlm with no meta', () => {
      tracker.captureLlm({
        traceId: 'trace-2',
        model: 'gpt-4',
        inputTokens: 5,
        outputTokens: 2,
        latencyMs: 50,
      })
      expect(mockPosthog.capture).toHaveBeenCalledWith(
        '$ai_generation',
        expect.objectContaining({
          $ai_model: 'gpt-4',
          $environment: mockEnvironment,
          $service: mockService,
        }),
      )
    })

    it('should not call posthog.capture when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureLlm({
        traceId: 't1',
        model: 'gpt-4',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 10,
        meta: {},
      })
      expect(mockPosthog.capture).not.toHaveBeenCalled()
    })
  })

  describe('capturePageView', () => {
    it('should call posthog.capture with $pageview event', () => {
      tracker.capturePageView('/test-page')
      expect(mockPosthog.capture).toHaveBeenCalledWith('$pageview', {
        $current_url: '/test-page',
      })
    })

    it('should not call posthog.capture when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.capturePageView('/test-page')
      expect(mockPosthog.capture).not.toHaveBeenCalled()
    })
  })

  describe('captureScreen', () => {
    it('should call posthog.capture with $screen event', () => {
      tracker.captureScreen('HomeScreen')
      expect(mockPosthog.capture).toHaveBeenCalledWith('$screen', {
        $screen_name: 'HomeScreen',
      })
    })

    it('should scrub PII from screen properties when properties are provided', () => {
      tracker.captureScreen('ProfileScreen', { userEmail: 'user@example.com', tab: 'settings' })
      expect(mockPosthog.capture).toHaveBeenCalledWith('$screen', {
        $screen_name: 'ProfileScreen',
        userEmail: REDACTED_PLACEHOLDER,
        tab: 'settings',
      })
    })

    it('should not call posthog.capture when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureScreen('HomeScreen')
      expect(mockPosthog.capture).not.toHaveBeenCalled()
    })
  })

  describe('sessionId', () => {
    it('should return a stable string', () => {
      const id1 = tracker.sessionId()
      const id2 = tracker.sessionId()
      expect(typeof id1).toBe('string')
      expect(id1).toBe(id2)
    })
  })

  describe('isFeatureEnabled', () => {
    it('should call posthog.isFeatureEnabled with flag key and return boolean', async () => {
      mockPosthog.isFeatureEnabled.mockReturnValue(true)
      const result = await tracker.isFeatureEnabled('test-feature', 'test-user-id')
      expect(mockPosthog.isFeatureEnabled).toHaveBeenCalledWith('test-feature')
      expect(result).toBe(true)
    })

    it('should return false while flags have not loaded (posthog returns undefined)', async () => {
      mockPosthog.isFeatureEnabled.mockReturnValueOnce(undefined)
      const result = await tracker.isFeatureEnabled('test-feature', 'test-user-id')
      expect(result).toBe(false)
    })
  })

  describe('getAllFlags', () => {
    it('should call posthog.featureFlags.getFlagVariants and return flag map', async () => {
      const result = await tracker.getAllFlags('test-user-id')
      expect(mockPosthog.featureFlags.getFlagVariants).toHaveBeenCalled()
      expect(result).toEqual({ flag_a: true, flag_b: 'v2' })
    })

    it('should return an empty map while flags have not loaded', async () => {
      mockPosthog.featureFlags.getFlagVariants.mockReturnValueOnce(undefined)
      const result = await tracker.getAllFlags('test-user-id')
      expect(result).toEqual({})
    })
  })

  describe('setSuperProperties', () => {
    it('should call posthog.register', () => {
      tracker.setSuperProperties({ prop1: 'value1' })
      expect(mockPosthog.register).toHaveBeenCalledWith({ prop1: 'value1' })
    })

    it('should not call posthog.register when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.setSuperProperties({ prop1: 'value1' })
      expect(mockPosthog.register).not.toHaveBeenCalled()
    })
  })

  describe('clearSuperProperties', () => {
    it('should call posthog.reset', () => {
      tracker.clearSuperProperties()
      expect(mockPosthog.reset).toHaveBeenCalled()
    })

    it('should not call posthog.reset when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogBrowserAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.clearSuperProperties()
      expect(mockPosthog.reset).not.toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('should return resolved promise', async () => {
      await expect(tracker.shutdown()).resolves.toBeUndefined()
    })
  })
})
