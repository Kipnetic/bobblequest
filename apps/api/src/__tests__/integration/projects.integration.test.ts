/**
 * A5 — Projects CRUD integration tests.
 *
 * Uses the full Hono app (buildTestApp) with in-memory repos + NoopAuthProvider.
 * Auth: any non-empty Bearer token resolves to { id: 'user_noop', … }.
 * `projects.owner_id` is the INTERNAL `users.id`, so each suite mirrors two
 * users (the session's `user_noop` and another) and seeds projects by their
 * internal ids; projects owned by the other user must stay unreachable.
 *
 * tRPC HTTP shape (this server, @hono/trpc-server):
 *   Query   → GET  /trpc/<procedure>?input=<URLEncoded {"json": <input>}>
 *             Response: {"result":{"data":<value>}} or {"error":{...}}
 *   Mutation → POST /trpc/<procedure>  Content-Type: application/json
 *             Body: plain JSON (NOT wrapped in {"json":...})
 *             Response: {"result":{"data":<value>}} or {"error":{...}}
 *   Error envelope: {"error":{"message":"...","data":{"code":"<TRPC_CODE>","httpStatus":N,...}}}
 */

import type { InMemoryProjectRepository, InMemoryUserRepository } from '@t/db'
import { dependencyKeys } from '@t/dependency-injection'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, signedFetch } from './setup.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a tRPC query input as the ?input= query-string value. */
function trpcInput(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value))
}

/** Perform a tRPC query (GET). */
async function trpcQuery(
  app: ReturnType<typeof buildTestApp>['app'],
  procedure: string,
  input: unknown,
  token?: string,
): Promise<Response> {
  return signedFetch(app, {
    method: 'GET',
    path: `/trpc/${procedure}?input=${trpcInput(input)}`,
    token: token ?? 'user-a-token',
  })
}

/** Perform a tRPC mutation (POST). Body is sent as plain JSON (server-side tRPC HTTP). */
async function trpcMutation(
  app: ReturnType<typeof buildTestApp>['app'],
  procedure: string,
  input: unknown,
  token?: string,
): Promise<Response> {
  return signedFetch(app, {
    method: 'POST',
    path: `/trpc/${procedure}`,
    body: input,
    token: token ?? 'user-a-token',
  })
}

/** Parse the tRPC success envelope and return the result data. */
async function trpcData(res: Response): Promise<unknown> {
  const envelope = (await res.json()) as { result?: { data?: unknown } }
  return envelope?.result?.data
}

/** Parse the tRPC error envelope and return the tRPC code. */
async function trpcErrCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as {
    error?: { data?: { code?: string } }
  }
  return body?.error?.data?.code
}

// ---------------------------------------------------------------------------
// Fixture: internal ids of the session user (Clerk `user_noop`, the
// NoopAuthProvider stub) and of another user, mirrored per test.
// ---------------------------------------------------------------------------
let AUTHED_USER_ID: string
let OTHER_USER_ID: string

async function seedUsers(testApp: ReturnType<typeof buildTestApp>): Promise<void> {
  const users = testApp.container.resolve<InMemoryUserRepository>(
    dependencyKeys.global.USER_REPOSITORY,
  )
  users.clear()
  AUTHED_USER_ID = (await users.create({ clerkUserId: 'user_noop', email: 'noop@example.com' })).id
  OTHER_USER_ID = (await users.create({ clerkUserId: 'user_other', email: 'other@example.com' })).id
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('projects.list', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('returns empty array when authenticated user has no projects', async () => {
    const res = await trpcQuery(testApp.app, 'projects.list', { limit: 10, offset: 0 })
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data).toEqual([])
  })

  it('only returns projects owned by the authenticated user (cross-tenant isolation)', async () => {
    const ownedProject = await projectRepo.create({ name: 'My Project', ownerId: AUTHED_USER_ID })
    // Seed a project for another user — must NOT appear in the authed user's list
    await projectRepo.create({ name: 'Other Project', ownerId: OTHER_USER_ID })

    const res = await trpcQuery(testApp.app, 'projects.list', { limit: 10, offset: 0 })
    expect(res.status).toBe(200)
    const data = (await trpcData(res)) as Array<{ id: string }>
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(ownedProject.id)
  })
})

describe('projects.create', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('creates a project and returns 200 with the created entity', async () => {
    const res = await trpcMutation(testApp.app, 'projects.create', {
      name: 'New Project',
      description: 'A test project',
    })
    expect(res.status).toBe(200)
    const data = (await trpcData(res)) as { id: string; name: string; ownerId: string }
    expect(data.name).toBe('New Project')
    expect(data.ownerId).toBe(AUTHED_USER_ID)
    expect(typeof data.id).toBe('string')
  })

  it('created project appears in subsequent list', async () => {
    await trpcMutation(testApp.app, 'projects.create', { name: 'Listed Project' })

    const res = await trpcQuery(testApp.app, 'projects.list', { limit: 10, offset: 0 })
    const data = (await trpcData(res)) as Array<{ name: string }>
    expect(data.some((p) => p.name === 'Listed Project')).toBe(true)
  })
})

