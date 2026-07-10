# Titan POS — Desktop Release Checklist

**Version:** 1.0.8
**Date:** 2026-07-11

---

## Release Channel Definitions

| Channel | Signed? | Auto-update? | Distribution | Audience |
|---------|---------|--------------|--------------|----------|
| **Internal** | No | Disabled | Private link | Development team |
| **Pilot** | Optional | Disabled | Private link | Pilot store owners |
| **Stable** | **Required** | Enabled | GitHub Releases | All customers |

**Rule:** Do NOT promote a build to Stable unless it is code-signed.

---

## Before Release

- [x] **Clean git status** — no uncommitted changes
- [x] **All tests pass** — `pnpm test:desktop` (101/101)
- [x] **Typecheck clean** — `pnpm typecheck:desktop` + `pnpm typecheck:api`
- [x] **Desktop build passes** — `pnpm build:desktop`
- [x] **API build passes** — `pnpm --dir apps/api build`
- [x] **Version bumped** — `apps/electron/package.json` version set (currently 1.0.8)
- [x] **Icons exist** — `assets/icon.png` and `assets/icon.ico` present
- [ ] **Git tag created** — `git tag v1.0.8` matching version (not yet — awaiting instructions)
- [x] **All commits pushed** — `git push origin master`

---

## Build Installer

- [x] **Clean build** — `pnpm --dir apps/electron run package` completes without errors
- [x] **Output exists** — `Titan POS Setup 1.0.8.exe` in `apps/electron/dist-v8/`
- [x] **Portable exists** — `Titan POS 1.0.8.exe` in `apps/electron/dist-v8/`
- [x] **latest.yml generated** — Auto-update manifest present
- [x] **Checksums generated** — SHA-256 file in `dist-v8/Titan POS 1.0.8.sha256`

### Code Signing (Stable releases only)

- [ ] **Certificate available** — OV cert on USB token or Azure Artifact Signing configured
- [ ] **Sign NSIS installer** — `signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 "Titan POS Setup 1.0.8.exe"`
- [ ] **Sign portable EXE** — Same command for `Titan POS 1.0.8.exe`
- [ ] **Verify signature** — `Get-AuthenticodeSignature "Titan POS Setup 1.0.8.exe"` shows `Status: Valid`
- [ ] **Re-generate checksums** — After signing, checksums change; re-run sha256sum
- [ ] **Re-package latest.yml** — If signed after initial build, update `latest.yml` SHA

---

## Install Test (on clean Windows VM)

- [ ] **Runs installer** — Double-click `Titan POS Setup 1.0.8.exe`
- [ ] **SmartScreen (unsigned only)** — Click "More info → Run anyway" (document this step)
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

---

## Install Test — POS Functionality (same for all channels)

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

---

## Uninstall Test

- [ ] **Uninstall via Windows** — Settings → Apps → Titan POS → Uninstall
- [ ] **Uninstall via Start Menu** — Right-click → Uninstall
- [ ] **Desktop shortcut removed** — After uninstall
- [ ] **Start Menu entry removed** — After uninstall
- [ ] **Program Files folder removed** — After uninstall
- [ ] **AppData folder** — `%AppData%/Titan POS/` persists (contains database)

---

## Upgrade Test (if replacing previous version)

- [ ] **Install new version over old** — Data preserved
- [ ] **PostgreSQL data intact** — Products, sales, customers remain
- [ ] **Settings preserved** — Exchange rate, store name, etc.
- [ ] **Sync queue preserved** — Pending operations not lost

---

## Publish Stable Release (signed only)

- [ ] **GitHub release created** — Tag `v1.0.8`, title "Titan POS v1.0.8"
- [ ] **Upload installer** — Attach `Titan POS Setup 1.0.8.exe`
- [ ] **Upload portable** — Attach `Titan POS 1.0.8.exe`
- [ ] **Upload checksums** — Attach `Titan POS 1.0.8.sha256`
- [ ] **Upload latest.yml** — Attach `latest.yml` (or publish via electron-builder)
- [ ] **Upload release notes** — Attach `RELEASE_NOTES-v1.0.8.md`
- [ ] **Set as latest** — GitHub release marked as "Latest"
- [ ] **Auto-update enabled** — `electron-updater` configured; `GH_TOKEN` set during build

---

## Pilot Distribution (unsigned allowed)

- [ ] **Host installer** — Upload to private Google Drive / Dropbox folder
- [ ] **Share link** — Send password-protected link to pilot store owners
- [ ] **Include instructions** — SmartScreen bypass + support contact
- [ ] **Collect feedback** — Document issues in GitHub Issues
- [ ] **No auto-update** — Pilot builds do NOT auto-update

---

## Post-Release

- [ ] **Verify download** — Download link works
- [ ] **Verify auto-update** — Installed app prompts to update (signed builds only)
- [ ] **Monitor issues** — Check GitHub Issues / support channel
- [ ] **Increment version** — Bump to next dev version for continued work

---

## Known Limitations at Release

| # | Limitation | Channel Affected | Workaround |
|---|-----------|-----------------|------------|
| 1 | **Unsigned installer** — SmartScreen shows "Windows protected your PC" | All (until signed) | Click "More info → Run anyway" |
| 2 | **Placeholder app icon** — no `titan-source.png` | All | Provide 1024×1024 logo; run `node make-icons.mjs` |
| 3 | **Thermal printer** requires browser print dialog | All | Setup by store owner via Settings → Printer |
| 4 | **Auto-update disabled for unsigned builds** | Internal, Pilot | Manual re-install for each version |
| 5 | **No code signing certificate** — OV or Azure Artifact Signing needed | Stable | See code-signing report for purchasing steps |
| 6 | **Bundled PostgreSQL** adds ~100MB | All | Expected for offline-capable desktop app |
| 7 | **Deferred**: tablet layout, refund wizard, monolith decomposition | Pilot | Planned for future sprints |

---

## SmartScreen Bypass Instructions (for pilot users)

Include these instructions with every unsigned installer download:

```
Windows may show "Windows protected your PC" when you try to run Titan POS.
This is normal — the installer hasn't been downloaded enough times yet
to build SmartScreen reputation.

To proceed:
1. Click "More info" (blue text on the warning screen)
2. Click "Run anyway" (button that appears)
3. Confirm UAC prompt to install

Once installed, the app will run without further warnings.
```
