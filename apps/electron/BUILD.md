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

## Step 2 — Auto-updater (one-time GitHub setup)

1. Create a GitHub repo named `lebanon-pos-releases` (can be private)
2. Update `apps/electron/package.json` → `build.publish.owner` with your GitHub username
3. When building for release, set `GH_TOKEN` env var to a GitHub PAT with `repo` scope

## Step 3 — Build the installer

```bash
# From the monorepo root:
pnpm electron:package
```

This runs:
1. `pnpm build:api`     — compiles the Express backend
2. `pnpm build:desktop` — builds the React POS SPA
3. `electron-builder`   — bundles everything

Output (in `apps/electron/dist-v7/`):
```
Titan POS Setup 1.0.7.exe      ← NSIS installer (share this with store owners)
Titan POS 1.0.7.exe            ← Portable (no install needed)
latest.yml                     ← Auto-updater manifest
```

## Step 4 — Publish release (for auto-update)

```bash
GH_TOKEN=your_token pnpm --dir apps/electron run package
```

electron-builder will publish the installer + `latest.yml` to the GitHub release automatically.

## What happens on first install (store owner experience)

1. Owner runs `Titan POS Setup 1.0.7.exe`
2. Installer puts app in `Program Files`, creates desktop shortcut + Start Menu entry
3. Owner launches Titan POS
4. **Setup wizard appears** — owner enters:
   - PostgreSQL host/port/database/user/password
   - Admin portal password
5. App saves `.env` to `%AppData%\Titan POS\`
6. App starts the API server and opens the POS

## What happens on update

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
