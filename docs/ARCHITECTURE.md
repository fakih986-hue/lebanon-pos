# Lebanon POS Architecture

Lebanon POS is now organized around operational modules rather than isolated screens.

## Product Modules

- POS checkout: cart, payment method, debt checkout, stock deduction, sale recording, receipt printing.
- Dashboard: live operating view for revenue, profit, stock, debt, top products, recent sales, and action items.
- Products: searchable catalog, stock value, stock status, and barcode visibility.
- Receiving: batch stock receiving, USB barcode scanner input, camera scan support, generated barcodes, printable labels.
- Sales: immutable sales history and payment mix.
- Customers: customer accounts, mobile numbers, credit limits, debt balances, payments, and activity history.
- Settings: business profile, VAT rate, low stock threshold, receipt footer, backup export.

## Data Boundary

The preview uses browser localStorage through service modules:

- `product.service.ts`
- `sales.service.ts`
- `customer.service.ts`
- `settings.service.ts`

These services are the production swap point. In the deployed environment, replace localStorage reads/writes with API or Prisma calls while keeping the page components mostly unchanged.

## Commercial Backend Targets

- Products, categories, batches, stock movements
- Sales, sale items, payment methods, receipt numbers
- Customers, customer payments, debt ledger
- Users, roles, shifts, cash drawer sessions
- Store settings, tax rules, receipt templates
- Audit events for price changes, refunds, voids, stock edits, and debt payments

## Deployment Notes

- Camera barcode scanning requires HTTPS on real mobile/tablet devices.
- USB barcode scanners work as keyboard input and are already supported by the receiving screen.
- Receipt and barcode label printing use browser print windows now; production desktop builds can route these to configured printers.
- The current UI is English and intentionally cashier-focused: dense, scannable, and built for repeated daily operations.
