# Titan POS v1.0.8 Release Notes

**Date:** 2026-07-10
**Type:** Internal Build (unsigned)

---

## What's New

- **Brand naming finalized** — All occurrences of "Lebanon POS" renamed to "Titan POS" across:
  - Electron main process (tray, dialogs, updater, window titles)
  - Desktop app (default store name, receipt header, customer statements)
  - API (health check, console banner, seed data)
  - i18n strings (English + Arabic — login, footer, admin, ordering)
- **Version bumped** 1.0.7 → 1.0.8
- **Installer output dir** `dist-v7` → `dist-v8`

## Code Signing

This build is **unsigned**. SmartScreen will show a warning on install.

**Next step:** Purchase code signing — see `stages/release/pos-desktop-code-signing-report.md`

## Artifacts

| File | Size | SHA-256 |
|------|------|---------|
| `Titan POS Setup 1.0.8.exe` | 239 MB | 424031c144f957ca7596b74d612e5b5dc8988301d92db6f796f50945beb74fc7 |
| `Titan POS 1.0.8.exe` | 239 MB | (see checksum file) |
| `latest.yml` | Auto-update manifest | — |

## Known Issues

1. Placeholder app icon — needs `titan-source.png`
2. Unsigned installer → SmartScreen warning
3. Pre-existing TypeScript errors in desktop app (unrelated; SPA still builds via Vite)
