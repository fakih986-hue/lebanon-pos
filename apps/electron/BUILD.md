# Building the Titan POS Installer

## Prerequisites

- Node.js 20+
- pnpm 9+
- Windows (for the `.exe` build)

## Step 1 — Icons (one-time)

Icons must be placed in `apps/electron/assets/` before building:

```
icon.png   256×256 PNG   (tray icon, macOS)
icon.ico   Windows ICO   (installer + taskbar)
```

Generate the placeholder PNG:
```bash
pnpm electron:icon
```

Convert to ICO (pick one):
- **Online:** https://convertio.co/png-ico/ — upload `icon.png`, download `icon.ico`
- **ImageMagick:** `magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`

## Step 2 — Build the installer

```bash
# From the electron app directory:
npm run package
```

This runs:
1. `build:spa` — builds the React POS SPA + bundles the Express API
2. `build` — compiles the Electron TypeScript
3. `electron-builder --win` — produces the NSIS installer + portable EXE

Output (in `apps/electron/dist-v8/`):
```
Titan POS Setup <version>.exe      ← NSIS installer (self-updates; use this on the hub)
Titan POS <version>.exe            ← Portable (no install; CANNOT self-update)
latest.yml                         ← electron-updater feed (MUST ship for auto-update)
Titan POS Setup <version>.exe.blockmap  ← enables delta (partial) downloads
```

> **Auto-update note:** `latest.yml` + the `.blockmap` are the feed the installed
> app reads to self-update. For any **shippable** release, publish them (Step 4).
> Only delete `latest.yml` for throwaway internal QA builds (`--publish never`).
> Self-update works on the **NSIS-installed** app only — the portable EXE can't update itself.

## Step 3 — Code Signing (Stable releases only)

Titan POS installers are unsigned by default. For Stable distribution, code signing is required.

### Option A: Azure Artifact Signing (recommended — $9.99/month)

```bash
# 1. Install signing CLI
dotnet tool install --global Azure.Sdk.Tools.TrustedSigningCli --prerelease

# 2. Sign NSIS installer
dotnet sign --file "Titan POS Setup 1.0.8.exe" ^
  --output "Titan POS Setup 1.0.8.exe" ^
  --endpoint "https://trustedsigning.azure.net" ^
  --account-name "YourAccount" ^
  --profile-name "YourProfile" ^
  --certificate-profile "YourCertProfile"

# 3. Sign portable EXE (same command, different file)
# 4. Verify
Get-AuthenticodeSignature "Titan POS Setup 1.0.8.exe"
```

### Option B: Traditional OV/EV Certificate

```bash
# 1. Insert USB token + enter PIN
# 2. Sign with signtool (Windows SDK)
signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 ^
  "Titan POS Setup 1.0.8.exe"

# 3. Sign portable EXE
signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 ^
  "Titan POS 1.0.8.exe"

# 4. Verify
signtool verify /pa /all "Titan POS Setup 1.0.8.exe"
```

### Post-Signing

After signing, re-generate checksums and update `latest.yml`:

```bash
# Generate SHA-256
certutil -hashfile "Titan POS Setup 1.0.8.exe" SHA256 > "Titan POS 1.0.8.sha256"
```

## Step 4 — Release Distribution (auto-update channel)

Publishing a release to GitHub is what lets an installed hub self-update. The
`build.publish` block already points at `github: fakih986-hue/lebanon-pos`.

### Publish a release

```bash
# GH_TOKEN = GitHub PAT with `repo` scope (classic) or contents:write (fine-grained)
GH_TOKEN=your_token pnpm --dir apps/electron run release:publish
```

`release:publish` runs `build:spa → build → electron-builder --win --publish always`,
which creates/updates the GitHub release `v<version>` and uploads the NSIS installer,
portable EXE, `latest.yml`, and `.blockmap`.

Then:
1. On GitHub, ensure the release is **Published (not draft)** and marked **Latest** —
   electron-updater reads `latest.yml` from the latest published release.
2. The release assets must be **publicly downloadable** (public repo, or public
   release assets) so the hub can fetch them without a token.
3. Integrity is guaranteed by the SHA512 in `latest.yml` even though builds are
   unsigned — auto-update works today. (Code signing, Step 3, only removes the
   first-install SmartScreen warning.)

### Internal / Pilot QA build (no auto-update)

```bash
pnpm --dir apps/electron run package   # --publish never; delete latest.yml if present
```
Share the `.exe` on a private channel; installs manually with SmartScreen "Run anyway".

### One-time bootstrap

Because releases before this feature shipped no `latest.yml`, the **first
update-capable build must be installed manually once** on the hub (SmartScreen →
Run anyway). Every subsequently **published** release is then one-click updatable
in-app (Settings → About → Check for updates → Download & install → Restart).

## What happens on first install (store owner experience)

1. Owner runs `Titan POS Setup 1.0.8.exe`
2. Installer puts app in `Program Files`, creates desktop shortcut + Start Menu entry
3. Owner launches Titan POS
4. **Setup wizard appears** — owner enters:
   - PostgreSQL host/port/database/user/password
   - Admin portal password
5. App saves `.env` to `%AppData%\Titan POS\`
6. App starts the API server and opens the POS

## What happens on update (owner experience)

Controlled, in-app, one-click — the register never restarts on its own:

1. App checks GitHub for a newer release on startup (after 10s) and whenever the
   owner opens **Settings → About** or the tray **Check for Updates**.
2. If a newer version exists, About shows **"Update available — vX.Y.Z"** with
   release notes and a **Download & install** button.
3. Owner clicks it → a **progress bar** shows the download (delta via blockmap).
4. When ready, the button becomes **"Restart now to finish"** → the app quits,
   the NSIS installer applies silently, and Titan POS relaunches on the new version.
5. As a safety net, an already-downloaded update also installs if the app is quit
   before the owner clicks restart (`autoInstallOnAppQuit`).

Works on unsigned builds (SHA512-verified). Connected devices (admin/driver/
ordering browsers) need no binary update — they refresh from the hub automatically.

## Troubleshooting

**"Server could not start"**
→ PostgreSQL is not running. Start it via Services (`services.msc`) or XAMPP.

**"Reconfigure Database"**
→ Right-click tray icon → Reconfigure Database → re-enter credentials on next launch.

**Build fails with "icon.ico not found"**
→ Run `pnpm electron:icon` then convert the PNG to ICO (see Step 1).

**SmartScreen blocks installer**
→ Click "More info" → "Run anyway". This is expected for unsigned builds.
