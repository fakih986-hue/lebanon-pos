# Titan POS v1.0.51 (candidate — not released)

## Security (Sprint 0)
- A store's staff can no longer read another store's data, and cashiers can no longer download staff PIN hashes.
- Offline sign-in keeps working: a till uses the PIN copy it saves after an online sign-in. A full sync no longer erases those copies (it used to).
- Permissions now enforced: catalogue price/cost changes, selling below the price (manager override), reports, device approval, driver logins. New permission "See cost & profit"; cashiers no longer see cost or margin, and their sync carries no cost data.

## Café (Sprint 1)
- Products without a barcode (drinks) and a "Track stock" setting: made-to-order items sell with no stock count, next to scanned packaged goods in the same order.
- Refunding a made-to-order item returns money only.
- Stock-setting changes between an offline sale and its sync: every change of a product's stock setting gets its own identity, the same on the till, the hub and the cloud. A sale is recorded under the setting it was actually sold with — on the hub and again in the cloud — never re-read with today's setting. If two places change the same product's setting at the same time, the cloud's setting stays current, the other change is kept for the sales made under it, and the conflict is shown for review. A sale whose setting the server has not received yet is held (nothing applied) and retried automatically; it stays visible until it goes through.
- Products are matched by their stable identity when syncing: a till no longer mixes up two products that had the same local and server number.

## Upgrade order and mixed versions
**Cloud first, then hubs, then tills.** Database migrations (applied automatically): `20261029100000_product_stock_policy`, `20261029120000_stock_policy_version`, `20261029140000_stock_policy_history`, `20261029160000_stock_policy_rev` — all add columns only.

No mix of versions takes payment for a made-to-order item and rejects the sale afterwards:
- New till on an older hub (1.0.50 or earlier): drinks show as out of stock and cannot be added; a till that still has them cached as made-to-order refuses at payment ("Nothing was charged. Update the hub…").
- Older till on an updated hub or cloud: drinks show as out of stock and cannot be added. An older till's sale of a product whose stock setting has been changed cannot say which setting it was sold under: it is held (shown as not synced on that till, nothing recorded) rather than recorded with today's setting. **Upgrade every till before changing any product's stock setting.**
- To sell made-to-order items, the store's hub (or the cloud, for direct tills) and the selling tills must be on 1.0.51. The only gap the apps cannot close themselves is a 1.0.51 hub syncing to an older cloud — the cloud is always updated first.

## Known, not in this release
- Staff attribution (S4): the server records the cashier the till names. Tracked by an expected-failure test probe; fix planned for Sprint 2.
