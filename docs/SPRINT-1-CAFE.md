# Sprint 1 — barcode-free and untracked (made-to-order) products

**Status:** implemented and tested locally (real Postgres scratch database, real desktop services, browser UI). **Not pushed, not deployed.** Closes C1, C2, C3 and the C4 feedback/label items of [CAFE-COMPATIBILITY-AUDIT.md](CAFE-COMPATIBILITY-AUDIT.md).

## What changed

| Area | Change |
|---|---|
| Barcode | Optional everywhere. A blank barcode is stored and synced as **NULL** (device `createProduct`/`updateProduct`, server product create/update, migration of existing `''` rows). Any number of products can have none. An empty scan never matches a product. Import: barcode column optional; a row without one is always a new product. |
| Identity | `syncId` is the identity. Pulls now reconcile the device's copy with the server's by `syncId` (they used to match only by numeric id or barcode — **every barcode-free product created on a till was duplicated after its first incremental pull**; found in the UI walk-through, fixed, regression test with a negative control). |
| Stock policy | `Product.stockPolicy` = `tracked` (default, all existing products) or `untracked` (made to order). Editor: "Track stock" switch (opening stock hidden when off); product list shows "Not tracked"; import column "Track stock" (yes/no). |
| Selling | Untracked lines: no stock gate (till and server), no lot allocation, no stock movement, cost snapshot from `product.cost`. Tracked lines unchanged (stock + FEFO lots enforced). Mixed orders work. The **server** decides each line's policy from its own product record — a till cannot mark a packaged item untracked to dodge stock control. |
| Line snapshot | `SaleItem.stockPolicy` records the policy when sold. Refunds and voids restore stock/lots only for lines sold as tracked (device and server), even if the product's policy changes later. |
| Refunds | A refund of a made-to-order line is financial only — nothing goes back to stock. Packaged lines restore exact lots as before. |
| Feedback | Tapping an out-of-stock (tracked) tile now explains itself: error buzz + the status line under the scan field reads "… is out of stock." (an error toast is also raised; in the UI test it was recorded in the notification centre rather than seen as a pop-up). The tile button used to be `disabled`, so the tap was silent. |
| Arabic | "All Items", "Favorites", the favorites hint, "N left" and the tile's "No barcode" now translate; the idle "Scanner ready." follows a language switch. The "No barcode" hint is hidden for made-to-order items. |
| Reports | Low-stock lists and alerts, the stock pre-check and low-stock export ignore untracked items. |
| Sync schema 3 | `stockPolicy` (product and sale line) is sent only to clients announcing `x-titan-sync-schema: 3` (new tills and hubs); older hubs insert pulled rows verbatim and would fail on an unknown column. |

## Migration
`apps/api/prisma/migrations/20261029100000_product_stock_policy`: adds `Product.stockPolicy` and `SaleItem.stockPolicy` (`TEXT NOT NULL DEFAULT 'tracked'`), and sets blank barcodes to NULL. Additive and idempotent; existing stores behave exactly as before.

## Tests (all against real Postgres unless noted)
- `apps/api/__tests__/cafe-device.test.ts` — 18 checks with the real desktop services: create 3 drinks + Pepsi; incremental pull keeps one copy each (negative control fails without the fix); server rows NULL barcode / own syncId / no lots; import of 2 more drinks; edit; restart + full pull; mixed order local and server (Pepsi 24→23, Espresso stays 0, line snapshots); offline order + lost answer + retry → applied once; tracked item at 0 still refused; refunds (drink money-only, Pepsi restock); void of a mixed sale; policy changed after sale → old line restores nothing (caught a real bug: the device dropped the line snapshot when reading stored sales — fixed); compatibility (product without policy → tracked; old till's `''` barcodes → NULL, coexisting; old till's drink sale accepted; till cannot declare a tracked item untracked; schema-2 pulls carry no new column, schema 3 does).
- `apps/api/__tests__/cafe-audit.test.ts` — the two café probes converted to regular assertions (drinks with no barcode; untracked drink sells; mixed order; drink refund restores nothing).
- Desktop: import tests updated to the new rule (a row without a barcode is valid; invalid rows are now nameless rows) + a new optional-barcode import test.
- UI (browser, guarded local cloud, disposable store): editor with Track stock off and no barcode; product list "No barcode · Not tracked" vs Pepsi "10 · Low" with a lot; POS: Espresso ×2 by tap + Pepsi by scan → paid; server row checked: Espresso `untracked`, no lots, stock 0; Pepsi `tracked`, lot allocation, stock 10→9; out-of-stock tap feedback; Arabic labels. Screenshots `docs/evidence/cafe/07…12`.
- Suites: API 417 passed + 1 expected failure (S4 attribution, Sprint 2); desktop 404; `tsc -b`, API and ordering type checks clean; lint: no new errors in touched files.

## Known limits / follow-ups
- Modifiers, preparation tickets, recipes and ingredients are not part of this sprint (plan Sprints 3–5). Use variants (size, single/double) and the sale note meanwhile.
- The editor still shows reorder point/quantity for untracked items (harmless; hide in a polish pass).
- The out-of-stock message stays in the language it was shown in; only the idle "ready" message re-translates on a language switch.
- A sale that fails to sync 5 times stops retrying automatically (existing design; visible in sync status with a retry action).
- Several existing API test files `delete process.env.IS_LOCAL_SERVER`; after a module reset, dotenv can refill it from `apps/api/.env` (hub mode). The new tests pin it to `"false"`; the older files should follow.
- Better Design MCP review (AGENTS.md) was not run: those tools are not available in this session. The UI changes reuse existing components and tokens.

## Rollout
Cloud first (migration + server), then hubs, then tills. Old tills against the new cloud keep working (their products are tracked; their `''` barcodes are stored as NULL; their drink sales are judged by the server's policy). A 1.0.50 hub against the new cloud receives no `stockPolicy` (schema 2), so it treats every product as tracked until upgraded: café stores must upgrade their hub before selling untracked drinks through it.
