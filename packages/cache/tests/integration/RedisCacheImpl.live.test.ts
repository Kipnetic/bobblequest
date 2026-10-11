import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CacheLockTimeoutError } from '../../src/infrastructure/InMemoryCacheImpl.ts'
import { RedisCacheImpl } from '../../src/infrastructure/RedisCacheImpl.ts'
import { TEST_REDIS_URL, flushTestKeys, isRedisAvailable } from './setup.ts'

const available = await isRedisAvailable()

describe.skipIf(!available)('RedisCacheImpl (live Redis)', () => {
  const KEY_PREFIX = 'test:cache:live:'

  afterAll(async () => {
    // Best-effort cleanup: remove all test keys
    const { default: Redis } = await import('ioredis')
    const cleaner = new Redis(TEST_REDIS_URL)
    await flushTestKeys(cleaner, `${KEY_PREFIX}*`)
    cleaner.disconnect()
  })

  // -------------------------------------------------------------------------
  // get / set / del round-trip
  // -------------------------------------------------------------------------

  describe('get / set / del', () => {
    let cache: RedisCacheImpl

    beforeEach(() => {
      cache = new RedisCacheImpl({ url: TEST_REDIS_URL })
    })

    afterEach(async () => {
      await cache.close()
    })

    it('set and get a plain object', async () => {
      const key = `${KEY_PREFIX}obj`
      await cache.set(key, { hello: 'world' })
      expect(await cache.get(key)).toEqual({ hello: 'world' })
      await cache.del(key)
    })

    it('returns null for a missing key', async () => {
      expect(await cache.get(`${KEY_PREFIX}missing-${Date.now()}`)).toBeNull()
    })

    it('set with TTL expires the key', async () => {
      const key = `${KEY_PREFIX}ttl`
      await cache.set(key, 'expiring', 1)
      expect(await cache.get(key)).toBe('expiring')
      // Wait for expiry — TTL is 1s; poll with a small buffer
      await new Promise((r) => setTimeout(r, 1100))
      expect(await cache.get(key)).toBeNull()
    })

    it('del removes the key', async () => {
      const key = `${KEY_PREFIX}del`
      await cache.set(key, 42)
      await cache.del(key)
      expect(await cache.get(key)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // atomic incr + TTL
  // -------------------------------------------------------------------------

  describe('incr with TTL', () => {
    let cache: RedisCacheImpl

    beforeEach(() => {
      cache = new RedisCacheImpl({ url: TEST_REDIS_URL })
    })

    afterEach(async () => {
      await cache.close()
    })

    it('increments from zero and returns the new count', async () => {
      const key = `${KEY_PREFIX}incr-${Date.now()}`
      expect(await cache.incr(key)).toBe(1)
      expect(await cache.incr(key)).toBe(2)
      await cache.del(key)
    })

    it('sets TTL atomically on first incr', async () => {
      const key = `${KEY_PREFIX}incr-ttl-${Date.now()}`
      await cache.incr(key, 2)
      // TTL should be ≤ 2s and > 0
      const { default: Redis } = await import('ioredis')
      const probe = new Redis(TEST_REDIS_URL)
      const ttl = await probe.ttl(key)
      probe.disconnect()
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(2)
      await cache.del(key)
    })
  })

  // -------------------------------------------------------------------------
  // withLock — mutual exclusion (CAS release)
  // -------------------------------------------------------------------------

  describe('withLock', () => {
    it('allows only one concurrent holder', async () => {
      const lockKey = `${KEY_PREFIX}lock-${Date.now()}`
      const a = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const b = new RedisCacheImpl({ url: TEST_REDIS_URL })

      const order: string[] = []

      try {
        await Promise.all([
          a.withLock(lockKey, 5, async () => {
            order.push('a-start')
            await new Promise((r) => setTimeout(r, 200))
            order.push('a-end')
          }),
          // b tries to acquire the same lock; it will poll until a finishes
          b.withLock(lockKey, 5, async () => {
            order.push('b-start')
            order.push('b-end')
          }),
        ])
      } finally {
        await a.close()
        await b.close()
      }

      // Either holder may win the race for the lock; what matters is that the
      // two critical sections never interleave.
      expect([
        ['a-start', 'a-end', 'b-start', 'b-end'],
        ['b-start', 'b-end', 'a-start', 'a-end'],
      ]).toContainEqual(order)
    })

    it('throws CacheLockTimeoutError when lock cannot be acquired in time', async () => {
      const lockKey = `${KEY_PREFIX}lock-timeout-${Date.now()}`
      const holder = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const contender = new RedisCacheImpl({ url: TEST_REDIS_URL })

      // Holder grabs the lock for 5s; contender's budget is 0.1s
      const holderDone = holder.withLock(lockKey, 5, () => new Promise((r) => setTimeout(r, 300)))

      // Give the holder time to acquire
      await new Promise((r) => setTimeout(r, 50))

      try {
        await expect(contender.withLock(lockKey, 0.1, async () => {})).rejects.toBeInstanceOf(
          CacheLockTimeoutError,
        )
      } finally {
        await holderDone
        await holder.close()
        await contender.close()
      }
    })
  })

  // -------------------------------------------------------------------------
  // pub/sub fanout across separate clients
  // -------------------------------------------------------------------------

  describe('publish / subscribe', () => {
    it('delivers published message to subscriber on same channel', async () => {
      const channel = `${KEY_PREFIX}pubsub-${Date.now()}`
      const publisher = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const subscriber = new RedisCacheImpl({ url: TEST_REDIS_URL })

      const received: unknown[] = []

      try {
        await subscriber.subscribe(channel, (p) => received.push(p))

        // Brief settle — ioredis subscribe is async
        await new Promise((r) => setTimeout(r, 100))

        await publisher.publish(channel, { msg: 'hello' })

        // Wait for delivery
        await new Promise((r) => setTimeout(r, 200))

        expect(received).toEqual([{ msg: 'hello' }])
      } finally {
        await publisher.close()
        await subscriber.close()
      }
    })

    it('fans out to multiple subscribers on the same channel', async () => {
      const channel = `${KEY_PREFIX}fanout-${Date.now()}`
      const publisher = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const sub1 = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const sub2 = new RedisCacheImpl({ url: TEST_REDIS_URL })

      const r1: unknown[] = []
      const r2: unknown[] = []

      try {
        await sub1.subscribe(channel, (p) => r1.push(p))
        await sub2.subscribe(channel, (p) => r2.push(p))

        await new Promise((r) => setTimeout(r, 100))
        await publisher.publish(channel, 'ping')
        await new Promise((r) => setTimeout(r, 200))

        expect(r1).toEqual(['ping'])
        expect(r2).toEqual(['ping'])
      } finally {
        await publisher.close()
        await sub1.close()
        await sub2.close()
      }
    })

    it('unsubscribe stops further deliveries', async () => {
      const channel = `${KEY_PREFIX}unsub-${Date.now()}`
      const publisher = new RedisCacheImpl({ url: TEST_REDIS_URL })
      const subscriber = new RedisCacheImpl({ url: TEST_REDIS_URL })

      const received: unknown[] = []

      try {
        const unsub = await subscriber.subscribe(channel, (p) => received.push(p))
        await new Promise((r) => setTimeout(r, 100))

        await publisher.publish(channel, 'before')
        await new Promise((r) => setTimeout(r, 150))

        await unsub()

        await publisher.publish(channel, 'after')
        await new Promise((r) => setTimeout(r, 150))

        expect(received).toEqual(['before'])
      } finally {
        await publisher.close()
        await subscriber.close()
      }
    })
  })

  // -------------------------------------------------------------------------
  // close() cleanup
  // -------------------------------------------------------------------------

  describe('close()', () => {
    it('resolves cleanly when no subscriber was created', async () => {
      const cache = new RedisCacheImpl({ url: TEST_REDIS_URL })
      await expect(cache.close()).resolves.toBeUndefined()
    })

    it('resolves cleanly when subscriber was created', async () => {
      const cache = new RedisCacheImpl({ url: TEST_REDIS_URL })
      await cache.subscribe(`${KEY_PREFIX}close-ch`, () => {})
      await expect(cache.close()).resolves.toBeUndefined()
    })
  })
})
