import type { Product } from "../types/product"

import { writeLocalWithIndexedDB } from "./storage.service"

const HELD_SALES_KEY = "lebanonpos.held-sales.v1"
const HELD_SALES_EVENT = "lebanonpos-held-sales-changed"

export type HeldSaleItem = Product & {
  quantity: number
}

export type HeldSale = {
  id: string
  holdNumber: string
  items: HeldSaleItem[]
  paymentMethod: "Cash" | "Card" | "Wallet" | "Debt"
  selectedCustomerId: string
  discountMode: "USD" | "Percent"
  discountValue: string
  note: string
  createdAt: string
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function readHeldSales() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(HELD_SALES_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as HeldSale[]) : []
  } catch {
    console.warn(`[heldSale.service] Failed to parse storage key`)
    return []
  }
}

function writeHeldSales(heldSales: HeldSale[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(HELD_SALES_KEY, heldSales)
  window.dispatchEvent(new Event(HELD_SALES_EVENT))
}

export function getHeldSales() {
  return readHeldSales()
}

export function holdSale(input: Omit<HeldSale, "id" | "holdNumber" | "createdAt">) {
  const heldSales = getHeldSales()
  const heldSale: HeldSale = {
    ...input,
    id: crypto.randomUUID(),
    holdNumber: `H-${Date.now().toString().slice(-6)}`,
    createdAt: new Date().toISOString(),
  }

  writeHeldSales([heldSale, ...heldSales])

  return heldSale
}

export function removeHeldSale(heldSaleId: string) {
  writeHeldSales(getHeldSales().filter((heldSale) => heldSale.id !== heldSaleId))
}

export function subscribeHeldSales(callback: (heldSales: HeldSale[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleHeldSalesChanged() {
    callback(getHeldSales())
  }

  window.addEventListener(HELD_SALES_EVENT, handleHeldSalesChanged)
  window.addEventListener("storage", handleHeldSalesChanged)

  return () => {
    window.removeEventListener(HELD_SALES_EVENT, handleHeldSalesChanged)
    window.removeEventListener("storage", handleHeldSalesChanged)
  }
}
