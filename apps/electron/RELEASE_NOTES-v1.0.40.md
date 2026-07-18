# Titan POS v1.0.40 — Offline Fresh-Store Detection Patch

**Type:** Desktop client-only patch. **No server, schema, or migration change.**
**Baseline:** v1.0.39. **Railway:** not deployed (server runtime unchanged).

---

## What's in this build

### Fix — first-run setup prompt on a brand-new offline install
- A brand-new install whose product data had **never been written** (no cloud
  pull yet) was mis-classified as **"review"** instead of **"fresh"**, because
  store detection counted products via `getProductsSync()` — which falls back to
  a bundled 12-item **demo catalog** when the products key is absent. The
  first-time catalog setup prompt was therefore hidden on a genuinely fresh
  offline install.
- Detection now reads the **raw** stored products (new read-only
  `getStoredProducts()`), so an unwritten key counts as **0 products** →
  **fresh**. The product-list UI is unchanged (the demo fallback in
  `getProductsSync()` is untouched).
- Connected-hub behavior is unchanged: the first full pull writes an empty
  products array, which already read as fresh.

**Detection before → after** (offline, products key absent, no activity):
`review` (12 demo counted, prompt hidden) → **`fresh`** (prompt shown).

No other behavior changes. No feature work.

---

## Artifacts

| Artifact | File |
|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.40.exe` |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.40.exe` |

### SHA-256
```
f48d344f1b87f853d2320976a3fd5c7a84e0a8486d0acfba0265671325a1abef  Titan POS Setup 1.0.40.exe
32a5b557276a5d1f13c99e6344fefa5fc9f6019de8b23b245ce2d5fc34a2a1e9  Titan POS 1.0.40.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml` removed). Install manually.

---

## Hub acceptance checklist
- [ ] Install fresh (or clear local data) **without** connecting to a tenant → Dashboard shows the **"Set up your product catalog"** prompt
- [ ] After connecting to a fresh tenant, the prompt still shows; after adding products it goes away
- [ ] Everything from 1.0.39 still works (First-time catalog setup wizard, Import, Scan, Stock & Batches → Opening inventory, daily Receive stock)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **235**, API **212**
- Packaged SPA: single root bundle `index-B_HjGw6v.js` (stale-asset hygiene applied); markers present — First-time catalog setup, "No products, sales, or stock yet" (detection), Confirm opening inventory, Save & scan next, Opening inventory, `view=Opening`
- Schema/migrations: **none**
- Server runtime: **unchanged** → **no Railway deploy**
