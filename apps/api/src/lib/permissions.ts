// POS-PERMISSIONS-1 (phase 3): server-side mirror of the client permission
// model, used to enforce the money/admin-sensitive subset on the sync push path.
// Kept self-contained (no cross-app import). Must stay in step with the client
// catalog in apps/desktop/.../security.service.ts.

export type Permission = string

const ALL_PERMISSIONS: Permission[] = [
  "sales.checkout", "sales.discount", "sales.price_override", "sales.refund", "sales.void", "sales.reprint",
  "inventory.view", "inventory.manage", "inventory.receive", "inventory.adjust",
  "customers.manage", "suppliers.manage",
  "reports.view", "accounting.manage", "cash.manage", "shifts.manage",
  "staff.manage", "settings.manage", "delivery.manage",
]

const ROLE_PRESETS: Record<string, Permission[]> = {
  Admin: [...ALL_PERMISSIONS],
  Manager: ALL_PERMISSIONS.filter((p) => p !== "staff.manage" && p !== "settings.manage"),
  Cashier: ["sales.checkout", "sales.reprint", "inventory.view"],
  Driver: ["delivery.manage"],
  // "Owner" is referenced in some legacy code paths — treat as full access.
  Owner: [...ALL_PERMISSIONS],
}

/** Expand legacy coarse permissions into the granular gates (idempotent). */
function expandLegacyPermissions(perms: Permission[]): Permission[] {
  const set = new Set<Permission>(perms)
  if (set.has("inventory.manage")) { set.add("inventory.view"); set.add("inventory.receive"); set.add("inventory.adjust") }
  if (set.has("inventory.receive") || set.has("inventory.adjust")) set.add("inventory.view")
  if (set.has("accounting.manage")) { set.add("suppliers.manage"); set.add("cash.manage") }
  return [...set]
}

/** Effective permissions: explicit set if present, else the role preset — both expanded. */
export function effectivePermissions(perms: Permission[] | null | undefined, role: string | null | undefined): Permission[] {
  const base = perms && perms.length > 0 ? perms : (ROLE_PRESETS[role ?? ""] ?? [])
  return expandLegacyPermissions(base)
}

/** The permission a sync op requires, or null if it isn't in the enforced subset.
 *  Deliberately limited to money/admin-sensitive operations to bound blast radius;
 *  everyday operational ops (sale-create, product/inventory/customer edits, shifts)
 *  stay client-enforced for now. */
export function requiredPermissionForOp(entity: string, action: string, payload: unknown): Permission | null {
  switch (entity) {
    case "sale":
      if (action === "void") return "sales.void"
      if (action === "create") {
        // Applying a discount at checkout requires sales.discount.
        const p = (payload ?? {}) as Record<string, unknown>
        const discount = Number(p.discountTotal ?? p.discount ?? 0)
        if (discount > 0) return "sales.discount"
      }
      return null
    case "refund": return "sales.refund"
    case "cash-movement": return "cash.manage"
    case "expense": return "accounting.manage"
    case "daily-close": return "accounting.manage"
    case "staff": return "staff.manage"
    case "settings": return "settings.manage"
    case "supplier-payment": return "suppliers.manage"
    case "purchase-order": return "suppliers.manage"
    default: return null
  }
}
