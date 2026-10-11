import { beforeEach, describe, expect, it } from 'vitest'
import { UserRepository } from '../../src/entities/ports/UserRepository.ts'
import { InMemoryUserRepository } from '../../src/infrastructure/in-memory/InMemoryUserRepository.ts'

describe('InMemoryUserRepository', () => {
  let repo: InMemoryUserRepository
  beforeEach(() => {
    repo = new InMemoryUserRepository()
  })

  it('is an instance of the UserRepository port', () => {
    expect(repo).toBeInstanceOf(UserRepository)
  })

  it('returns null for absent lookups', async () => {
    expect(await repo.findById('missing')).toBeNull()
    expect(await repo.findByClerkUserId('user_missing')).toBeNull()
    expect(await repo.findByEmail('nobody@example.com')).toBeNull()
  })

  it('creates a user and stamps server fields', async () => {
    const user = await repo.create({
      clerkUserId: 'user_abc',
      email: 'abc@example.com',
    })
    expect(user.id).toBeTypeOf('string')
    expect(user.id.length).toBeGreaterThan(0)
    expect(user.clerkUserId).toBe('user_abc')
    expect(user.email).toBe('abc@example.com')
    expect(user.displayName).toBeNull()
    expect(user.avatarUrl).toBeNull()
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.updatedAt).toBeInstanceOf(Date)
  })

  it('finds by id, clerkUserId, and case-insensitive email', async () => {
    const created = await repo.create({
      clerkUserId: 'user_find',
      email: 'Find.Me@Example.COM',
      displayName: 'Find Me',
    })
    expect(await repo.findById(created.id)).toEqual(created)
    expect(await repo.findByClerkUserId('user_find')).toEqual(created)
    expect(await repo.findByEmail('find.me@example.com')).toEqual(created)
  })

  it('skips non-matching rows when several users are stored', async () => {
    await repo.create({ clerkUserId: 'user_first', email: 'first@example.com' })
    const second = await repo.create({ clerkUserId: 'user_second', email: 'second@example.com' })
    expect((await repo.findByClerkUserId('user_second'))?.id).toBe(second.id)
    expect((await repo.findByEmail('SECOND@example.com'))?.id).toBe(second.id)
  })

  it('rejects duplicate clerkUserId on create', async () => {
    await repo.create({ clerkUserId: 'user_dup', email: 'a@example.com' })
    await expect(repo.create({ clerkUserId: 'user_dup', email: 'b@example.com' })).rejects.toThrow(
      /duplicate/i,
    )
  })

  it('updates mutable fields and bumps updatedAt', async () => {
    const created = await repo.create({
      clerkUserId: 'user_upd',
      email: 'orig@example.com',
      displayName: 'Orig',
    })
    await new Promise((r) => setTimeout(r, 2))
    const updated = await repo.update(created.id, {
      email: 'new@example.com',
      displayName: null,
    })
    expect(updated.id).toBe(created.id)
    expect(updated.email).toBe('new@example.com')
    expect(updated.displayName).toBeNull()
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
  })

  it('update throws when the row does not exist', async () => {
    await expect(repo.update('no-such-id', { email: 'x@y.z' })).rejects.toThrow(/no user/i)
  })

  it('delete is idempotent', async () => {
    const u = await repo.create({ clerkUserId: 'u1', email: 'u1@e.com' })
    await repo.delete(u.id)
    await repo.delete(u.id) // idempotent
    expect(await repo.findById(u.id)).toBeNull()
  })

  it('update preserves existing displayName and avatarUrl when not supplied', async () => {
    const created = await repo.create({
      clerkUserId: 'user_preserve',
      email: 'preserve@example.com',
      displayName: 'Original',
      avatarUrl: 'https://example.com/avatar.png',
    })
    const updated = await repo.update(created.id, { email: 'new@example.com' })
    expect(updated.displayName).toBe('Original')
    expect(updated.avatarUrl).toBe('https://example.com/avatar.png')
  })

  it('update sets displayName and avatarUrl when provided', async () => {
    const created = await repo.create({
      clerkUserId: 'user_setfields',
      email: 'setfields@example.com',
    })
    const updated = await repo.update(created.id, {
      displayName: 'New Name',
      avatarUrl: 'https://example.com/new.png',
    })
    expect(updated.displayName).toBe('New Name')
    expect(updated.avatarUrl).toBe('https://example.com/new.png')
  })

  it('clear() removes all users', async () => {
    await repo.create({ clerkUserId: 'user_clear', email: 'clear@example.com' })
    repo.clear()
    expect(await repo.findByClerkUserId('user_clear')).toBeNull()
  })

  it('update preserves email when not supplied in update input', async () => {
    const created = await repo.create({
      clerkUserId: 'user_noemail',
      email: 'noemail@example.com',
      displayName: 'No Email Update',
    })
    // Pass update without email — exercises the false branch of `input.email ?? existing.email`
    const updated = await repo.update(created.id, { displayName: 'Changed' })
    expect(updated.email).toBe('noemail@example.com')
    expect(updated.displayName).toBe('Changed')
  })

  it('create exercises crypto fallback when randomUUID is unavailable', async () => {
    const saved = globalThis.crypto
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      })
      const user = await repo.create({ clerkUserId: 'user_fallback', email: 'fb@example.com' })
      expect(user.id).toMatch(/^inmem-/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: saved,
        configurable: true,
        writable: true,
      })
    }
  })
})
