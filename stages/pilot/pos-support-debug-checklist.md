# POS — Support & Debug Checklist

**For:** Pilot support team / Developer
**Date:** 2026-07-09

---

## What to Collect When There's a Problem

### Required Information (EVERY report needs these)
| Item | Where to find it |
|------|-----------------|
| Sale number | Receipt, Sales page, or cart display (e.g. `S-12345678`) |
| Customer name | Sales page row, customer ledger |
| Timestamp | Browser console, receipt date, or Sales page |
| Exact steps to reproduce | What did the cashier click/tap/scan? |
| Screenshot of the error | PrintScreen or snippet tool |
| Console errors | Press F12 → Console tab → screenshot red errors |
| Sync status | Settings → Cloud sync → screenshot pending/failed/stuck counts |
| POS version/commit | Settings page footer or `git log -1 --oneline` on the PC |

### Nice-to-Have (speed up debugging)
| Item | Where to find it |
|------|-----------------|
| Browser + version | Chrome typically. F12 → top of Console |
| Operating system | Windows 10/11, Mac |
| Network status | Was internet working at the time? |
| Staff user + role | Who was logged in? POS header shows name. |
| Payment method used | Cash/Card/Wallet/Debt |
| Exact LBP used? | Did the cashier press Exact LBP? |
| Held sale involved? | Was the sale held and resumed? |

---

## Recovery Steps for Common Issues

### 1. Sale completed but items still in cart
- The sale was NOT completed (checkout blocked or failed)
- Check the cart for error messages ("Insufficient payment", "Select customer")
- Fix the issue and try again

### 2. Sale completed but stock not decremented
- This is a sync issue — the sale is queued locally
- Settings → Cloud sync → Sync Now
- If stuck: note the sale number and contact support

### 3. Sync operations stuck / failed
- Settings → Cloud sync → Retry Failed
- If same ops fail repeatedly: note the entity/error text and contact support
- Common: "Insufficient stock in batch" — stock count was wrong when sale was made
  - Fix: Adjust stock via Products → Stock Control → select product → adjust quantity

### 4. Product not found on barcode scan
- QuickPOS: "Unknown barcode" message
- Manager/Admin: can create product immediately
- Cashier: ask manager to add product in Products page

### 5. Customer debt shows wrong balance
- Customers page auto-refreshes
- Check that all debt sales and payments are recorded
- Record a payment: Customers → Pay debt → enter amount

### 6. Receipt not printing
- Browser may block popup window
- Check browser settings → allow popups for this site
- Try printing from Sales page → click sale → Receipts view → reprint

### 7. Daily close shows incorrect expected cash
- Expected cash = cashSales - cashRefunds - cashExpenses - cashSupplierPayments
- Does NOT include opening float
- If counted cash ≠ expected: note the variance and describe in closing note

### 8. App white screen / not loading
- Refresh browser (F5 or Ctrl+R)
- Clear browser cache: F12 → Application → Clear storage
- Restart the local API: `pnpm dev:api`
- Check local PostgreSQL is running

### 9. Cannot connect to Railway
- Verify internet connection
- Check Railway service status
- POS works offline — sales queue locally until reconnect

---

## Commands Reference

```bash
# Typecheck (verify no code errors)
npx tsc -p apps/api/tsconfig.json --noEmit
npx tsc -p apps/desktop/tsconfig.json --noEmit

# Run tests
npx vitest run apps/desktop
npx vitest run apps/api

# Build desktop
cd apps/desktop && npx vite build

# Start local API
pnpm dev:api

# Start desktop dev server
pnpm dev

# Prisma migrations
cd apps/api && npx prisma migrate dev    # local
cd apps/api && npx prisma migrate deploy # production

# Railway
railway service status -s lebanon-pos
railway service logs -s lebanon-pos
railway service redeploy -s lebanon-pos -y

# Check if Railway API is live
curl https://pos.titan-suite.net/api/setup/diagnostics
```

---

## Known Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| `unitPrice.mul is not a function` | Prisma Decimal mock issue (test-only) | Ignore — test environment only |
| `null.id` in audit | No user logged in during audit event | Fixed in POS-HARDEN-1 |
| `usdInputRef is not defined` | Missing ref in CartDrawer | Fixed in POS-COMM-10 follow-up |
| `Unknown argument 'pinChanged'` | Prisma schema missing field | Fixed — migration applied |
| `Unknown argument 'batchAllocations'` | Prisma schema missing field | Fixed — migration applied |
| `Insufficient stock in batch` | Batch quantity exhausted before sync | Manually adjust stock or void sale |
