# Titan POS v1.0.46

## Fix — completing a sale with the keyboard (main POS)

**Symptom:** After adding items to the cart, pressing **Enter** did nothing — the
sale wouldn't go through from the keyboard.

**Cause:** The barcode/scan box is auto-focused and keeps focus through the sale,
so Enter was firing there as an empty "add item" (a no-op). The cart's cash
tender fields never handled Enter, and the "Confirm Sale" dialog wasn't focused
when it opened, so its Enter/Escape didn't fire either.

**Fix — the checkout is now fully keyboard-driven:**
- **Enter on an empty scan box** (with items in the cart) opens the checkout
  review — or, if something's blocking it, says exactly what (payment still due,
  no debt customer selected, credit limit exceeded).
- **Enter in the cash paid field** (USD or LBP) jumps straight to the review.
- **The Confirm Sale dialog is focused when it opens**, so **Enter confirms** and
  **Esc cancels** — including for anyone who clicks Checkout with the mouse.

Flow: add items → **Enter** → review → **Enter** → sale done.

Also includes the v1.0.45 clean-machine startup fix (bundled VC++ runtime for the
embedded PostgreSQL). Money, tender, and receipt logic are unchanged.
