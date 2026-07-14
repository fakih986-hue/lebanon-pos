# Titan POS v1.0.34 Release Notes

**Date:** 2026-07-14
**Type:** Internal build — stock-write hardening + navigation/workflow polish, unsigned
**Bundles:** POS-SYNC-HARDEN-2 + POS-UX-IA-1A + POS-UX-IA-1B

## Why this build exists
Ships the server-side stock-write guard and the first round of navigation/workflow quick wins (labels, confirmations, and a Manager-reachable Shift control). No money/tender/tax/sync/checkout logic changed; no permission changes; no features removed. No new migrations.

## What's new (since 1.0.33)
**HARDEN-2 — server-side stock write guard (server + client):**
- A generic `product.update` sync op can no longer change `Product.stock` — the server strips `stock` from the patch (metadata still updates) and warns. Stock changes only via approved ops (sale/refund/void/receive/adjustment/count/reconciliation-repair).
- Receiving an existing product legitimately raises the aggregate; its update carries a transient `_stockUpdate` marker the server honors (never persisted). Restocking still works.

**IA-1A — navigation/label/confirmation quick wins (desktop):**
- Stock adjustment action renamed **"Post" → "Apply adjustment"** (en + ar).
- Batches terminology unified ("Search lots…" → "Search batches…").
- **Delivery "Cancel order"** now confirmation-gated (was 1-click).
- **Driver deactivate** now confirmed (enabling stays instant).
- Settings **"Export Full Data Backup" + "Restore from IndexedDB"** grouped into a labelled **Danger zone**, each confirmation-gated.

**IA-1B — Manager-accessible shift control (desktop):**
- **Shift Open/Close** now available on the **Accounting page ("Shift" tab)**, gated by `shifts.manage` — Managers can open/close the till without the Admin-only Staff page. Cashiers unaffected; Admins keep the Staff shift tab too. Reuses the existing shift-service functions (no logic change).
- Verified the Staff permission matrix is already data-driven and correct (no change needed).

## Verification
| Check | Result |
|-------|--------|
| API / desktop / electron typecheck | PASS |
| API tests | 203/203 |
| Desktop tests | 118/118 |
| New migrations | none |
| Bundle inspection | PASS — API: stock-write guard, `_stockUpdate` path, 3 inventory routes. Desktop SPA: Manager Shift tab, Delivery-cancel confirm, Driver-deactivate confirm, Settings Danger zone, "Apply adjustment", "Search batches" |

## Artifacts
| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.34.exe` | `11e33fbbd643fd8e7693d7b1a39d0ccd3f5f6e90289e1bece43e823d692bbb2c` |
| `Titan POS 1.0.34.exe` (portable) | `4d0c4fda7a987302332fca426f72c4fe9400b975f1133170be10b983acf0d482` |

**Not published.** No GitHub release, no update manifest. `latest.yml` is a local-only electron-builder artifact. Railway deploy handled separately (HARDEN-2 server code — additive, no migration).

## Install & acceptance test (hub)
1. Quit 1.0.33 (tray) → install `Titan POS Setup 1.0.34.exe` → relaunch. Confirm no migration errors (there are no new migrations).
2. **Stock guard:** editing a product (name/price) must NOT change its stock; receiving still increases stock. Selling/refunding still adjust stock normally.
3. **Manager shift:** log in as a Manager → Accounting → **Shift** tab → open a shift (float) and close it (counted cash) — no Staff/Admin access needed. Confirm a Cashier sees no such access.
4. **Confirms:** Delivery → Cancel order shows a confirmation; Drivers → deactivating a driver shows a confirmation.
5. **Danger zone:** Settings → Backup shows Export/Restore under a "Danger zone" with confirmations.
6. **Labels:** stock adjustment button reads "Apply adjustment"; batches search reads "Search batches…".
