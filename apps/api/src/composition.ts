/**
 * Composition root for apps/api.
 *
 * Wires all singleton services into the DI container in the correct order.
 * Designed to boot without real secrets: all registrars soft-fail under
 * `environment === 'testing'` or when env vars are absent.
 */
import { registerAnalyticsDI } from '@t/analytics'
import { type UserSyncCallback, registerAuthDI } from '@t/auth'
import { registerBillingDI } from '@t/billing'
import { registerCacheDI } from '@t/cache'
import { registerConfigRepo } from '@t/config'
import type { Environment } from '@t/config'
import { registerDbDI } from '@t/db'
import type { UserRepository } from '@t/db'
import { type Container, createContainer, dependencyKeys } from '@t/dependency-injection'
import { registerLoggerDI, registerLoggerFactoryDI } from '@t/logging'
import { registerQueueDI } from '@t/queue'

export function buildContainer(): Container {
  const container = createContainer()

  // 1. Config — must be first; everything else reads from it.
  registerConfigRepo(container)

  const config = container.resolve(dependencyKeys.global.CONFIG)

  // Resolve environment from the config repo; default to 'development'.
  /* v8 ignore next — ConfigValuesSchema ensures system.environment is always set; 'development' is unreachable */
  const environment: Environment = config.system?.environment ?? 'development'

  // 2. Logger infrastructure (factory first, then the named global logger).
  registerLoggerFactoryDI(container)
  registerLoggerDI(container, { context: { requestId: 'global', metadata: { service: 'api' } } })

  const logger = container.resolve(dependencyKeys.global.LOGGER)

  // 3. Infrastructure services — all soft-fail in testing / missing-env scenarios.
  registerCacheDI(container, {
    config,
    environment,
  })
  registerDbDI(container, { config, environment })
  registerQueueDI(container, { config, environment })

  // Build the userSync callback that mirrors Clerk lifecycle events into the
  // application database. Resolved lazily from the container so test doubles
  // (InMemoryUserRepository registered by registerDbDI under 'testing') are
  // picked up without any eager binding.
  const userSync: UserSyncCallback = async (event) => {
    const repo = container.resolve<UserRepository>(dependencyKeys.global.USER_REPOSITORY)
    if (event.type === 'user.created') {
      const d = event.data
      const primaryId = d.primary_email_address_id ?? null
      const email =
        (primaryId
          ? d.email_addresses.find((e) => e.id === primaryId)?.email_address
          : d.email_addresses[0]?.email_address) ?? ''
      const nameParts = [d.first_name, d.last_name].filter(
        (p): p is string => typeof p === 'string' && p.length > 0,
      )
      const displayName = nameParts.length > 0 ? nameParts.join(' ') : null
      await repo.create({
        clerkUserId: d.id,
        email,
        displayName,
        avatarUrl: d.image_url ?? null,
      })
    } else if (event.type === 'user.updated') {
      const d = event.data
      const existing = await repo.findByClerkUserId(d.id)
      if (existing) {
        const primaryId = d.primary_email_address_id ?? null
        const email =
          (primaryId
            ? d.email_addresses.find((e) => e.id === primaryId)?.email_address
            : d.email_addresses[0]?.email_address) ?? undefined
        const nameParts = [d.first_name, d.last_name].filter(
          (p): p is string => typeof p === 'string' && p.length > 0,
        )
        const displayName = nameParts.length > 0 ? nameParts.join(' ') : null
        await repo.update(existing.id, { email, displayName, avatarUrl: d.image_url ?? null })
      }
      /* v8 ignore start -- WebhookEventSchema is a discriminated union of exactly these three types and is parsed before this callback runs, so the implicit no-match arm is unreachable */
    } else if (event.type === 'user.deleted') {
      /* v8 ignore stop */
      const existing = await repo.findByClerkUserId(event.data.id)
      if (existing) {
        await repo.delete(existing.id)
      }
    }
  }

  registerAuthDI(container, { config, environment, userSync })
  registerAnalyticsDI(container, { config, environment, service: 'api' })

  // 4. Billing — registrar has no built-in soft-fail, so we guard explicitly.
  // scaffold: consumers wire their own billing env vars (STRIPE_KEY,
  // CORE_REVENUE_CAT_API_KEY, etc.); the template must not hard-crash when
  // those are absent.
  try {
    registerBillingDI(container, {
      stripeConfig: config.stripe,
      revenuecatConfig: config.revenueCat,
      /* v8 ignore next — RevenueCatConfigSchema enforces webhookAuthHeader is a non-empty string; nullish branch is unreachable */
      revenuecatWebhookAuthHeader: config.revenueCat?.webhookAuthHeader ?? '',
    })
  } catch {
    logger.warning(
      {
        message:
          'Billing registration skipped — STRIPE_KEY / CORE_REVENUE_CAT_API_KEY not set. ' +
          'Wire billing env vars before enabling billing routes.',
      },
      '',
    )
  }

  return container
}
