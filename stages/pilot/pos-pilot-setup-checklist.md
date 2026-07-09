# POS Pilot Setup Checklist

**Date:** 2026-07-09
**Status:** READY FOR PILOT

---

## 1. Required Environment Variables

### Local API Server (`.env` in `apps/api/`)
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lebanonpos
JWT_SECRET=<strong-random-string>
ADMIN_PASSWORD_HASH=<bcrypt-hash-of-admin-password>
NODE_ENV=production
PORT=3001
```

### Railway (set in Railway dashboard)
- `DATABASE_URL` — auto-provided by Railway PostgreSQL plugin
- `JWT_SECRET` — same as local for cross-device sync
- `ADMIN_PASSWORD_HASH` — generate with `node -e "console.log(require('bcryptjs').hashSync('yourpassword', 10))"`

---

## 2. Database Setup

```bash
# Local development
cd apps/api
npx prisma migrate dev
npx prisma db seed   # creates 3 tenants: fakih, newstore, bendo2

# Railway production (auto-runs on deploy via Dockerfile)
# Dockerfile CMD: npx prisma migrate deploy && node dist/index.js
```

---

## 3. Admin Login / Setup

1. Open `https://lebanon-pos-production.up.railway.app/admin/login`
2. Log in with admin credentials (password set in `ADMIN_PASSWORD_HASH`)
3. Enter your tenant subdomain (e.g. `bendo2`) and staff PIN
4. The admin dashboard shows tenant management, products, customers, sales, reports

---

## 4. Printer / Receipt Setup

The POS uses browser `window.print()` for receipts. No driver installation needed.

- Install the POS on a Windows/Mac machine with a printer connected
- Receipts print as HTML via the browser print dialog
- WhatsApp receipt sharing available from sale completion screen
- Receipt footer text is configurable in Settings → Business

---

## 5. Currency / Exchange Rate Setup

1. Go to **Settings → Business**
2. Set **VAT rate** (Lebanon = 0.11 or 11%)
3. Set **USD to LBP exchange rate** (e.g. 89,500)
4. Save settings
5. The POS handles USD/LBP mixed cash tender automatically
6. Exact LBP button rounds to nearest 5,000 LBP banknote

---

## 6. Store Profile Setup

1. Go to **Settings → Business**
2. Fill in:
   - **Store name** — displayed on receipts and dashboard
   - **Branch name** — for multi-branch operations
   - **Phone** — contact number
   - **Address** — store address
   - **Low stock threshold** — default 10 units
   - **Profit margins** — percentage presets for receiving
   - **Receipt footer** — optional text at bottom of receipts
3. Save settings

---

## 7. Staff / Roles Setup

1. Go to **Staff → Team**
2. Click **"+ Add"** button
3. Create users with these roles:
   - **Admin** — full control (1-2 people)
   - **Manager** — checkout, inventory, customers, reports, shifts, delivery (1 per shift)
   - **Cashier** — checkout only (1+ per register)
   - **Driver** — delivery orders only (1+ if doing delivery)
4. Each staff member gets a unique PIN
5. Toggle inactive staff with the Active/Inactive filter

---

## 8. Products / Import Setup

1. Go to **Products → Add product** tab
2. Create products manually by filling: name, barcode, category, price, cost
3. For bulk import:
   - Go to **Products → New** (receiving page)
   - Click **"Paste"** button
   - Paste spreadsheet data in format: `Name, Barcode, Category, Qty, Cost, Price`
4. Quick-create from Products page toolbar: click **"+ New Product"**
5. Product images can be generated from the admin panel (AI-powered, optional)

---

## 9. Customer Debt Setup

1. Go to **Customers**
2. Click **"+ Add customer"** in the right panel
3. Set:
   - **Name** (required)
   - **Mobile** (required, used for WhatsApp reminders)
   - **Credit limit** — 0 = no limit
   - **Wholesale** checkbox — for wholesale pricing
   - **Notes** — optional
4. Customer debt is automatically tracked when Debt sales are made
5. Record payments through **Pay debt** tab

---

## 10. Daily Close Routine

1. At end of day, go to **Accounting → Close day**
2. Review:
   - Gross sales, refunds, net sales, cost of goods, gross margin
   - Expenses total, net profit
   - Cash in, cash out, supplier payments, net cash movement
3. Enter **counted cash** (actual money in drawer)
4. Enter a closing note (optional)
5. Click **"Close Today"** → confirm
6. The day is now sealed and synced to the server

---

## Verification Checklist

- [ ] Can log in with staff PIN
- [ ] Can scan barcode → item appears in cart
- [ ] Can complete cash sale (USD + LBP)
- [ ] Can complete card/wallet/debt sale
- [ ] Can print/receipt view
- [ ] Products page loads with all products
- [ ] Can receive stock with supplier
- [ ] Customer list shows debt/risk badges
- [ ] Accounting page shows daily totals
- [ ] Settings page shows sync status
- [ ] Dashboard shows KPIs + alerts
