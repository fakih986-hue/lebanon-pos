# Titan POS v1.0.53 (release candidate — not published)

Follows 1.0.51 (the client security hotfix). 1.0.52 was never published; every build that carried 1.0.52 was a test
build. The cloud must be updated before any hub or till runs 1.0.53 (see "Upgrade order").

## For managers and cashiers
- **Closing a drawer needs a count.** The register's Cash Drawer no longer closes with the counted-cash field empty
  (it used to record the expected amount, which looked like a perfect count). Count the cash and type the amount;
  type 0 if the drawer is empty. Earlier shifts closed without a recorded count show "Not counted" and are listed for
  review. The cloud's Z-report also refuses a close without a counted amount.
- **Void is no longer offered on a sale that already has a refund** (partial or full). The button shows disabled with
  the reason: refund the remaining items instead. No manager is asked to approve a void that would be refused.
- **Café menu:** drinks with option groups (size, milk, extras…), recipes with revisions, ingredients counted in g/ml/units
  and received in purchase units (kg, L, packs), stock taken from lots when a drink is sold, remakes and waste, and a
  café report (drink revenue, options, ingredient cost, waste). Refunding a drink returns money only; its ingredients
  stay used.
- **Manager approvals** on the register (discounts, refunds, voids, owner payouts) are bound to the exact sale and
  amount; changing the order after approval needs a new approval.
- **Held work review:** anything the server could not apply is kept and shown (Sync status on the register, "Refused
  work" in admin) until a manager applies or declines it with a note. Nothing is silently dropped.
- **Store security screen** (admin): staff identity mode, store topology (registers direct to the cloud, or through one
  hub), devices and readiness checks. Every store starts in **observe** with topology **not set**; nothing is enforced
  until the owner changes it.
- Cashiers do not see cost or margin; unknown cost is shown as unknown, never as 0. Daily close per register and shift,
  with corrections kept as revisions.
- Remake/waste confirmation no longer promises "a manager's review" (it says what the server will do).

## Security
- Server-side store isolation, staff PIN verifiers never sent to registers, permission checks on every route, enrolled
  hub keys and signed forwarding from hubs.

## Upgrade order and mixed versions
**Cloud first, then each hub, then registers.** 19 database migrations apply automatically (cloud at deploy, hub at
start); the list is in `docs/RELEASE-MANIFEST.md` §3. All add tables or columns, plus: blank barcodes become empty
(no barcode), daily-close cost columns accept "unknown", and the daily-close unique key now includes scope and
revision.
- Registers 1.0.50/1.0.51 keep working through an upgraded hub or cloud (sales recorded as sold from stock; they never
  receive recipe drinks or ingredients). Their drawer still closes the old way until they are updated.
- Hubs 1.0.49–1.0.51 can still pull products and staff from the upgraded cloud; their stock adjustments and counts
  that name products only by number are held for review at the cloud until the hub is updated. Update hubs promptly.
- Do not install an older version over 1.0.53 (its database is migrated). Recovery is by forward fix; see the manifest.

## Not in this release / limits
- Physical LAN/Wi-Fi registers, receipt and label printers, cash drawers and scanner hardware were not certified on a
  real network or device for this candidate (see the release record).
- Staff enforcement and hub-only topology are available but off; turn them on only per store, after the pilot.
