# Lebanon POS

Lebanon POS is a multi-app retail POS platform for Lebanese mini markets and small retail shops. It includes an offline-first desktop checkout, a Railway/PostgreSQL API, admin dashboards, customer ordering, driver delivery flows, inventory batches, debts, suppliers, and sync.

## Apps

- `apps/desktop` - cashier POS, inventory, customers, debts, suppliers, receiving, reports, settings.
- `apps/api` - Express API, Prisma/PostgreSQL, sync, auth, delivery, WebSocket events.
- `apps/admin` - browser admin dashboard for cloud operations.
- `apps/ordering` - customer-facing ordering site.
- `apps/driver` - driver order acceptance and delivery workflow.
- `apps/electron` - desktop packaging shell.
- `packages/shared` - shared React providers and WebSocket/i18n/theme utilities.

## Local Setup

If the project was copied from another machine, reinstall dependencies locally before running checks. Copied `node_modules` command shims can point to the old path.

```sh
pnpm install
pnpm --dir apps/api db:generate
```

Run the main POS:

```sh
pnpm dev
```

Run cloud/API apps:

```sh
pnpm dev:api
pnpm dev:admin
pnpm dev:ordering
pnpm dev:driver
```

## Verification

```sh
pnpm typecheck:all
pnpm test:all
pnpm build:all
```

## Railway Production Checklist

- Set `DATABASE_URL` to the Railway PostgreSQL database.
- Set a strong `JWT_SECRET`; do not use the development fallback in production.
- Set `CORS_ORIGINS` to the deployed admin, ordering, driver, and desktop origins.
- Run Prisma migration or `db:push` according to the deployment process.
- Generate Prisma client during build.
- Confirm `/api/health` responds after deploy.
- Confirm WebSocket path `/ws` connects for authenticated admin/driver users.
- Seed or reset the first admin only through trusted scripts.

## Demo Checklist

- Complete a POS sale with barcode scan and receipt.
- Complete a debt sale, then pay customer debt later.
- Receive product batches with expiry dates.
- Trigger low stock/reorder suggestions.
- Place a customer online delivery order.
- Accept and deliver the order in the driver app.
- Review sales receipt history and dashboard totals.

## Security Notes

- Public ordering must send only product IDs and quantities; the API calculates prices, delivery fee, stock, and totals.
- WebSocket subscriptions are restricted to the authenticated tenant/user.
- Delivery tracking requires tenant context so order numbers cannot leak across stores.
