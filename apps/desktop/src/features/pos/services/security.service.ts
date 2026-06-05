import { enqueueSyncOperation, getApiUrl } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

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
  pinChanged: boolean
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
    pinChanged: false,
  },
  {
    id: "user-manager",
    name: "Store Manager",
    mobile: "+961 70 000 000",
    pin: "D/4avRoIIVNTwjPW4AlhPpXuxCU4Mqdhryj/N6xaFQw=",
    role: "Manager",
    active: true,
    createdAt: new Date().toISOString(),
    pinChanged: false,
  },
  {
    id: "user-cashier",
    name: "Cashier",
    mobile: "+961 71 000 000",
    pin: "7e4p+IJUO5VmILJtDuDn6VA5mxxCIvXeBeBkJbTJlek=",
    role: "Cashier",
    active: true,
    createdAt: new Date().toISOString(),
    pinChanged: false,
  },
]

export async function hashPin(pin: string): Promise<string> {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(pin)
    if (typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function") {
      const hashBuffer = await crypto.subtle.digest("SHA-256", data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return btoa(String.fromCharCode(...hashArray))
    }
  } catch { /* crypto.subtle unavailable — fall through */ }
  return sha256Base64(pin)
}

/** Synchronous SHA-256 fallback for insecure contexts (plain HTTP on mobile). */
function sha256Base64(msg: string): string {
  // ── SHA-256 constants & helpers ──────────────────────────────────────────
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const R = (n: number, x: number) => (x >>> n) | (x << (32 - n))
  const enc = new TextEncoder()
  const bytes = enc.encode(msg)
  const bitLen = bytes.length * 8
  // pad message
  const ml = (((bytes.length + 9 + 63) >>> 6) << 6) * 4
  const m = new Uint8Array(ml)
  m.set(bytes)
  m[bytes.length] = 0x80
  const dv = new DataView(m.buffer)
  dv.setUint32(ml - 4, bitLen >>> 0, false)
  dv.setUint32(ml - 8, 0, false)

  let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a
  let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19
  const W = new Uint32Array(64)
  const dv2 = new DataView(m.buffer)

  for (let i = 0; i < ml / 64; i++) {
    for (let j = 0; j < 16; j++) { W[j] = dv2.getUint32((i * 64) + (j * 4), false) }
    for (let j = 16; j < 64; j++) {
      const s0 = R(7, W[j - 15]) ^ R(18, W[j - 15]) ^ (W[j - 15] >>> 3)
      const s1 = R(17, W[j - 2]) ^ R(19, W[j - 2]) ^ (W[j - 2] >>> 10)
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0
    }
    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7
    for (let j = 0; j < 64; j++) {
      const S1 = R(6, e) ^ R(11, e) ^ R(25, e)
      const ch = (e & f) ^ ((~e) & g)
      const temp1 = (h + S1 + ch + K[j] + W[j]) >>> 0
      const S0 = R(2, a) ^ R(13, a) ^ R(22, a)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0
    H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0
  }
  // produce base64 digest
  const out = new Uint8Array(32)
  const dvOut = new DataView(out.buffer)
  dvOut.setUint32(0, H0, false)
  dvOut.setUint32(4, H1, false)
  dvOut.setUint32(8, H2, false)
  dvOut.setUint32(12, H3, false)
  dvOut.setUint32(16, H4, false)
  dvOut.setUint32(20, H5, false)
  dvOut.setUint32(24, H6, false)
  dvOut.setUint32(28, H7, false)
  return btoa(String.fromCharCode(...new Uint8Array(out.buffer)))
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

  console.log("[unlockWithPin] users:", users.length, "users:", users.map((u) => ({ id: u.id, name: u.name, pinPrefix: u.pin.slice(0, 8) })))
  console.log("[unlockWithPin] pinHash:", pinHash, "cleanPin:", cleanPin)

  // Collect every active user whose PIN matches, then prefer the highest-privilege role
  // (handles seeded accounts that all share the same PIN, e.g. 0000).
  const rolePriority: Record<string, number> = { Admin: 4, Manager: 3, Cashier: 2, Driver: 1 }
  const matches = users.filter(
    (staffUser) =>
      staffUser.active && (staffUser.pin === pinHash || staffUser.pin === cleanPin)
  )
  console.log("[unlockWithPin] matches:", matches.length, matches.map((u) => u.name))

  // If no local match, try the API (handles cloud-synced users with bcrypt PINs on the hub)
  if (matches.length === 0) {
    const apiUrl = getApiUrl()
    if (apiUrl) {
      try {
        const res = await fetch(`${apiUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: cleanPin }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data?.user?.id) {
            // Update this user's PIN from bcrypt to SHA-256 for future offline unlocks
            for (const u of users) {
              if (u.id === data.user.id) {
                u.pin = pinHash
                u.pinChanged = true
                writeCollection(USERS_KEY, users)
                console.log("[unlockWithPin] converted bcrypt PIN to SHA-256 for", u.name)
                matches.push(u)
                break
              }
            }
          }
        }
      } catch (e) {
        console.warn("[unlockWithPin] API fallback failed:", e)
      }
    }
  }

  const user = matches.sort(
    (a, b) => (rolePriority[b.role] ?? 0) - (rolePriority[a.role] ?? 0)
  )[0]

  if (!user) {
    console.log("[unlockWithPin] NO USER MATCHED")
    recordAuditEvent({
      action: "security.login.failed",
      entity: "security",
      summary: "Failed PIN unlock attempt.",
    })
    return null
  }

  console.log("[unlockWithPin] matched user:", user.name, user.role, "pinChanged:", user.pinChanged)

  if (user.pin === cleanPin) {
    user.pin = pinHash
    user.pinChanged = true
    writeCollection(USERS_KEY, users)
  } else if (user.pin === pinHash && !user.pinChanged) {
    // PIN matched via hash (already set by server or prior change) — no change needed
    user.pinChanged = true
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
    pinChanged: false,
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

export function mustChangePin(user: StaffUser): boolean {
  return !user.pinChanged
}

export async function updateUser(userId: string, patch: Partial<StaffUser>) {
  const users = getUsers()
  const resolvedPatch = { ...patch }
  if (resolvedPatch.pin) {
    resolvedPatch.pin = await hashPin(resolvedPatch.pin)
    resolvedPatch.pinChanged = true
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
