import { getCurrentUser, recordAuditEvent } from "./security.service"
import { enqueueSyncOperation } from "./sync.service"

const DAILY_CLOSES_KEY = "lebanonpos.daily-closes.v1"
const DAILY_CLOSES_EVENT = "lebanonpos-daily-closes-changed"

export type DailyClose = {
  id: string
  dateKey: string
  grossSales: number
  refunds: number
  netSales: number
  costOfGoods: number
  returnedCost: number
  grossMargin: number
  expenses: number
  supplierPayments?: number
  netProfit: number
  cashIn: number
  cashOut: number
  note: string
  closedBy: string
  createdAt: string
}

export type CloseBusinessDayInput = Omit<
  DailyClose,
  "id" | "closedBy" | "createdAt"
>

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function readDailyCloses() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(DAILY_CLOSES_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as DailyClose[]) : []
  } catch {
    console.warn(`[dailyClose.service] Failed to parse storage key`)
    return []
  }
}

function writeDailyCloses(dailyCloses: DailyClose[]) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(DAILY_CLOSES_KEY, JSON.stringify(dailyCloses))
  window.dispatchEvent(new Event(DAILY_CLOSES_EVENT))
}

export function getDailyCloses() {
  return readDailyCloses()
}

export function closeBusinessDay(input: CloseBusinessDayInput) {
  const user = getCurrentUser()
  const close: DailyClose = {
    ...input,
    id: crypto.randomUUID(),
    note: input.note.trim(),
    closedBy: user.name,
    createdAt: new Date().toISOString(),
  }
  const previousCloses = getDailyCloses().filter(
    (dailyClose) => dailyClose.dateKey !== close.dateKey
  )

  writeDailyCloses([close, ...previousCloses])
  recordAuditEvent({
    action: "day.close",
    entity: "accounting",
    summary: `${close.dateKey} closed with ${close.netProfit.toFixed(
      2
    )} net profit.`,
    metadata: {
      dateKey: close.dateKey,
      netSales: close.netSales,
      expenses: close.expenses,
      netProfit: close.netProfit,
    },
  })
  enqueueSyncOperation({
    entity: "daily-close",
    action: "close",
    summary: `${close.dateKey} daily close queued for sync.`,
    payload: close,
  })

  return close
}

export function subscribeDailyCloses(callback: (dailyCloses: DailyClose[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleDailyClosesChanged() {
    callback(getDailyCloses())
  }

  window.addEventListener(DAILY_CLOSES_EVENT, handleDailyClosesChanged)
  window.addEventListener("storage", handleDailyClosesChanged)

  return () => {
    window.removeEventListener(DAILY_CLOSES_EVENT, handleDailyClosesChanged)
    window.removeEventListener("storage", handleDailyClosesChanged)
  }
}
