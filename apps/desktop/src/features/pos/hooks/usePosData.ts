import { useEffect, useState } from "react"
import { getProducts, subscribeProducts } from "../services/product.service"
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

    getProducts()
      .then((data) => {
        if (active) {
          setProducts(data)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) setIsLoading(false)
      })

    const unsubscribe = subscribeProducts((data) => {
      if (active) setProducts(data)
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
