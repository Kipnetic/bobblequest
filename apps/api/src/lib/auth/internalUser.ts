import type { UserRepository } from '@t/db'
import { TRPCError } from '@trpc/server'

/**
 * Minimal slice of the tRPC context needed to resolve the app-side user.
 * Kept structural so routers can pass `ctx` directly and unit tests can
 * pass a small stub.
 */
export interface InternalUserContext {
  userRepository: UserRepository
  /** Clerk user id (`user_xxx`) from the verified session. */
  userId: string
}

/**
 * Resolve the INTERNAL `users.id` (UUID primary key) for the session's
 * Clerk identity.
 *
 * `UserRepository.update` / `delete` key on that UUID, never on the raw
 * Clerk `user_xxx` id. The row is mirrored by the Clerk `user.created`
 * webhook; until it lands the caller gets NOT_FOUND rather than a write
 * against the wrong key.
 */
export async function requireInternalUserId(ctx: InternalUserContext): Promise<string> {
  const user = await ctx.userRepository.findByClerkUserId(ctx.userId)
  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User profile not found' })
  }
  return user.id
}
