import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { buildErrorMetadata } from '../../delivery/utils/buildErrorMetadata.ts'
import { ValidationError } from '../../infrastructure/4xx/ValidationError.ts'

/** Builds the metadata inside a real route so the Hono context is real. */
async function metadataFor(
  error: Error,
  requestId: string | undefined,
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {}
  const app = new Hono()
  app.post('/v1/orders', (c) => {
    captured = buildErrorMetadata(error, 400, c, 'user_1', requestId)
    return c.body(null, 204)
  })
  await app.request('/v1/orders', { method: 'POST' })
  return captured
}

describe('buildErrorMetadata', () => {
  it('copies validationErrors from a ValidationError cause', async () => {
    const validationErrors = [{ path: 'email', message: 'Required' }]
    const error = new ValidationError('Request validation failed', 'Please check your input.', {
      cause: { validationErrors },
    })

    const metadata = await metadataFor(error, 'req_1')

    expect(metadata.validationErrors).toEqual(validationErrors)
    expect(metadata.route).toBe('/v1/orders')
    expect(metadata.method).toBe('POST')
    expect(metadata.isExpected).toBe(true)
    expect(metadata.requestId).toBe('req_1')
  })

  it('omits validationErrors when the cause carries none', async () => {
    const error = new ValidationError('Request validation failed', 'Please check your input.', {
      cause: { field: 'email' },
    })

    const metadata = await metadataFor(error, undefined)

    expect(metadata).not.toHaveProperty('validationErrors')
    expect(metadata.requestId).toBeUndefined()
  })
})
