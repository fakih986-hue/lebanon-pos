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
Titan POS Setup 1.0.8.exe      ← NSIS installer (share this with store owners)
Titan POS 1.0.8.exe            ← Portable (no install needed)
latest.yml                     ← Auto-updater manifest
```

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

## Step 4 — Release Distribution

### Internal / Pilot (unsigned allowed)

1. Upload `Titan POS Setup 1.0.8.exe` + `Titan POS 1.0.8.exe` to private share
2. Include SmartScreen bypass instructions:
   ```
   Click "More info" → "Run anyway" to install.
   Normal for new unsigned software.
   ```
3. Collect feedback via GitHub Issues

### Stable (signed required)

1. Set `GH_TOKEN` env var to a GitHub PAT with `repo` scope
2. Build + publish:
   ```bash
   GH_TOKEN=your_token npm run package
   ```
3. Or upload manually:
   - Create GitHub release for tag `v1.0.8`
   - Attach `Titan POS Setup 1.0.8.exe`, `Titan POS 1.0.8.exe`, `latest.yml`, `Titan POS 1.0.8.sha256`
   - Mark as "Latest"

## What happens on first install (store owner experience)

1. Owner runs `Titan POS Setup 1.0.8.exe`
2. Installer puts app in `Program Files`, creates desktop shortcut + Start Menu entry
3. Owner launches Titan POS
4. **Setup wizard appears** — owner enters:
   - PostgreSQL host/port/database/user/password
   - Admin portal password
5. App saves `.env` to `%AppData%\Titan POS\`
6. App starts the API server and opens the POS

## What happens on update (signed builds only)

1. App silently checks GitHub releases on startup (after 10s)
2. If update available, a dialog notifies the owner
3. Update downloads in background
4. Update installs automatically when owner quits the app

## Troubleshooting

**"Server could not start"**
→ PostgreSQL is not running. Start it via Services (`services.msc`) or XAMPP.

**"Reconfigure Database"**
→ Right-click tray icon → Reconfigure Database → re-enter credentials on next launch.

**Build fails with "icon.ico not found"**
→ Run `pnpm electron:icon` then convert the PNG to ICO (see Step 1).

**SmartScreen blocks installer**
→ Click "More info" → "Run anyway". This is expected for unsigned builds.
