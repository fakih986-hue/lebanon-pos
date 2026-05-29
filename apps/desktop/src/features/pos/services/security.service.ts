import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SESSION_KEY = "lebanonpos.session.v1"
const SHIFTS_KEY = "lebanonpos.shifts.v1"
const AUDIT_KEY = "lebanonpos.audit.v1"
const SECURITY_EVENT = "lebanonpos-security-changed"

export type UserRole = "Admin" | "Manager" | "Cashier"

export type Permission =
  | "sales.checkout"
  | "sales.discount"
  | "sales.refund"
  | "sales.void"
  | "inventory.manage"
  | "customers.manage"
  | "reports.view"
  | "accounting.manage"
  | "settings.manage"
  | "staff.manage"
  | "shifts.manage"
  | "delivery.manage"

export type StaffUser = {
  id: string
  name: string
  mobile: string
  pin: string // SHA-256 hash
  role: UserRole
  active: boolean
  createdAt: string
}

export type SecuritySession = {
  userId: string
  unlockedAt: string
}

export type ShiftStatus = "Open" | "Closed"

export type Shift = {
  id: string
  shiftNumber: string
  status: ShiftStatus
  openedAt: string
  closedAt?: string
  openingFloatUsd: number
  cashSalesUsd?: number
  cashRefundsUsd?: number
  cashExpensesUsd?: number
  supplierPaymentsUsd?: number
  expectedCashUsd?: number
  closingCashUsd?: number
  differenceUsd?: number
  openedById: string
  openedByName: string
  closedById?: string
  closedByName?: string
  notes?: string
}

export type AuditEvent = {
  id: string
  action: string
  entity: string
  summary: string
  metadata?: Record<string, string | number | boolean | null | undefined>
  userId: string
  userName: string
  userRole: UserRole
  createdAt: string
}

export type RecordAuditInput = {
  action: string
  entity: string
  summary: string
  metadata?: AuditEvent["metadata"]
}

export const rolePermissions: Record<UserRole, Permission[]> = {
  Admin: [
    "sales.checkout",
    "sales.discount",
    "sales.refund",
    "sales.void",
    "inventory.manage",
    "customers.manage",
    "reports.view",
    "accounting.manage",
    "settings.manage",
    "staff.manage",
    "shifts.manage",
    "delivery.manage",
  ],
  Manager: [
    "sales.checkout",
    "sales.discount",
    "sales.refund",
    "sales.void",
    "inventory.manage",
    "customers.manage",
    "reports.view",
    "accounting.manage",
    "shifts.manage",
    "delivery.manage",
  ],
  Cashier: ["sales.checkout", "customers.manage"],
}

const initialUsers: StaffUser[] = [
  {
    id: "user-admin",
    name: "Domain Admin",
    mobile: "+961 00 000 000",
    pin: "mvFbM25qlhmShTffMLLmojdlafz51+dz7M7eZWBlKaA=",
    role: "Admin",
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user-manager",
    name: "Store Manager",
    mobile: "+961 70 000 000",
    pin: "D/4avRoIIVNTwjPW4AlhPpXuxCU4Mqdhryj/N6xaFQw=",
    role: "Manager",
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user-cashier",
    name: "Cashier",
    mobile: "+961 71 000 000",
    pin: "7e4p+IJUO5VmILJtDuDn6VA5mxxCIvXeBeBkJbTJlek=",
    role: "Cashier",
    active: true,
    createdAt: new Date().toISOString(),
  },
]

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashBase64 = btoa(String.fromCharCode(...hashArray))
  return hashBase64
}

function dispatchSecurityChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SECURITY_EVENT))
  }
}

function readCollection<T>(key: string, fallback: T[]) {
  if (!canUseStorage()) {
    return fallback
  }

  const storedValue = window.localStorage.getItem(key)

  if (!storedValue) {
    return fallback
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as T[]) : fallback
  } catch {
    console.warn(`[security.service] Failed to parse storage key`)
    return fallback
  }
}

function writeCollection<T>(key: string, value: T[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(key, value)
  dispatchSecurityChanged()
}

function ensureSecurityData() {
  if (!canUseStorage()) {
    return
  }

  if (!window.localStorage.getItem(USERS_KEY)) {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(initialUsers))
  }

  if (!window.localStorage.getItem(CURRENT_USER_KEY)) {
    window.localStorage.setItem(CURRENT_USER_KEY, initialUsers[0].id)
  }

  if (!window.localStorage.getItem(SHIFTS_KEY)) {
    const shift: Shift = {
      id: "shift-preview",
      shiftNumber: "SHIFT-001",
      status: "Open",
      openedAt: new Date().toISOString(),
      openingFloatUsd: 250,
      openedById: initialUsers[0].id,
      openedByName: initialUsers[0].name,
    }

    window.localStorage.setItem(SHIFTS_KEY, JSON.stringify([shift]))
  }

  if (!window.localStorage.getItem(AUDIT_KEY)) {
    const event: AuditEvent = {
      id: "audit-preview",
      action: "system.ready",
      entity: "system",
      summary: "Security, shift, and audit controls initialized.",
      userId: initialUsers[0].id,
      userName: initialUsers[0].name,
      userRole: initialUsers[0].role,
      createdAt: new Date().toISOString(),
    }

    window.localStorage.setItem(AUDIT_KEY, JSON.stringify([event]))
  }
}

