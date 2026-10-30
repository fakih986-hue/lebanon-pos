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
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { effectivePermissions } from "../lib/permissions.js"
import { json, type AuthRequest } from "./auth.js"

const STORE_LEVEL = new Set(["__admin__", "cloud-bridge"])
const cache = new WeakMap<object, Promise<Set<string> | "store">>()

/** The caller's permissions in their own store, or "store" for a store-level token. */
export function accessOf(req: AuthRequest): Promise<Set<string> | "store"> {
  let p = cache.get(req)
  if (!p) {
    p = (async () => {
      const auth = req.auth
      if (!auth?.tenantId) return new Set<string>()
      if (STORE_LEVEL.has(auth.userId)) return "store" as const
      const u = await prisma.staffUser.findFirst({ where: { id: auth.userId, tenantId: auth.tenantId, active: true }, select: { role: true, permissions: true } })
      return new Set(u ? effectivePermissions(u.permissions, u.role) : [])
    })()
    cache.set(req, p)
  }
  return p
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
