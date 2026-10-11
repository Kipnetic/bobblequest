import { describe, expect, it, vi } from 'vitest'
import type { Context, SessionUser } from '../../trpc/context'
import { appRouter } from '../index'

const internalUserId = '11111111-1111-4111-8111-111111111111'

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    userId: null,
    user: null,
    req: new Request('http://localhost/trpc'),
    db: null,
    userRepository: {
      findByClerkUserId: vi
        .fn()
        .mockImplementation((clerkUserId) => Promise.resolve({ id: internalUserId, clerkUserId })),
      update: vi.fn().mockImplementation((id, data) => Promise.resolve({ userId: id, ...data })),
    } as unknown as Context['userRepository'],
    projectRepository: {
      findByOwnerId: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'proj_1', ...data })),
      update: vi.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as Context['projectRepository'],
    cache: {} as Context['cache'],
    queue: {} as Context['queue'],
    logger: {} as Context['logger'],
    auth: {} as Context['auth'],
    analytics: {} as Context['analytics'],
    requestAnalytics: {} as Context['requestAnalytics'],
    ...overrides,
  }
}

const mockUser: SessionUser = { id: 'user_1', email: 'user@example.com', role: 'user' }
const authedCtx = makeContext({ userId: mockUser.id, user: mockUser })

describe('auth router', () => {
  it('me returns null when unauthenticated', async () => {
    const caller = appRouter.createCaller(makeContext())
    const result = await caller.auth.me()
    expect(result).toBeNull()
  })

  it('me returns user when authenticated', async () => {
    const caller = appRouter.createCaller(authedCtx)
    const result = await caller.auth.me()
    expect(result?.id).toBe(mockUser.id)
  })

  it('updateProfile calls userRepository.update', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    const caller = appRouter.createCaller(ctx)
    await caller.auth.updateProfile({ displayName: 'Alice' })
    expect(ctx.userRepository.findByClerkUserId).toHaveBeenCalledWith(mockUser.id)
    expect(ctx.userRepository.update).toHaveBeenCalledWith(internalUserId, { displayName: 'Alice' })
  })
})

describe('users router', () => {
  it('update calls userRepository.update', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    const caller = appRouter.createCaller(ctx)
    await caller.users.update({ displayName: 'Bob' })
    expect(ctx.userRepository.findByClerkUserId).toHaveBeenCalledWith(mockUser.id)
    expect(ctx.userRepository.update).toHaveBeenCalledWith(internalUserId, { displayName: 'Bob' })
  })
})

describe('projects router', () => {
  const validId = '00000000-0000-0000-0000-000000000001'

  it('list calls projectRepository.findByOwnerId', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    const caller = appRouter.createCaller(ctx)
    await caller.projects.list({ limit: 10 })
    expect(ctx.projectRepository.findByOwnerId).toHaveBeenCalledWith(mockUser.id, {
      limit: 10,
      offset: 0,
    })
  })

  it('getById returns project if owned by user', async () => {
    const project = {
      id: validId,
      ownerId: mockUser.id,
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    const result = await caller.projects.getById({ id: validId })
    expect(result).toEqual(project)
  })

  it('getById throws NOT_FOUND if project not owned by user', async () => {
    const project = {
      id: validId,
      ownerId: 'other_user',
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    await expect(caller.projects.getById({ id: validId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('create calls projectRepository.create', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    const caller = appRouter.createCaller(ctx)
    await caller.projects.create({ name: 'New Proj' })
    expect(ctx.projectRepository.create).toHaveBeenCalledWith({
      name: 'New Proj',
      ownerId: mockUser.id,
    })
  })

  it('update throws NOT_FOUND when project not found', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(null)
    const caller = appRouter.createCaller(ctx)
    await expect(caller.projects.update({ id: validId, name: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('update throws NOT_FOUND when project owned by different user', async () => {
    const project = {
      id: validId,
      ownerId: 'other_user',
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    await expect(caller.projects.update({ id: validId, name: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('update calls projectRepository.update if owned', async () => {
    const project = {
      id: validId,
      ownerId: mockUser.id,
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    await caller.projects.update({ id: validId, name: 'Updated' })
    expect(ctx.projectRepository.update).toHaveBeenCalledWith(validId, { name: 'Updated' })
  })

  it('delete throws NOT_FOUND when project not found', async () => {
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(null)
    const caller = appRouter.createCaller(ctx)
    await expect(caller.projects.delete({ id: validId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('delete throws NOT_FOUND when project owned by different user', async () => {
    const project = {
      id: validId,
      ownerId: 'other_user',
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    await expect(caller.projects.delete({ id: validId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('delete calls projectRepository.delete if owned', async () => {
    const project = {
      id: validId,
      ownerId: mockUser.id,
      name: 'P1',
      description: null,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const ctx = makeContext({ userId: mockUser.id, user: mockUser })
    vi.mocked(ctx.projectRepository.findById).mockResolvedValue(project)
    const caller = appRouter.createCaller(ctx)
    await caller.projects.delete({ id: validId })
    expect(ctx.projectRepository.delete).toHaveBeenCalledWith(validId)
  })
})
