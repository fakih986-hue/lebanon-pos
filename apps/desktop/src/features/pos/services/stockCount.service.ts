import {
  recordStockAdjustment,
  type StockAdjustmentReason,
} from "./inventoryAdjustment.service"
import { getProductsSync } from "./product.service"
import { recordAuditEvent } from "./security.service"
import { enqueueSyncOperation } from "./sync.service"

const STOCK_COUNTS_KEY = "lebanonpos.stock-counts.v1"
const STOCK_COUNTS_EVENT = "lebanonpos-stock-counts-changed"

export type StockCountStatus = "Draft" | "Completed"

export type StockCountLine = {
  productId: number
  productName: string
  barcode: string
  category: string
  expectedQuantity: number
  countedQuantity?: number
  variance: number
  valueImpact: number
}

export type StockCountSession = {
  id: string
  countNumber: string
  status: StockCountStatus
  createdAt: string
  completedAt?: string
  lines: StockCountLine[]
  totalVariance: number
  totalValueImpact: number
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function readCounts() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(STOCK_COUNTS_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as StockCountSession[]) : []
  } catch {
    console.warn(`[stockCount.service] Failed to parse storage key`)
    return []
  }
}

function writeCounts(counts: StockCountSession[]) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(STOCK_COUNTS_KEY, JSON.stringify(counts))
  window.dispatchEvent(new Event(STOCK_COUNTS_EVENT))
}

function summarizeLines(lines: StockCountLine[]) {
  return {
    totalVariance: lines.reduce((sum, line) => sum + line.variance, 0),
    totalValueImpact: lines.reduce((sum, line) => sum + line.valueImpact, 0),
  }
}

function createCountNumber(count: number) {
  return `COUNT-${String(count + 1).padStart(5, "0")}`
}

export function getStockCounts() {
  return readCounts()
}

export function getActiveStockCount() {
  return getStockCounts().find((session) => session.status === "Draft")
}

export function startStockCount() {
  const activeCount = getActiveStockCount()

  if (activeCount) {
    return activeCount
  }

  const counts = getStockCounts()
  const lines = getProductsSync().map<StockCountLine>((product) => ({
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    category: product.category,
    expectedQuantity: product.stock,
    variance: 0,
    valueImpact: 0,
  }))
  const session: StockCountSession = {
    id: createId("stock-count"),
    countNumber: createCountNumber(counts.length),
    status: "Draft",
    createdAt: new Date().toISOString(),
    lines,
    totalVariance: 0,
    totalValueImpact: 0,
  }

  writeCounts([session, ...counts])
  recordAuditEvent({
    action: "inventory.count.start",
    entity: "inventory",
    summary: `${session.countNumber} physical count started.`,
    metadata: {
      lineCount: lines.length,
    },
  })

  return session
}

export function updateStockCountLine(
  sessionId: string,
  productId: number,
  countedQuantity: number
) {
  let updatedSession: StockCountSession | undefined
  const products = getProductsSync()
  const counts = getStockCounts().map((session) => {
    if (session.id !== sessionId || session.status !== "Draft") {
      return session
    }

    const lines = session.lines.map((line) => {
      if (line.productId !== productId) {
        return line
      }

      const product = products.find((item) => item.id === productId)
      const expectedQuantity = product?.stock ?? line.expectedQuantity
      const safeCountedQuantity = Math.max(0, countedQuantity)
      const variance = safeCountedQuantity - expectedQuantity

      return {
        ...line,
        expectedQuantity,
        countedQuantity: safeCountedQuantity,
        variance,
        valueImpact: variance * (product?.cost ?? 0),
      }
    })
    const summary = summarizeLines(lines)

    updatedSession = {
      ...session,
      lines,
      ...summary,
    }

    return updatedSession
  })

  writeCounts(counts)

  return updatedSession
}

export function completeStockCount(sessionId: string) {
  let completedSession: StockCountSession | undefined
  const reason: StockAdjustmentReason = "Count Correction"
  const counts = getStockCounts().map((session) => {
    if (session.id !== sessionId || session.status !== "Draft") {
      return session
    }

    session.lines
      .filter(
        (line) =>
          typeof line.countedQuantity === "number" && line.variance !== 0
      )
      .forEach((line) => {
        recordStockAdjustment({
          productId: line.productId,
          quantityChange: line.variance,
          reason,
          note: `${session.countNumber} physical count variance.`,
        })
      })

    completedSession = {
      ...session,
      status: "Completed",
      completedAt: new Date().toISOString(),
    }

    return completedSession
  })

  writeCounts(counts)

  if (completedSession) {
    recordAuditEvent({
      action: "inventory.count.complete",
      entity: "inventory",
      summary: `${completedSession.countNumber} completed with ${completedSession.totalVariance} net units variance.`,
      metadata: {
        totalVariance: completedSession.totalVariance,
        totalValueImpact: completedSession.totalValueImpact,
      },
    })
    enqueueSyncOperation({
      entity: "inventory",
      action: "count",
      summary: `${completedSession.countNumber} stock count queued for sync.`,
      payload: completedSession,
    })
  }

  return completedSession
}

export function subscribeStockCounts(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  window.addEventListener(STOCK_COUNTS_EVENT, callback)
  window.addEventListener("storage", callback)

  return () => {
    window.removeEventListener(STOCK_COUNTS_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}
