# Titan POS v1.0.51 (candidate — not released)

## Security (Sprint 0)
- A store's staff can no longer read another store's data, and cashiers can no longer download staff PIN hashes.
- Offline sign-in keeps working: a till uses the PIN copy it saves after an online sign-in. A full sync no longer erases those copies (it used to).
- Permissions now enforced: catalogue price/cost changes, selling below the price (manager override), reports, device approval, driver logins. New permission "See cost & profit"; cashiers no longer see cost or margin, and their sync carries no cost data.

## Café (Sprint 1)
- Products without a barcode (drinks) and a "Track stock" setting: made-to-order items sell with no stock count, next to scanned packaged goods in the same order.
- Refunding a made-to-order item returns money only.
- Stock-setting changes between an offline sale and its sync: every change of a product's stock setting gets its own identity, the same on the till, the hub and the cloud. A sale is recorded under the setting it was actually sold with — on the hub and again in the cloud — never re-read with today's setting. If two places change the same product's setting at the same time, the cloud's setting stays current, the other change is kept for the sales made under it, and the conflict is shown for review. A sale whose setting the server has not received yet is held (nothing applied) and retried automatically. If it cannot be established, the sync panel shows the sale, what the customer already paid and the product; a manager records it as tracked or made to order with a note (audited). The customer is never charged again.
- Products are matched by their stable identity when syncing: a till no longer mixes up two products that had the same local and server number.

## Upgrade order and mixed versions
**Cloud first, then hubs, then tills.** Database migrations (applied automatically): `20261029100000_product_stock_policy`, `20261029120000_stock_policy_version`, `20261029140000_stock_policy_history`, `20261029160000_stock_policy_rev`, `20261029180000_sync_client_gate` — all additive (new columns, and one new table for the upgrade check).

No mix of versions takes payment for a made-to-order item and rejects the sale afterwards:
- New till on an older hub (1.0.50 or earlier): drinks show as out of stock and cannot be added; a till that still has them cached as made-to-order refuses at payment ("Nothing was charged. Update the hub…").
- Older till on an updated hub or cloud: drinks show as out of stock and cannot be added. An older till always sells from stock, so its sales are recorded that way (flagged for review if the product is made to order today), never re-read with today's setting. The app also enforces: a product's stock setting cannot change while a till or hub on an older version has traded in the last 14 days (the editor names them). Update them, or — for one no longer in use — retire it (manager, with a note; recorded in the audit log).
- To sell made-to-order items, the store's hub (or the cloud, for direct tills) and the selling tills must be on 1.0.51. The only gap the apps cannot close themselves is a 1.0.51 hub syncing to an older cloud — the cloud is always updated first.

- A till the owner retired cannot take payment when it comes back on an older version (connected to a hub): checkout is refused before payment with "update this till, or ask the owner to re-admit it". Updating the till, or re-admitting it (manager, with a note; audited), restores it. Sales an older till completed offline are recorded as sold from stock, never left waiting. Tills connected directly to the cloud cannot be stopped this way: update them first.

## Before enabling café stock settings in a store
- Update every till that connects **directly to the cloud** (not through a hub) first. Find them with the read-only report `apps/api/scripts/report-direct-tills.mjs` — do not rely on these notes alone.
- Retiring a till never erases sales it already completed; it only stops an older till's new checkouts.
- Lines marked "legacy" came from an older till, which always sells from stock. That says how the till handled the sale, not what the product's stock setting was at the time.

## Known, not in this release
- Stock-decision approval checks the manager named by the till (they must exist, be active and have Manage inventory) but not proof that this manager made the decision. Every decision is in the audit log. Planned for Sprint 2.
- Staff attribution (S4): the server records the cashier the till names. Tracked by an expected-failure test probe; fix planned for Sprint 2.
