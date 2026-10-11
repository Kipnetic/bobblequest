import { describe, expect, it, vi } from 'vitest'
import { UserRepository } from '../../src/entities/ports/UserRepository.ts'
import type { DrizzleDbClientImpl } from '../../src/infrastructure/drizzle/DrizzleDbClientImpl.ts'
import { DrizzleUserRepositoryImpl } from '../../src/infrastructure/drizzle/DrizzleUserRepositoryImpl.ts'

// ---------------------------------------------------------------------------
// Fake query builder chain
// ---------------------------------------------------------------------------

function makeUserRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u-1',
    clerkUserId: 'clerk_u1',
    email: 'u1@example.com',
    displayName: 'User One',
    avatarUrl: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeDrizzleMock(returnRows: unknown[]) {
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }

  // select chain: .select().from().where().limit()
  // limit() is thenable so the find* reads resolve on it.
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      const limitResult = {}
      Object.defineProperty(limitResult, 'then', {
        value: (resolve: (v: unknown[]) => unknown) => resolve(returnRows),
      })
      return limitResult
    }),
  }
  chain.select.mockReturnValue(selectChain)

  // insert chain: .insert().values().returning()
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returnRows),
  }
  chain.insert.mockReturnValue(insertChain)

  // update chain: .update().set().where().returning()
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returnRows),
  }
  chain.update.mockReturnValue(updateChain)

  // delete chain: .delete().where()
  const deleteChain = {
    where: vi.fn().mockResolvedValue(undefined),
  }
  chain.delete.mockReturnValue(deleteChain)

  return chain
}

function makeClient(rows: unknown[]) {
  const drizzleMock = makeDrizzleMock(rows)
  const client = {
    getDrizzle: vi.fn().mockReturnValue(drizzleMock),
  } as unknown as DrizzleDbClientImpl
  return { client, drizzleMock }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleUserRepositoryImpl', () => {
  it('is an instance of UserRepository port', () => {
    const { client } = makeClient([])
    expect(new DrizzleUserRepositoryImpl(client)).toBeInstanceOf(UserRepository)
  })

  it('findById returns null when no row found', async () => {
    const { client } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    expect(await repo.findById('missing')).toBeNull()
  })

  it('findById returns mapped user when row found', async () => {
    const row = makeUserRow()
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.findById('u-1')
    expect(user?.id).toBe('u-1')
    expect(user?.clerkUserId).toBe('clerk_u1')
    expect(user?.email).toBe('u1@example.com')
    expect(user?.displayName).toBe('User One')
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('findByClerkUserId returns null when no row found', async () => {
    const { client } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    expect(await repo.findByClerkUserId('no-such')).toBeNull()
  })

  it('findByClerkUserId returns mapped user when found', async () => {
    const row = makeUserRow()
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.findByClerkUserId('clerk_u1')
    expect(user?.clerkUserId).toBe('clerk_u1')
  })

  it('findByEmail returns null when no row found', async () => {
    const { client } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    expect(await repo.findByEmail('nobody@example.com')).toBeNull()
  })

  it('findByEmail returns mapped user when found', async () => {
    const row = makeUserRow()
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.findByEmail('u1@example.com')
    expect(user?.email).toBe('u1@example.com')
  })

  it('create returns mapped user from insert returning', async () => {
    const row = makeUserRow()
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.create({
      clerkUserId: 'clerk_u1',
      email: 'u1@example.com',
      displayName: 'User One',
    })
    expect(user.id).toBe('u-1')
  })

  it('create throws when insert returns no row', async () => {
    const { client } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    await expect(repo.create({ clerkUserId: 'c', email: 'e@e.com' })).rejects.toThrow(
      /insert returned no row/,
    )
  })

  it('update returns mapped user from update returning', async () => {
    const row = makeUserRow({ email: 'new@example.com' })
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.update('u-1', { email: 'new@example.com' })
    expect(user.email).toBe('new@example.com')
  })

  it('update throws when no row returned (user not found)', async () => {
    const { client } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    await expect(repo.update('no-id', { email: 'x@x.com' })).rejects.toThrow(/no user with id/)
  })

  it('update with displayName and avatarUrl includes them in SET clause', async () => {
    const row = makeUserRow({ displayName: 'New Name', avatarUrl: 'https://example.com/a.png' })
    const { client } = makeClient([row])
    const repo = new DrizzleUserRepositoryImpl(client)
    const user = await repo.update('u-1', {
      displayName: 'New Name',
      avatarUrl: 'https://example.com/a.png',
    })
    expect(user.displayName).toBe('New Name')
    expect(user.avatarUrl).toBe('https://example.com/a.png')
  })

  it('delete calls delete().where() without throwing', async () => {
    const { client, drizzleMock } = makeClient([])
    const repo = new DrizzleUserRepositoryImpl(client)
    await expect(repo.delete('u-1')).resolves.toBeUndefined()
    expect(drizzleMock.delete).toHaveBeenCalled()
  })
})
