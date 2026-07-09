# POS — Daily Operating Checklist

**For:** Pilot shop staff (Owner / Manager / Cashier)
**Date:** 2026-07-09

---

## Morning — Before Opening

| Step | Who | Action | Screen |
|------|-----|--------|--------|
| 1 | Owner | Turn on PC, open the POS app | Desktop shortcut |
| 2 | Owner | Open Staff → Shifts → "Open Shift" | `/staff` |
| 3 | Owner | Enter opening float amount | Shift dialog |
| 4 | Cashier | Log in with your PIN | Login screen |
| 5 | Cashier | Verify your name appears in top bar | POS header |
| 6 | Owner | Check Dashboard for alerts: low stock, overdue debt, failed sync | `/dashboard` |
| 7 | Owner | If sync issues: Settings → Cloud sync → Sync Now → Retry Failed | `/settings` |

---

## During the Day — Sales

| Step | Who | Action | Notes |
|------|-----|--------|-------|
| 8 | Cashier | Scan product barcode → item appears in cart | Scanner stays focused |
| 9 | Cashier | Tap product card to add manually | Works in grid view |
| 10 | Cashier | Select payment method: Cash / Card / Wallet / Debt | Payment tiles in tender panel |
| 11 | Cashier | Cash sale: enter USD or LBP paid, or press Exact LBP | Change calculated automatically |
| 12 | Cashier | Card/Wallet sale: select method, pay externally, tap Pay | Sale records immediately |
| 13 | Cashier | Debt sale: select customer, confirm credit limit OK | Blocked if no customer selected |
| 14 | Cashier | Review sale: Confirm Sale overlay shows totals + change | Enter to confirm, Esc to edit |
| 15 | Cashier | Receipt: print or WhatsApp share | After-sale banner |

### Hold Sales (if customer pauses)
| 16 | Cashier | Cart panel → Hold Sale | Sale saved as pill above cart |
| 17 | Cashier | Resume: tap held sale pill | Cart restores fully |
| 18 | Cashier | Discard: tap ✕ on held sale pill | Confirms before discarding |

### Refunds (if needed)
| 19 | Manager | Sales page → find sale → Receipts view | `/sales` |
| 20 | Manager | Enter refund quantity per item → Record Return | Stock restored automatically |
| 21 | Manager | Void sale: Sales page → Void button → confirm | Reverses inventory + debt |

---

## During the Day — Inventory

| Step | Who | Action | Screen |
|------|-----|--------|--------|
| 22 | Manager | Receive new stock: Products → New | `/products/new` |
| 23 | Manager | Select supplier, enter invoice number | Right sidebar |
| 24 | Manager | Scan or paste barcode + enter quantity/cost/price | Per-row input |
| 25 | Manager | Click Save Batch → verify toast summary | Confirms products created/updated |
| 26 | Manager | Check Batches/Lots tab: see FEFO order + expiry chips | `/products` → Lots tab |
| 27 | Manager | Low stock: Products → Low quick-view → reorder needed | `/products` |

---

## During the Day — Customers

| Step | Who | Action | Screen |
|------|-----|--------|--------|
| 28 | Cashier | Add customer: Customers → Add customer | `/customers` |
| 29 | Manager | Record payment: Customers → Pay debt tab | Select customer + amount |
| 30 | Manager | WhatsApp reminder: tap WhatsApp icon on overdue rows | `/customers` |

---

## End of Day — Closing

| Step | Who | Action | Screen |
|------|-----|--------|--------|
| 31 | Owner | Record any remaining expenses | `/accounting` → Expenses |
| 32 | Owner | Record any supplier payments | `/suppliers` → Pay supplier |
| 33 | Owner | Accounting → Close day | `/accounting` |
| 34 | Owner | Review: gross sales, refunds, expenses, net profit | CloseDayPanel |
| 35 | Owner | Count cash in drawer → enter "Counted cash" | Cash reconciliation section |
| 36 | Owner | Enter closing note → Close Today → confirm | Day sealed |
| 37 | Owner | Dashboard: verify day summary | `/dashboard` |
| 38 | Owner | Settings → Cloud sync → Sync Now | `/settings` |
| 39 | Owner | Settings → Cloud sync → Export Full Backup (JSON) | Save backup file |
| 40 | Owner | Staff → Shifts → close shift if applicable | `/staff` |

---

## Quick Help

| Problem | Fix |
|---------|-----|
| Scanner not working | Press Ctrl+F to focus scanner |
| Stuck in cart view | Press F8 to toggle cart |
| Sale blocked "Insufficient payment" | Check paid amount ≥ cash payable |
| Sale blocked "Select customer" | Debt sale needs customer selected first |
| Sale blocked "Credit limit" | Customer exceeded limit — use different payment |
| Sync errors showing | Settings → Cloud sync → Retry Failed |
| App not loading | Refresh browser (Ctrl+R) |
