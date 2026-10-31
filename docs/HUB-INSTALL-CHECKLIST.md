# Hub installation and upgrade checklist (real Windows installer)

Status for the 1.0.52 candidate: **blocked.** The build PC has no disposable Windows machine (no
Windows Sandbox or Hyper-V), and running the installer there would replace its real install. Do not
substitute extracted-payload runs for this checklist: they skip the installer and the old uninstaller,
which is what deletes the install directory.

Run every step on a disposable Windows 10/11 x64 machine or VM, from a clean snapshot. Never on a
till or hub that trades.

## What is being checked

- The installer stages `<install dir>\data` before the old version's uninstaller deletes it
  (`apps/electron/build/installer.nsh`), and the hub adopts it into `%APPDATA%\lebanon-pos\hub-data`
  (`apps/electron/src/hubConfig.ts`): **no reactivation after an update**.
- A link already in `hub-data` is never overwritten; a link for a store the hub's database does not
  hold is refused (the hub opens activation).
- `BIND_HOST` (LAN mode) survives restart and update.
- Data, staff, journals, pending operations and till pairing survive the update.

## Preparation

1. Snapshot the VM. Note Windows version and whether the user is an administrator.
2. A test cloud the VM can reach, with a disposable store (never production). Record the store id, not
   its key.
3. Copy the installers to the VM and check their SHA-256 (`Get-FileHash -Algorithm SHA256 <file>`):
   - 1.0.51 Setup (GitHub release v1.0.51): `AAEDFD2B…42A80E` (full value in the release notes).
   - The 1.0.52 candidate Setup: the value in `D:\TitanPOS-candidates\<candidate>\SHA256SUMS.txt`.
4. The installers are unsigned: SmartScreen will warn. Record it; do not change system settings.

For each step record: time, what was seen, and pass/fail. Keep screenshots. Never record keys, PINs,
passwords or database URLs; record file presence and SHA-256 fingerprints instead.

## A. Install 1.0.51 and create work

1. Run the 1.0.51 Setup with defaults (per-user, `%LOCALAPPDATA%\Programs\Titan POS`).
2. Start it, activate it for the test store. Check `%LOCALAPPDATA%\Programs\Titan POS\data\cloud-config.json`
   exists.
3. Sign in with a staff PIN. Make two sales and one receive (unit cost typed).
4. Pair a till (a second VM, or the same VM's browser on `http://localhost:3015`): sign in once online.
5. LAN mode: Settings → Cloud sync → allow LAN access (accept the firewall prompt on the VM only).
   Check `%APPDATA%\lebanon-pos\.env` contains `BIND_HOST=0.0.0.0`.
6. Pending work: block the VM's route to the cloud (disconnect the network adapter), make one sale on
   the hub and one on the till. Settings shows them pending.
7. Record: number of sales, staff, pending operations (Settings → Sync), the SHA-256 of
   `cloud-config.json` and of `.env`'s `JWT_SECRET` line (fingerprints only).
8. Quit the hub from the tray.

## B. Upgrade to the 1.0.52 candidate (cloud still unreachable)

1. Run the candidate Setup over it, same directory. It must close nothing else and finish without error.
2. Before starting the hub, check:
   - `%LOCALAPPDATA%\Programs\Titan POS\data` is gone (the old uninstaller removed it);
   - `%APPDATA%\lebanon-pos\install-data-migration\cloud-config.json` exists (staged by the installer).
3. Start the hub. Pass: **no activation screen**; the POS opens.
4. Check:
   - `%APPDATA%\lebanon-pos\hub-data\cloud-config.json` exists, same fingerprint as A.7;
   - `%APPDATA%\lebanon-pos\install-data-migration` is gone;
   - `.env` still has `BIND_HOST=0.0.0.0` and the same `JWT_SECRET` fingerprint;
   - staff PIN sign-in works; sales, staff and pending counts equal A.7; journals (Settings → Sync,
     audit) show the earlier work.
5. The till: still paired; sign-in works online (through the hub) and offline.

## C. Reconnect and restart

1. Reconnect the network. Within a minute the pending operations are sent once: each sale appears in
   the test cloud exactly once; the hub shows nothing pending.
2. Reboot the VM. Start the hub: no activation screen, `BIND_HOST=0.0.0.0` kept, the till connects over
   the LAN.
3. Switch LAN access off in Settings, restart the hub: `BIND_HOST=127.0.0.1` stays.

## D. Silent update path

The auto-updater runs the installer silently. Restore the A snapshot (state after A.8) and run
`<candidate Setup>.exe /S`, then repeat B.2–B.4.

## E. Refusals (optional but recommended)

1. From the A snapshot, put a `cloud-config.json` for **another** store into `<install dir>\data`
   before upgrading. After the upgrade the hub must open activation, `hub-data` must have no
   `cloud-config.json`, and the staged copy stays in `install-data-migration`.
2. With a valid link already in `hub-data`, upgrade again from a build whose install dir holds another
   store's link: the existing link is kept.

## F. Fresh install of the candidate

1. On a clean snapshot, install the candidate only. Activation shows; after activating,
   `%APPDATA%\lebanon-pos\hub-data\cloud-config.json` exists and nothing is written to the install
   directory's `data` folder.
2. Uninstall: the app data folder (`%APPDATA%\lebanon-pos`) is kept by default; record what remains.

## Result

Record the candidate hash, the VM image, every step's result, and any deviation. The release stays
blocked until A–D pass.
