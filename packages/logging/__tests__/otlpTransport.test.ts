/**
 * @fileoverview End-to-end export through OTLPWinstonTransport: a real
 * OTLPLogExporter posts to a local HTTP collector, so the test covers the
 * OpenTelemetry SDK wiring (LoggerProvider, BatchLogRecordProcessor) rather
 * than a mock of it.
 */

import { type IncomingHttpHeaders, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { OTLPWinstonTransport } from '../infrastructure/transports/otlpTransport.ts'

type Received = { url: string | undefined; headers: IncomingHttpHeaders; body: string }

let server: Server
let endpoint: string
let received: Received[]

beforeEach(async () => {
  received = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  endpoint = `http://127.0.0.1:${port}/v1/logs`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeTransport(): OTLPWinstonTransport {
  return new OTLPWinstonTransport({
    endpoint,
    apiKey: 'phc_test_key',
    maxQueueSize: 100,
    batchSize: 10,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 2_000,
  })
}

function logThrough(transport: OTLPWinstonTransport, info: Record<string, unknown>): void {
  transport.log({ level: 'warn', message: 'payment retry scheduled', ...info }, () => undefined)
}

describe('OTLPWinstonTransport export', () => {
  test('initializes the SDK pipeline without error', async () => {
    const transport = makeTransport()
    const status = transport.getStatus()
    expect(status.error).toBeNull()
    expect(status.initialized).toBe(true)
    await transport.shutdown()
  })

  test('exports a winston entry to the collector on shutdown', async () => {
    const transport = makeTransport()
    logThrough(transport, { orderId: 'ord_123', timestamp: '2026-10-11T00:00:00.000Z' })
    await transport.shutdown()

    expect(received).toHaveLength(1)
    const [request] = received
    expect(request?.url).toBe('/v1/logs')
    expect(request?.headers.authorization).toBe('Bearer phc_test_key')
    expect(request?.body).toContain('payment retry scheduled')
    expect(request?.body).toContain('ord_123')
    expect(request?.body).toContain('"severityText":"WARN"')
    expect(transport.getStatus().circuitBreaker.state).toBe('CLOSED')
  })

  test('exports nothing when nothing was logged', async () => {
    const transport = makeTransport()
    await transport.shutdown()
    expect(received).toHaveLength(0)
  })
})
