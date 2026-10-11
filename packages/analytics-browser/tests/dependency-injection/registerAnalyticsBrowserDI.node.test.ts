// @vitest-environment node
/**
 * Node-environment tests for registerAnalyticsBrowserDI.
 * Run with environment: 'node' so typeof window === 'undefined' is genuinely true.
 * Covers the ServerNoOp branch (lines 82-83) that cannot be tested in jsdom.
 */
import { createContainer, dependencyKeys } from '@t/dependency-injection'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAnalyticsBrowserDI } from '../../src/dependency-injection/registerAnalyticsBrowserDI'

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

const createMockConfig = (overrides: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = {
    NEXT_PUBLIC_POSTHOG_KEY: 'test-key',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://test.posthog.com',
  }
  return {
    get: (key: string): string | undefined => (key in overrides ? overrides[key] : base[key]),
  }
}

describe('registerAnalyticsBrowserDI (node/SSR — window undefined)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves ServerNoOp via real container when window is undefined (SSR)', () => {
    const realContainer = createContainer()
    const config = createMockConfig()
    registerAnalyticsBrowserDI(realContainer, { config })
    const tracker = realContainer.resolve(dependencyKeys.global.ANALYTICS)
    expect(tracker).toBeDefined()
    // posthog.init should NOT be called in SSR (no window)
    expect(mockPosthog.init).not.toHaveBeenCalled()
  })
})
