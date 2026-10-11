/**
 * Vitest mock for react-native-purchases.
 *
 * This file is resolved via the vitest.config.ts alias so the native-only
 * dependency can be imported in unit tests without a native runtime.
 */
import { vi } from 'vitest'

const Purchases = {
  configure: vi.fn(),
  setLogLevel: vi.fn(),
  getCustomerInfo: vi.fn().mockResolvedValue({}),
  logIn: vi.fn().mockResolvedValue({ customerInfo: {} }),
  logOut: vi.fn().mockResolvedValue({}),
  addCustomerInfoUpdateListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
}

export const LOG_LEVEL = { DEBUG: 'DEBUG' }

export default Purchases
