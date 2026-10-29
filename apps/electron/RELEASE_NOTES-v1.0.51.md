# Titan POS v1.0.51 (candidate — not released)

## Security (Sprint 0)
- A store's staff can no longer read another store's data, and cashiers can no longer download staff PIN hashes.
- Offline sign-in keeps working: a till uses the PIN copy it saves after an online sign-in. A full sync no longer erases those copies (it used to).
- Permissions now enforced: catalogue price/cost changes, selling below the price (manager override), reports, device approval, driver logins. New permission "See cost & profit"; cashiers no longer see cost or margin, and their sync carries no cost data.

## Café (Sprint 1)
- Products without a barcode (drinks) and a "Track stock" setting: made-to-order items sell with no stock count, next to scanned packaged goods in the same order.
- Refunding a made-to-order item returns money only.
- Stock-setting changes between an offline sale and its sync: the server keeps a history of every product's stock setting, and an offline sale is recorded under the setting it was actually sold with — the server reads it from that history, never from what the till claims. A sale whose setting differs from today's is flagged for review; a till claim that contradicts the history is refused (the sale shows as needing attention, nothing is recorded silently). If the original setting cannot be established (older tills), today's setting applies and the sale is flagged "unknown".
- Products are matched by their stable identity when syncing: a till no longer mixes up two products that had the same local and server number.

## Upgrade order and mixed versions
**Cloud first, then hubs, then tills.** Database migrations (applied automatically): `20261029100000_product_stock_policy`, `20261029120000_stock_policy_version`, `20261029140000_stock_policy_history` — all add columns only.

No mix of versions takes payment for a made-to-order item and rejects the sale afterwards:
- New till on an older hub (1.0.50 or earlier): drinks show as out of stock and cannot be added; a till that still has them cached as made-to-order refuses at payment ("Nothing was charged. Update the hub…").
- Older till on an updated hub or cloud: drinks show as out of stock and cannot be added.
- To sell made-to-order items, the store's hub (or the cloud, for direct tills) and the selling tills must be on 1.0.51. The only gap the apps cannot close themselves is a 1.0.51 hub syncing to an older cloud — the cloud is always updated first.

## Known, not in this release
- Staff attribution (S4): the server records the cashier the till names. Tracked by an expected-failure test probe; fix planned for Sprint 2.
