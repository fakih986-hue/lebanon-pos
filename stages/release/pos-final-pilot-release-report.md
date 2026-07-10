# Titan POS — Final Pilot Release Report

**Version:** 1.0.8
**Date:** 2026-07-11
**Commit:** `4a755122277213baf507c5c0216f8fc5a1d90690`
**Branch:** `master`
**Type:** Final Pilot Release Snapshot (unsigned)

---

## 1. Git Baseline

| Property | Value |
|----------|-------|
| Branch | `master` |
| Remote | `https://github.com/fakih986-hue/lebanon-pos.git` |
| Working tree | Clean |
| Latest commit | `4a75512` — POS-QA-WEB-1: fix mobile text overlap |
| Unpushed commits | None (pushed to origin) |

## 2. Verification Results

| Command | Result |
|---------|--------|
| `pnpm typecheck:desktop` | PASS |
| `pnpm typecheck:api` | PASS |
| `pnpm test:desktop` | 101/101 PASS |
| `pnpm test:api` | 108/108 PASS |
| `pnpm build:desktop` | PASS |
| `pnpm --dir apps/website build` | PASS |

## 3. Live URL Smoke Tests

| URL | Status | Response |
|-----|--------|----------|
| `https://pos.titan-suite.net` | UP | "TITAN POS" |
| `https://lebanon-pos-production.up.railway.app` | UP | "TITAN POS" |
| `https://titan-website-production.up.railway.app` | UP | "Titan — Software for Real Businesses" |
| `https://www.titan-suite.net` | UP | "Titan — Software for Real Businesses" |

## 4. Installer Artifacts

All artifacts in `apps/electron/dist-v8/`:

| File | Size | SHA-256 |
|------|------|---------|
| `Titan POS Setup 1.0.8.exe` (NSIS) | 238.2 MB | `BF6F6AB8E95749A19F4299ECEC8A47EF7666D3888D8BFECBD81CD9F98C9751A0` |
| `Titan POS 1.0.8.exe` (Portable) | 238.0 MB | `B4D4C8B0C10C0C2BD83A8C9079AA0B58F2C750CB0153B1641CDA0295FCDCF15D` |
| `Titan POS Setup 1.0.8.exe.blockmap` | 200 KB | — |
| `latest.yml` | 347 B | — |
| `Titan POS 1.0.8.sha256` | — | Contains both SHA-256 checksums |

## 5. Known Limitations

| # | Limitation | Impact | Workaround |
|---|-----------|--------|------------|
| 1 | **Unsigned installer** — SmartScreen warning on install | Pilot users see "Windows protected your PC" | Click "More info → Run anyway" |
| 2 | **Placeholder app icon** — no `titan-source.png` | Taskbar/title bar shows default icon | Provide 1024×1024 logo; run `node make-icons.mjs` |
| 3 | **No code signing certificate** — not purchased yet | Cannot distribute as Stable channel | Purchase OV cert or configure Azure Artifact Signing |
| 4 | **Auto-update disabled for unsigned builds** | Manual re-install for each version | Auto-update enabled only when signed |
| 5 | **Thermal printer** requires browser print dialog | Setup by store owner | Configure in Settings → Printer |
| 6 | **Bundled PostgreSQL** adds ~100 MB | Larger installer | Expected for offline-capable desktop app |
| 7 | **Deferred items**: tablet layout, refund wizard, monolith decomposition | Not in this release | Planned for future sprints |

## 6. Verdict

**READY WITH LIMITATIONS**

All verification gates pass. Installer builds successfully. Live URLs are UP. This build is ready for pilot distribution as an unsigned installer with documented SmartScreen bypass instructions.

**Blockers to Stable:** Code signing (purchase OV cert or configure Azure Artifact Signing).
