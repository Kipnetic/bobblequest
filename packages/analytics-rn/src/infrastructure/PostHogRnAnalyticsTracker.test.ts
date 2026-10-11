import type { Environment, Service } from '@t/analytics-types'
import { REDACTED_PLACEHOLDER } from '@t/analytics-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogRnAnalyticsTracker } from './PostHogRnAnalyticsTracker'

// vi.mock is hoisted — use vi.hoisted() so mockPosthogInstance is available in the factory.
// posthog-react-native exports PostHog as a class; we mock the constructor to return a
// controlled instance without touching native modules.
const mockPosthogInstance = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  alias: vi.fn(),
  group: vi.fn(),
  isFeatureEnabled: vi.fn(() => false),
  getFeatureFlags: vi.fn(() => ({ flag_a: true, flag_b: 'v2' })),
  captureException: vi.fn(),
  screen: vi.fn(),
  getSessionId: vi.fn(() => 'rn-session-abc'),
  shutdown: vi.fn(() => Promise.resolve()),
}))

vi.mock('posthog-react-native', () => ({
  // Vitest 4 mocks called with `new` need a constructable implementation.
  PostHog: vi.fn(function PostHog() {
    return mockPosthogInstance
  }),
}))

describe('PostHogRnAnalyticsTracker', () => {
  let tracker: PostHogRnAnalyticsTracker
  const mockEnvironment: Environment = 'production'
  const mockService: Service = 'mobile'
  const mockApiKey = 'test-key'
  const mockHost = 'https://test.posthog.com'

  beforeEach(() => {
    vi.clearAllMocks()
    tracker = new PostHogRnAnalyticsTracker({
      environment: mockEnvironment,
      service: mockService,
      apiKey: mockApiKey,
      host: mockHost,
      enabled: true,
    })
  })

  describe('constructor', () => {
    it('should initialize PostHog with correct parameters', async () => {
      const { PostHog } = await import('posthog-react-native')
      expect(PostHog).toHaveBeenCalledWith(mockApiKey, {
        host: mockHost,
        captureAppLifecycleEvents: false,
      })
    })

    it('should use default host when host is undefined', async () => {
      vi.clearAllMocks()
      new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: undefined,
        enabled: true,
      })
      const { PostHog } = await import('posthog-react-native')
      expect(PostHog).toHaveBeenCalledWith(mockApiKey, {
        host: 'https://us.i.posthog.com',
        captureAppLifecycleEvents: false,
      })
    })
  })

  describe('capture', () => {
    it('should call posthog.capture with stamped properties', () => {
      tracker.capture('test-event', 'test-user-id', { prop: 'value' })
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('test-event', {
        prop: 'value',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should not call posthog.capture when disabled', () => {
      vi.clearAllMocks()
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.capture('test-event', 'test-user-id')
      expect(mockPosthogInstance.capture).not.toHaveBeenCalled()
    })

    it('should scrub PII keys from properties', () => {
      tracker.capture('test-event', 'user-1', {
        safeKey: 'safe value',
        email: 'user@example.com',
        password: 'secret123',
      })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.email).toBe(REDACTED_PLACEHOLDER)
      expect(payload.password).toBe(REDACTED_PLACEHOLDER)
      expect(payload.safeKey).toBe('safe value')
    })

    it('should scrub email content pattern from values', () => {
      tracker.capture('test-event', 'user-1', { userInfo: 'user@example.com' })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.userInfo).toBe(REDACTED_PLACEHOLDER)
    })

    it('should preserve reserved super-props through scrubbing', () => {
      tracker.capture('test-event', 'user-1', {
        $environment: 'staging',
        $service: 'api',
        $session_id: 'sess-abc',
      })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      // After stampAndStrip, $environment and $service are always overwritten with tracker values.
      expect(payload.$environment).toBe(mockEnvironment)
      expect(payload.$service).toBe(mockService)
    })

    it('should forward groups as $groups', () => {
      tracker.capture('test-event', 'user-1', { prop: 'v' }, { org: 'org-1' })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.$groups).toEqual({ org: 'org-1' })
    })

    it('should apply custom pii extraKeys', () => {
      const customTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { extraKeys: ['myCustomKey'] },
      })
      customTracker.capture('test-event', 'user-1', { myCustomKey: 'should-be-redacted' })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.myCustomKey).toBe(REDACTED_PLACEHOLDER)
    })

    it('should apply custom pii allowKeys (skip redaction)', () => {
      const customTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { allowKeys: ['email'] },
      })
      customTracker.capture('test-event', 'user-1', { email: 'user@example.com' })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.email).toBe('user@example.com')
    })

    it('should apply custom pii replaceWith placeholder', () => {
      const customTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
        pii: { replaceWith: '***' },
      })
      customTracker.capture('test-event', 'user-1', { email: 'user@example.com' })
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.email).toBe('***')
    })

    it('should call posthog.capture with only stamped props when properties are undefined', () => {
      tracker.capture('test-event', 'user-1')
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('test-event', {
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('identify', () => {
    it('should call posthog.identify with stamped traits', () => {
      tracker.identify('test-user-id', { name: 'Test User' })
      expect(mockPosthogInstance.identify).toHaveBeenCalledWith('test-user-id', {
        name: 'Test User',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from traits', () => {
      tracker.identify('user-1', { name: 'Alice', email: 'alice@example.com' })
      const [, traitArg] = mockPosthogInstance.identify.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(traitArg.email).toBe(REDACTED_PLACEHOLDER)
      expect(traitArg.name).toBe('Alice')
    })

    it('should not call posthog.identify when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.identify('user-1', { name: 'Alice' })
      expect(mockPosthogInstance.identify).not.toHaveBeenCalled()
    })

    it('should call posthog.identify with only stamped props when traits are undefined', () => {
      tracker.identify('user-no-traits')
      expect(mockPosthogInstance.identify).toHaveBeenCalledWith('user-no-traits', {
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('alias', () => {
    it('should call posthog.alias with alias string', () => {
      tracker.alias('user-123', 'anon-456')
      expect(mockPosthogInstance.alias).toHaveBeenCalledWith('anon-456')
    })

    it('should not call posthog.alias when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.alias('user-123', 'anon-456')
      expect(mockPosthogInstance.alias).not.toHaveBeenCalled()
    })
  })

  describe('captureException', () => {
    it('should call posthog.captureException with error and stamped properties', () => {
      const error = new Error('Test error')
      tracker.captureException(error, 'test-user-id')
      expect(mockPosthogInstance.captureException).toHaveBeenCalledWith(
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
      const [, payload] = mockPosthogInstance.captureException.mock.calls[0] as [
        Error,
        Record<string, unknown>,
      ]
      expect(payload.email).toBe(REDACTED_PLACEHOLDER)
      expect(payload.safe).toBe('ok')
    })

    it('should not call posthog.captureException when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureException(new Error('err'), 'user-1')
      expect(mockPosthogInstance.captureException).not.toHaveBeenCalled()
    })
  })

  describe('group', () => {
    it('should call posthog.group with stamped traits', () => {
      tracker.group('org', 'org-123', { name: 'Test Org' })
      expect(mockPosthogInstance.group).toHaveBeenCalledWith('org', 'org-123', {
        name: 'Test Org',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })

    it('should scrub PII from group traits', () => {
      tracker.group('org', 'org-1', { contactEmail: 'admin@corp.com' })
      const [, , traits] = mockPosthogInstance.group.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(traits.contactEmail).toBe(REDACTED_PLACEHOLDER)
    })

    it('should not call posthog.group when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.group('org', 'org-1')
      expect(mockPosthogInstance.group).not.toHaveBeenCalled()
    })

    it('should call posthog.group with only stamped props when traits are undefined', () => {
      tracker.group('org', 'org-999')
      expect(mockPosthogInstance.group).toHaveBeenCalledWith('org', 'org-999', {
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
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('$revenue', {
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
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.cardNumber).toBe(REDACTED_PLACEHOLDER)
      expect(payload.plan).toBe('pro')
    })

    it('should not call posthog.capture when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureRevenue({ distinctId: 'u', amount: 1, currency: 'USD' })
      expect(mockPosthogInstance.capture).not.toHaveBeenCalled()
    })

    it('should call posthog.capture with only stamped props when meta is undefined', () => {
      tracker.captureRevenue({ distinctId: 'user-1', amount: 5.0, currency: 'EUR' })
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('$revenue', {
        amount: 5.0,
        currency: 'EUR',
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
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('$ai_generation', {
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
      const [, payload] = mockPosthogInstance.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(payload.userEmail).toBe(REDACTED_PLACEHOLDER)
      expect(payload.prompt).toBe('hello')
    })

    it('should not call posthog.capture when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureLlm({
        traceId: 't',
        model: 'gpt-4',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 10,
      })
      expect(mockPosthogInstance.capture).not.toHaveBeenCalled()
    })

    it('should call posthog.capture with only stamped props when meta is undefined', () => {
      tracker.captureLlm({
        traceId: 'trace-no-meta',
        model: 'claude-3',
        inputTokens: 20,
        outputTokens: 10,
        latencyMs: 150,
      })
      expect(mockPosthogInstance.capture).toHaveBeenCalledWith('$ai_generation', {
        $ai_model: 'claude-3',
        $ai_input_tokens: 20,
        $ai_output_tokens: 10,
        $ai_latency: 150,
        $ai_trace_id: 'trace-no-meta',
        $environment: mockEnvironment,
        $service: mockService,
      })
    })
  })

  describe('captureScreen', () => {
    it('should call posthog.screen with screen name', () => {
      tracker.captureScreen('HomeScreen')
      expect(mockPosthogInstance.screen).toHaveBeenCalledWith('HomeScreen', undefined)
    })

    it('should call posthog.screen with scrubbed properties', () => {
      tracker.captureScreen('ProfileScreen', { userId: 'u1', email: 'user@example.com' })
      const [, props] = mockPosthogInstance.screen.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ]
      expect(props.email).toBe(REDACTED_PLACEHOLDER)
      expect(props.userId).toBe('u1')
    })

    it('should not call posthog.screen when disabled', () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      disabledTracker.captureScreen('Home')
      expect(mockPosthogInstance.screen).not.toHaveBeenCalled()
    })
  })

  describe('sessionId', () => {
    it('should return the value from posthog.getSessionId()', () => {
      const id = tracker.sessionId()
      expect(id).toBe('rn-session-abc')
      expect(mockPosthogInstance.getSessionId).toHaveBeenCalled()
    })

    it('should return empty string when getSessionId returns null', () => {
      mockPosthogInstance.getSessionId.mockReturnValueOnce(null as unknown as string)
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
      })
      expect(disabledTracker.sessionId()).toBe('')
    })
  })

  describe('isFeatureEnabled', () => {
    it('should call posthog.isFeatureEnabled with flag key and return boolean', async () => {
      mockPosthogInstance.isFeatureEnabled.mockReturnValue(true)
      const result = await tracker.isFeatureEnabled('test-feature', 'test-user-id')
      expect(mockPosthogInstance.isFeatureEnabled).toHaveBeenCalledWith('test-feature')
      expect(result).toBe(true)
    })

    it('should return false when flag returns undefined', async () => {
      mockPosthogInstance.isFeatureEnabled.mockReturnValue(undefined as unknown as boolean)
      const result = await tracker.isFeatureEnabled('missing-flag', 'user-1')
      expect(result).toBe(false)
    })

    it('should return false when disabled', async () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      const result = await disabledTracker.isFeatureEnabled('flag', 'user-1')
      expect(result).toBe(false)
    })
  })

  describe('getAllFlags', () => {
    it('should call posthog.getFeatureFlags and return flag map', async () => {
      const result = await tracker.getAllFlags('test-user-id')
      expect(mockPosthogInstance.getFeatureFlags).toHaveBeenCalled()
      expect(result).toEqual({ flag_a: true, flag_b: 'v2' })
    })

    it('should return empty object when getFeatureFlags returns null', async () => {
      mockPosthogInstance.getFeatureFlags.mockReturnValueOnce(
        null as unknown as { flag_a: boolean; flag_b: string },
      )
      const tracker2 = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: true,
      })
      const result = await tracker2.getAllFlags('user-1')
      expect(result).toEqual({})
    })

    it('should return empty object when disabled', async () => {
      const disabledTracker = new PostHogRnAnalyticsTracker({
        environment: mockEnvironment,
        service: mockService,
        apiKey: mockApiKey,
        host: mockHost,
        enabled: false,
      })
      const result = await disabledTracker.getAllFlags('user-1')
      expect(result).toEqual({})
    })
  })

  describe('shutdown', () => {
    it('should call posthog.shutdown and return its promise', async () => {
      await tracker.shutdown()
      expect(mockPosthogInstance.shutdown).toHaveBeenCalled()
    })
  })
})
