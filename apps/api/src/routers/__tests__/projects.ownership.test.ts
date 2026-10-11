/**
 * Projects ownership over real HTTP.
 *
 * `projects.owner_id` is a uuid foreign key to `users.id` (migration 0001).
 * The router used to store and compare the Clerk id (`user_xxx`), which
 * Postgres rejects for a uuid column, and which never equals the owner's
 * internal id. Every procedure must key on the internal `users.id` resolved
 * from the session.
 *
 * Auth: NoopAuthProvider resolves any non-empty Bearer token to `user_noop`.
 */

import type { InMemoryProjectRepository, InMemoryUserRepository } from '@t/db'
import { dependencyKeys } from '@t/dependency-injection'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, signedFetch } from '../../__tests__/integration/setup'
import type { TestApp } from '../../__tests__/integration/setup'

const NOOP_CLERK_ID = 'user_noop'

type Project = { id: string; name: string; ownerId: string }

function repos(testApp: TestApp) {
  return {
    users: testApp.container.resolve<InMemoryUserRepository>(dependencyKeys.global.USER_REPOSITORY),
    projects: testApp.container.resolve<InMemoryProjectRepository>(
      dependencyKeys.global.PROJECT_REPOSITORY,
    ),
  }
}

function query(testApp: TestApp, procedure: string, input: unknown): Promise<Response> {
  return signedFetch(testApp.app, {
    path: `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
  })
}

function mutate(testApp: TestApp, procedure: string, input: unknown): Promise<Response> {
  return signedFetch(testApp.app, { method: 'POST', path: `/trpc/${procedure}`, body: input })
}

async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { result: { data: T } }).result.data
}

async function errorCode(res: Response): Promise<string | null> {
  const body = (await res.json()) as { error?: { data?: { code?: string } } }
  return body.error?.data?.code ?? null
}

describe('projects: owned by the internal users.id', () => {
  let testApp: TestApp
  let internalId: string
  let otherInternalId: string

  beforeEach(async () => {
    testApp = buildTestApp()
    const { users, projects } = repos(testApp)
    users.clear()
    projects.clear()
    internalId = (await users.create({ clerkUserId: NOOP_CLERK_ID, email: 'noop@example.com' })).id
    otherInternalId = (
      await users.create({ clerkUserId: 'user_other', email: 'other@example.com' })
    ).id
  })

  it('create stores the internal uuid as ownerId, not the Clerk id', async () => {
    const res = await mutate(testApp, 'projects.create', { name: 'Roadmap' })

    expect(res.status).toBe(200)
    const created = await data<Project>(res)
    expect(created.ownerId).toBe(internalId)
    expect((await repos(testApp).projects.findById(created.id))?.ownerId).toBe(internalId)
  })

  it('list returns the projects owned by the internal id and no others', async () => {
    const { projects } = repos(testApp)
    const mine = await projects.create({ name: 'Mine', ownerId: internalId })
    await projects.create({ name: 'Theirs', ownerId: otherInternalId })

    const res = await query(testApp, 'projects.list', { limit: 10, offset: 0 })

    expect(res.status).toBe(200)
    expect((await data<Project[]>(res)).map((p) => p.id)).toEqual([mine.id])
  })

  it('getById, update and delete accept the caller own project', async () => {
    const project = await repos(testApp).projects.create({ name: 'Mine', ownerId: internalId })

    const get = await query(testApp, 'projects.getById', { id: project.id })
    expect(get.status).toBe(200)

    const update = await mutate(testApp, 'projects.update', { id: project.id, name: 'Renamed' })
    expect(update.status).toBe(200)
    expect((await data<Project>(update)).name).toBe('Renamed')

    const del = await mutate(testApp, 'projects.delete', { id: project.id })
    expect(del.status).toBe(200)
    expect(await repos(testApp).projects.findById(project.id)).toBeNull()
  })

  it.each([
    ['projects.getById', 'query'],
    ['projects.update', 'mutate'],
    ['projects.delete', 'mutate'],
  ] as const)('%s reports another user project as NOT_FOUND', async (procedure, kind) => {
    const theirs = await repos(testApp).projects.create({
      name: 'Theirs',
      ownerId: otherInternalId,
    })
    const input = procedure === 'projects.update' ? { id: theirs.id, name: 'x' } : { id: theirs.id }

    const res =
      kind === 'query'
        ? await query(testApp, procedure, input)
        : await mutate(testApp, procedure, input)

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
    expect((await repos(testApp).projects.findById(theirs.id))?.name).toBe('Theirs')
  })

  it('a session whose user row is not mirrored yet gets NOT_FOUND and creates nothing', async () => {
    repos(testApp).users.clear()

    const res = await mutate(testApp, 'projects.create', { name: 'Orphan' })

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
    expect(await repos(testApp).projects.list({ limit: 10, offset: 0 })).toEqual([])
  })
})
