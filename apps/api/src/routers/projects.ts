import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { requireInternalUserId } from '../lib/auth/internalUser'
import { protectedProcedure, router } from '../trpc'

/**
 * Projects router: CRUD over the session user's own projects.
 *
 * `projects.owner_id` is a uuid foreign key to `users.id`, so every read,
 * write and ownership check uses the INTERNAL user id resolved from the
 * session's Clerk id (`requireInternalUserId`), never `ctx.userId` itself.
 * A caller whose Clerk user has not been mirrored into `users` yet gets
 * NOT_FOUND. Projects owned by someone else are reported as NOT_FOUND too,
 * so their existence does not leak.
 */
export const projectsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(10),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.projectRepository.findByOwnerId(await requireInternalUserId(ctx), input)
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ownerId = await requireInternalUserId(ctx)
      const project = await ctx.projectRepository.findById(input.id)
      if (!project || project.ownerId !== ownerId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        })
      }
      return project
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.projectRepository.create({
        ...input,
        ownerId: await requireInternalUserId(ctx),
      })
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        status: z.enum(['active', 'archived', 'deleted']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerId = await requireInternalUserId(ctx)
      const project = await ctx.projectRepository.findById(input.id)
      if (!project || project.ownerId !== ownerId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        })
      }

      const { id, ...updateData } = input
      return ctx.projectRepository.update(id, updateData)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = await requireInternalUserId(ctx)
      const project = await ctx.projectRepository.findById(input.id)
      if (!project || project.ownerId !== ownerId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        })
      }
      return ctx.projectRepository.delete(input.id)
    }),
})
