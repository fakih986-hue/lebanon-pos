# Titan POS v1.0.42 — Final Commercial Polish

**Type:** Desktop client-only release. **No server, schema, or migration change.**
**Baseline:** v1.0.41. **Railway:** not deployed (cloud already current on `9fc6f0e`).

---

## What's in this build

### POS checkout polish (POS-UX-FINAL-CHECKOUT-1)
- **Disabled checkout button is now clearly inert** (muted grey) instead of a
  faded-gold button that still looked tappable — the insufficient-payment /
  missing-debt-customer state cashiers hit all day is now unmistakable. Enabled
  state stays full gold. Applies to both the cart rail and the mobile drawer.
- Cart line **remove (trash) button turns danger-red on hover** instead of a
  generic opacity dim.

### Products & Stock polish (POS-UX-FINAL-PRODUCTS-1)
- **Search icons no longer overlap the input text** — fixed at the stylesheet
  layer for all seven affected fields at once: Products search + category
  filter, Batches search, Customers, Delivery, and Sales search + method
  filter.
- Product-row **archive X** and variant-row **remove X** turn danger-red on
  hover; the row edit pencil got its missing hover state; tooltips added.

### Back-office polish (POS-UX-FINAL-OPERATIONS-1)
- Staff: the **Delivery permission now shows a proper label** (English +
  Arabic) — Driver's permission chip and the Admin/Manager trailing chip were
  rendering as blank pills. Future unlabeled permissions fall back to their raw
  key instead of a blank chip.
- Staff: the active-register user select no longer clips its label
  ("Owner - Ad…") in the narrow team column.
- Suppliers: the archive/restore row button uses proper icons instead of raw
  emoji ("📦"/"↩").

Live-verified per sprint via headless-Chrome smoke walks (desktop + mobile,
computed-style probes, 0 console errors). Reports in `stages/ux/` and the
sprint commit messages (80beeb2, 78d2f18, 1ce312b).

No feature or business-logic changes.

---

## Artifacts

| Artifact | File | Size |
|---|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.42.exe` | 264,937,336 bytes |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.42.exe` | 264,467,616 bytes |

### SHA-256
```
ca92c11e6fdcd348f16c0a5c3e0e500d7b6c8cf0ae463d4575985a9de72c6c51  Titan POS Setup 1.0.42.exe
e048b5958836360bd831cbddb5b8481f06d595bfebe9e4229100ad23714059a5  Titan POS 1.0.42.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml` removed). Install manually.

---

## Hub acceptance checklist
- [ ] POS: with items in the cart and no payment entered, the Pay button is a muted grey block (not gold); entering exact cash turns it gold
- [ ] POS: hovering a cart line's trash icon turns it red
- [ ] Products: search field / category filter icons sit clear of the text; row X turns red on hover
- [ ] Staff → Roles: Driver shows a "Delivery" chip (no blank pills); the user dropdown shows the full "Owner - Admin" label
- [ ] Suppliers: archive button shows a box icon (not an emoji)
- [ ] Everything from 1.0.41 still works (first-setup wizard, opening inventory, daily receive, mobile Products)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **235**, API **212**
- Packaged SPA: single root bundle `index-CUKxTH-2.js` (stale-asset hygiene applied); markers verified — `btn-checkout:disabled`, `cart-remove-btn`, `hover-danger` (CSS+JS), `.input` layer padding, `permission_delivery` (en+ar), "Archive product" / "Remove variant" / "Active register user"
- Server runtime unchanged since deployed `9fc6f0e` → **no Railway deploy**
