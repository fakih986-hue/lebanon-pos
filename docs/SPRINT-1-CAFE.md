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

## Install acceptance (2026-10-29) — candidate 1.0.51, commit `30c92bf`

Installer `Titan-POS-Setup-1.0.51.exe`, SHA-256 `225D9349505B7D5043A76302DA1C4A0B87A24CF54CBC08CEEB473FA845403A57`, installed on disposable user data against a guarded local cloud (scratch DB only).

- Scenario main phase 25/25: security permissions, NULL-barcode drinks, mixed checkout, refund, void, offline → reconnect. After hub restart 3/3.
- Till app paired to the hub in a browser: the cashier signs in online, a full pull (including `cash-movements`) keeps her verifier, the hub is stopped, and she unlocks offline. A wrong PIN is refused. Once the hub restarts, the till syncs cleanly.
- Old hub 1.0.50: `/api/health` has no `syncSchema`. Drinks arrive with no stock policy and stock 0, and a pushed Espresso sale is rejected ("Insufficient stock"). New tills check `syncSchema` and refuse made-to-order lines before payment (`pos.err.server_too_old`).

Found during acceptance (not blocking):
- After the hub stops, the till header keeps showing "Hub connected" until its next health check. Offline unlock still works.
- Hard-killing a hub can orphan its embedded Postgres, which blocks the next start ("pre-existing shared memory block"). This was already the case before 1.0.51.

## Release checks (2026-10-29, commit `d3899d4`)

**Historical stock policy is established by the server.** Each product carries a server-owned `stockPolicyHistory` (migration `20261029140000_stock_policy_history`): one entry per policy version, written only by the server when a product update changes the policy (client-sent versions and history are discarded). A sale line names the version it was sold under:

| Line | Policy applied | Result |
|---|---|---|
| current version | today's | claim must match, else STOCK_POLICY_MISMATCH (not applied) |
| older version in the history | that version's | claim must match, else refused; flagged `changed` if ≠ today's |
| version newer than the server's | — | refused |
| no version (older till), policy unchanged since the sale | today's | no conflict |
| no version and changed since, or an older version missing from the history | **today's** (never the claim) | flagged `unknown` + audit event |

Stock effects follow the applied policy: tracked → stock decremented, lots consumed, refund/void restocks; untracked → none. Tested tracked → untracked → tracked (v1/v2/v3) in `cafe-device.test.ts`; negative control: letting the `unknown` path use the claim makes the test fail.

**Mixed versions (live):**
- New till UI → 1.0.50 hub: the old hub strips the policy; drinks arrive as tracked with stock 0, so the tile is disabled ("Espresso is out of stock") and every pull resets them. With the drink cached as made-to-order and the hub unreachable, Confirm and pay is refused: "This hub (or cloud) has not confirmed it can record made-to-order items. Nothing was charged." No sale stored; cart kept.
- 1.0.50 till UI → new cloud with untracked drinks: drinks arrive tracked with stock 0; tile disabled, and the scan field also refuses ("Out of stock").
- Store-wide gate: cloud first; made-to-order sales need the till's own server (hub, or cloud for direct tills) and the till on 1.0.51. Residual gap: a 1.0.51 hub syncing to an older cloud (prevented only by deploy order). Residual edge: a hub and the cloud bump a product's version independently; concurrent conflicting policy edits on two servers could make a hub-accepted line contradict the cloud's history.

**Installer test isolation:** `apps/electron/scripts/it-hub.mjs` is the only way to start/restart a test hub. It refuses a non-loopback cloud and a non-scratch user-data dir, verifies the freshly written `.env` names the loopback cloud, blocks Chromium-level DNS, stops the hub on any non-loopback TCP connection from its process tree (logged to `<userData>/it-hub-network.log`), and stops cleanly (no orphaned embedded Postgres). Background: the hub rewrites `.env` with `LBPOS_CLOUD_URL` (default production) on every launch, and keeps cloud credentials in `<install dir>\data\cloud-config.json`. The watchdog detects and stops; it is not a firewall (a per-program outbound firewall rule needs an administrator).

