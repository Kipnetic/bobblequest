import { z } from 'zod'
import { requireInternalUserId } from '../lib/auth/internalUser'
import { protectedProcedure, publicProcedure, router } from '../trpc'

/**
 * Auth-facing tRPC procedures.
 *
 * Identity (tokens, sessions, password lifecycle) is owned by Clerk — this
 * router only exposes views over `ctx.user` (Clerk session projection) and
 * mirrors profile edits down to the app-side `users` table.
 */
export const authRouter = router({
  /**
   * Returns the current Clerk session projection (id, role, email), or null
   * for unauthenticated requests.
   */
  me: publicProcedure.query(({ ctx }) => {
    return ctx.user
  }),

  /** Update the current user's profile metadata. */
  updateProfile: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // `ctx.userId` is the Clerk id; `update` keys on the internal uuid.
      return ctx.userRepository.update(await requireInternalUserId(ctx), input)
    }),
})
