# Release manifest — from the deployed containment release (e2fd79a) to the proposed development release

Status: **development candidate — not a release.** Nothing here is published or deployed. The version number below is a
proposal; the candidate binaries still say 1.0.52 and must not be published as they are.

## 1. Where production is, and the proposed number

| | |
|---|---|
| Cloud (deployed) | containment release `e2fd79a` (branch `hotfix/containment-1.0.50`) |
| Registers (published) | GitHub release **v1.0.51** (tag → `31e1ce6`, 2026-10-31, "Latest"); v1.0.50, v1.0.49 before it |
| Published tags (checked 2026-11-02, `git ls-remote --tags origin`, `gh release list`) | v1.0.43 … v1.0.47, v1.0.49, v1.0.50, v1.0.51. **No 1.0.52 exists.** |
| Proposed next version | **1.0.53** |

Why not 1.0.52: it was never published, but many local builds carry 1.0.52 (`1.0.52-*` candidates, the frozen `d678a84`,
every `dev-*` build). The updater offers only a higher version, so a machine where any of them was installed for testing
would never be offered a different 1.0.52. 1.0.53 is above all of them. Raise `apps/electron/package.json` to 1.0.53 only
when acceptance (section 9) is complete; until then every build stays a `dev-*` candidate.

## 2. What changes (120 commits, `e2fd79a..` this branch)

The full list with dates: `D:\TitanPOS-it\batch75\commits-since-e2fd79a.txt`. By area:

- **Sprint 0 security** — tenant isolation, PIN verifiers (never sent to registers), authorization on every route (`908f876`).
- **Sprint 1** — products without barcodes and made-to-order (untracked) products; the stock policy a line was sold
  under (revisions, history, store-wide upgrade gate); syncId-first product merge; cost never sent to cost-hidden
  registers; returning old tills (`6e9c12f` … `cc90001`).
- **Containment and Sprint 2** — token kinds, permission rules for every operation, refused work kept for review;
  operation evidence (observe); device enrollment and staff sessions; enrolled hub keys and signed forwarding; online
  manager approvals bound to the exact command; review of held work (actor, approver, reviewer kept apart);
  platform-wide staff enforcement with a versioned cloud-issued policy (**off by default**); closes per register and
  shift with revisions; legacy till compatibility without verifiers or cost; server valuation of cost-hidden work.
- **Operational readiness** — one stock authority per store (direct-cloud registers or one hub, owner-decided with
  readiness checks); authoritative attribution on records; Store security screen.
- **Café** — modifier groups, recipe revisions, ingredient units and purchase-unit receiving, consumption from lots at
  commit, remake/waste, café report, delivery refused in hub stores.
- **This batch (stabilization)** — products cross servers by stable id only (`d79e4fe`); held work says what it waits
  for and is never silently exhausted (`d79e4fe`, `241f45c`); quantity precision and no float drift, café refunds and
  cost fields (`f0657d3`); refund/void wording, Arabic punctuation and reasons (`241f45c`).

## 3. Pending migrations, in order (all applied by `prisma migrate deploy`; hubs apply the same files at start)

