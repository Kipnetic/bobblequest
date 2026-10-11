/**
 * @fileoverview OTLP Winston Transport for PostHog
 *
 * This module provides a custom Winston transport that sends logs to PostHog
 * via the OpenTelemetry Protocol (OTLP). It bridges Winston's logging API
 * with OpenTelemetry's structured logging format.
 */

import process from 'node:process'
import {
  type AnyValue,
  type Logger as OTLogger,
  SeverityNumber,
  logs,
} from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { ATTR_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions/incubating'
import { createGlobalLogger } from '@t/logging'
import type winston from 'winston'
import Transport from 'winston-transport'
import type { OTLPConfig } from '../../entities/types/otlpConfig.ts'
import { VERSION } from '../../version.ts'

/**
 * Map Winston log levels to OpenTelemetry severity numbers.
 *
 * OpenTelemetry uses a numeric severity scale from 1 (TRACE) to 24 (FATAL).
 * This mapping aligns Winston's string levels with OpenTelemetry's standard severity.
 */
const WINSTON_TO_OTEL_SEVERITY: Record<string, SeverityNumber> = {
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  http: SeverityNumber.INFO,
  verbose: SeverityNumber.DEBUG,
  debug: SeverityNumber.DEBUG,
  silly: SeverityNumber.TRACE,
}

/**
 * Map Winston log levels to OpenTelemetry severity text.
 *
 * These text values correspond to the numeric severity values
 * and provide human-readable severity indicators in PostHog.
 */
const WINSTON_TO_OTEL_SEVERITY_TEXT: Record<string, string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  http: 'INFO',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  silly: 'TRACE',
}

/**
 * Circuit breaker states for OTLP export resilience.
 */
enum CircuitBreakerState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, skip exports
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Custom Winston transport that sends logs to PostHog via OTLP.
 *
 * This transport creates an OpenTelemetry LoggerProvider configured with
 * an OTLP HTTP exporter that sends logs to PostHog's endpoint. It transforms
 * Winston log entries into OpenTelemetry LogRecord format and handles batching,
 * retries, and graceful shutdown.
 *
 * **Key Features:**
 * - Non-blocking log emission with proper error isolation
 * - Circuit breaker pattern for resilience
 * - Automatic batching for efficiency
 * - Resource attributes for service identification
 * - Severity level mapping
 * - Graceful shutdown to flush buffered logs
 *
 * @extends Transport
 *
 * @example
 * ```typescript
 * const transport = new OTLPWinstonTransport({
 *   endpoint: "https://us.i.posthog.com/v1/logs",
 *   apiKey: "phc_1234567890abcdef",
 *   batchSize: 512,
 *   exportIntervalMillis: 5000,
 * });
 *
 * const logger = winston.createLogger({
 *   transports: [transport],
 * });
 *
 * logger.info("Test message", { userId: "123" });
 * await transport.shutdown(); // Flush logs before exit
 * ```
 */
export class OTLPWinstonTransport extends Transport {
  private loggerProvider: LoggerProvider | null = null
  private otLogger: OTLogger | null = null
  private isInitialized = false
  private initializationError: Error | null = null

  /**
   * Internal logger for OTLP transport diagnostics.
   * Uses the global logger factory for structured transport logs.
   */
  private readonly internalLogger = createGlobalLogger(
    import.meta.filename ?? 'src/platform/logging/infrastructure/transports/otlpTransport.ts',
  )

  // Circuit breaker state management
  private circuitBreakerState: CircuitBreakerState = CircuitBreakerState.CLOSED
  private failureCount = 0
  private lastFailureTime = 0
  private readonly failureThreshold = 5 // Open circuit after 5 consecutive failures
  private readonly halfOpenTimeout = 30000 // Test recovery after 30 seconds

