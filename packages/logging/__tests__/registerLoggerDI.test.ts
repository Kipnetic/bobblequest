/**
 * @fileoverview Container registration for the global logger and the logger
 * factory.
 */

import { createContainer, dependencyKeys } from '@t/dependency-injection'
import { describe, expect, test } from 'vitest'
import { createGlobalLogger } from '../index.ts'
import {
  LOGGER_DEPENDENCY_KEY,
  registerLoggerDI,
} from '../dependency-injection/registerLoggerDI.ts'
import { registerLoggerFactoryDI } from '../dependency-injection/registerLoggerFactoryDI.ts'
import { GlobalLogger } from '../infrastructure/globalLogger.ts'

describe('registerLoggerDI', () => {
  test('registers a singleton GlobalLogger under the shared logger key', () => {
    const container = createContainer()
    registerLoggerDI(container)

    const first = container.resolve<GlobalLogger>(LOGGER_DEPENDENCY_KEY)
    expect(first).toBeInstanceOf(GlobalLogger)
    expect(container.resolve(dependencyKeys.global.LOGGER)).toBe(first)
  })

  test('accepts an explicit context and options', () => {
    const container = createContainer()
    registerLoggerDI(container, { context: { requestId: 'req-42' }, quiet: true })

    expect(container.resolve(LOGGER_DEPENDENCY_KEY)).toBeInstanceOf(GlobalLogger)
  })
})

describe('registerLoggerFactoryDI', () => {
  test('registers createGlobalLogger as the logger factory', () => {
    const container = createContainer()
    registerLoggerFactoryDI(container)

    expect(container.resolve(dependencyKeys.global.LOGGER_FACTORY)).toBe(createGlobalLogger)
  })
})
