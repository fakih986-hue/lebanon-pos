# POS-RELEASE-QA-1.0.38 — Release-Readiness Audit

**Date:** 2026-07-17
**HEAD:** `3339e22`  ·  **Baseline (1.0.37):** `e3c5858`  ·  **origin/master (last deploy):** `767917f`
**Verdict:** ✅ **Ready to build 1.0.38** (desktop-focused). No blockers.

---

## 1. Git baseline

| Check | Result |
|---|---|
| Working tree | ✅ clean (no dirty/untracked) |
| Commits since 1.0.37 | 5 (all client-side) |
| `apps/api` changes since 1.0.37 | ✅ none |
| Schema / migrations since 1.0.37 | ✅ none |
| Local ahead of origin | 4 commits (checkout, website, settings, dashboard) |

Commits since 1.0.37:
```
3339e22 feat(dashboard): action-queue clarity + prioritization
9866f97 feat(settings): backup/restore data-safety hardening
89f573c fix(website): mobile hardening — WebGL fallback + overflow guard
6900392 feat(ordering): checkout availability warning + double-submit guard
767917f feat(ordering): variant grouping + build fixes for catalog  ← already on origin/Railway
```
The alias-aware `sync.ts` change shipped **inside** 1.0.37 and was deployed to Railway when `767917f` was pushed — so **cloud server code is current; no pending server deploy**.

## 2. Automated verification

| Command | Result |
|---|---|
| `apps/desktop` `tsc --noEmit` | ✅ PASS |
| `apps/api` `tsc --noEmit` | ✅ PASS |
| `apps/electron` `tsc -p tsconfig.json --noEmit` | ✅ PASS |
| `apps/website` `tsc --noEmit` | ✅ PASS |
| `apps/ordering` `tsc -b` | ✅ PASS |
| `apps/desktop` vitest | ✅ 161 passed (8 files) |
| `apps/api` vitest | ✅ 208 passed (12 files) |
| `apps/desktop` `vite build` | ✅ PASS |
| `apps/website` `vite build` | ✅ PASS |
| `apps/ordering` build (`tsc -b && vite build`) | ✅ PASS |

**Note:** `apps/website` `tsc -b` (build-mode) emits `TS5011 rootDir` — a pre-existing tsconfig quirk, **not** a code error; the website builds via `vite build` and `tsc --noEmit` is clean. Non-blocking.

## 3. Functional audit (pass/fail)

Changed areas reviewed at code level (preview browser unavailable — hub holds port 3015); unchanged areas confirmed untouched since 1.0.37.

| Area | Changed since 1.0.37? | Result |
|---|---|---|
| POS unlock / login | no | ✅ PASS (unchanged) |
| Dashboard | **yes** (action queue) | ✅ PASS — helper unit-tested (7); links `/customers`, `/products/new`, `/products`, `/settings` all valid routes; no calc change |
| Products | no | ✅ PASS |
| Stock & Batches (`/stock`) | no | ✅ PASS |
| Receive stock (decision / alias / variant / image) | no | ✅ PASS |
| POS checkout | no | ✅ PASS |
| Sales / refund / void | no | ✅ PASS (no tender/ledger touched) |
| Customers / debt | no | ✅ PASS |
| Suppliers / receiving | no | ✅ PASS |
| Accounting / daily close | no | ✅ PASS |
| Staff / roles / PIN | no logic change | ✅ PASS — PINs now **redacted** from safe export (improvement) |
| Settings / export / restore / update | **yes** (data safety) | ✅ PASS — redaction unit-tested (9); restore typed-confirm + fail-safe; audit-logged |
| Ordering website — catalog | **yes** (variant grouping) | ✅ PASS — build clean; **already live on cloud** (767917f) |
| Ordering website — checkout | **yes** (availability warning) | ✅ PASS — build clean; **not yet deployed** |
| Public Titan website (mobile) | **yes** (WebGL guard + overflow) | ✅ PASS — build clean; **separate deploy pipeline; not deployed** |

## 4. Risk audit

| Risk | Finding |
|---|---|
| Server changes needing Railway deploy | ✅ none since 1.0.37 (all client). Cloud already current. |
| Schema / migration changes | ✅ none |
| Sensitive-data export risk | ✅ **improved** — safe export redacts PIN/token/secret/keys + omits session; raw export gated behind typed `EXPORT`, admin-only |
| Role / PIN risk | ✅ no role changes; PIN hashes redacted from safe export |
| Duplicate navigation | ✅ none — `/stock` remains the single stock home (IA-2B.5); no nav added since |
| Stock / sync drift | ✅ none — no stock/sync/tender/tax/refund/ledger logic touched since 1.0.37 |
| Installer-only changes | Desktop (settings data-safety + dashboard) reach the hub only via a new installer |

## 5. Where each change reaches users

| Change | Delivery path | Status |
|---|---|---|
| Settings data-safety, Dashboard polish | **hub installer (1.0.38)** | needs build |
| Ordering catalog (variant grouping) | Railway (Dockerfile rebuilds `apps/ordering`) | ✅ deployed (`767917f`) |
| Ordering checkout polish | Railway (`git push`) | pending push |
| Website mobile | **separate website deploy** (not in main Dockerfile) | pending |

## 6. Known non-blockers / follow-ups

- **Hub-hosted ordering site is stale in the installer.** `build:spa` rebuilds only the desktop SPA + API bundle; the hub serves `apps/api/public/order` from the **committed** (pre-built) ordering bundle. So a 1.0.38 installer would carry the *old* ordering UI for the hub-hosted storefront. Not a regression, and cloud ordering is fresh. Fix (optional, future): add `apps/ordering` rebuild + copy into the release `build:spa`. **Does not block a desktop-focused 1.0.38.**
- `apps/website` `tsc -b` rootDir config quirk (cosmetic; see §2).

## 7. Release decision

- **Ready to build 1.0.38:** ✅ **YES** — desktop payload (Settings data-safety + Dashboard polish) is type-clean, tested, and builds; no server/schema changes; no blockers.
- **Blockers:** none.
- **Safe to continue feature work:** ✅ **YES.**

### Recommended next steps
1. **Build 1.0.38** (desktop installer: Settings data-safety + Dashboard polish). Apply the standard SPA-asset hygiene from 1.0.37.
2. **Push origin** to deploy the ordering **checkout** polish to cloud (client-only, no migration).
3. **Website mobile** → deploy via its own pipeline when convenient.
4. Optional: close the hub-ordering build gap (§6) before relying on the hub-hosted storefront.
