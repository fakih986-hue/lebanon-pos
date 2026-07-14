# Titan POS v1.0.33 Release Notes

**Date:** 2026-07-14
**Type:** Internal build — stock ledger + inventory reconciliation tool, unsigned
**Sprints:** POS-SYNC-AUTHORITY-2A (record-only ledger) + 2C (reconciliation & narrow repair)

## Why this build exists
Ships the audit-grade stock ledger and the operator-facing inventory reconciliation tool. **Record-only** — stock is still driven by `Product.stock` + batches; the ledger is *not* the source of truth (that would be the still-gated 2B). No checkout/sale/refund/receive/tax/tender/debt logic changed.

## What's new (since 1.0.32)
- **Stock ledger hardening (2A):** `StockMovement` extended with nullable `deviceId`, `userId`, `userName`, `batchId` + a non-unique `(tenantId, reference, type, productId)` lookup index. Source attribution threaded into the hub's movement writer. Two previously-unledgered paths closed: **delivery** fulfill/cancel and **opening balances** on product-create + cloud bootstrap/restore. Idempotent write helper. Hub-local (not synced).
- **Reconciliation report (2C-1):** Products → Stock control now shows a **Ledger Reconciliation** panel — per product: aggregate (A) vs open-batch total (B) vs ledger expected (L), diffs, severity, classification, suggested action. Read-only.
- **Initialize ledger (2C-0):** admin action that anchors each product's baseline (`Opening = stock − Σ existing movements`) so `L == Product.stock`. Idempotent, record-only.
- **Narrow repair (2C-2):** one safe repair — "Lower aggregate to batch total" — only when aggregate > open-batch total for a **batch-tracked** product. Never increases stock, never touches batches, refuses untracked products, requires confirmation + reason, records a StockAdjustment + Adjustment movement + audit event, and is a safe no-op on a double-click.
- Carries all prior AUTHORITY-1 hub-authoritative inventory protections + the 1.0.32 cloud-bridge fix.

## Migrations (auto-applied by the hub on first launch)
- `20260713120000_add_inventory_batch_updated_at`
- `20260714120000_stock_movement_ledger_fields`

## Verification
| Check | Result |
|-------|--------|
| API / desktop / electron typecheck | PASS |
| API tests | 200/200 |
| Desktop tests | 118/118 |
| Bundle inspection (packaged API) | PASS — StockMovement fields+index, InventoryBatch.updatedAt, both migrations, 3 inventory endpoints, AUTHORITY-1 markers all present in `bundle/index.cjs` + `bundle/prisma` |
| Live smoke (dev API, real Postgres) | reconciliation + initialize + repair verified end-to-end |

## Artifacts
| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.33.exe` | `bee2ef19bc6a40ce8aa0f91131c0c6fefeaeab285d07cf5a143b2b3fd96f7b81` |
| `Titan POS 1.0.33.exe` (portable) | `836d3ea9c682ed4bb084e030642229649181c6d1955ec0ba9a3ea45de259a5e5` |

**Not published.** No GitHub release, no update manifest, **no Railway deploy**. `latest.yml` is a local-only electron-builder artifact.

## Install & focused acceptance test (hub)
1. Quit 1.0.32 (tray) → install `Titan POS Setup 1.0.33.exe` → relaunch. Confirm the two migrations apply in the startup log.
2. Products → Stock control → **Ledger Reconciliation**: click **Initialize ledger** (admin) once to anchor baselines.
3. Confirm the report shows any real aggregate-vs-batch drift.
4. On a drifted batch-tracked product, use **Lower aggregate to batch total** (with a reason) → confirm stock drops to the batch total, batches unchanged, and the row clears.
5. Confirm normal selling/refund/receiving is unchanged (record-only).
