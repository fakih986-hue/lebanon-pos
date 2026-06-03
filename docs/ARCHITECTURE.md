# Lebanon POS Architecture

Lebanon POS is a multi-app POS platform with an offline-capable desktop checkout and a cloud API backed by PostgreSQL.

## System Shape

- Desktop POS stores local operational data in browser storage/IndexedDB and syncs to the API.
- API owns tenants, auth, sync, delivery, WebSocket events, and PostgreSQL persistence through Prisma.
- Admin, ordering, and driver apps are browser clients served separately or from API static assets.
- Shared package provides i18n, theme, and WebSocket helpers.

## Main Domains

- Retail checkout: sales, sale items, tenders, receipts, refunds, voids, shifts.
- Inventory: products, variants, barcode aliases, batches/lots, expiry, adjustments, stock counts.
- Customers: debt sales, payments, credit limits, customer order accounts.
- Suppliers: supplier ledger, purchase orders, payments, reorder suggestions.
- Delivery: customer order creation, admin dispatch, driver assignment, status tracking.
- Operations: settings, exchange rate, VAT, low-stock alerts, audit events, daily close.

## Trust Boundaries

- Public ordering clients are not trusted for price, fee, product name, stock, or total calculations.
- The API calculates delivery order totals from tenant products/settings and reserves stock transactionally.
- WebSocket subscriptions require an authenticated JWT and are limited to the caller's tenant/user channels.
- Public tracking requires tenant context with the order number.
- Desktop sync operations are tenant-scoped and must be validated before persistence.

## Sync Model

- Desktop queues operations locally and pushes them to `/api/sync/push`.
- API records each sync operation by tenant/id for idempotency.
- Pull sync returns tenant-scoped collections from `/api/sync/pull`.
- Server stock is updated when synced POS sales and voids are processed.
- Future work should expand conflict policy for simultaneous product edits and batch-level server movements.

## Production Readiness Targets

- Use precise money storage with Prisma `Decimal` or integer minor units.
- Keep quantity fields fractional where needed for weighted items.
- Validate all API payloads with Zod.
- Keep local-first checkout, but make server persistence authoritative when data syncs.
- Run `typecheck:all`, `test:all`, and `build:all` before deployment.
