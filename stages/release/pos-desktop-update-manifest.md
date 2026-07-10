# Desktop Update Awareness — Release Manifest Docs

**Sprint:** POS-UPDATE-1  
**Date:** 2026-07-10

---

## Overview

Titan POS checks for desktop updates by fetching a release manifest from the local API (`/api/releases/manifest`). The manifest is a static JSON file served by the API — no database required for this sprint.

The desktop app shows the update status in **Settings → About** and offers a manual "Download update" button.

---

## Update States

| State | Description | User action |
|-------|-------------|-------------|
| `up-to-date` | Installed version >= latest available | None |
| `update-available` | Installed version < latest but >= minimum supported | "Download update" shown |
| `update-required` | Installed version < minimum supported version | "Download update" shown, forced upgrade recommended |
| `unable-to-check` | API unreachable or no manifest found | Retry button shown |

---

## How to Publish a New Release

### 1. Build the installer

```bash
cd apps/electron
pnpm run package
```

Artifacts are written to `apps/electron/dist-v8/`.

### 2. Update the manifest

Edit `apps/api/public/releases/manifest.json`:

```json
{
  "version": "1.0.9",
  "channel": "stable",
  "downloadUrl": "https://github.com/fakih986-hue/lebanon-pos/releases/download/v1.0.9/Titan+POS+Setup+1.0.9.exe",
  "checksum": {
    "type": "sha256",
    "value": "<SHA256 of the setup EXE>"
  },
  "releaseNotes": "## Titan POS 1.0.9\n\n- Bug fixes\n- Performance improvements",
  "minimumSupportedVersion": "1.0.6",
  "forceUpdate": false,
  "publishedAt": "2026-07-11T00:00:00.000Z"
}
```

### 3. Generate the checksum

```powershell
certutil -hashfile "Titan POS Setup 1.0.9.exe" SHA256
```

Copy the hash value into the manifest's `checksum.value` field.

### 4. Rebuild the API bundle

```bash
cd apps/api
pnpm run bundle
```

This bundles the updated manifest into the API bundle at `apps/api/bundle/`.

### 5. Rebuild the Electron app

```bash
cd apps/electron
pnpm run package
```

---

## How to Promote a Release (Internal → Pilot → Stable)

| Step | Action | Manifest change |
|------|--------|-----------------|
| 1 | Build + test internally | Set `channel` to `"internal"` |
| 2 | Test on pilot machines | Set `channel` to `"pilot"` |
| 3 | Release to all users | Set `channel` to `"stable"` |

The `channel` field is informational in this sprint. In future sprints it can be used to gate updates by channel.

---

## How to Force an Update

Set `forceUpdate: true` in the manifest. When `forceUpdate` is `true` and the installed version is below `minimumSupportedVersion`, the desktop shows "Update required" instead of "Update available".

This is intended for security-critical updates.

---

## How Checksums Are Verified Manually

```powershell
# Step 1: Download the installer
# Step 2: Compute SHA-256
certutil -hashfile "Titan POS Setup 1.0.9.exe" SHA256

# Step 3: Compare against the manifest value
```

The checksum in the manifest is informational in this sprint — verification is manual. Future sprints can automate SHA-256 verification before launch.

---

## API Endpoint

`GET /api/releases/manifest`

- **No auth required** — the manifest is public within the local network
- **No caching** — `Cache-Control: no-cache` is set
- **404** — if `public/releases/manifest.json` does not exist
- **500** — on read error

---

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/features/pos/lib/version.ts` | NEW — `compareVersions()`, `getUpdateStatus()`, `formatVersion()` |
| `apps/desktop/src/features/pos/services/update.service.ts` | NEW — `fetchReleaseManifest()`, `checkForUpdates()`, `clearUpdateCache()`, `isNewerVersion()` |
| `apps/desktop/src/pages/settings/SettingsPage.tsx` | MODIFIED — added "About" tab with version display + update status |
| `apps/desktop/src/__tests__/version.test.ts` | NEW — 17 unit tests for version comparison and update states |
| `apps/api/public/releases/manifest.json` | NEW — static release manifest for v1.0.8 |
| `apps/api/src/routes/releases.ts` | NEW — `GET /api/releases/manifest` route |
| `apps/api/src/app.ts` | MODIFIED — mounted releases route |
| `stages/release/pos-desktop-update-manifest.md` | NEW — this file |

---

## Remaining Blocker Before Final Pilot EXE

| # | Blocker | Priority | Status |
|---|---------|----------|--------|
| 1 | **Code signing** | HIGH | Open — see `pos-desktop-code-signing-report.md` |
| 2 | **Branded icon** | HIGH | Open — provide 1024×1024 `titan-source.png` |
| 3 | **CHANGELOG** | MEDIUM | Open — write release notes before Stable |
| 4 | **GitHub PAT for auto-update** | MEDIUM | Open — set `GH_TOKEN` during signed builds |
