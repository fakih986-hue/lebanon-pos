// SPRINT-0 authorization for REST routes. The token's user is looked up in its own store and
// checked against its CURRENT effective permissions (role preset or explicit set).
//
// Store-level tokens without a staff row act as the store itself (full access to THAT store only):
//   - "__admin__" with a tenantId: the hub's localhost auto-login / owner tooling on a hub;
//   - "cloud-bridge": a hub's sync connection authenticated by the store's cloud key.
// The platform owner ("__admin__" with no tenantId) has no store permissions here; a route that
// serves the platform owner across stores must say so explicitly (allowPlatformOwner).
// Any other token without an active staff row in the token's store (customers, deleted or
// deactivated staff, another store's staff) has NO permissions — fail closed.
//
// SPRINT-2 hub batch — a store that ENFORCES staff identity (lib/staffPolicy.ts, mode "enforce"): a
// register's connection token (use "transport", or an older token without "use") and the hub's own
// screen ("__admin__" with a store) carry no personal authority. The acting person is the person of the
// server-checked staff session the register presents (x-staff-session) on its enrolled device
// (x-device-credential); without one, nobody. A person's own sign-in (use "person", the admin app) acts
// as that person. The hub's link to the cloud ("cloud-bridge") stays store-level: what it forwards is
// authorized per operation from the hub's signed evidence (routes/sync.ts).
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { effectivePermissions } from "../lib/permissions.js"
import { json, tokenKind, type AuthRequest } from "./auth.js"
import { checkDevice, checkSession } from "../lib/credentials.js"
import { asMode, enforcesAll, type StaffMode } from "../lib/staffPolicy.js"

const STORE_LEVEL = new Set(["__admin__", "cloud-bridge"])
const cache = new WeakMap<object, Promise<Acting>>()

/** Who is acting on this request, and with which permissions. */
export type Acting = {
  /** "person": a person's own token (or any staff token in a store that does not enforce); "session": the
   *  person of a verified staff session on an enrolled register; "store": a store-level token; "none". */
  basis: "person" | "session" | "store" | "none"
  staffId: string | null
  name: string | null
  permissions: Set<string> | "store"
  mode: StaffMode
  /** Why nobody is acting (enforcing store, no verified session). */
  reason?: string
}

const header = (req: AuthRequest, name: string) => { const h = req.headers?.[name]; return typeof h === "string" && h ? h : undefined }

async function staffOf(tenantId: string, id: string) {
  const u = await prisma.staffUser.findFirst({ where: { id, tenantId, active: true }, select: { id: true, name: true, role: true, permissions: true } })
  return u ? { id: u.id, name: u.name, permissions: new Set<string>(effectivePermissions(u.permissions, u.role)) } : null
}

/** The acting person (see the header): cached per request. */
export function actingPerson(req: AuthRequest): Promise<Acting> {
  let p = cache.get(req)
  if (!p) {
    p = (async (): Promise<Acting> => {
      const auth = req.auth
      if (!auth?.tenantId) return { basis: "none", staffId: null, name: null, permissions: new Set(), mode: "observe" }
      const mode = asMode((await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { staffSessionMode: true } }))?.staffSessionMode)
      const kind = tokenKind(auth)
      if (auth.userId === "cloud-bridge") return { basis: "store", staffId: null, name: null, permissions: "store", mode }
      const enforced = enforcesAll(mode)
      if (!enforced || (kind === "staff" && auth.use === "person")) {
        if (STORE_LEVEL.has(auth.userId)) return { basis: "store", staffId: null, name: null, permissions: "store", mode }
        const u = await staffOf(auth.tenantId, auth.userId)
        return u ? { basis: "person", staffId: u.id, name: u.name, permissions: u.permissions, mode } : { basis: "none", staffId: null, name: null, permissions: new Set(), mode }
      }
      // enforcing: a register (or the hub's own screen) acts only as its verified session's person
      if (kind !== "staff" && kind !== "hub-local") return { basis: "none", staffId: null, name: null, permissions: new Set(), mode, reason: "not a staff credential" }
      const device = await checkDevice(header(req, "x-device-credential"), auth.tenantId)
      if (device.check !== "valid" || !device.deviceId) return { basis: "none", staffId: null, name: null, permissions: new Set(), mode, reason: `this store requires an enrolled register (device credential ${device.check})` }
      const session = await checkSession(header(req, "x-staff-session"), auth.tenantId, device.deviceId)
      if (session.check !== "valid" || !session.staffId || session.expired || session.ended) return { basis: "none", staffId: null, name: null, permissions: new Set(), mode, reason: `this store requires the person to sign in with a server PIN check (staff session ${session.check}${session.expired ? ", expired" : ""}${session.ended ? ", ended" : ""})` }
      const u = await staffOf(auth.tenantId, session.staffId)
      return u ? { basis: "session", staffId: u.id, name: u.name, permissions: u.permissions, mode } : { basis: "none", staffId: null, name: null, permissions: new Set(), mode, reason: "the signed-in person is not an active staff member" }
    })()
    cache.set(req, p)
  }
  return p
}

/** The caller's permissions in their own store, or "store" for a store-level token. */
export async function accessOf(req: AuthRequest): Promise<Set<string> | "store"> {
  return (await actingPerson(req)).permissions
}

/** True when the caller holds `perm` in its own store (store-level tokens always do). */
export async function can(req: AuthRequest, perm: string): Promise<boolean> {
  const a = await accessOf(req)
  return a === "store" || a.has(perm)
}

/** The platform owner's token (owner portal): "__admin__" not bound to any store. */
export function isPlatformOwner(req: AuthRequest): boolean {
  return req.auth?.userId === "__admin__" && !req.auth?.tenantId
}

type Guard = (req: AuthRequest, res: ServerResponse, next: () => void) => Promise<void>

/** Route guard: the caller must hold at least one of `anyOf`. Use after requireAuth. */
export function requirePermission(...anyOf: string[]): Guard {
  return guard(false, anyOf)
}

/** As requirePermission, and the platform owner is explicitly allowed (cross-store tooling). */
export function requirePermissionOrPlatformOwner(...anyOf: string[]): Guard {
  return guard(true, anyOf)
}

function guard(allowPlatformOwner: boolean, anyOf: string[]): Guard {
  return async (req, res, next) => {
    try {
      if (allowPlatformOwner && isPlatformOwner(req)) { next(); return }
      for (const perm of anyOf) if (await can(req, perm)) { next(); return }
      json(res, { error: "You don't have permission to do this", code: "FORBIDDEN", required: anyOf }, 403)
    } catch {
      json(res, { error: "Permission check failed" }, 500)
    }
  }
}

/** Marks the response so json() drops cost/profit/margin fields unless the caller holds reports.cost. */
export async function hideCostUnlessAllowed(req: AuthRequest, res: ServerResponse, next: () => void) {
  try {
    if (!(await can(req, "reports.cost"))) (res as { hideCost?: boolean }).hideCost = true
  } catch {
    (res as { hideCost?: boolean }).hideCost = true
  }
  next()
}
