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

## 3. Pending migrations, in order (all applied by `prisma migrate deploy`)

| # | Migration | Change | Additive? |
|---|---|---|---|
| 1 | 20261029100000_product_stock_policy | Product/SaleItem `stockPolicy`; empty-string barcodes become NULL | data: blank barcodes → NULL (harmless to old code) |
| 2 | 20261029120000_stock_policy_version | policy version/changedAt; SaleItem conflict | yes |
| 3 | 20261029140000_stock_policy_history | policy history | yes |
| 4 | 20261029160000_stock_policy_rev | policy revision ids | yes |
| 5 | 20261029180000_sync_client_gate | table SyncClient | yes |
| 6 | 20261030100000_operation_evidence | table OperationEvidence | yes |
| 7 | 20261031100000_device_enrollment_staff_sessions | device credential columns, staff sessions | yes |
| 8 | 20261031120000_staff_session_mode | Tenant `staffSessionMode` (default observe) | yes |
| 9 | 20261101090000_sync_operation_server_valued | SyncOperation `serverValued` | yes |
| 10 | 20261101130000_daily_close_unknown_cost | DailyClose cost columns become nullable (unknown ≠ 0) | relaxes NOT NULL |
| 11 | 20261101150000_hub_attestation | table HubKey; evidence attestation columns | yes |
| 12 | 20261101170000_manager_approval | table ManagerApproval | yes |
| 13 | 20261101190000_review_resolution | SyncOperation `heldEvidence`; table ReviewResolution | yes |
| 14 | 20261102090000_approval_permissions_close_revisions | approval permissions; DailyClose scope/revision; **unique index (tenant,date) replaced by (tenant,date,scope,revision)** | **structural** |
| 15 | 20261102120000_staff_policy_version | Tenant `staffPolicyVersion` | yes |
| 16 | 20261103090000_store_topology | Tenant topology columns (default `unset`) | yes |
| 17 | 20261103100000_record_attribution | attribution columns on records | yes |
| 18 | 20261104090000_cafe_menu_recipes | product units/sellable/recipe pointer; sale-line snapshots; lot purchase fields; tables ModifierGroup, RecipeRevision | yes |
| 19 | 20261105090000_sync_product_refs | SyncOperation `productRefs` | yes |

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

Before upgrading:
1. Cloud: take a Railway PostgreSQL backup (or `pg_dump -Fc`) and record the deployed commit (e2fd79a).
2. Each hub: stop the hub, back up its data folder (`%APPDATA%\lebanon-pos\hub-data`) and its embedded database
   (see HUB-INSTALL-CHECKLIST.md); confirm the hub's queue is forwarded (Sync status: nothing pending/held).
3. Registers: make sure each register's queue is empty (Sync status) before updating it.

Recovery: restore the backup and reinstall the previous version (cloud: redeploy e2fd79a; hub/registers: 1.0.51
installer).

**Rollback limits once new-format work exists** (after the first operation is applied by the new version):
- Migrations are additive except the DailyClose index (#14): the old code's upsert on (tenant, date) no longer has its
  unique index; closes written per register/shift by the new code are several rows per date. **Old cloud code must not
  run on the migrated database.** Rolling back = restoring the pre-upgrade backup (work done since is lost unless
  replayed from registers' queues).
- An old cloud would read a new hub's forwards by number (it ignores the stable ids beside the command) — the exact
  wrong-product risk this release removes. Never point upgraded hubs at a rolled-back cloud.
- Recipe drinks, options, ingredient lots and consumption snapshots have no meaning in old code (it would treat recipe
  lines as packaged stock). Held statuses (`Held`, register `held`) are unknown to old code (kept, not lost, but not
  re-checked). Prefer a forward fix over a rollback after café items are in use.

## 9. Acceptance status and what is still outside

See SPRINT-2-ACCEPTANCE.md ("Batch: café stabilization and release preparation"). The NSIS installer, an upgrade from
1.0.51 on a real machine, real LAN/Wi-Fi registers and physical printers/scanners need an isolated Windows machine:
`docs/ISOLATED-MACHINE-CHECKLIST.md`.
