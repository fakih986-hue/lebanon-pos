# Titan POS v1.0.30 Release Notes

**Date:** 2026-07-13
**Type:** Internal build — STORE_HUB server-authoritative checkout, unsigned

## Why
Fixes "sold stock reappears": a hub sale of a product whose aggregate was drifted above its (empty) batch total showed optimistic "success / 0 left", but the commit was rejected server-side and reverted — a confusing false success. STORE_HUB checkout is now server-authoritative (commits to its own localhost API — instant, same-machine — before finalizing), so the sale commits or fails cleanly, never a false success that reverts.

Also (data, already applied live): with batches confirmed as truth, batch-tracked products' aggregate reconciled to open-batch totals (succarinee/cerave/loreal/hostage→0, evian→31, safasf→39, aaasssdddd→23); non-batch-tracked left untouched.

## Verification
- API/desktop/electron typecheck PASS; 170 API + 118 desktop tests PASS.
- succarinee now 0 on hub + cloud (verified).

## Artifacts
| File | SHA-256 |
|------|---------|
| Titan POS Setup 1.0.30.exe | 1f5088ffcaf42aa1cb1447f33814981c72455cb1505d45d783a44ce789aa8ce6 |
| Titan POS 1.0.30.exe | 0e6b4fd8bd5d4157f53bde324b5669c75ad36bb973ab079ad8d8e540b638fe16 |

Not published. No Railway deploy (client-only). Railway stays on b58bb06.

## Install
Install on hub + connected client. Then: selling an out-of-stock item shows a clean "Out of stock — sale not completed" instead of a false success that reverts.
