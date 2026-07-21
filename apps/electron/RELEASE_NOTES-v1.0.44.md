# Titan POS v1.0.44 — Detailed Staff Permissions

**Type:** Desktop client **+ server (Railway deployed)**. **Schema migration:**
StaffUser.permissions (additive). **Baseline:** v1.0.43.
**Railway:** deployed at commit `e4b960d` (migration applied; enforcement live).

---

## What's in this build

### Choose a user → choose exactly what they can access (POS-PERMISSIONS-1)
- **Staff → Team → Manage access** opens an editor with a grouped permission
  matrix (Sales / Inventory / People / Money / Admin). Pick a **role preset**
  (Admin / Manager / Cashier / Driver) to pre-fill, then tick/untick per user.
- **~19 detailed capabilities** (up from 12): apply-discount, override-price,
  reprint, view-vs-manage inventory, receive, adjust/count, suppliers, cash
  in/out, and the rest — each gated in the app.
- **Guardrails:** only staff-managers can edit; you can't grant a permission you
  don't hold; you can't edit your own access; the last full admin can't be
  removed. Every change is written to the audit log.
- **Syncs across devices** — each user's access saves to the cloud.
- **Server-enforced** for the money/admin subset (void, refund, discounted
  sales, cash in/out, expenses, daily close, settings, staff, supplier payments):
  a tampered device is rejected by the server, not just the app. Everyday
  operations remain fast and offline-capable; existing users are unaffected
  (empty permissions fall back to their role).

No other feature changes.

---

## Artifacts (in `apps/electron/dist-v8/`)

| Artifact | File |
|---|---|
| NSIS installer | `Titan-POS-Setup-1.0.44.exe` |
| Updater feed | `latest.yml` |
| Delta map | `Titan-POS-Setup-1.0.44.exe.blockmap` |
| Portable EXE (optional) | `Titan-POS-Portable-1.0.44.exe` |

### SHA-256
```
ecaa4dd27085b0da52545b2dc5e3429751917253f43ed51c3ef228ad20e14c74  Titan-POS-Setup-1.0.44.exe
21e81022f5abfc51d2aad4a2205fe88ea1c31becdc0323890623fa78fffeabb9  Titan-POS-Portable-1.0.44.exe
```

---

## How to ship it (one-click update path)

Railway is already deployed with the DB migration + server enforcement, so the
ordering is safe — publish the app now.

1. GitHub → Releases → **Draft a new release**, tag **`v1.0.44`**, title
   `Titan POS 1.0.44`.
2. Upload from `apps/electron/dist-v8/`: `Titan-POS-Setup-1.0.44.exe`,
   `Titan-POS-Setup-1.0.44.exe.blockmap`, `latest.yml` (portable optional).
3. Mark **Set as the latest release** → **Publish**.
4. On the hub (running 1.0.43): **Settings → About → Update available → Download
   & install → Restart**. It self-updates to 1.0.44 (and the hub's own Postgres
   applies the migration automatically on first launch).

---

## Verification
- Desktop: `tsc -b` + build clean; **250 tests**.
- API: `tsc` clean; **218 tests** (incl. 6 permission-enforcement tests) against a migrated DB.
- Railway: deployed `e4b960d`; `/api/health` 200; sync routes auth-guarded (401);
  new bundle `index-C4uan0Dx.js` live; migration `20260721120000_add_staff_user_permissions` applied on deploy.
- Packaged SPA: single root bundle `index-C4uan0Dx.js` (stale-asset hygiene);
  `latest.yml` references the space-free installer.
