# Titan POS — Desktop Release Checklist

**Version:** 1.0.7
**Date:** 2026-07-09

---

## Before Release

- [ ] **Clean git status** — no uncommitted changes
- [ ] **All tests pass** — `npx vitest run apps/desktop` (78/78)
- [ ] **Typecheck clean** — `npx tsc -p apps/desktop/tsconfig.json --noEmit`
- [ ] **Typecheck clean** — `npx tsc -p apps/api/tsconfig.json --noEmit`
- [ ] **Desktop build passes** — `npx vite build apps/desktop`
- [ ] **API build passes** — `npx tsc -p apps/api/tsconfig.json`
- [ ] **Version bumped** — `apps/electron/package.json` version updated
- [ ] **CHANGELOG updated** — list changes since last release
- [ ] **Icons exist** — `assets/icon.png` and `assets/icon.ico` present
- [ ] **Git tag created** — `git tag v1.0.7` matching version
- [ ] **All commits pushed** — `git push origin master --tags`

## Build Installer

- [ ] **Clean build** — `pnpm electron:package` completes without errors
- [ ] **Output exists** — `Titan POS Setup 1.0.7.exe` in `apps/electron/dist-v7/`
- [ ] **Portable exists** — `Titan POS 1.0.7.exe` in `apps/electron/dist-v7/`
- [ ] **latest.yml generated** — Auto-update manifest present

## Install Test (on clean Windows)

- [ ] **Runs installer** — Double-click `Titan POS Setup 1.0.7.exe`
- [ ] **UAC prompt** — Windows asks for admin permission
- [ ] **Custom directory** — Can change install path
- [ ] **Desktop shortcut** — Created after install
- [ ] **Start Menu entry** — "Titan POS" appears in Start Menu
- [ ] **App launches** — Starts from desktop shortcut
- [ ] **Window title** — Shows "Titan POS"
- [ ] **App icon** — Taskbar + title bar show icon
- [ ] **Setup wizard** — PostgreSQL config screen appears on first launch
- [ ] **POS loads** — After setup, POS page opens
- [ ] **System tray** — Tray icon visible; right-click menu works

## Install Test — POS Functionality

- [ ] **Login** — Staff PIN login works
- [ ] **Scanner** — Barcode scan adds product to cart
- [ ] **Checkout** — Cash sale completes
- [ ] **Products** — Products page loads
- [ ] **Receiving** — Can receive stock
- [ ] **Customers** — Customer list loads
- [ ] **Sales** — Sales history loads
- [ ] **Dashboard** — KPIs + action queue visible
- [ ] **Settings** — Settings save and sync
- [ ] **Offline** — Works without internet (local PostgreSQL)
- [ ] **Sync** — Can connect to Railway if configured

## Uninstall Test

- [ ] **Uninstall via Windows** — Settings → Apps → Titan POS → Uninstall
- [ ] **Uninstall via Start Menu** — Right-click → Uninstall
- [ ] **Desktop shortcut removed** — After uninstall
- [ ] **Start Menu entry removed** — After uninstall
- [ ] **Program Files folder removed** — After uninstall
- [ ] **AppData folder** — `%AppData%/Titan POS/` may persist (contains database)

## Upgrade Test (if replacing previous version)

- [ ] **Install new version over old** — Data preserved
- [ ] **PostgreSQL data intact** — Products, sales, customers remain
- [ ] **Settings preserved** — Exchange rate, store name, etc.
- [ ] **Sync queue preserved** — Pending operations not lost

## Publish Release

- [ ] **Upload to GitHub** — Attach `Titan POS Setup 1.0.7.exe` + `latest.yml` to release
- [ ] **Release title** — "Titan POS v1.0.7"
- [ ] **Release notes** — Paste CHANGELOG section
- [ ] **Set as latest** — GitHub release marked as latest
- [ ] **Auto-update check** — Older version detects update on startup

## Post-Release

- [ ] **Verify download** — Download link works
- [ ] **Verify auto-update** — Installed app prompts to update
- [ ] **Monitor issues** — Check GitHub Issues / support channel
- [ ] **Increment version** — Bump to next dev version for continued work

---

## Known Limitations at Release

| # | Limitation |
|---|-----------|
| 1 | Windows SmartScreen warning due to unsigned EXE (until EV Code Signing Certificate obtained) |
| 2 | Placeholder app icon (gradient square) — replace with professional Titan POS logo |
| 3 | Thermal printer requires browser print dialog setup by store owner |
| 4 | Auto-update requires GitHub PAT in GH_TOKEN env var during build |
| 5 | Bundled PostgreSQL adds ~100MB to installer size |
