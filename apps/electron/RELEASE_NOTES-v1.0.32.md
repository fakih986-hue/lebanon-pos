# Titan POS v1.0.32 Release Notes

**Date:** 2026-07-13
**Type:** Internal build — cloud-bridge stall fix (found during live 1.0.31 two-device testing), unsigned
**Sprint:** POS-SYNC-AUTHORITY-1 (follow-up)

## Why this build exists
During the live two-device verification of 1.0.31, the hub's background cloud sync was observed to stall permanently after a full pull (connecting a new device / "Download my data" / restore): the cloud stopped receiving the hub's updates even though status showed `running: true` with no errors. Root cause was a **pre-existing** bug in `syncLoop` — not introduced by AUTHORITY-1.

## What's fixed (since 1.0.31)
- **Cloud sync loop no longer dies on overlap.** `syncLoop` used to early-return when another sync held the lock (a `triggerFullPull`) *without* scheduling its next tick, breaking the self-perpetuating timer chain forever. Now the reschedule always runs; only the work is skipped when the lock is held. The hub keeps pushing to / pulling from the cloud reliably after any full pull or device connect.
- Carries all of 1.0.31 (hub-authoritative inventory: `InventoryBatch.updatedAt`, incremental batch propagation, cloud-can't-overwrite-hub-stock, write-through checkout).

## Verification
| Check | Result |
|-------|--------|
| API / desktop / electron typecheck | PASS |
| API tests | 178/178 (+1: bridge-stall regression reproducing the exact overlap) |
| Desktop tests | 118/118 |
| Bundle contains fix | PASS — compiled `syncLoop` reschedules outside the `_syncRunning` guard; AUTHORITY-1 markers + migration present |

## Artifacts
| File | SHA-256 |
|------|---------|
| `Titan POS Setup 1.0.32.exe` | `e0b0b75292d714d1028cafd8b2b08678c8aa8df4ef7de9858900be7d6cd0ad53` |
| `Titan POS 1.0.32.exe` (portable) | `cd85c8509947307a37716c450288aecaa1f29e2dabe8b158e2dc6991223c6a77` |

**Not published.** No GitHub release; `latest.yml` is a local-only electron-builder artifact.

## Install
Install on the hub (and any client). After install, the hub's cloud bridge survives device connects/restores and keeps the cloud in sync. Confirm on the hub startup log that migrations apply and, in Settings → Cloud, that "last pull" keeps advancing.
