import type { AwilixContainer } from '@t/dependency-injection'
/**
 * Tests the clerk webhook handler body paths (user.created, user.updated,
 * user.deleted, unhandled event ignore) by mocking svix verification.
 *
 * Also covers the new DI-wired repo/auth calls, error-path 500 returns,
 * and logger invocations introduced in the factory refactor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock svix before importing the clerk module.
// Must use a regular function (not arrow function) because `new Webhook(...)` is called as a constructor.
vi.mock('svix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svix')>()),
  // biome-ignore lint/complexity/useArrowFunction: constructor mock — arrow functions cannot be used with `new`
  Webhook: vi.fn().mockImplementation(function () {
    return {
      verify: vi.fn((payload: string) => JSON.parse(payload)),
    }
  }),
}))

// Import after the mock is established
const { createClerkWebhookApp } = await import('../clerk')

const SVIX_HEADERS = {
  'svix-id': 'msg_1',
  'svix-timestamp': '1700000000',
  'svix-signature': 'v1,mock_sig',
}

// ---------------------------------------------------------------------------
// Stub container factory
// ---------------------------------------------------------------------------

type StubUserRepo = {
  create: ReturnType<typeof vi.fn>
  findByClerkUserId: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

type StubAuth = {
  syncFromWebhook: ReturnType<typeof vi.fn>
}

type StubLogger = {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

function makeStubs(
  overrides: {
    userRepository?: Partial<StubUserRepo>
    auth?: Partial<StubAuth>
    logger?: Partial<StubLogger>
  } = {},
): {
  container: AwilixContainer
  userRepository: StubUserRepo
  auth: StubAuth
  logger: StubLogger
} {
  const userRepository: StubUserRepo = {
    create: vi.fn().mockResolvedValue({ id: 'internal_1', clerkUserId: 'user_1' }),
    findByClerkUserId: vi.fn().mockResolvedValue({ id: 'internal_1', clerkUserId: 'user_1' }),
    update: vi.fn().mockResolvedValue({ id: 'internal_1', clerkUserId: 'user_1' }),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides.userRepository,
  }
  const auth: StubAuth = {
    syncFromWebhook: vi.fn().mockResolvedValue(undefined),
    ...overrides.auth,
  }
  const logger: StubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    ...overrides.logger,
  }

  const resolveMap: Record<string, unknown> = {
    userRepository,
    auth,
    logger,
  }

  const container = {
    resolve: vi.fn((key: string) => resolveMap[key]),
  } as unknown as AwilixContainer

  return { container, userRepository, auth, logger }
}

async function callWebhook(
  app: ReturnType<typeof createClerkWebhookApp>,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const req = new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...SVIX_HEADERS,
      ...extraHeaders,
    },
    body: raw,
  })
  return app.fetch(req)
}

// ---------------------------------------------------------------------------
// Existing handler path tests (kept green)
// ---------------------------------------------------------------------------

describe('clerk webhook handler — user.created event', () => {
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    app = createClerkWebhookApp(makeStubs().container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('returns 200 for a valid user.created event', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_1',
        first_name: 'Alice',
        last_name: 'Smith',
        image_url: 'https://example.com/avatar.jpg',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
        public_metadata: {},
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('falls back to first email when primaryEmailAddressId is not found', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_2',
        first_name: null,
        last_name: null,
        image_url: null,
        primary_email_address_id: 'email_notfound',
        email_addresses: [{ id: 'email_1', email_address: 'fallback@example.com' }],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
  })

  it('handles null firstName and lastName (composeDisplayName returns null)', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_3',
        first_name: null,
        last_name: null,
        primary_email_address_id: null,
        email_addresses: [],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
  })
})

describe('clerk webhook handler — user.updated event', () => {
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    app = createClerkWebhookApp(makeStubs().container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('returns 200 for a valid user.updated event', async () => {
    const payload = {
      type: 'user.updated',
      data: {
        id: 'user_1',
        first_name: 'Alice',
        last_name: null,
        image_url: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
  })

  it('returns 200 for user.updated with no email addresses (null email branch)', async () => {
    const payload = {
      type: 'user.updated',
      data: {
        id: 'user_1',
        first_name: null,
        last_name: null,
        image_url: null,
        primary_email_address_id: null,
        email_addresses: [],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
  })
})

describe('clerk webhook handler — user.deleted event', () => {
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    app = createClerkWebhookApp(makeStubs().container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('returns 200 for a valid user.deleted event', async () => {
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_1', deleted: true },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
  })
})

describe('clerk webhook handler — unhandled event type (ignored)', () => {
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    app = createClerkWebhookApp(makeStubs().container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('returns 200 with ignored:true for unhandled event types', async () => {
    const payload = { type: 'session.created', data: { id: 'sess_1' } }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; ignored?: boolean }
    expect(body.ignored).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// New DI assertion tests
// ---------------------------------------------------------------------------

describe('clerk webhook handler — user.created DI assertions', () => {
  let stubs: ReturnType<typeof makeStubs>
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs()
    app = createClerkWebhookApp(stubs.container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('calls userRepository.create with projected payload on user.created', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_abc',
        first_name: 'Alice',
        last_name: 'Smith',
        image_url: 'https://example.com/avatar.jpg',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    await callWebhook(app, payload)
    expect(stubs.userRepository.create).toHaveBeenCalledOnce()
    expect(stubs.userRepository.create).toHaveBeenCalledWith({
      clerkUserId: 'user_abc',
      email: 'alice@example.com',
      displayName: 'Alice Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
    })
  })

  it('calls auth.syncFromWebhook with the parsed event on user.created', async () => {
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_abc',
        first_name: 'Alice',
        last_name: 'Smith',
        image_url: null,
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    await callWebhook(app, payload)
    expect(stubs.auth.syncFromWebhook).toHaveBeenCalledOnce()
    const callArg = stubs.auth.syncFromWebhook.mock.calls[0][0] as {
      type: string
      data: { id: string }
    }
    expect(callArg.type).toBe('user.created')
    expect(callArg.data.id).toBe('user_abc')
  })
})

describe('clerk webhook handler — user.deleted DI assertions', () => {
  let stubs: ReturnType<typeof makeStubs>
  let app: ReturnType<typeof createClerkWebhookApp>

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs()
    app = createClerkWebhookApp(stubs.container)
  })

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('calls userRepository.findByClerkUserId then delete on user.deleted', async () => {
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_abc', deleted: true },
    }
    stubs.userRepository.findByClerkUserId.mockResolvedValue({
      id: 'internal_abc',
      clerkUserId: 'user_abc',
    })
    await callWebhook(app, payload)
    expect(stubs.userRepository.findByClerkUserId).toHaveBeenCalledWith('user_abc')
    expect(stubs.userRepository.delete).toHaveBeenCalledWith('internal_abc')
  })

  it('calls auth.syncFromWebhook on user.deleted', async () => {
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_abc', deleted: true },
    }
    await callWebhook(app, payload)
    expect(stubs.auth.syncFromWebhook).toHaveBeenCalledOnce()
    const callArg = stubs.auth.syncFromWebhook.mock.calls[0][0] as {
      type: string
      data: { id: string }
    }
    expect(callArg.type).toBe('user.deleted')
    expect(callArg.data.id).toBe('user_abc')
  })

  it('skips delete when user not found in repository', async () => {
    stubs.userRepository.findByClerkUserId.mockResolvedValue(null)
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_ghost', deleted: true },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    expect(stubs.userRepository.delete).not.toHaveBeenCalled()
    // auth sync still called even when user not in our DB
    expect(stubs.auth.syncFromWebhook).toHaveBeenCalledOnce()
  })
})

describe('clerk webhook handler — user.updated DI assertions', () => {
  let stubs: ReturnType<typeof makeStubs>
  let app: ReturnType<typeof createClerkWebhookApp>
  const payload = {
    type: 'user.updated',
    data: {
      id: 'user_abc',
      first_name: 'Ada',
      last_name: 'Lovelace',
      primary_email_address_id: 'email_1',
      email_addresses: [{ id: 'email_1', email_address: 'ada@example.com' }],
    },
  }

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs()
    app = createClerkWebhookApp(stubs.container)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, 'CLERK_WEBHOOK_SECRET')
  })

  it('updates the mirrored row by its internal id', async () => {
    stubs.userRepository.findByClerkUserId.mockResolvedValue({
      id: 'internal_abc',
      clerkUserId: 'user_abc',
    })
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    expect(stubs.userRepository.update).toHaveBeenCalledWith('internal_abc', {
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
    })
  })

  it('skips the update when the user was never mirrored, but still syncs auth', async () => {
    stubs.userRepository.findByClerkUserId.mockResolvedValue(null)
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    expect(stubs.userRepository.update).not.toHaveBeenCalled()
    expect(stubs.auth.syncFromWebhook).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// CONFIG resolve path tests (line 150-158 in clerk.ts)
// ---------------------------------------------------------------------------

describe('clerk webhook handler — CONFIG resolve catch path (line 156)', () => {
  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('falls back to process.env when container.resolve(CONFIG) throws', async () => {
    // The container throws on CONFIG but resolves USER_REPOSITORY / AUTH / LOGGER
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_env_fallback'

    const { userRepository, auth, logger } = makeStubs()
    const resolveMap: Record<string, unknown> = {
      userRepository,
      auth,
      logger,
    }
    const throwingContainer = {
      resolve: vi.fn((key: string) => {
        if (key === 'config') throw new Error('config not registered')
        const val = resolveMap[key]
        if (val === undefined) throw new Error(`unknown key: ${key}`)
        return val
      }),
    } as unknown as import('@t/dependency-injection').AwilixContainer

    const app = createClerkWebhookApp(throwingContainer)

    const payload = {
      type: 'user.created',
      data: {
        id: 'user_env_fallback',
        first_name: null,
        last_name: null,
        image_url: null,
        primary_email_address_id: null,
        email_addresses: [],
      },
    }
    const res = await callWebhook(app, payload)
    // Handler ran successfully using the env var fallback secret
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    // auth.syncFromWebhook was invoked (event handler ran end-to-end)
    expect(auth.syncFromWebhook).toHaveBeenCalledOnce()
  })
})

describe('clerk webhook handler — CONFIG happy path (secret from cfg.auth.clerkWebhookSecret)', () => {
  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('reads secret from cfg.auth.clerkWebhookSecret when container resolves CONFIG', async () => {
    // Unset env var so the only valid source is the config object
    process.env.CLERK_WEBHOOK_SECRET = undefined

    const configWithSecret = { auth: { clerkWebhookSecret: 'whsec_from_config' } }
    const { userRepository, auth, logger } = makeStubs()

    const resolveMapWithConfig: Record<string, unknown> = {
      userRepository,
      auth,
      logger,
      config: configWithSecret,
    }
    const configContainer = {
      resolve: vi.fn((key: string) => {
        const val = resolveMapWithConfig[key]
        if (val === undefined) throw new Error(`unknown key: ${key}`)
        return val
      }),
    } as unknown as import('@t/dependency-injection').AwilixContainer

    const app = createClerkWebhookApp(configContainer)

    const payload = {
      type: 'user.deleted',
      data: { id: 'user_config_path', deleted: true as const },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(auth.syncFromWebhook).toHaveBeenCalledOnce()
  })
})

describe('clerk webhook handler — error paths return 500', () => {
  let app: ReturnType<typeof createClerkWebhookApp>
  let stubs: ReturnType<typeof makeStubs>

  afterEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = undefined
  })

  it('returns 500 and logs error when userRepository.create throws on user.created', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      userRepository: {
        create: vi.fn().mockRejectedValue(new Error('DB write failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_abc',
        first_name: 'Alice',
        last_name: null,
        image_url: null,
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })

  it('returns 500 and logs error when auth.syncFromWebhook throws on user.created', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      auth: {
        syncFromWebhook: vi.fn().mockRejectedValue(new Error('Auth sync failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.created',
      data: {
        id: 'user_abc',
        first_name: null,
        last_name: null,
        image_url: null,
        email_addresses: [],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })

  it('returns 500 and logs error when userRepository.update throws on user.updated', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      userRepository: {
        findByClerkUserId: vi.fn().mockResolvedValue({ id: 'internal_1', clerkUserId: 'user_abc' }),
        update: vi.fn().mockRejectedValue(new Error('DB update failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.updated',
      data: {
        id: 'user_abc',
        first_name: 'Alice',
        last_name: null,
        image_url: null,
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })

  it('returns 500 and logs error when auth.syncFromWebhook throws on user.updated', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      auth: {
        syncFromWebhook: vi.fn().mockRejectedValue(new Error('Auth sync failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.updated',
      data: {
        id: 'user_abc',
        first_name: 'Alice',
        last_name: null,
        image_url: null,
        email_addresses: [{ id: 'email_1', email_address: 'alice@example.com' }],
      },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })

  it('returns 500 and logs error when userRepository.delete throws on user.deleted', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      userRepository: {
        findByClerkUserId: vi.fn().mockResolvedValue({ id: 'internal_1', clerkUserId: 'user_abc' }),
        delete: vi.fn().mockRejectedValue(new Error('DB delete failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_abc', deleted: true },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })

  it('returns 500 and logs error when auth.syncFromWebhook throws on user.deleted', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
    stubs = makeStubs({
      auth: {
        syncFromWebhook: vi.fn().mockRejectedValue(new Error('Auth sync failed')),
      },
    })
    app = createClerkWebhookApp(stubs.container)
    const payload = {
      type: 'user.deleted',
      data: { id: 'user_abc', deleted: true },
    }
    const res = await callWebhook(app, payload)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(stubs.logger.error).toHaveBeenCalledOnce()
  })
})
