import { UserRepository } from '../../entities/ports/UserRepository.ts'
import type { CreateUserInput, UpdateUserInput, User } from '../../entities/types/User.ts'

/**
 * In-memory `UserRepository` used for unit tests and local dev without
 * a live Postgres. Storage is a single `Map<id, User>`; secondary
 * indexes are rebuilt on every lookup so the behaviour mirrors the
 * Drizzle impl (no caching surprises).
 *
 * Not thread-safe across workers — single-process Map.
 */
export class InMemoryUserRepository extends UserRepository {
  private readonly store = new Map<string, User>()

  async findById(id: string): Promise<User | null> {
    return this.store.get(id) ?? null
  }

  async findByClerkUserId(clerkUserId: string): Promise<User | null> {
    for (const user of this.store.values()) {
      if (user.clerkUserId === clerkUserId) return user
    }
    return null
  }

  async findByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase()
    for (const user of this.store.values()) {
      if (user.email.toLowerCase() === target) return user
    }
    return null
  }

  async create(input: CreateUserInput): Promise<User> {
    // Mirror Drizzle unique-constraint behaviour — reject duplicate clerk id.
    const existing = await this.findByClerkUserId(input.clerkUserId)
    if (existing) {
      throw new Error(`InMemoryUserRepository: duplicate clerk_user_id '${input.clerkUserId}'`)
    }
    const now = new Date()
    const user: User = {
      id: cryptoRandomUuid(),
      clerkUserId: input.clerkUserId,
      email: input.email,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(user.id, user)
    return user
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const existing = this.store.get(id)
    if (!existing) {
      throw new Error(`InMemoryUserRepository: no user with id '${id}'`)
    }
    const next: User = {
      ...existing,
      email: input.email ?? existing.email,
      displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing.avatarUrl,
      updatedAt: new Date(),
    }
    this.store.set(id, next)
    return next
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }

  /** Test helper: empty the store between cases. */
  clear(): void {
    this.store.clear()
  }
}

function cryptoRandomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Extremely unlikely fallback — kept so the test double never throws
  // on platforms that somehow lack webcrypto.
  return `inmem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