  /**
   * Creates a new OTLP Winston transport instance.
   *
   * Initializes the OpenTelemetry LoggerProvider with BatchLogRecordProcessor
   * and OTLPLogExporter configured for PostHog. If initialization fails,
   * the transport will silently skip log exports without breaking the application.
   *
   * @param config - OTLP configuration including endpoint, API key, and batching settings
   * @param exporter - Optional OTLP log exporter instance (mainly for testing)
   */
  constructor(config: OTLPConfig, exporter?: OTLPLogExporter) {
    super()

    // Since this transport is shared as a singleton across many loggers,
    // raise the listener limit to avoid MaxListenersExceeded warnings
    this.setMaxListeners(100)

    try {
      // Create resource attributes for service identification
      const resource = defaultResource().merge(
        resourceFromAttributes({
          [ATTR_SERVICE_NAME]: 'core-api',
          [ATTR_SERVICE_VERSION]: VERSION,
          [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.ENVIRONMENT || 'development',
        }),
      )

      // Create OTLP HTTP exporter for PostHog or use provided one
      const logExporter =
        exporter ??
        new OTLPLogExporter({
          url: config.endpoint,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
          },
          timeoutMillis: config.exportTimeoutMillis,
        })

      // Create batch processor for efficient log export.
      // exportTimeoutMillis is intentionally capped at 3 s so the processor
      // can always complete its shutdown (and clear its internal interval timer)
      // within the 4 s shutdown guard, preventing timer leaks when the endpoint
      // is unreachable.
      const processor = new BatchLogRecordProcessor({
        exporter: logExporter,
        maxQueueSize: config.maxQueueSize,
        maxExportBatchSize: config.batchSize,
        scheduledDelayMillis: config.exportIntervalMillis,
        exportTimeoutMillis: Math.min(config.exportTimeoutMillis, 3000),
      })

      // Initialize logger provider with processor in config
      this.loggerProvider = new LoggerProvider({
        resource,
        processors: [processor],
      })

      // Register global logger provider (optional, for OpenTelemetry API usage)
      logs.setGlobalLoggerProvider(this.loggerProvider)

      // Get logger instance for this transport
      this.otLogger = this.loggerProvider.getLogger('core-api-winston-transport', VERSION)

      this.isInitialized = true
      // Initialization logging is now handled by the transport factory
    } catch (error) {
      // Store error but don't throw - allow application to continue
      // Initialization status is available via getStatus()
      this.initializationError = error as Error
      // Error logging is now handled by the transport factory
    }
  }

  /**
   * Check and update circuit breaker state.
   *
   * @returns true if the circuit is closed or half-open (allow export attempt)
   */
  private shouldAttemptExport(): boolean {
    const now = Date.now()

    switch (this.circuitBreakerState) {
      case CircuitBreakerState.CLOSED:
        return true

      case CircuitBreakerState.OPEN:
        // Check if enough time has passed to try half-open
        if (now - this.lastFailureTime >= this.halfOpenTimeout) {
          this.circuitBreakerState = CircuitBreakerState.HALF_OPEN
          this.internalLogger.debug({
            message: 'Circuit breaker entering HALF_OPEN state, testing recovery',
            metadata: { transport: 'OTLPWinstonTransport' },
          })
          return true
        }
        return false

      case CircuitBreakerState.HALF_OPEN:
        return true

      default:
        return false
    }
  }

  /**
   * Record a successful export.
   */
  private recordSuccess(): void {
    if (this.circuitBreakerState !== CircuitBreakerState.CLOSED) {
      this.internalLogger.info({
        message: 'Circuit breaker closing after successful export',
        metadata: { transport: 'OTLPWinstonTransport' },
      })
    }
    this.failureCount = 0
    this.circuitBreakerState = CircuitBreakerState.CLOSED
  }

