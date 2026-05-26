# Lebanon POS

Lebanon POS is a desktop-ready point-of-sale interface for small retail and food shops. The current app is built with React, TypeScript, Vite, Tailwind CSS, Zustand, Electron, and Prisma.

## What is included

- Fast POS screen with product search, category filters, cart controls, payment method selection, VAT calculation, and sale confirmation.
- Products screen with searchable inventory table, category filtering, stock status, catalog metrics, and barcode visibility.
- Receiving screen with manual entry, batch stock receiving, USB scanner input, camera barcode scanning, auto-generated barcodes, and printable sticky labels.
- Customer debt ledger with mobile numbers, POS debt checkout, outstanding balances, later payments, and activity history.
- Management dashboard for revenue, profit, payment mix, low stock, debt risk, top products, and recent sales.
- Sales history with payment filtering and complete receipt trail.
- Business settings for VAT, low-stock threshold, receipt footer, store profile, and JSON backup export.
- Professional English UI tailored for a cashier workflow.
- Electron entry point for desktop packaging.
- Prisma schema for future product, category, sale, and sale item persistence.

## Run the app

```sh
pnpm install
pnpm dev
```

Then open:

```txt
http://localhost:5173
```

## Build

```sh
pnpm build
```

## Electron

Start the Vite app first, then run:

```sh
pnpm electron:build
pnpm electron:start
```

## Project layout

```txt
apps/desktop   React POS frontend
apps/electron  Electron shell
docs           Architecture and production handoff notes
prisma         Database schema and seed data
packages       Shared workspace packages
```
