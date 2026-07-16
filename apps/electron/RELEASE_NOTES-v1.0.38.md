# Titan POS v1.0.38 — Data Safety & Dashboard Clarity

**Type:** Desktop / client-only release. **No server, schema, or migration changes.**
**Baseline:** v1.0.37. **Railway:** not deployed (no server change; cloud already current).

---

## What's in this build

### Settings — backup/restore data safety
- **"Safe backup export"** is now the default: business data only, with staff
  PIN hashes, tokens, keys and the live session **redacted/omitted** — safe to
  store or send.
- **"Full raw export"** (includes secrets) is kept as an escape hatch, gated
  behind a typed **`EXPORT`** confirmation (Admin-only).
- **Restore from IndexedDB** now requires a typed **`RESTORE`** confirmation,
  spells out what gets overwritten, and fails safely with a clear error.
- Export and restore are written to the audit log.

### Owner dashboard — action-queue clarity
- Action items now use action-verb labels with correct destinations:
  **Collect debt** → Customers, **Restock <product>** → Receive stock,
  **Clear <product>** → Products, **Resolve sync issue** → Settings.
- Priority order: **critical alerts first** (e.g. store suspended), then by
  money-at-risk — outstanding debt now surfaces here.
- No metric/calculation changes — only labelling, links, and ordering of
  already-computed values.

*(Ordering-website catalog/checkout and the public-website mobile fixes from
this cycle ship via their own web deploys, not this installer.)*

---

## Artifacts

| Artifact | File |
|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.38.exe` |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.38.exe` |

### SHA-256
```
3d399308eb0aab2899200ef303ff9ba17d7d8a0d03d10f18a1edc2931b0054d3  Titan POS Setup 1.0.38.exe
3e16b41582ac51253133d0b9c430fdd76e0676a25802836e73b962b5e7e33b17  Titan POS 1.0.38.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml` removed). Install manually.

---

## Hub acceptance checklist
- [ ] Settings → Data & Backup: **Safe backup export** downloads; open the file and confirm **no PINs/tokens** appear
- [ ] Full raw export requires typing **EXPORT**; Restore requires typing **RESTORE**
- [ ] Dashboard action queue shows **action-verb** items; a store-suspended/sync alert (if any) sits at the **top**; each item opens the right screen
- [ ] Everything from 1.0.37 still works (Stock & Batches, Receive decision flow, product images, variant creation)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **161**, API **208**
- Packaged SPA: single bundle `index-BbCATuBs.js` (stale-asset hygiene applied); markers present — Safe backup export, Collect debt, Resolve sync issue, Restock, Stock & Batches, /stock, Devices & Sync
- No server/schema/migration change → **no Railway deploy**

## Fix included
- Widened the dashboard action-queue helper's alert-type input to accept
  `"info"` (it was `"warning" | "danger"` only) — a type-only fix surfaced by
  the release `tsc -b` build; `"info"` alerts already mapped to the warn tier,
  so no behavior change.
