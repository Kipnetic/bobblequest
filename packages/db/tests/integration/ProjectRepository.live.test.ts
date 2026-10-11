import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleDbClientImpl } from '../../src/infrastructure/drizzle/DrizzleDbClientImpl.ts'
import { DrizzleProjectRepositoryImpl } from '../../src/infrastructure/drizzle/DrizzleProjectRepositoryImpl.ts'
import { DrizzleUserRepositoryImpl } from '../../src/infrastructure/drizzle/DrizzleUserRepositoryImpl.ts'
import {
  closeTestClient,
  getTestClient,
  isDbAvailable,
  runMigrations,
  truncateTables,
} from './setup.ts'

const available = await isDbAvailable()

/**
 * projects.owner_id is a uuid foreign key to users.id (migration 0001). These
 * run the repository against real Postgres so the column type and the
 * constraint are exercised, not just the in-memory double.
 */
describe.skipIf(!available)('DrizzleProjectRepositoryImpl (live Postgres)', () => {
  let projects: DrizzleProjectRepositoryImpl
  let users: DrizzleUserRepositoryImpl

  beforeAll(async () => {
    const sql = await getTestClient()
    await runMigrations(sql)
    const client = new DrizzleDbClientImpl({ client: sql })
    projects = new DrizzleProjectRepositoryImpl(client)
    users = new DrizzleUserRepositoryImpl(client)
  })

  beforeEach(async () => {
    await truncateTables(await getTestClient())
  })

  afterAll(async () => {
    await closeTestClient()
  })

  it('stores a project owned by an internal users.id and lists it by owner', async () => {
    const owner = await users.create({ clerkUserId: 'user_owner', email: 'owner@example.com' })
    const created = await projects.create({ name: 'Roadmap', ownerId: owner.id })

    expect(created.ownerId).toBe(owner.id)
    const listed = await projects.findByOwnerId(owner.id, { limit: 10, offset: 0 })
    expect(listed.map((p) => p.id)).toEqual([created.id])
  })

  it('rejects a Clerk id as the owner (owner_id is a uuid)', async () => {
    await expect(projects.create({ name: 'Bad', ownerId: 'user_owner' })).rejects.toThrow()
  })

  it('rejects an owner uuid with no users row (foreign key)', async () => {
    await expect(
      projects.create({ name: 'Orphan', ownerId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow()
  })

  it('deletes the owner projects when the user is deleted (cascade)', async () => {
    const owner = await users.create({ clerkUserId: 'user_gone', email: 'gone@example.com' })
    const created = await projects.create({ name: 'Doomed', ownerId: owner.id })

    await users.delete(owner.id)

    expect(await projects.findById(created.id)).toBeNull()
  })
})
