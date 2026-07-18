# Titan POS v1.0.41 — Commercial UI Polish

**Type:** Desktop client-only release. **No server, schema, or migration change.**
**Baseline:** v1.0.40 (never hub-installed — this build also carries 1.0.40's
offline fresh-detection patch to the hub). **Railway:** not deployed (cloud
already current on `9fc6f0e`).

---

## What's in this build

### UI consistency pass (POS-UX-FINAL-POLISH-1)
- **Default button sizing** (40px / 14px padding / 13px) for all `.btn` variants
  — fixes ~15 previously unsized buttons (first-setup wizard/import/scan, bulk
  import, quick create) that rendered with no height/padding; explicitly-sized
  buttons are unaffected (layered CSS).
- Icon buttons: disabled state (0.45 opacity); Spinner uses brand tokens +
  `role="status"`.
- Empty states across Suppliers (×3), Dashboard (×2), Customers, and
  Products→Categories: icon + bold title + guidance hint instead of bare grey
  text.
- Accessibility: aria-labels on Login modal close buttons and the Products
  sort toggle; Drivers "Edit" moved onto standard button classes.

### Live visual smoke + fixes (POS-UX-FINAL-POLISH-2)
21 screen captures (desktop / mobile / dark) with 0 console errors. Fixes:
- **Mobile Products page no longer overflows horizontally** (569px → 0): the
  `sr-only` accessibility span in the table header escaped the table's scroll
  container and widened the page; fixed in Products + the same latent pattern
  in Suppliers.
- **Topbar now says "Stock & Batches" on `/stock`** (was "Point of Sale");
  English + Arabic.
- **Suppliers: the "Activity" tab is no longer clipped** under "+ Add supplier"
  — the tab row wraps and the search field drops to its own line.

### Carried from v1.0.40 (first hub install of it)
- Offline fresh-store detection: brand-new installs that haven't synced yet now
  show the first-time catalog setup prompt (the bundled demo catalog no longer
  suppresses it).

No feature or business-logic changes. Reports:
`stages/ux/pos-ux-final-polish-1-report.md`, `-2-report.md` (+ screenshots).

---

## Artifacts

| Artifact | File | Size |
|---|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.41.exe` | 264,937,222 bytes |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.41.exe` | 264,467,573 bytes |

### SHA-256
```
8791a2c798bddea2e90ae7085c0ecc97e727677d89d466329d6248e36cf25f40  Titan POS Setup 1.0.41.exe
d0f3506553c3ccdcc1c0aae336fcdf042158ecbf2f32bbd2814dd91afe0845c8  Titan POS 1.0.41.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml` removed). Install manually.

---

## Hub acceptance checklist
- [ ] Products on a phone/narrow window: no horizontal page scroll
- [ ] Stock & Batches: topbar title reads "Stock & Batches" (Arabic: "المخزون والدفعات")
- [ ] Suppliers: all four tabs visible; "+ Add supplier" doesn't cover "Activity"
- [ ] First-setup wizard / bulk import / quick create: buttons are full-height (not cramped)
- [ ] Empty screens (Suppliers, Dashboard with no sales, Customers search) show icon + guidance text
- [ ] Fresh unsynced install shows the catalog setup prompt (1.0.40 fix)
- [ ] Everything from 1.0.39 still works (first-setup import/scan, opening inventory report, daily Receive)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **235**, API **212**
- Packaged SPA: single root bundle `index-2MlHzRtr.js` (stale-asset hygiene applied); markers verified — "Stock & Batches" topbar title, supplier/customer/dashboard empty-state hints, `@layer components` button defaults, `icon-btn:disabled`, first-setup screens
- Server runtime unchanged since deployed `9fc6f0e` → **no Railway deploy**