describe('projects.update', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('updates an owned project and returns 200 with updated shape', async () => {
    const project = await projectRepo.create({ name: 'Old Name', ownerId: AUTHED_USER_ID })

    const res = await trpcMutation(testApp.app, 'projects.update', {
      id: project.id,
      name: 'New Name',
    })
    expect(res.status).toBe(200)
    const data = (await trpcData(res)) as { id: string; name: string }
    expect(data.name).toBe('New Name')
    expect(data.id).toBe(project.id)
  })

  it('returns NOT_FOUND when user B tries to update user A project', async () => {
    const project = await projectRepo.create({ name: 'Other Project', ownerId: OTHER_USER_ID })

    const res = await trpcMutation(testApp.app, 'projects.update', {
      id: project.id,
      name: 'Hijacked',
    })
    const code = await trpcErrCode(res)
    expect(code).toBe('NOT_FOUND')
  })
})

describe('projects.delete', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('deletes an owned project; subsequent getById returns NOT_FOUND', async () => {
    const project = await projectRepo.create({ name: 'To Delete', ownerId: AUTHED_USER_ID })

    const delRes = await trpcMutation(testApp.app, 'projects.delete', { id: project.id })
    expect(delRes.status).toBe(200)

    const getRes = await trpcQuery(testApp.app, 'projects.getById', { id: project.id })
    const code = await trpcErrCode(getRes)
    expect(code).toBe('NOT_FOUND')
  })

  it('returns NOT_FOUND when user B tries to delete user A project', async () => {
    const project = await projectRepo.create({ name: 'Other Project', ownerId: OTHER_USER_ID })

    const res = await trpcMutation(testApp.app, 'projects.delete', { id: project.id })
    const code = await trpcErrCode(res)
    expect(code).toBe('NOT_FOUND')
  })
})

describe('projects.getById — 404 vs NOT_FOUND disambiguation', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('returns NOT_FOUND for a genuinely nonexistent UUID', async () => {
    const res = await trpcQuery(testApp.app, 'projects.getById', {
      id: '00000000-0000-0000-0000-000000000000',
    })
    const code = await trpcErrCode(res)
    expect(code).toBe('NOT_FOUND')
  })

  it('returns NOT_FOUND (not FORBIDDEN) for an existing project owned by another user', async () => {
    // Security boundary: the router deliberately collapses both cases into
    // NOT_FOUND to avoid leaking existence of other users' resources.
    const project = await projectRepo.create({ name: 'Secret Project', ownerId: OTHER_USER_ID })

    const res = await trpcQuery(testApp.app, 'projects.getById', { id: project.id })
    const code = await trpcErrCode(res)
    // Must be NOT_FOUND, never FORBIDDEN — existence must not leak.
    expect(code).toBe('NOT_FOUND')
    expect(code).not.toBe('FORBIDDEN')
  })
})

describe('projects.create — input validation', () => {
  let testApp: ReturnType<typeof buildTestApp>
  let projectRepo: InMemoryProjectRepository

  beforeEach(async () => {
    testApp = buildTestApp()
    projectRepo = testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    )
    projectRepo.clear()
    await seedUsers(testApp)
  })

  it('rejects missing required name with BAD_REQUEST', async () => {
    const res = await trpcMutation(testApp.app, 'projects.create', {
      description: 'no name field',
    })
    const code = await trpcErrCode(res)
    expect(code).toBe('BAD_REQUEST')
  })

  it('rejects empty string name with BAD_REQUEST', async () => {
    const res = await trpcMutation(testApp.app, 'projects.create', { name: '' })
    const code = await trpcErrCode(res)
    expect(code).toBe('BAD_REQUEST')
  })
})

describe('authentication — 401 before reaching handler', () => {
  let testApp: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    testApp = buildTestApp()
  })

  it('rejects list query with no Authorization header (UNAUTHORIZED)', async () => {
    const res = await testApp.app.request(
      `/trpc/projects.list?input=${trpcInput({ limit: 10, offset: 0 })}`,
      { method: 'GET' },
    )
    const code = await trpcErrCode(res)
    expect(code).toBe('UNAUTHORIZED')
  })

  it('rejects create mutation with no Authorization header (UNAUTHORIZED)', async () => {
    const res = await testApp.app.request('/trpc/projects.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost Project' }),
    })
    const code = await trpcErrCode(res)
    expect(code).toBe('UNAUTHORIZED')
  })
})