  /**
   * Record a failed export and update circuit breaker state.
   */
  private recordFailure(error: unknown): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.failureThreshold) {
      if (this.circuitBreakerState !== CircuitBreakerState.OPEN) {
        this.internalLogger.error({
          message:
            `Circuit breaker opening after ${this.failureCount} failures. ` +
            `OTLP exports will be skipped for ${this.halfOpenTimeout}ms`,
          metadata: {
            transport: 'OTLPWinstonTransport',
            failureCount: this.failureCount,
            halfOpenTimeout: this.halfOpenTimeout,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        this.circuitBreakerState = CircuitBreakerState.OPEN
      }
    } else {
      this.internalLogger.error({
        message: `Export failure ${this.failureCount}/${this.failureThreshold}`,
        metadata: {
          transport: 'OTLPWinstonTransport',
          failureCount: this.failureCount,
          failureThreshold: this.failureThreshold,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Winston transport log method.
   *
   * Transforms Winston log entries into OpenTelemetry LogRecords and emits
   * them through the OTLP exporter. This method is called by Winston for each
   * log entry. Emission is non-blocking and errors are caught to prevent
   * application disruption.
   *
   * The method includes circuit breaker logic to prevent cascading failures
   * when PostHog is unavailable. After multiple consecutive failures, the
   * circuit opens and exports are skipped until the service potentially recovers.
   *
   * @param info - Winston log info object containing level, message, and metadata
   * @param callback - Callback to signal Winston that logging is complete
   */
  override log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    // Skip if transport is not initialized
    if (!this.isInitialized || !this.otLogger) {
      callback()
      return
    }

    // Check circuit breaker state
    if (!this.shouldAttemptExport()) {
      // Circuit is open, skip export silently
      callback()
      return
    }

    try {
      const { level, message, timestamp, ...attributes } = info

      // Map Winston level to OpenTelemetry severity
      const severityNumber = WINSTON_TO_OTEL_SEVERITY[level] || SeverityNumber.INFO
      const severityText = WINSTON_TO_OTEL_SEVERITY_TEXT[level] || 'INFO'

      // Emit log record (non-blocking)
      // Note: The emit() method itself is synchronous, but the underlying
      // BatchLogRecordProcessor handles async export. Errors from the async
      // export are handled by the processor's error callback (if configured)
      // or silently dropped. This is intentional to prevent unhandled rejections.
      this.otLogger.emit({
        severityNumber,
        severityText,
        body: message as AnyValue,
        attributes: {
          ...(attributes as Record<string, AnyValue>),
          // Include original Winston level for reference
          'winston.level': level,
          // Include timestamp if available
          ...(timestamp ? { timestamp: timestamp as AnyValue } : {}),
        },
      })

      // Record success for circuit breaker
      this.recordSuccess()
    } catch (error) {
      // Catch synchronous errors from emit() call
      // This prevents any errors from propagating as unhandled rejections
      this.recordFailure(error)
      // Continue - Winston should continue functioning even if telemetry fails
    }

    // Always call callback to signal completion to Winston
    callback()
  }

  /**
   * Gracefully shutdown the OTLP transport.
   *
   * Flushes any buffered logs and shuts down the LoggerProvider. This method
   * should be called before application exit to ensure all logs are sent to
   * PostHog. The shutdown process has a timeout to prevent hanging.
   *
   * @returns Promise that resolves when shutdown is complete
   *
   * @example
   * ```typescript
   * // In application shutdown handler
   * process.on('SIGTERM', async () => {
   *   await otlpTransport.shutdown();
   *   process.exit(0);
   * });
   * ```
   */
  async shutdown(): Promise<void> {
    if (!this.loggerProvider) {
      return
    }

    // Race the provider shutdown against a timeout to prevent hanging
    // when the OTLP endpoint is unreachable during flush.
    const SHUTDOWN_TIMEOUT_MS = 4000
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.loggerProvider.shutdown().finally(() => {
          clearTimeout(timeoutHandle)
        }),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
        }),
      ])
    } catch {
      clearTimeout(timeoutHandle)
      // Silently handle shutdown errors â€”
      // status can be checked via getStatus() method
    }
  }

  /**
   * Get initialization status and error details.
   *
   * Useful for debugging or monitoring to check if the transport
   * initialized successfully.
   *
   * @returns Object containing initialization status and any error that occurred
   */
  getStatus(): {
    initialized: boolean
    error: Error | null
    circuitBreaker: {
      state: CircuitBreakerState
      failureCount: number
      lastFailureTime: number
    }
  } {
    return {
      initialized: this.isInitialized,
      error: this.initializationError,
      circuitBreaker: {
        state: this.circuitBreakerState,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
      },
    }
  }
}
