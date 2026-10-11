import type { User } from '../types/User.ts'
import type { CreateUserInput, UpdateUserInput } from '../types/User.ts'

/**
 * Abstract repository port for the `users` table.
 *
 * Maps cleanly onto the Clerk-mirrored user record: each app user has a
 * `clerkUserId` that links back to the identity owned by Clerk. All
 * authentication state (password hashes, sessions, MFA factors) lives
 * in Clerk, never here.
 *
 * Implementations:
 *   - `DrizzleUserRepositoryImpl` — postgres-js + Drizzle over the
 *     Railway Postgres pool bound by `registerDbDI`.
 *   - `InMemoryUserRepository` — Map-backed test double.
 *
 * Consumers (routers, webhook handlers, workers) depend ONLY on this
 * abstract class.
 */
export abstract class UserRepository {
  /** Find a user by their internal app id (UUID primary key). */
  abstract findById(id: string): Promise<User | null>

  /** Find a user by the Clerk identity id (`user_xxx`). */
  abstract findByClerkUserId(clerkUserId: string): Promise<User | null>

  /** Find a user by email (case-insensitive). */
  abstract findByEmail(email: string): Promise<User | null>

  /**
   * Create a new user row. Called by the `POST /webhooks/clerk`
   * handler on `user.created`. Throws on unique-constraint violations
   * (email / clerkUserId collisions).
   */
  abstract create(input: CreateUserInput): Promise<User>

  /**
   * Partial update by internal id. Returns the updated row. Throws if
   * the row does not exist so callers don't silently no-op.
   */
  abstract update(id: string, input: UpdateUserInput): Promise<User>

  /**
   * Delete by internal id. Idempotent — deleting an absent row is not
   * an error. Called by the Clerk webhook on `user.deleted`.
   */
  abstract delete(id: string): Promise<void>

  // No `list`: the table has no tenant column, so any listing would expose
  // every user's email.
}
