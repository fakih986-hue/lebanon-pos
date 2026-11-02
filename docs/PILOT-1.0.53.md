# Pilot plan: 1.0.53 on one disposable test store

Status: **prepared, not started.** Nothing below runs until the owner approves the deployment. All current stores
are disposable test data (owner, 2026-11-02); credentials and access controls stay private. Enforcement is not
enabled at any point in this plan.

## 0. What is rolled out, and to whom

| | |
|---|---|
| Cloud | the release commit of 1.0.53 (full SHA in `D:\TitanPOS-candidates\1.0.53-<commit>\RELEASE.txt`), deployed by pushing it to `master` (Railway service `lebanon-pos` builds the root `Dockerfile` and runs `prisma migrate deploy` at start) |
| Migrations | the 19 in RELEASE-MANIFEST.md §3, `20261029100000_product_stock_policy` … `20261105090000_sync_product_refs`; none added after the freeze |
| Hub/register installer | `Titan POS Setup 1.0.53.exe` from that folder, checked against its `SHA256SUMS.txt` before use |
| Pilot store | **one** disposable store, proposed: the owner's live-testing store `fakih`. Confirm with step 0.1 |
| Other stores | not touched: stay on their current hubs/registers (1.0.49–1.0.51), observe mode, topology unset |

### 0.1 Pick and confirm the pilot store (read-only, before the window)
Run the read-only query `D:\TitanPOS-it\batch80\prod-stores.sql` (stores, last sale, last sync operation, devices,
open shifts; no personal data, `BEGIN READ ONLY … ROLLBACK`):

```
railway run -s Postgres -- node D:/TitanPOS-it/tools/pg-env.mjs psql -A -F " | " -f D:/TitanPOS-it/batch80/prod-stores.sql
```

The pilot store must have: no sync operation from a device you do not recognise in the last 7 days, no open shift,
and every device in it known to you. If `fakih` fails this, pick another disposable store that passes and use its
subdomain below. Record the store's subdomain, tenant id and device list in the pilot log.

## 1. Window and backups (before anything is deployed)

1. **Announce the window**; stores keep selling offline (hub stores through their hub). Record `T_stop` when client
   access to the cloud is closed (Railway: remove the public domain, or stop `lebanon-pos`).
2. **Cloud backup** after `T_stop`:
   ```
   railway run -s Postgres -- node D:/TitanPOS-it/tools/pg-env.mjs pg_dump --format=custom --file="D:/Claude project/backups/prod-pre-1.0.53-<yyyymmdd-hhmm>.dump"
   ```
   **Verify the archive** before going on:
   ```
   "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe" --list "D:/Claude project/backups/prod-pre-1.0.53-<…>.dump" > "D:/Claude project/backups/prod-pre-1.0.53-<…>.list"
   ```
   It must exit 0 and list `TABLE DATA` entries for Tenant, Sale, SaleRefund, InventoryBatch, StockAdjustment,
   SyncOperation, DailyClose and `_prisma_migrations`. Record its size and `Get-FileHash -Algorithm SHA256`, and the
   per-store row counts (Sale, SaleRefund, InventoryBatch, StockAdjustment, SyncOperation, DailyClose) from a read-only
   query. Optional and stronger: `pg_restore` it into a new local scratch database and compare those counts.
3. **Pilot hub** (if the pilot store has one): Sync status shows nothing pending or held; quit Titan POS from the tray;
   copy `%APPDATA%\lebanon-pos` and `%LOCALAPPDATA%\Programs\Titan POS` to a dated folder with
   `robocopy <src> <dst> /MIR /IS /IT /R:1 /W:1` (the `/IS /IT` flags matter: without them same-size files are skipped),
   then compare file hashes of source and copy (`D:\TitanPOS-it\batch79\verify-1049.sh` does exactly this for this PC).
4. **Pilot registers**: each register's Sync status queue is empty, or its pending items are written in the pilot log
   (number, type, amount) so they can be checked after the upgrade.

## 2. Upgrade order: cloud, hub, registers

1. **Cloud.** Push the release commit to `master` (the owner runs the push). Wait for the deployment to be healthy;
   check `/api/health` and that `_prisma_migrations` ends with `20261105090000_sync_product_refs` (19 new rows, none
   failed). Reopen client access. Record `T_open`.
2. **Every other store's devices keep working** on their old versions (manifest §4): 1.0.49–1.0.51 hubs pull products
   and staff (legacy projection); 1.0.50/1.0.51 registers sell from stock. Spot-check one other store: its hub or
   register syncs one sale (if any device of another store is online).
3. **Pilot hub.** Run the installer over the installed version (it is silent-capable: `"Titan POS Setup 1.0.53.exe" /S`).
   First start must show **no activation screen**; the store link is kept (installer stages it to
   `%APPDATA%\lebanon-pos\install-data-migration`, the hub adopts it into `hub-data` and removes the staging folder);
   the hub applies the missing migrations (1.0.49 hub: 33 → 54). Queued work is sent once.
4. **Pilot registers**, one at a time, after the hub: update, sign in, Sync status empty after the first sync.

## 3. Pending work across the upgrade
- Work queued on any device before the window is sent after its device is upgraded (or by the old version, which
  the upgraded cloud accepts). Each queued sale must arrive **once**: compare the pilot log (step 1.4) with the
  cloud's sales list.
