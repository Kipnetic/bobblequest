/**
 * Users integration tests: tenant isolation and profile writes over real HTTP.
 *
 *  1. `users.list` no longer exists. It was a publicProcedure over an
 *     unfiltered users query and the `users` table has no tenant column to
 *     scope by, so anonymous and authenticated callers must both get
 *     NOT_FOUND and no user data.
 *  2. `auth.updateProfile` / `users.update` must write the session user's row.
 *     They used to pass the Clerk id (`user_xxx`) to `UserRepository.update`,
 *     which matches on the internal `users.id` uuid, so every call failed.
 *
 * Auth: NoopAuthProvider resolves any non-empty Bearer token to `user_noop`.
 */

import type { InMemoryUserRepository } from '@t/db'
import { dependencyKeys } from '@t/dependency-injection'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, signedFetch } from '../../__tests__/integration/setup'
import type { TestApp } from '../../__tests__/integration/setup'

const NOOP_CLERK_ID = 'user_noop'
const OTHER_TENANT_EMAIL = 'victim@other-tenant.example'

function userRepo(testApp: TestApp): InMemoryUserRepository {
  return testApp.container.resolve<InMemoryUserRepository>(dependencyKeys.global.USER_REPOSITORY)
}

async function trpcErrorCode(res: Response): Promise<string | null> {
  const body = (await res.json()) as { error?: { data?: { code?: string } } }
  return body.error?.data?.code ?? null
}

describe('users.list: cross-tenant enumeration is closed', () => {
  let testApp: TestApp

  beforeEach(async () => {
    testApp = buildTestApp()
    const repo = userRepo(testApp)
    repo.clear()
    await repo.create({ clerkUserId: NOOP_CLERK_ID, email: 'noop@example.com' })
    await repo.create({ clerkUserId: 'user_other_tenant', email: OTHER_TENANT_EMAIL })
  })

  it('rejects an anonymous caller and leaks no user rows', async () => {
    const res = await testApp.app.request('/trpc/users.list', { method: 'GET' })
    const text = await res.clone().text()
    expect(res.status).toBe(404)
    expect(await trpcErrorCode(res)).toBe('NOT_FOUND')
    expect(text).not.toContain(OTHER_TENANT_EMAIL)
  })

  it('does not let an authenticated caller read other users', async () => {
    const res = await signedFetch(testApp.app, { path: '/trpc/users.list' })
    const text = await res.clone().text()
    expect(res.status).toBe(404)
    expect(await trpcErrorCode(res)).toBe('NOT_FOUND')
    expect(text).not.toContain(OTHER_TENANT_EMAIL)
  })
})

describe.each([
  ['auth.updateProfile'],
  ['users.update'],
])('%s: writes the session user row', (procedure) => {
  let testApp: TestApp

  beforeEach(() => {
    testApp = buildTestApp()
    userRepo(testApp).clear()
  })

  it('updates the existing row matched by Clerk id and no other row', async () => {
    const repo = userRepo(testApp)
    const seeded = await repo.create({ clerkUserId: NOOP_CLERK_ID, email: 'noop@example.com' })
    const other = await repo.create({ clerkUserId: 'user_other', email: OTHER_TENANT_EMAIL })

    const res = await signedFetch(testApp.app, {
      method: 'POST',
      path: `/trpc/${procedure}`,
      body: { displayName: 'Alice' },
    })

    expect(res.status).toBe(200)
    expect((await repo.findById(seeded.id))?.displayName).toBe('Alice')
    expect((await repo.findById(other.id))?.displayName).toBeNull()
  })

  it('returns NOT_FOUND when the Clerk webhook has not mirrored the user yet', async () => {
    const res = await signedFetch(testApp.app, {
      method: 'POST',
      path: `/trpc/${procedure}`,
      body: { displayName: 'Alice' },
    })

    expect(res.status).toBe(404)
    expect(await trpcErrorCode(res)).toBe('NOT_FOUND')
    expect(await userRepo(testApp).findByClerkUserId(NOOP_CLERK_ID)).toBeNull()
  })
})