function getStoredSession() {
  if (!canUseStorage()) {
    return null
  }

  const storedValue = window.localStorage.getItem(SESSION_KEY)

  if (!storedValue) {
    return null
  }

  try {
    return JSON.parse(storedValue) as SecuritySession
  } catch {
    console.warn(`[security.service] Failed to parse storage key`)
    return null
  }
}

export function getUsers() {
  ensureSecurityData()

  return readCollection<StaffUser>(USERS_KEY, initialUsers)
}

export function getCurrentUser() {
  ensureSecurityData()

  const users = getUsers()
  const currentUserId = canUseStorage()
    ? window.localStorage.getItem(CURRENT_USER_KEY)
    : undefined

  return (
    users.find((user) => user.id === currentUserId && user.active) ??
    users.find((user) => user.active) ??
    initialUsers[0]
  )
}

export function getSecuritySession() {
  ensureSecurityData()

  return getStoredSession()
}

export function isSessionUnlocked() {
  const session = getStoredSession()

  if (!session) {
    return false
  }

  return getUsers().some((user) => user.id === session.userId && user.active)
}

export async function unlockWithPin(pin: string) {
  if (!canUseStorage()) {
    return null
  }

  const cleanPin = pin.trim()
  const pinHash = await hashPin(cleanPin)
  const users = getUsers()

  // Collect every active user whose PIN matches, then prefer the highest-privilege role
  // (handles seeded accounts that all share the same PIN, e.g. 0000).
  const rolePriority: Record<string, number> = { Admin: 4, Manager: 3, Cashier: 2, Driver: 1 }
  const matches = users.filter(
    (staffUser) =>
      staffUser.active && (staffUser.pin === pinHash || staffUser.pin === cleanPin)
  )
  const user = matches.sort(
    (a, b) => (rolePriority[b.role] ?? 0) - (rolePriority[a.role] ?? 0)
  )[0]

  if (!user) {
    recordAuditEvent({
      action: "security.login.failed",
      entity: "security",
      summary: "Failed PIN unlock attempt.",
    })
    return null
  }

  if (user.pin === cleanPin) {
    user.pin = pinHash
    writeCollection(USERS_KEY, users)
  }

  const session: SecuritySession = {
    userId: user.id,
    unlockedAt: new Date().toISOString(),
  }

  window.localStorage.setItem(CURRENT_USER_KEY, user.id)
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  recordAuditEvent({
    action: "security.login",
    entity: "security",
    summary: `${user.name} unlocked the register.`,
    metadata: {
      role: user.role,
    },
  })
  dispatchSecurityChanged()

  return user
}

export function lockSession() {
  if (!canUseStorage()) {
    return
  }

  const user = getCurrentUser()

  window.localStorage.removeItem(SESSION_KEY)
  recordAuditEvent({
    action: "security.lock",
    entity: "security",
    summary: `${user.name} locked the register.`,
  })
  dispatchSecurityChanged()
}

export function setCurrentUser(userId: string) {
  if (!canUseStorage()) {
    return
  }

  const user = getUsers().find((staffUser) => staffUser.id === userId)

  if (!user) {
    return
  }

  window.localStorage.setItem(CURRENT_USER_KEY, userId)
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId,
      unlockedAt: new Date().toISOString(),
    } satisfies SecuritySession)
  )
  recordAuditEvent({
    action: "staff.switch",
    entity: "staff",
    summary: `Active operator switched to ${user.name}.`,
    metadata: {
      role: user.role,
    },
  })
  dispatchSecurityChanged()
}

export async function createUser(input: {
  name: string
  mobile: string
  pin: string
  role: UserRole
}) {
  const now = new Date().toISOString()
  const user: StaffUser = {
    id: createId("user"),
    name: input.name.trim(),
    mobile: input.mobile.trim(),
    pin: await hashPin(input.pin.trim()),
    role: input.role,
    active: true,
    createdAt: now,
  }

  writeCollection(USERS_KEY, [user, ...getUsers()])
  recordAuditEvent({
    action: "staff.create",
    entity: "staff",
    summary: `${user.name} was added as ${user.role}.`,
    metadata: {
      staffUserId: user.id,
      role: user.role,
    },
  })
  enqueueSyncOperation({
    entity: "staff",
    action: "create",
    summary: `${user.name} staff profile queued for sync.`,
    payload: user,
  })

  return user
}

