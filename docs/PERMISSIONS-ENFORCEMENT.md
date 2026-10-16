# Permission enforcement: what is checked, where, and what is not authenticated

Status: 2026-10-16. Covers shifts, drawer movements (owner draw, cash in/out) and expenses, plus the existing money-sensitive set (refund, void, discount, supplier payments, staff, settings).

## Where each rule is enforced

| Rule | Desktop UI | Desktop service | Server push (`/api/sync/push`) | Server REST |
|---|---|---|---|---|
| Open a shift: `sales.checkout` or `shifts.manage` | Disabled, with the reason | `openShift` throws `PermissionError` | Pushing account; named opener (`openedById`) | n/a |
| Close a shift: its opener or `shifts.manage` | Disabled, with the reason | `closeShift` throws `PermissionError` | Pushing account; named closer (`closedById`) | Z-report close: the authenticated caller (403) |
| Owner draw / cash in–out: `cash.manage` | Hidden, with the reason | `createCashMovement` returns `null` | Pushing account; named recorder (`recordedById`) | n/a |
| Expense: `accounting.manage` | Hidden, with the reason | `createExpense` throws `PermissionError` | Pushing account; named recorder (`recordedById`, sent since this change) | n/a |

Tests:
- `apps/desktop/src/__tests__/shiftCashPermissions.test.ts`: service layer.
- `apps/api/__tests__/shift-cash-permissions.test.ts`: real Postgres, push.
- `apps/api/__tests__/z-report-close.test.ts`: REST close.

Each rule is mutation-checked: removing it fails a test.

## The limitation: staff attribution on push is not authenticated

**This is not authenticated cashier authorization.** Do not describe it as such.

- **The pushing account is the store or device account, not the cashier.**
  - A register connects with a store login.
  - A store hub uses `/api/setup/auto-login`, whose token carries the user id `__admin__`. That is not a staff record, so the **pushing-account check is skipped entirely on hubs**.
  - Cashiers sign in with a PIN **on the device**. The server never sees that session.
- **The named staff member is client-asserted.** `openedById`, `closedById` and `recordedById` are written by the desktop. The server checks that this staff member exists in the tenant and holds the permission, but it cannot verify that this person actually performed the action.

What this does stop:
- A device whose UI or service checks are missing, stale or buggy recording an action for a staff member who isn't allowed to do it.
- A record naming a staff member the server doesn't know. This fails closed, with a retryable error.
- A shift close rewriting who opened the shift or its opening float.
- A cashier's own token (on direct cloud connections) closing someone else's shift, or recording a drawer movement or expense.

What it does **not** stop:
- A modified client that names a manager as the actor.
- Anyone holding the store or hub token pushing operations directly.

Operational effect of failing closed: if a cashier's staff record hasn't reached the server, their shift closes, drawer movements and expenses wait in the queue with an error until it has.

## What authenticated cashier authorization would need (not built)

1. **Per-staff credentials the server can verify.** For example, a staff session token issued when a cashier signs in with their PIN while online. Or, for offline-first, a per-device key plus a per-staff secret, so each operation carries a signature (device id, staff id, operation id, payload hash) that the server verifies.
2. **Offline rules.** Operations signed offline stay valid only within a bounded window, and the server rejects signatures from revoked staff or devices.
3. **Hub relay.** A hub forwards operations with their original staff signatures instead of re-authoring them under `__admin__`.

That is a separate security sprint and needs your decision. Until then, the server checks above are consistency checks, and real enforcement of who did what happens on the device.