- Anything the cloud cannot apply is kept for review (register: Sync status → "kept by the server"; admin → Refused
  work), never dropped. Expected cases: old hubs' stock adjustments or counts naming a product only by number
  (`IDENTITY_HELD`) until that hub is upgraded — then they are re-sent and apply once.

## 4. Store topology for the pilot
- **Leave staff identity in observe** for every store, including the pilot.
- Topology stays **unset** for every store except, optionally, the pilot store **after** §5 passes:
  - pilot store **with** a hub: admin → Store security → "registers through one hub" → this hub. The readiness checks
    must pass (no open shifts, no held work, every queue reported empty, a fresh matching hub report, no open delivery
    orders). If any check fails, leave topology unset; it is not required for the pilot.
  - pilot store without a hub: leave it unset (or "direct to the cloud" after the same checks).
- Never change another store's topology or permissions during the pilot.

## 5. Pilot checklist with expected outcomes
On the pilot store, with a 20.00 float on one register. New items only (names start with "Pilot"), so existing
data does not change the expected figures. Amounts USD.

| # | Step | Expected |
|---|---|---|
| 1 | Create **Pilot Water** (barcode 990053000001, price 1.00, tracked). Receive 1 case of 12 at 3.60/case | stock 12, lot cost 0.30 each; PO total 3.60 |
| 2 | Create ingredients **Pilot Beans** (g, bought per kg) and **Pilot Milk** (ml, bought per L). Receive 1 kg beans at 20.00/kg, 2 L milk at 1.20/L | beans 1000 g (0.02/g), milk 2000 ml (0.0012/ml); PO total 22.40 |
| 3 | Create drink **Pilot Latte** 3.00 with option group Size (Regular 0 default, Large +0.50) and recipe: beans 18 g; milk 200 ml; +100 ml milk when Large | saved, revision 1 |
| 4 | Open shift, float 20.00. **P1** cash: 1 Pilot Latte Regular + 2 Pilot Water (scan) | total 5.00; water 10, beans 982, milk 1800 |
| 5 | **P2** card: 1 Pilot Latte Large | total 3.50; beans 964, milk 1500 |
| 6 | Refund 1 Pilot Water from P1 (cash) | refund 1.00; water 11 |
| 7 | Open P1's receipt | **Void is disabled** with "This sale already has refunds…"; nothing changes |
| 8 | **P3** cash: 1 Pilot Water; then **Void** P3 | P3 voided; water back to 11; no money counted for P3 |
| 9 | Remake/waste: 1 Pilot Latte Regular, note "pilot remake" (a manager) | beans 946, milk 1300; waste lines for beans and milk |
| 10 | Shift & drawer → **Close with the count empty** | Close is disabled; "Count the drawer…" shown; shift stays open |
| 11 | Type **24.00** and close | expected 24.00 (20 + 5.00 − 1.00), counted 24.00, difference 0.00 |
| 12 | Sync status empty; cloud admin shows the same | P1, P2 (P3 voided), 1 refund, 1 waste event; stock as above on hub and cloud |

**Final expected:** Pilot Water 11 · Pilot Beans 946 g · Pilot Milk 1300 ml · sales 8.50 (P1 5.00 + P2 3.50),
refunds 1.00, P3 excluded · drawer 24.00 counted = expected · café: 2 drinks sold (own price 6.00, options 0.50),
ingredient cost 0.60 + 0.72 = 1.32, waste cost 0.60 · Pilot Water cost of goods 0.30 net (2 × 0.30 sold − 0.30
returned) · open lots add up to stock.

Then restart the hub: registers reconnect without re-pairing; one more Pilot Water sale syncs once.

## 6. Stop conditions (stop, preserve, then decide; manifest §8.3)
Stop the pilot and close client access if any of these happens:
- the cloud deployment is unhealthy, or any migration fails or is missing;
- the pilot hub shows an activation screen after the upgrade, or loses its link, settings, or local data;
- any sale, refund, void or waste is applied twice, or a queued item is lost (pilot log ≠ cloud);
- any stock or money figure in §5 differs by more than 0.01 (0.001 for g/ml), or hub ≠ cloud after sync;
- another store's device stops syncing or loses data;
- any staff-mode or topology change that the owner did not make.

## 7. Forward recovery
Default is a **forward fix**, never a restore over the live database:
1. Close client access; record the time. Devices keep their queues; nobody reinstalls, re-pairs or clears data.
2. `pg_dump` the live (migrated) database to a new file and hash it; back up the pilot hub as in §1.3.
3. Fix on a branch from the release commit, build once from a clean short-path worktree with
   `pnpm install --frozen-lockfile`, run the full suites and the affected acceptance, then deploy that commit to the
   live database. Devices resend what they queued; operation ids make every resend apply once.
4. A rollback to `e2fd79a` after the first sale on 1.0.53 is not supported without a replay tool (manifest §8.3/§10);
   do not attempt it. Before the first sale, restoring the §1.2 backup into a new database loses nothing.
5. Pilot hub only: if its upgrade fails before it sold anything, restore its §1.3 copy and reinstall its previous
   version; after it sold, keep it on 1.0.53 and fix forward.