**Test status:** the S4 staff-attribution test is an expected-failure probe (`it.fails`, known defect, fix planned for Sprint 2). Vitest reports it as "1 expected fail".

**Rebuilt candidate at `d3899d4`** (unpacked build, started only through `it-hub.mjs`): `Titan-POS-Setup-1.0.51.exe` SHA-256 `21DC64343F1ECE190CD37D41DBFB716AE8D5A647C97799CB339E64DEFA97303D`. Fresh store: scenario main phase 25/25, then restart, after-restart 3/3. Upgrade: the previous candidate's hub database applied `20261029140000_stock_policy_history` at startup (products keep version 1, empty history). Every launcher run logged 0 outbound violations. The launcher's first stop of the 1.0.50 hub left an orphaned embedded Postgres holding port 5434 (Windows returned no executable path for it); the launcher now matches by command line, and later stops left the ports free.

## Stock-policy revisions (2026-10-29) — closes the hub/cloud version gap

**Problem.** `stockPolicyVersion` was a per-database counter: a hub and the cloud each numbered their own changes, so "version 2" could mean different policies on each, and a hub-accepted sale could be reinterpreted (or refused) at the cloud. Sale stock was also decremented only for products tracked *today* (`lib/inventory.ts`), even for a line sold as tracked.

**Identity.** A policy is identified by a revision id (`Product.stockPolicyRev`), minted once by whoever changes it — till (`crypto.randomUUID()` in `updateProduct`), hub or cloud — and recorded with its parent in `stockPolicyHistory`. Ids are copied, never re-minted, so one id means one policy everywhere. `"initial"` is the policy a product was created with. `stockPolicyVersion` is now only a count. Rules live in one module used by hub and cloud: `apps/api/src/lib/stockPolicy.ts`. Migration `20261029160000_stock_policy_rev`.

**Concurrent edits / authority.** A change whose parent is the receiver's current revision fast-forwards it. A change made concurrently (parent no longer current) is recorded as a branch — sales sold under it keep resolving to its policy — but does not change the current policy; a `product.stock_policy_conflict` audit event makes it visible. The cloud is the authority: on pull, a hub adopts the cloud's current revision once the cloud has seen the hub's own, and keeps its own until then; histories are merged by id, never overwritten. A known id re-sent with another policy is refused (STOCK_POLICY_MISMATCH).

**Historical sales.** A line names the revision it was sold under (`SaleItem.stockPolicyRev`); the receiver's record of that revision decides the policy (a claim must agree), on the hub and again on the cloud after forwarding, so a hub-accepted sale keeps its policy. Stock is decremented by the line's policy. A revision the receiver does not know (e.g. the product change has not arrived yet), or a line with no revision for a product whose policy changed (older tills), is **held**: `STOCK_POLICY_HELD`, retryable, nothing applied. A till keeps it queued and visible; the hub keeps it Pending without using up its attempts and shows the reason in its sync status; it applies once the revision arrives. (A held line from an older till for a product that changed policy has no automatic resolution: it stays visible until the till is upgraded or the operation is reviewed.)

**Tests (real hub + cloud handlers, `stock-policy-sync.test.ts`):** both sides change policy while disconnected (hub: tracked → untracked; cloud: tracked → untracked → tracked), sales between the changes, reconnect, forward, retry, pull: the cloud records the hub's change as a branch with one conflict event; forwarded sales keep `initial`→tracked and the hub's revision→untracked; both databases end with the same current revision and history; sale lines, stock and lots agree; refund of the made-to-order line returns money only, void of the tracked line restocks and restores its lot on both. A sale whose revision has not reached the cloud is held (Pending, 0 attempts, no cloud sale or stock change) and applies on retry. Migration defaults: existing products `"initial"` with `[]` history; existing sale lines keep their policy with a NULL revision; a row written without policy fields sells normally. Negative controls (each makes the suite fail): resolving lines with today's policy; applying an unknown revision; letting a concurrent edit overwrite the current policy.
