# Titan POS v1.0.47

## Fix — clear guidance when no shift is open (was: "Checkout failed" on every sale)

**Symptom:** On a fresh register, every sale failed with *"Checkout failed. Cart
preserved, try again."*

**Cause:** A sale must belong to an open register shift (cash control, so the
daily close can reconcile the drawer). A brand-new register has no shift open,
so the sale was refused — but the real reason was swallowed and shown as a
generic failure, with no hint about what to do.

**Fix:**
- The POS now says **"No open shift — open one in Accounting → Shift before
  selling"** (and beeps) instead of the generic failure — on both the review
  step and on submit, so you're never left guessing.
- Any *other* checkout failure now shows its **real reason** at the till instead
  of a fixed generic string.

**What to do on a new register:** open a shift once — **Accounting → Shift →**
enter the opening float → **Open shift** — then sell normally. (Requires the
Manage shifts permission; owners/managers have it.)

Verified with live acceptance tests against the real sale + shift services: a
fresh register correctly blocks the sale (persisting nothing) and completes it
as soon as a shift is open; full desktop suite green (252 tests).

Also includes the earlier keyboard-checkout fix (Enter completes a sale) and the
clean-machine startup fix (bundled VC++ runtime for embedded PostgreSQL).
Money, tender, and receipt logic are unchanged.