export async function updateUser(userId: string, patch: Partial<StaffUser>) {
  const users = getUsers()
  const resolvedPatch = { ...patch }
  if (resolvedPatch.pin) {
    resolvedPatch.pin = await hashPin(resolvedPatch.pin)
  }
  const nextUsers = users.map((user) =>
    user.id === userId
      ? {
          ...user,
          ...resolvedPatch,
          id: user.id,
          createdAt: user.createdAt,
        }
      : user
  )
  const updatedUser = nextUsers.find((user) => user.id === userId)

  writeCollection(USERS_KEY, nextUsers)

  if (updatedUser) {
    recordAuditEvent({
      action: "staff.update",
      entity: "staff",
      summary: `${updatedUser.name} was updated.`,
      metadata: {
        staffUserId: updatedUser.id,
        role: updatedUser.role,
        active: updatedUser.active,
      },
    })
    enqueueSyncOperation({
      entity: "staff",
      action: "update",
      summary: `${updatedUser.name} staff update queued for sync.`,
      payload: updatedUser,
    })
  }
}

export function userCan(permission: Permission, user = getCurrentUser()) {
  return rolePermissions[user.role].includes(permission)
}

export function getAuditEvents() {
  ensureSecurityData()

  return readCollection<AuditEvent>(AUDIT_KEY, [])
}

export function recordAuditEvent(input: RecordAuditInput) {
  const user = getCurrentUser()
  const event: AuditEvent = {
    id: createId("audit"),
    action: input.action,
    entity: input.entity,
    summary: input.summary,
    metadata: input.metadata,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    createdAt: new Date().toISOString(),
  }

  writeCollection(AUDIT_KEY, [event, ...getAuditEvents()].slice(0, 500))

  return event
}

export function getShifts() {
  ensureSecurityData()

  return readCollection<Shift>(SHIFTS_KEY, [])
}

export function getActiveShift() {
  return getShifts().find((shift) => shift.status === "Open")
}

export function openShift(openingFloatUsd: number) {
  const user = getCurrentUser()
  const shifts = getShifts()
  const openShiftNow = shifts.find((shift) => shift.status === "Open")

  if (openShiftNow) {
    return openShiftNow
  }

  const shift: Shift = {
    id: createId("shift"),
    shiftNumber: `SHIFT-${String(shifts.length + 1).padStart(3, "0")}`,
    status: "Open",
    openedAt: new Date().toISOString(),
    openingFloatUsd,
    openedById: user.id,
    openedByName: user.name,
  }

  writeCollection(SHIFTS_KEY, [shift, ...shifts])
  recordAuditEvent({
    action: "shift.open",
    entity: "shift",
    summary: `${shift.shiftNumber} opened with $${openingFloatUsd.toFixed(2)}.`,
    metadata: {
      shiftId: shift.id,
      openingFloatUsd,
    },
  })
  enqueueSyncOperation({
    entity: "shift",
    action: "open",
    summary: `${shift.shiftNumber} opening queued for sync.`,
    payload: shift,
  })

  return shift
}

export function closeShift(input: {
  shiftId: string
  cashSalesUsd?: number
  cashRefundsUsd?: number
  cashExpensesUsd?: number
  supplierPaymentsUsd?: number
  expectedCashUsd: number
  closingCashUsd: number
  notes?: string
}) {
  const user = getCurrentUser()
  const shifts = getShifts()
  const differenceUsd = input.closingCashUsd - input.expectedCashUsd
  let closedShift: Shift | undefined

  const nextShifts = shifts.map((shift) => {
    if (shift.id !== input.shiftId) {
      return shift
    }

    closedShift = {
      ...shift,
      status: "Closed",
      closedAt: new Date().toISOString(),
      cashSalesUsd: input.cashSalesUsd ?? 0,
      cashRefundsUsd: input.cashRefundsUsd ?? 0,
      cashExpensesUsd: input.cashExpensesUsd ?? 0,
      supplierPaymentsUsd: input.supplierPaymentsUsd ?? 0,
      expectedCashUsd: input.expectedCashUsd,
      closingCashUsd: input.closingCashUsd,
      differenceUsd,
      closedById: user.id,
      closedByName: user.name,
      notes: input.notes?.trim(),
    }

    return closedShift
  })

  writeCollection(SHIFTS_KEY, nextShifts)

  if (closedShift) {
    recordAuditEvent({
      action: "shift.close",
      entity: "shift",
      summary: `${closedShift.shiftNumber} closed with $${differenceUsd.toFixed(
        2
      )} difference.`,
      metadata: {
        shiftId: closedShift.id,
        cashSalesUsd: input.cashSalesUsd ?? 0,
        cashRefundsUsd: input.cashRefundsUsd ?? 0,
        cashExpensesUsd: input.cashExpensesUsd ?? 0,
        supplierPaymentsUsd: input.supplierPaymentsUsd ?? 0,
        expectedCashUsd: input.expectedCashUsd,
        closingCashUsd: input.closingCashUsd,
        differenceUsd,
      },
    })
    enqueueSyncOperation({
      entity: "shift",
      action: "close",
      summary: `${closedShift.shiftNumber} closing queued for sync.`,
      payload: closedShift,
    })
  }

  return closedShift
}

export function subscribeSecurity(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleSecurityChanged() {
    callback()
  }

  window.addEventListener(SECURITY_EVENT, handleSecurityChanged)
  window.addEventListener("storage", handleSecurityChanged)

  return () => {
    window.removeEventListener(SECURITY_EVENT, handleSecurityChanged)
    window.removeEventListener("storage", handleSecurityChanged)
  }
}
