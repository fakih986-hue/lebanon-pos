# Cashier test checklist: register slice (Midnight Gold v2)

**Where:** `pnpm --dir apps/desktop dev`, then open **http://localhost:5174/?dev**. This is local dev mode: a "Dev Admin", the demo catalog, and no server. Test the hub or cloud too, on a test store, never production.

**Before you start:** open a shift. On any screen size, tap the shift chip in the top bar ("No shift") or **Open shift** in the register banner, enter the opening float, and press **Open**. On a wide screen the cart rail has the same Cash Drawer. Repeat the checks in Arabic (the AR button) and in light mode (the sun button).

**How to record a result:** tick the item, or write what happened.

## Scanning and focus
- [ ] The scan field has focus when the register opens. Typing goes there without clicking.
- [ ] Scanning (or typing) a barcode and pressing Enter adds the item. The status line names it ("Pepsi Can added (barcode)."), and the scan field keeps focus.
- [ ] An unknown barcode says "No item found for …" and adds nothing.
- [ ] Esc in the scan field clears what you typed and keeps focus there.
- [ ] Tapping a product tile adds it, with "(tap)" in the status line.
- [ ] Out-of-stock items can't be added. The status line says why.

## Quantity edits
- [ ] + and − change the line quantity. The total, LBP line and cash-payable line update immediately.
- [ ] Typing a quantity in a line sets it. Enter keeps it; Esc cancels.
- [ ] Removing a line (bin icon) updates the totals.
- [ ] The line count and unit count under "Current sale" are right ("3 lines · 4 units").

## Held sales
- [ ] F8 (or Hold) holds a sale with items. The cart empties, and the held sale appears in the rail.
- [ ] Resuming a held sale brings back its lines and totals exactly.
- [ ] Resuming is refused while another sale is in the cart, with a message.
- [ ] Discarding a held sale asks for confirmation, then removes it.

## Cash payment
- [ ] F2 selects Cash (also with focus in the scan field). The selected option shows a check and a gold edge.
- [ ] **Total due** shows the USD total, then "… LBP cash · $…" and "Rounded up from …" when rounding applies.
- [ ] Exact LBP and Exact USD fill the **cash-payable** amount. Change shows "No change due".
- [ ] Paying $20 + 200,000 LBP shows the change in **USD** first (the currency handed back), with LBP under it.
- [ ] Paying LBP only shows the change in **LBP** first.
- [ ] Not enough paid: "Still due …" in orange, and Pay does not open the review.
- [ ] The Pay button shows the amount the customer pays (cash payable).

## Debt payment
- [ ] F5 selects Debt and the customer picker appears. Enter in the search picks the first match.
- [ ] Current balance, the balance after the sale, and the credit limit are shown.
- [ ] A customer over their limit blocks the sale: "Sale blocked: over the credit limit by …".
- [ ] After a debt sale, the customer's balance goes up by the total.

## Review, confirm, cancel
- [ ] Enter on an empty scan field (or the Pay button) opens **Review payment**. Focus is on the confirm button.
- [ ] Tab and Shift+Tab stay inside the dialog.
- [ ] Esc or Back closes it. Focus returns to the scan field, and the cart is unchanged.
- [ ] Enter (or the confirm button) completes the sale.
- [ ] **Clear sale** (eraser) empties the cart after confirmation. Nothing is recorded.

## Receipt
- [ ] After a sale, the **Sale complete** panel shows the receipt number, the amount paid (cash payable), and the change to give.
- [ ] The panel does not take focus. Scanning the next item closes it and starts a new sale.
- [ ] Print receipt opens the 80 mm receipt. Check its total, cash rounding, cash payable, paid and change lines.
- [ ] WhatsApp opens a message with the receipt number and total.

## Simple POS
- [ ] Simple mode opens the full-screen register. The scan field has focus.
- [ ] Scan, quantities, cash, exact buttons, review, confirm and receipt behave as above.
- [ ] Full register returns to the normal register with the same cart.
- [ ] As a Cashier, **Sell at Cost** is hidden; it needs the price-override permission.

## Offline and restart
- [ ] Turn the network off. The capsule shows "Offline: saved on this device".
- [ ] A cash sale completes offline and appears in recent receipts.
- [ ] Reload or restart the app while offline (or with the store server down). The sale, the waiting count and the local stock are unchanged, and the scan field has focus.
- [ ] Turn the network back on and press **Sync now** in the capsule. The waiting count drops, and the sale appears once on the server (Sales page, or the owner report).
- [ ] Restart again: the sale is not sent or counted twice.

## Shift and drawer
- [ ] On a phone or tablet with no open shift, the register shows "No open shift" with **Open shift**, and the top-bar chip says "No shift".
- [ ] Tapping either one opens **Shift & drawer** from the bottom. Focus is in the opening-float field. After **Open**, the banner disappears and the chip shows the shift number.
- [ ] Esc (or ×) closes the sheet, and focus returns to the chip.
- [ ] As a Cashier: you can open your own shift and close it. Owner draw and Record expense show why they are unavailable instead of doing nothing.
- [ ] Record expense with no open shift says to open a shift first. A recorded expense shows a confirmation with the amount, in English and Arabic.
- [ ] Before closing the shift, check that the expected-in-drawer amount includes the sales just made.
- [ ] **Known gap.** The drawer closes slightly **over**, by the sum of the cash rounding (`docs/CASH-ROUNDING-RECONCILIATION.md`). Record the amount you see; this is expected until the rounding policy is decided.

## Automated evidence for the same flows

These check behaviour; they don't replace this checklist.

| Script | What it proves |
|---|---|
| `docs/design/qa-app.cjs` | Screenshots. With `BEHAVIOUR=1`: keyboard, focus trap with real Tab presses, focus return, offline sale, Cashier permissions. With `SHIFT=1`: a fresh phone (390×844) and tablet (768×1024) session, no shift, opened from the top bar or banner, then a sale; Cashier permission reasons |
| `docs/design/qa-offline-recovery.cjs` | Offline sale → real reload → server back → sale recorded exactly once (real API, scratch DB) |
