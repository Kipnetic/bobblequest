/**
 * Composition root — billing registration safety net.
 *
 * `buildContainer()` wraps `registerBillingDI` in a try/catch because the
 * template must boot without billing credentials: a consumer who has not yet
 * wired STRIPE_KEY / CORE_REVENUE_CAT_API_KEY should get a working API with
 * billing routes disabled, not a crash at startup.
 *
 * The happy path (billing env present, registrar succeeds) is covered by
 * `composition.test.ts`, which runs against the fully-populated env from
 * `__tests__/setup.ts`. This file forces the registrar to throw so the catch
 * arm is exercised, and asserts the contract that arm is supposed to uphold:
 * the container is still returned, billing is simply absent, and every
 * dependency registered before the failure is untouched.
 *
 * Kept in its own file because `vi.mock` is hoisted per-module — mocking
 * `@t/billing` here leaves `composition.test.ts` free to exercise the real
 * registrar.
 */

import { dependencyKeys } from '@t/dependency-injection'
import { describe, expect, it, vi } from 'vitest'
import { buildContainer } from './composition'

vi.mock('@t/billing', async () => {
  const actual = await vi.importActual<typeof import('@t/billing')>('@t/billing')
  return {
    ...actual,
    registerBillingDI: vi.fn(() => {
      throw new Error('STRIPE_KEY / CORE_REVENUE_CAT_API_KEY not set')
    }),
  }
})

describe('buildContainer — billing registrar throws', () => {
  it('still returns a container instead of propagating the error', () => {
    expect(() => buildContainer()).not.toThrow()
    expect(buildContainer()).toBeDefined()
  })

  it('leaves BILLING_REPOSITORY unregistered', () => {
    const container = buildContainer()
    expect(() => container.resolve(dependencyKeys.global.BILLING_REPOSITORY)).toThrow()
  })

  it('keeps every dependency registered before the failure resolvable', () => {
    const container = buildContainer()

    expect(container.resolve(dependencyKeys.global.CONFIG)).toBeDefined()
    expect(container.resolve(dependencyKeys.global.LOGGER)).toBeDefined()
    expect(container.resolve(dependencyKeys.global.CACHE)).toBeDefined()
    expect(container.resolve(dependencyKeys.global.USER_REPOSITORY)).toBeDefined()
  })

  it('still registers the auth and analytics tokens that follow billing setup', () => {
    const container = buildContainer()

    expect(container.resolve(dependencyKeys.global.AUTH)).toBeDefined()
    expect(container.resolve(dependencyKeys.global.ANALYTICS)).toBeDefined()
  })
})
