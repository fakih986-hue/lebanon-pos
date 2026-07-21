# Titan POS v1.0.43 — One-Click In-App Updates

**Type:** Desktop client (+ minor API cleanup). **No schema/migration change.**
**Baseline:** v1.0.42. **Railway:** not required (see note below).

---

## What's in this build

### One-click in-app updates (POS-UPDATE-1)
The hub app can now update itself. In **Settings → About**:
- It checks GitHub for a newer release on launch (10s), when you open About, or
  from the tray **Check for Updates**.
- When a newer version exists it shows **"Update available — vX.Y.Z"** + release
  notes and a **Download & install** button.
- Clicking it shows a **progress bar**, then a **"Restart now to finish"** button
  that applies the update and relaunches Titan POS. The register never restarts
  on its own.
- Powered by electron-updater against GitHub Releases; integrity verified by
  SHA512, so it works on unsigned builds. Connected devices (admin/driver/
  ordering browsers) don't need this — they refresh from the hub automatically.

### Cleanup
- Removed the old baked-in release-manifest path (`/api/releases/manifest` +
  the browser-download link) — it couldn't announce future versions from a
  frozen bundle and is fully replaced by the updater above.

*(This build also carries the commercial UI polish from 1.0.42.)*

---

## Artifacts (in `apps/electron/dist-v8/`)

| Artifact | File |
|---|---|
| NSIS installer | `Titan-POS-Setup-1.0.43.exe` |
| Updater feed | `latest.yml` |
| Delta map | `Titan-POS-Setup-1.0.43.exe.blockmap` |
| Portable EXE (optional) | `Titan-POS-Portable-1.0.43.exe` |

Filenames are now **space-free** so GitHub's uploader doesn't rename them (which
would break the updater's filename match).

### SHA-256
```
0f9a539c56dbea7d55773b86ec46fed21cc952a93c214a7b416285a507e6c9ba  Titan-POS-Setup-1.0.43.exe
abe6fe58a69f08e053f173023713be6af06a8ec953f42157d0bcf82cdbfbae3b  Titan-POS-Portable-1.0.43.exe
```

---

## How to publish (manual GitHub upload)

1. On https://github.com/fakih986-hue/lebanon-pos → **Releases → Draft a new release**.
2. Tag: **`v1.0.43`** (create it on publish). Title: `Titan POS 1.0.43`.
3. Upload these files from `apps/electron/dist-v8/` (drag-drop):
   - `Titan-POS-Setup-1.0.43.exe`   ← required
   - `Titan-POS-Setup-1.0.43.exe.blockmap`   ← required (delta updates)
   - `latest.yml`   ← required (the updater reads this)
   - `Titan-POS-Portable-1.0.43.exe`   ← optional
4. Leave "Set as the latest release" checked → **Publish release** (not draft).
5. Confirm the asset is named exactly `Titan-POS-Setup-1.0.43.exe` (no spaces/dots
   inserted) so it matches `latest.yml`.

## One-time bootstrap (important)
The currently-installed app (1.0.42) has **no** updater, so it can't pull this in.
**Install `Titan-POS-Setup-1.0.43.exe` manually once** on the hub (SmartScreen →
More info → Run anyway). From 1.0.43 onward, every future published release is
one-click updatable from Settings → About. (After installing, "Check for updates"
will say **Up to date** since 1.0.43 is the latest — the live self-update is
demonstrated when the next version, 1.0.44+, is published.)

---

## Verification
- Typechecks: desktop / API / electron = 0 (desktop via `tsc -b`)
- Tests: desktop **235**, API **212**
- Packaged SPA: single root bundle `index-CZoh6JWo.js` (stale-asset hygiene);
  updater UI markers verified — "Update available", "Download & install",
  "Restart now to finish", "Managed on hub"
- `latest.yml` present and references the space-free installer name
- Update state machine walked headlessly (checking→available→downloading→
  downloaded→up-to-date→error + browser-client note), 0 console errors

## Railway note
The only server change is the **removal of the unused `/api/releases/manifest`
route**. The hub's bundled API (in this installer) reflects it. The Railway cloud
still serves that now-unused route until a future deploy — harmless, nothing calls
it — so **no Railway deploy is required** for this release.
