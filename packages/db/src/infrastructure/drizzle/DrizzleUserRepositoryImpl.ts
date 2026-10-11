import { eq } from 'drizzle-orm'
import { UserRepository } from '../../entities/ports/UserRepository.ts'
import { type UserRow, users } from '../../entities/schemas/users.ts'
import type { CreateUserInput, UpdateUserInput, User } from '../../entities/types/User.ts'
import type { DrizzleDbClientImpl } from './DrizzleDbClientImpl.ts'

/**
 * Drizzle-backed `UserRepository` impl. Depends on
 * {@link DrizzleDbClientImpl} — the same port + pool — rather than
 * re-implementing connection handling.
 *
 * All reads/writes flow through Drizzle's query builder; raw SQL is
 * intentionally avoided here so the port is driver-portable.
 */
export class DrizzleUserRepositoryImpl extends UserRepository {
  constructor(private readonly client: DrizzleDbClientImpl) {
    super()
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.client.getDrizzle().select().from(users).where(eq(users.id, id)).limit(1)
    return row[0] ? toDomain(row[0]) : null
  }

  async findByClerkUserId(clerkUserId: string): Promise<User | null> {
    const row = await this.client
      .getDrizzle()
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1)
    return row[0] ? toDomain(row[0]) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.client
      .getDrizzle()
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    return row[0] ? toDomain(row[0]) : null
  }

  async create(input: CreateUserInput): Promise<User> {
    const [row] = await this.client
      .getDrizzle()
      .insert(users)
      .values({
        clerkUserId: input.clerkUserId,
        email: input.email,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
      })
      .returning()
    if (!row) throw new Error('DrizzleUserRepositoryImpl: insert returned no row')
    return toDomain(row)
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const [row] = await this.client
      .getDrizzle()
      .update(users)
      .set({
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()
    if (!row) {
      throw new Error(`DrizzleUserRepositoryImpl: no user with id '${id}'`)
    }
    return toDomain(row)
  }

  async delete(id: string): Promise<void> {
    await this.client.getDrizzle().delete(users).where(eq(users.id, id))
  }
}

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
