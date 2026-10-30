# Sprint 0 — security containment

**Status:** implemented and tested locally (real Postgres scratch database). **Not pushed, not deployed.**
Findings it closes: S1, S2, S3 (catalogue and price), S5 in [CAFE-COMPATIBILITY-AUDIT.md](CAFE-COMPATIBILITY-AUDIT.md). S4 (authenticated staff attribution) is Sprint 2 and stays an expected-failure probe.

## 1. Tenant isolation

| Endpoint | Before | Now |
|---|---|---|
| `GET /api/products`, `/api/customers`, `/api/sales` | `?tenantId=` replaced the token's store | always the token's store; a different `?tenantId=` → **403 `TENANT_SCOPE`** |
| `GET /api/setup/tenant-info` | a staff JWT could read any store via `X-Tenant-Id` | a JWT is bound to its own store (other id → 403); the hub's cloud-key path is unchanged |
| `GET /api/setup/diagnostics` | unauthenticated | only from the machine itself (localhost); 403 over the network |
| `GET /api/delivery/public/image/:id` | any product by bare id | requires `?tenantId=` and the product must belong to it (the ordering app passes its store id) |
| `PATCH /api/delivery/orders/:id` driver assignment | driver looked up across stores | driver must belong to the caller's store |
| `POST /api/images/generate-all` | platform owner via body `tenantId` | kept, **explicitly** authorized for the platform owner (`requirePermissionOrPlatformOwner`) |

Remaining by design: public delivery endpoints that take a store id (`/api/delivery/order`, `/products`, `/settings` GET, customer signup/login) serve the public ordering app; the legacy global `CLOUD_API_KEY` env key (operator-configured) can address any store.

## 2. PIN verifiers and offline login

**Before:** every staff session (any cashier) could download every staff PIN hash and every customer PIN hash through sync pull.

**Now:** `redactVerifiers` (`apps/api/src/routes/sync.ts`) removes `pin` from staff and customer records for every caller except a hub's sync connection (`cloud-bridge`, authenticated by the store's cloud key). Hubs keep verifying PINs for their LAN tills exactly as before. `pinVersion`, `active`, `roleVersion` still flow to tills.

**Offline design (unchanged rule, now explicit):** a till never used server hashes offline — they are bcrypt and the till compares SHA-256. It verifies offline only with the verifier it writes itself after a successful **online** sign-in on that device, and only while that verifier's version equals the latest `pinVersion` it has pulled. So:
- verified online once on this till → works offline;
- never signed in on this till → no offline login until one online sign-in (documented since 1.0.49);
- PIN reset elsewhere → the next pull raises `pinVersion` → old PIN refused offline;
- deactivated → the next pull sets `active=false` → refused offline.

**Pre-existing defect found and fixed:** the till's *full* pull requested `cash-movements`, which the server did not serve (400). The failure skipped the step that restores the till's own verifiers, so **every full pull wiped all offline verifiers** (offline login silently stopped working until each person signed in online again). Fixed twice: the server now serves `cash-movements` in full pulls, and the till restores its verifiers in a `finally`, so a partial failure (e.g. an older hub) can never wipe them again. Negative control: removing the `finally` makes the new test fail.

**Inherent limits (cannot be fixed by code):**
- 4–6 digit PINs are a small space: anyone holding a verifier (a hub's database, a till's local storage) can recover the PIN offline. Verifiers on a till are readable by whoever controls that device. Treat tills as trusted store equipment; use longer PINs for Admin/Manager.
- Offline, revocation and PIN resets reach a till only when it reconnects.
- Offline attribution is whatever the till records (Sprint 2).

## 3. Authorization

| Area | Rule |
|---|---|
| Catalogue via sync | product `create` needs `inventory.receive`; `update`/`delete` need `inventory.manage` (server `requiredPermissionForOp`); device `createProduct`/`updateProduct` enforce the same |
| Sale prices via sync | a line below the product's current price, or a sell-at-cost sale, needs `sales.price_override` on the pushing account; refused as **`rejected` `PRICE_OVERRIDE:`** (a money decision, never retried). Wholesale price honoured for a sale to a named customer. Device: sell-at-cost toggle, auto-switch and `checkoutLocalSale` enforce it |
| Reports | `/reports/margin` and margin export need `reports.cost`; low-stock needs `inventory.view`/`reports.view`; x-report `reports.view`/`shifts.manage`; debt-aging `reports.view`/`customers.manage`; dashboard `reports.view` |
| Cost filtering | lists and reports drop `cost`, `profit`, `margin*`, `unitCost`, `wholesalePrice`… unless `reports.cost`; CSV exports blank cost/profit; back office hides cost/margin columns, lot cost and average cost |
| Devices | generate-code, list, rename, register-hub, revoke need `settings.manage` |
| Drivers | create/edit need `staff.manage` (they are logins); list needs `delivery.manage`; delivery settings need `settings.manage`; orders need `delivery.manage` |
| Images | save/generate need `inventory.manage`; debug needs `settings.manage` |

New permission **`reports.cost`** ("See cost & profit"). Compatibility: implied by `reports.view`, `inventory.manage` or `accounting.manage`, so existing managers and saved permission sets keep cost visibility; the Cashier preset does not get it.

Who counts as authorized (`apps/api/src/middleware/permission.ts`): the token's user must be an **active staff row in the token's store**; store-level tokens without a staff row — the hub's localhost `__admin__` and `cloud-bridge` — act as the store; every other token (customers, deleted or deactivated staff) has no permissions. Deactivation takes effect immediately even for an old token without `tokenVersion`.

**Limit (S4, Sprint 2):** a till pushes with the store's connection token (usually the Admin who connected it), so server permission checks on sync see the store account, not the cashier at the till. These rules fully apply to staff-session pushes and REST calls; for till pushes the device-side checks apply.

## 4. Tests

- `apps/api/__tests__/cafe-audit.test.ts` — every Sprint 0 probe converted to a normal assertion with positive controls (Admin/Manager/hub still allowed). 25 pass; 3 remain expected failures (C1, C2 café; S4 attribution).
- `apps/api/__tests__/offline-auth.test.ts` — real desktop services + real API: online once → offline works after incremental and full pulls; partial full-pull failure keeps verifiers; never-verified → refused; PIN reset → old refused, new works after online sign-in; deactivation → refused.
- `apps/desktop/src/__tests__/sprint0Permissions.test.ts` — service-level catalogue checks and `reports.cost` compatibility.
- Existing suites: API 401 + 6 expected failures (all café/attribution probes), desktop 403. Mocked-Prisma unit tests (delivery, device, image) pass the route guard through; authorization is covered against real Postgres instead.

**Not yet tested:** the installed Electron hub + a paired LAN till with this build (needs an installer build; the cloud→hub→till chain test exercises the hub's cloud-key pull in-process).

## 5. Rollout

Cloud first, then hubs, then tills. Old tills against the new cloud: they receive no verifiers (they never used them offline) — and they still lose verifiers on full pulls until upgraded (pre-existing). New tills against an old hub: the `finally` keeps verifiers even though the old hub refuses `cash-movements`.