The deployed cloud (`e2fd79a`) and the published 1.0.51 hubs both stop at `20261019120000_one_active_admin`, so the same
19 migrations are pending for the cloud and for every hub. Each migration file runs in one transaction (Prisma on the
cloud; the hub's runner sends each file as one statement batch).

Kinds used below: **new table** (nothing old reads it); **column + default** (every existing row gets the default; old
code neither reads nor writes it); **nullable column** (old rows NULL); **constraint change** (changes what may be
stored); **data change** (rewrites existing values); **index change**. All additive changes still change *meaning* for
old code — see §8.

| # | Migration | Kind | Exactly what changes |
|---|---|---|---|
| 1 | 20261029100000_product_stock_policy | column + default; **data change** | Product, SaleItem `stockPolicy` (default `tracked`). `UPDATE Product SET barcode = NULL` where the barcode is blank or spaces |
| 2 | 20261029120000_stock_policy_version | column + default; nullable | Product `stockPolicyVersion` (1), `stockPolicyChangedAt`; SaleItem `stockPolicyConflict` |
| 3 | 20261029140000_stock_policy_history | column + default | Product `stockPolicyHistory` (`[]`) |
| 4 | 20261029160000_stock_policy_rev | column + default; nullable | Product `stockPolicyRev` (`initial`); SaleItem `stockPolicyRev` |
| 5 | 20261029180000_sync_client_gate | new table | SyncClient (+ unique and lookup index) |
| 6 | 20261030100000_operation_evidence | new table | OperationEvidence (+ 2 indexes) |
| 7 | 20261031100000_device_enrollment_staff_sessions | new table; column + default; nullable | StaffSession (+ 2 indexes); Device `credentialVersion` (0), `enrolledAt`, `enrolledById`; PairingCode `createdById`; 7 OperationEvidence columns |
| 8 | 20261031120000_staff_session_mode | column + default | Tenant `staffSessionMode` (`observe`) |
| 9 | 20261101090000_sync_operation_server_valued | column + default | SyncOperation `serverValued` (false) |
| 10 | 20261101130000_daily_close_unknown_cost | **constraint change**; nullable | DailyClose `costOfGoods`, `returnedCost`, `grossMargin`, `netProfit`: NOT NULL and default 0 **removed** (NULL = unknown); new `costStatus` |
| 11 | 20261101150000_hub_attestation | new table; nullable | HubKey (+ index); OperationEvidence `attestation`, `attestationKid` |
| 12 | 20261101170000_manager_approval | new table; nullable | ManagerApproval (+ 2 indexes); OperationEvidence `approval` |
| 13 | 20261101190000_review_resolution | new table; nullable | ReviewResolution (+ unique on `opId`, index); SyncOperation `heldEvidence` |
| 14 | 20261102090000_approval_permissions_close_revisions | column + default; nullable; **index change** | ManagerApproval `permissions`; DailyClose `scope` (`store`), `revision` (1), `registerId`, `shiftId`, `revisionOf`, `correction`, `supersededById`, `supersededAt`; **unique (tenant, date) dropped, unique (tenant, date, scope, revision) created** + lookup index |
| 15 | 20261102120000_staff_policy_version | column + default; nullable | Tenant `staffPolicyVersion` (0), `staffPolicyIssuedAt`, `staffPolicyIssuedBy` |
| 16 | 20261103090000_store_topology | column + default; nullable | Tenant `storeTopology` (`unset`), `topologyVersion` (0), `topologyHubId`, `topologyChangedAt`, `topologyChangedBy`; HubKey `hubLabel` (''), `hubId`, `lastReport`, `lastReportAt`; SyncClient `queueReport`, `queueReportedAt` |
| 17 | 20261103100000_record_attribution | nullable | who/attribution columns on Sale (incl. `voidedById/Name/At`), SaleRefund, Expense, CashMovement, InventoryBatch, StockAdjustment, StockCountSession, SupplierPayment, PurchaseOrder, DebtSale, DebtPayment, Shift, DailyClose, OperationEvidence |
| 18 | 20261104090000_cafe_menu_recipes | new table; column + default; nullable | ModifierGroup, RecipeRevision (+ 3 indexes); Product `sellable` (true), `stockUnit` (`unit`), `modifierGroupIds` ([]), `purchaseUnit`, `unitsPerPurchase`, `recipeRev`; SaleItem `modifiers`, `note`, `basePrice`, `recipeRev`, `consumption`, `costStatus`, `recipeConflict`, `modifierConflict`; InventoryBatch purchase fields; StockAdjustment `wasteRef`, `wasteOf` |
| 19 | 20261105090000_sync_product_refs | nullable | SyncOperation `productRefs` |

In total: 8 new tables, 1 data change (#1), 1 constraint relaxation (#10), 1 unique-index replacement (#14); everything
else adds columns with constant defaults or NULL. Nothing is dropped or renamed except that one index, and no existing
value changes except blank barcodes (#1). The earlier wording "only one structural" meant "only #14 replaces an
index"; it was imprecise and is withdrawn.

Locks and duration: adding a column with a constant default is a catalogue change on PostgreSQL 11+ (no table rewrite).
#1 updates only Product rows with blank barcodes. #14 builds its unique index without `CONCURRENTLY`, blocking writes to
DailyClose for the build (one row per store per day; seconds at most). On Railway the previous deployment keeps serving until the
new one is healthy, so old code briefly runs on the migrated schema; stop client writes first (§8.2, step 1) so that
window carries no work.

Verified (evidence `D:\TitanPOS-it\batch75`):
- **Fresh database**: all 54 migrations apply; `prisma migrate diff --from-schema-datasource --to-schema-datamodel
  --exit-code` = 0 (no drift) — `mig-fresh.out`, `mig-diff-fresh.out`.
- **Copy of the deployed schema with pending work** (scratch schema built by e2fd79a's own migrations and seeded by its
  own client: products with/without stable id, lots, sale, refund, adjustment, count, open shift, open delivery order,
  waiting sync operations with 1.0.51 payloads): the 19 apply; no drift; every row count unchanged; new columns take
  their defaults (tracked, sellable, unit, observe, topology unset); this version's hub logic revives waiting work
  (a `STOCK_POLICY_HELD` failure → Pending; a `PRICE_OVERRIDE` rejection → Held for review) — `mig-seed.mts`,
  `mig-verify.mts`, `mig-verify.json`, `mig-deploy-upgrade.out`, `mig-diff-upgraded.out`.

## 4. Compatibility requirements

- **Upgrade order: cloud first, then each hub, then registers.** Sync schema 6.
- **Registers 1.0.50/1.0.51** keep working through an upgraded hub or cloud: their numeric product references are
  resolved by the first server and forwarded with stable ids; they never receive recipe drinks or ingredients; recipe
  sale lines reach them as made-to-order; their sales are never held for the new rules (recorded as sold from stock).
- **Hubs 1.0.50/1.0.51 forwarding to the new cloud**: operations whose products they name only by number (adjustments,
  count lines, lines of products without a stable id) are **held for review at the cloud (`IDENTITY_HELD`)** — never
  applied to a guessed product. After that hub is upgraded it re-forwards them with stable ids and they apply once.
  Until then, upgrade hubs promptly after the cloud.
- **Older registers** cannot change a product to a recipe drink while they trade (store-wide gate).
- Mixed-version payloads tested: `product-identity.test.ts` (1.0.51 adjustment/count/sale/refund payloads through a
  hub to the cloud with crossing product numbers), `installed-hub.test.ts` phases with the released 1.0.51 till on the
  final package (section 9).

## 5. Unchanged settings and policies

Cash rounding and dual-currency rules; tax rules; role presets and permission names (no new permission); price floor
rules (options' deltas added); refund rules for packaged goods; delivery in direct stores; license checks; the
updater; hub installation and data folder.

## 6. Observe and enforcement defaults

- Staff identity: **observe** for every store (`staffSessionMode` default). Enforcement is changed only explicitly at
  the cloud by a person with Settings permission, after the activation gate passes.
- Store topology: **`unset`** for every store. Nothing is enforced until the owner chooses direct-cloud or one hub.
- Production enforcement stays off in this release.

## 7. Topology transition requirements

Changing a store's topology (unset → direct, unset → hub, hub → other hub, hub → direct) requires the readiness checks
(Store security screen / `/api/sync/topology`): no open shifts; no held (Refused/Resolving) work; every register's queue
reported empty; for a hub, a signed hub report with matching stock and lots; **no open delivery orders** when moving to
a hub store. The change is versioned, audited and adopted by hubs only when newer. See STAFF-ENFORCEMENT.md §7, §11–§16.

## 8. Backup, recovery and rollback

### 8.1 Why old code must not run on the migrated data (by code inspection of `e2fd79a` and 1.0.51; not executed)

The schema changes are additive, so old code *starts* on the migrated database. It is unsafe because it would
silently misread or overwrite what the new code records:

| Change | What old code would do on migrated data |
|---|---|
| #10 nullable close costs | reads an unknown cost (NULL) as 0: a day with unknown cost shows full margin; a close it writes without a cost value is stored as NULL, not 0 |
| #14 close scope/revision | ignores `scope`, `revision`, `supersededAt`: per-register and per-shift closes and superseded revisions all look like store closes for that date, and its pull sends them all to registers (totals counted more than once). Its upsert by close id still works; the earlier note that it relied on the dropped index was wrong |
| #1–#4, #18 stock policy and café | has no stock policy: sells made-to-order and recipe products as stock items (their stock goes negative), never takes ingredients, offers ingredients (`sellable` false) to registers, drops options, notes, base price and consumption from new registers' sales — the café revenue split, ingredient stock and café report become wrong |
| #5 SyncClient | no store-wide gate: a product can become a recipe drink while 1.0.50/1.0.51 registers trade |
| #6, #11–#13 evidence, hub keys, approvals, review | accepts forwarded work without hub signatures or approvals; work held for review (`Refused`, `Held`, `heldEvidence`) is never shown or resolved |
| #8, #15, #16 staff mode, policy, topology | ignores them: a store moved to enforce silently returns to no enforcement; a hub store's single stock authority is not enforced |
| #19 and hub forwarding | reads a new hub's forwards by the register's numeric product id and ignores the stable ids beside them — the wrong-product write this release removes |
| code, not schema | old code lacks the Sprint 0 fixes (tenant isolation, PIN verifiers, route authorization) |

Hubs: the 1.0.51 hub's migration runner applies missing migrations and ignores extra ones, so 1.0.51 installed over an
upgraded hub opens the migrated database with the same hazards locally, and its sender does not know the `Held` status
(that work is never sent). Registers: their local data has no schema version; 1.0.51 ignores new fields, retries work
the new version marked as waiting until its attempts run out, and keeps drinks received by the new version in its
product list as stock items.

**Point of no return**: the first operation the new code applies in a store (in practice the first sale after the
upgrade). Before it, restoring the pre-upgrade backup loses nothing. After it, prefer a forward fix; a restore loses
everything written since the backup unless it is reconciled (8.3).

### 8.2 Before upgrading

1. **Stop client writes to the cloud.** Announce a window; stores keep selling (hub stores through the hub, direct
   registers record routine sales as offline claims). Make the cloud unreachable for clients for the window (Railway:
   remove the public domain or stop the service) and record the time `T_stop`.
2. **Cloud backup** after `T_stop`: `pg_dump -Fc` (or a Railway backup). Record its time `T_backup`, its SHA-256, the
   deployed commit (`e2fd79a`) and per-store row counts (Sale, SaleRefund, InventoryBatch, StockAdjustment,
   SyncOperation, DailyClose).
3. **Each hub**: Sync status shows nothing pending or held; quit the hub; copy `%APPDATA%\lebanon-pos` (`pgdata`,
   `hub-data`, `.env`) to a dated backup; record the SHA-256 of `hub-data\cloud-config.json`.
4. **Registers**: queue empty (Sync status) before each register is updated.
5. Deploy the cloud (migrations run); check `/api/health` and the applied-migration list; reopen client access; then
   upgrade hubs, then registers (§4).

### 8.3 Recovery: stop, preserve, decide, reconcile

1. **Stop.** Make the cloud unreachable for clients again (as in 8.2.1); record `T_stop2`. Hubs and registers keep
   their work in their own queues. Tell stores they may keep selling or pause, but must **not reinstall, re-pair or
   clear data** on any device.
2. **Preserve.** Before anything else, dump the live (migrated) database to a new file `D_post` and record its SHA-256:
   it holds every transaction since `T_backup`. Back up each hub's `%APPDATA%\lebanon-pos` as in 8.2.3 (a hub that keeps
   selling holds its own complete record). Never restore over the live database; restore only into a **new** database.
3. **Decide.** The default is a **forward fix**: fix, build and validate the new version, deploy it on the live database
   (`D_post` unchanged), reopen; clients resend what they queued; nothing is lost. Roll back only when a forward fix is
   impossible.
4. **Rollback path** (only if step 3 says so):
   1. Restore the pre-upgrade backup into a new database and deploy `e2fd79a` on it, still unreachable for clients.
   2. Build the **reconciliation report** from `D_post`, per store, for everything after `T_backup`: applied sync
      operations (`SyncOperation` with `appliedAt > T_backup`: id, entity, action, device, payload), changes made in the
      cloud admin (`AuditEvent` with `createdAt > T_backup`), and comparison totals (sales count and value, refunds,
      receipts, adjustments, closes, cash per shift, stock per product, open lots).
   3. Replay into the restored database only what old code understands: operations from 1.0.50/1.0.51 registers and
      hubs whose products resolve there by stable id, with their **original operation ids** (so nothing applies twice).
      Recipe sales, options, ingredient consumption, waste, held or reviewed work and topology/enforcement changes are
      **not** replayable into old code; list them for manual entry or keep them for a forward fix. **No replay tool
      exists today.** It must be written and rehearsed on a copy (checklist §9) before any production rollback; until
      then, rolling back after the point of no return means manual re-entry from the report.
   4. Hubs: an upgraded hub must **never** forward to the restored old cloud. Either keep it upgraded and disconnected
      until a forward fix, or restore its pre-upgrade backup and reinstall 1.0.51 — only after its post-upgrade work is
      in the report (it is in `D_post` if it was forwarded; otherwise export it from the hub first).
   5. Registers: drain each queue to the upgraded hub or cloud **before** downgrading; a current-version queue sent to
      old code is misapplied. Then reinstall 1.0.51 and re-pair.
   6. Verify per store that the restored database plus replayed and re-entered work equals `D_post`'s totals; record
      every difference explicitly.
5. **Reopen** client access only when step 4.6 (or the forward fix's acceptance) passes.

## 9. Acceptance status and what is still outside

See SPRINT-2-ACCEPTANCE.md ("Batch: café stabilization and release preparation"). The NSIS installer, an upgrade from
1.0.51 on a real machine, real LAN/Wi-Fi registers and physical printers/scanners need an isolated Windows machine:
`docs/ISOLATED-MACHINE-CHECKLIST.md`.

## 10. Tracked items (not blocking the pilot)

| Item | Status |
|---|---|
| The remake/waste confirmation said "for a manager's review" from the staff member's own permission, while in observe mode the server decides by the register's connection account | **Fixed on the branch after the freeze** (`ea52d71`, wording only, English and Arabic, test `wasteWording.test.ts`). Not in `dev-176fc59`: the pilot records the old text and does not fail on it. Ships in 1.0.53. |
| Observe mode authorizes by the connection account | By design until enforcement (STAFF-ENFORCEMENT.md). The real outcome always shows in Sync status (work kept by the server). |
| Replay tool for a rollback after the point of no return (8.3) | Not written. Required before any production rollback; rehearse on a copy. |
