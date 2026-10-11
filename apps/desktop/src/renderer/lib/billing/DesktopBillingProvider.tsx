import { type CustomerInfo, type Offering, Purchases } from '@revenuecat/purchases-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { desktopClientConfig } from '../clientConfig'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntitlementInfo {
  isActive: boolean
  isLoading: boolean
  expirationDate: Date | null
}

interface BillingContextValue {
  purchases: Purchases | null
  customerInfo: CustomerInfo | null
  isLoading: boolean
  offerings: Offering[] | null
  refreshCustomerInfo: () => Promise<void>
}

// ─── Context ──────────────────────────────────────────────────────────────────

const BillingContext = createContext<BillingContextValue>({
  purchases: null,
  customerInfo: null,
  isLoading: false,
  offerings: null,
  refreshCustomerInfo: async () => {},
})

// ─── Provider ────────────────────────────────────────────────────────────────

export interface DesktopBillingProviderProps {
  children: React.ReactNode
  /** Override API key — useful in tests. Falls back to VITE_REVENUECAT_PUBLIC_API_KEY. */
  apiKey?: string
  /** Override app user ID — useful in tests. Defaults to 'anonymous'. */
  appUserId?: string
}

export function DesktopBillingProvider({
  children,
  apiKey: apiKeyProp,
  appUserId = 'anonymous',
}: DesktopBillingProviderProps) {
  const resolvedKey = apiKeyProp ?? desktopClientConfig.revenueCat.publicApiKey

  const purchasesRef = useRef<Purchases | null>(null)
  const [purchases, setPurchases] = useState<Purchases | null>(null)
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)
  const [offerings, setOfferings] = useState<Offering[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // No-op when key is absent — allows the app to run without billing configured.
    if (!resolvedKey) return

    setIsLoading(true)

    let instance: Purchases
    try {
      instance = Purchases.configure({ apiKey: resolvedKey, appUserId })
    } catch (err) {
      console.warn('[DesktopBillingProvider] configure failed:', err)
      setIsLoading(false)
      return
    }

    purchasesRef.current = instance
    setPurchases(instance)

    const init = async () => {
      try {
        const [info, offeringsResult] = await Promise.all([
          instance.getCustomerInfo(),
          instance.getOfferings(),
        ])
        setCustomerInfo(info)
        setOfferings(offeringsResult.all ? Object.values(offeringsResult.all) : null)
      } catch (err) {
        console.warn('[DesktopBillingProvider] init fetch failed:', err)
      } finally {
        setIsLoading(false)
      }
    }

    void init()
  }, [resolvedKey, appUserId])

  const refreshCustomerInfo = useCallback(async () => {
    const instance = purchasesRef.current
    if (!instance) return
    try {
      const info = await instance.getCustomerInfo()
      setCustomerInfo(info)
    } catch (err) {
      console.warn('[DesktopBillingProvider] refreshCustomerInfo failed:', err)
    }
  }, [])

  const value = useMemo<BillingContextValue>(
    () => ({ purchases, customerInfo, isLoading, offerings, refreshCustomerInfo }),
    [purchases, customerInfo, isLoading, offerings, refreshCustomerInfo],
  )

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Returns the raw Purchases instance (or null when billing is not configured). */
export function useBilling(): Purchases | null {
  return useContext(BillingContext).purchases
}

/** Returns active state, loading flag, and expiration date for an entitlement. */
export function useEntitlement(id: string): EntitlementInfo {
  const { customerInfo, isLoading } = useContext(BillingContext)

  return useMemo<EntitlementInfo>(() => {
    if (isLoading || !customerInfo) {
      return { isActive: false, isLoading, expirationDate: null }
    }

    const entitlement = customerInfo.entitlements?.active?.[id]
    if (!entitlement) {
      return { isActive: false, isLoading: false, expirationDate: null }
    }

    return {
      isActive: entitlement.isActive,
      isLoading: false,
      // expirationDate is already Date | null from the SDK
      expirationDate: entitlement.expirationDate,
    }
  }, [customerInfo, isLoading, id])
}

/** Returns the full billing context — useful when you need offerings or refreshCustomerInfo. */
export function useBillingContext(): BillingContextValue {
  return useContext(BillingContext)
}
