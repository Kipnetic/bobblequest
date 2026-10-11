import type { User, UserRepository } from '@t/db'
import { TRPCError } from '@trpc/server'
import { describe, expect, it, vi } from 'vitest'
import { requireInternalUserId } from '../internalUser'

const CLERK_ID = 'user_clerk_abc'
const INTERNAL_ID = '99999999-9999-4999-8999-999999999999'

const mirrored: User = {
  id: INTERNAL_ID,
  clerkUserId: CLERK_ID,
  email: 'rep@example.com',
  displayName: null,
  avatarUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function makeRepo(found: User | null): UserRepository {
  return {
    findByClerkUserId: vi.fn().mockResolvedValue(found),
    create: vi.fn(),
  } as unknown as UserRepository
}

describe('requireInternalUserId', () => {
  it('returns the internal uuid for the session Clerk id', async () => {
    const userRepository = makeRepo(mirrored)
    await expect(requireInternalUserId({ userRepository, userId: CLERK_ID })).resolves.toBe(
      INTERNAL_ID,
    )
    expect(userRepository.findByClerkUserId).toHaveBeenCalledWith(CLERK_ID)
  })

  it('throws NOT_FOUND and creates nothing when the user is not mirrored yet', async () => {
    const userRepository = makeRepo(null)
    const result = requireInternalUserId({ userRepository, userId: CLERK_ID })
    await expect(result).rejects.toBeInstanceOf(TRPCError)
    await expect(result).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(userRepository.create).not.toHaveBeenCalled()
  })
})
