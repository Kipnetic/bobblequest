import { z } from 'zod'
import { requireInternalUserId } from '../lib/auth/internalUser'
import { protectedProcedure, router } from '../trpc'

/**
 * Users router: views and edits over the session user's own row only.
 *
 * There is deliberately no `list`: the `users` table carries no tenant
 * column, so any listing here would expose every user's email.
 */
export const usersRouter = router({
  me: protectedProcedure.query(({ ctx }) => {
    return ctx.user
  }),

  update: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // `ctx.userId` is the Clerk id; `update` keys on the internal uuid.
      return ctx.userRepository.update(await requireInternalUserId(ctx), input)
    }),
})
