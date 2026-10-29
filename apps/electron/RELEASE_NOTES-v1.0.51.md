# Titan POS v1.0.51 (candidate — not released)

## Security (Sprint 0)
- A store's staff can no longer read another store's data, and cashiers can no longer download staff PIN hashes.
- Offline sign-in keeps working: a till uses the PIN copy it saves after an online sign-in. A full sync no longer erases those copies (it used to).
- Permissions now enforced: catalogue price/cost changes, selling below the price (manager override), reports, device approval, driver logins. New permission "See cost & profit"; cashiers no longer see cost or margin, and their sync carries no cost data.

## Café (Sprint 1)
- Products without a barcode (drinks) and a "Track stock" setting: made-to-order items sell with no stock count, next to scanned packaged goods in the same order.
- Refunding a made-to-order item returns money only. A stock-setting change between an offline sale and its sync keeps the setting the item was sold under, and is flagged for review.
- Products are matched by their stable identity when syncing: a till no longer mixes up two products that had the same local and server number.

**Upgrade order:** cloud first, then hubs, then tills. A store must update its hub before selling made-to-order items through it; a till refuses those items before payment when its hub or cloud is older.
