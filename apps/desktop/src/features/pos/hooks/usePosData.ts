import { useEffect, useState } from "react"
import { getProducts, subscribeProducts, getSellableProducts } from "../services/product.service"
import { getHeldSales, subscribeHeldSales } from "../services/heldSale.service"
import {
  getCustomerLedger,
  subscribeLedger,
  type CustomerLedger,
} from "../services/customer.service"
import {
  getSettings,
  subscribeSettings,
  type AppSettings,
} from "../services/settings.service"
import type { HeldSale } from "../services/heldSale.service"
import type { Product } from "../types/product"

export function usePosData() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [heldSales, setHeldSales] = useState<HeldSale[]>(getHeldSales())
  const [customers, setCustomers] = useState<CustomerLedger[]>([])
  const [settings, setSettings] = useState<AppSettings>(getSettings())

  useEffect(() => {
    let active = true

    // Archived products are discontinued — they must never appear in the POS
    // sellable grid / scan lookup / category tabs. (The products-management
    // views use the unfiltered accessor directly and still see archived ones,
    // e.g. to restore them.) Filtering here is what actually hides an archived
    // product from checkout; without it an archived item with leftover stock
    // shows as sellable and only fails at the hub stock check.
    const activeOnly = getSellableProducts

    getProducts()
      .then((data) => {
        if (active) {
          setProducts(activeOnly(data))
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) setIsLoading(false)
      })

    const unsubscribe = subscribeProducts((data) => {
      if (active) setProducts(activeOnly(data))
    })
    const unsubscribeHeldSales = subscribeHeldSales((data) => {
      if (active) setHeldSales(data)
    })
    const refreshLedger = () => {
      if (active) setCustomers(getCustomerLedger())
    }
    const unsubscribeLedger = subscribeLedger(refreshLedger)
    const unsubscribeSettings = subscribeSettings(setSettings)

    refreshLedger()

    return () => {
      active = false
      unsubscribe()
      unsubscribeHeldSales()
      unsubscribeLedger()
      unsubscribeSettings()
    }
  }, [])

  return { products, isLoading, heldSales, customers, settings }
}
