import { getActiveShift, isDrawerShared, recordAuditEvent, requireCurrentUser } from "./security.service"
import { enqueueSyncOperation, assertCanWrite, getDeviceId } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"
import { getRegisterId } from "./settings.service"

const DAILY_CLOSES_KEY = "lebanonpos.daily-closes.v1"
const DAILY_CLOSES_EVENT = "lebanonpos-daily-closes-changed"

export type DailyClose = {
  id: string
  dateKey: string
  grossSales: number
  refunds: number
  netSales: number
  /** Cost figures are absent when a cost they depend on was unavailable (never sent as 0). */
  costOfGoods?: number
  returnedCost?: number
  grossMargin?: number
  expenses: number
  supplierPayments?: number
  netProfit?: number
  /** Where the cost figures come from: "server" (computed by the server from the sales and refunds
   *  this close counted), "complete" (stated by this till), "incomplete" (not known). Absent on
   *  closes recorded before it existed. */
  costStatus?: "server" | "complete" | "incomplete"
  cashIn: number
  cashOut: number
  note: string
  closedBy: string
  registerId?: string
  deviceId?: string
  /** The shift open on this register when it closed the day (absent: none was open). */
  shiftId?: string
  unsyncedCountAtClose?: number
  createdAt: string
  /** Which close this is (server: lib/dailyClose.ts). One per register and shift; a correction is a new
   *  revision that names the close it corrects, which is kept (supersededById). Absent on older rows. */
  scope?: string
  revision?: number
  revisionOf?: string | null
  correction?: "correction" | "re-close" | null
  supersededById?: string | null
  /** The close this one corrects, as sent (the server refuses a correction of a close since corrected). */
  correctsId?: string
}

export type CloseBusinessDayInput = Omit<
  DailyClose,
  "id" | "closedBy" | "createdAt" | "costStatus" | "scope" | "revision" | "revisionOf" | "correction" | "supersededById" | "correctsId" | "shiftId"
> & {
  /** The sales and refunds the close counted: the server values the day from its own records of them. */
  saleIds: string[]
  refundIds: string[]
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

  writeLocalWithIndexedDB(DAILY_CLOSES_KEY, dailyCloses)
  window.dispatchEvent(new Event(DAILY_CLOSES_EVENT))
}

export function getDailyCloses() {
  return readDailyCloses()
}

/** The scope a close of this register is recorded under (the server derives the same): this device (every
 *  register defaults to the label REG-001), else the register label; and the open shift. */
export function closeScopeOf(c: Pick<DailyClose, "registerId" | "deviceId" | "shiftId" | "scope">): string {
  if (c.scope) return c.scope
  const who = c.deviceId ? `device:${c.deviceId}` : c.registerId ? `register:${c.registerId}` : null
  return who ? `${who}${c.shiftId ? `|shift:${c.shiftId}` : ""}` : "store"
}

/** The closes reports use: the current revision of each register and shift (corrected closes are kept). */
export function currentDailyCloses(closes: DailyClose[] = readDailyCloses()): DailyClose[] {
  return closes.filter((c) => !c.supersededById)
}

/**
 * Who closes: this register (its device, and its shift if one is open), or — with one shared drawer — the
 * store's shared drawer as a whole, so a second register's close of the same date corrects the first one
 * instead of adding the same sales again.
 */
export const SHARED_DRAWER_REGISTER = "SHARED-DRAWER"
function closeIdentity(): Pick<DailyClose, "registerId" | "deviceId" | "shiftId"> {
  if (isDrawerShared()) return { registerId: SHARED_DRAWER_REGISTER }
  const shiftId = getActiveShift()?.id
  return { registerId: getRegisterId(), deviceId: getDeviceId(), ...(shiftId ? { shiftId } : {}) }
}

/** This register's current close of a date in its present scope (closing again corrects it), if any. */
export function currentCloseOf(dateKey: string, closes: DailyClose[] = readDailyCloses()): DailyClose | undefined {
  const scope = closeScopeOf(closeIdentity())
  return currentDailyCloses(closes).find((c) => c.dateKey === dateKey && closeScopeOf(c) === scope)
}

export function closeBusinessDay({ saleIds, refundIds, ...input }: CloseBusinessDayInput) {
  assertCanWrite("close business day")
  const user = requireCurrentUser()
  const known = [input.costOfGoods, input.returnedCost, input.grossMargin, input.netProfit].every((v) => typeof v === "number" && Number.isFinite(v))
  // Another register, or another shift, closes separately; closing this register's date again in the
  // same shift corrects its current close (named here; the corrected close is kept, not replaced).
  const corrected = currentCloseOf(input.dateKey)
  const id = createId()
  const close: DailyClose = {
    ...input,
    costStatus: known ? "complete" : "incomplete",
    id,
    ...closeIdentity(),
    note: input.note.trim(),
    closedBy: user.name,
    createdAt: new Date().toISOString(),
    revision: corrected ? (corrected.revision ?? 1) + 1 : 1,
    ...(corrected ? { revisionOf: corrected.id, correction: "correction" as const, correctsId: corrected.id } : {}),
  }
  close.scope = closeScopeOf(close)

  writeDailyCloses([close, ...getDailyCloses().map((c) => (corrected && c.id === corrected.id ? { ...c, supersededById: id } : c))])
  recordAuditEvent({
    action: "day.close",
    entity: "accounting",
    summary: (corrected ? `${close.dateKey} close corrected (revision ${close.revision}). ` : "") + (close.netProfit === undefined
      ? `${close.dateKey} closed (net profit not available).`
      : `${close.dateKey} closed with ${close.netProfit.toFixed(2)} net profit.`),
    metadata: {
      dateKey: close.dateKey,
      ...(corrected ? { corrects: corrected.id, revision: close.revision } : {}),
      netSales: close.netSales,
      expenses: close.expenses,
      netProfit: close.netProfit,
    },
  })
  enqueueSyncOperation({
    entity: "daily-close",
    action: "close",
    summary: `${close.dateKey} daily close queued for sync.`,
    // scope, revision and links are the server's to decide: the register says only what it corrects
    payload: (({ scope: _s, revision: _r, revisionOf: _o, correction: _c, supersededById: _x, ...sent }) => ({ ...sent, saleIds, refundIds }))(close),
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
