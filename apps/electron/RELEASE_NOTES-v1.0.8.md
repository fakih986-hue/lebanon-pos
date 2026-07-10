# Titan POS v1.0.8 Release Notes

**Date:** 2026-07-11
**Type:** Final Pilot Release Snapshot (unsigned)

---

## What's New (since v1.0.7)

- **Brand naming finalized** — All occurrences of "Lebanon POS" renamed to "Titan POS" across:
  - Electron main process (tray, dialogs, updater, window titles)
  - Desktop app (default store name, receipt header, customer statements)
  - API (health check, console banner, seed data)
  - i18n strings (English + Arabic — login, footer, admin, ordering)
- **POS-HUB-1/2/3** — Connection modes, device identity, LAN hub toggle
- **POS-HUB-4/5** — Hub sync, register reconciliation
- **POS-CASHOPS-1** — Cash operations improvements
- **POS-QA-WEB-1** — Website mobile polish + API regression fixes
  - Fixed `leading-[0.95]` h1 text overlap on mobile (6 pages)
  - Reduced oversized pillar/value card outline numbers on mobile
  - API regression tests pass 108/108
- **Version bumped** 1.0.7 → 1.0.8
- **Installer output dir** `dist-v7` → `dist-v8`

## Verification Summary

| Check | Result |
|-------|--------|
| Desktop typecheck | PASS |
| API typecheck | PASS |
| Desktop tests | 101/101 PASS |
| API tests | 108/108 PASS |
| Desktop build | PASS |
| Website build | PASS |
| Commit | `4a75512` (pushed to origin) |

## Code Signing

This build is **unsigned**. SmartScreen will show a warning on install.

**Next step:** Purchase code signing — see `stages/release/pos-desktop-code-signing-report.md`

## Artifacts

| File | Size | SHA-256 |
|------|------|---------|
| `Titan POS Setup 1.0.8.exe` | 238.2 MB | `BF6F6AB8E95749A19F4299ECEC8A47EF7666D3888D8BFECBD81CD9F98C9751A0` |
| `Titan POS 1.0.8.exe` | 238.0 MB | `B4D4C8B0C10C0C2BD83A8C9079AA0B58F2C750CB0153B1641CDA0295FCDCF15D` |
| `latest.yml` | Auto-update manifest | — |

## Live URLs

| URL | Status |
|-----|--------|
| `https://pos.titan-suite.net` | UP — POS app loads |
| `https://lebanon-pos-production.up.railway.app` | UP — POS app loads |
| `https://titan-website-production.up.railway.app` | UP — website loads |
| `https://www.titan-suite.net` | UP — website loads |

## Known Issues

1. Placeholder app icon — needs `titan-source.png`
2. Unsigned installer → SmartScreen warning
3. No code signing certificate configured
4. Tablet layout / refund wizard / monolith decomposition deferred
