# Titan POS v1.0.36 — UX Navigation Update

**Type:** Desktop / client-only release (no server or database changes)
**Baseline:** v1.0.35 (`de39454`) — RECEIVE-1 server work already deployed to Railway
**Railway:** Not touched. No API, schema, or migration changes since 1.0.35.

---

## What's in this build

This release bundles the accepted UX / navigation simplification work
(POS-UX-IA-2A through IA-2B.4). It is **presentation and routing only** — no
stock, sync, tender, tax, refund, receive, or ledger behavior changed, and no
permissions changed.

### IA-2A — Safe navigation & label cleanup
- Sidebar groups renamed: **Sell / Stock / Money** (internal keys unchanged).
- "Receiving" → **Receive stock**.
- Products labels clarified; reconciliation made visible; Settings labels tidied.

### IA-2B.1 — Structure labels & section headers
- Settings tab **"Cloud sync" → "Devices & Sync"** (internal value unchanged),
  with clearer sub-headers: Connection mode / Hub · LAN access / Paired devices
  / Offline queue / Cloud account.
- Products **"Stock control" → "Stock tools"**; "Lots" surfaced as **Batches**.

### IA-2B.2 — Extract Stock tools into a hook
- Stock adjust / count / reconciliation state + logic moved into a portable
  `useStockControl` hook. No behavior change (verbatim logic, identical memo
  dependencies).

### IA-2B.3 — Dedicated Stock & Batches route
- New **`/stock`** route + sidebar item **"Stock & Batches"** (gated by the same
  `inventory.manage` permission as Products).
- Three tabs: **Adjust & count**, **Batches**, **Reconciliation**.
- Products left fully intact (all tabs still present).

### IA-2B.4 — Consolidate Batches UI
- Products' Batches tab now reuses the shared **`BatchesPanel`** (the same
  component `/stock` mounts) — one implementation instead of two. Same label,
  badge count, search/filter, and empty state.

> Products keeps **all six tabs** (Catalog · Categories · Alerts · Stock tools ·
> Batches · Add product). Nothing was removed this release; `/stock` is additive.

---

## Artifacts

| Artifact | File |
|---|---|
| NSIS installer | `apps/electron/dist-v8/Titan POS Setup 1.0.36.exe` |
| Portable EXE | `apps/electron/dist-v8/Titan POS 1.0.36.exe` |

### SHA-256
```
d2ca84ef674127b5b42923c97ff827cdd2eef0d12f5f430b400e55c5a62c3066  Titan POS Setup 1.0.36.exe
07b02041d997ba138e0cb8f05dcf889be2aacab1e918600a57f44de2a36bb8fe  Titan POS 1.0.36.exe
```

**Not published:** no GitHub release, no auto-update manifest (`latest.yml`
removed locally). Install manually on the hub for testing.

---

## Hub acceptance checklist

- [ ] Sidebar shows **Stock & Batches** (under the Stock group)
- [ ] `/stock` opens
- [ ] `/stock` → **Adjust & count** renders
- [ ] `/stock` → **Batches** renders
- [ ] `/stock` → **Reconciliation** renders (Run Scan + ledger reconciliation)
- [ ] **Products** still works (all six tabs)
- [ ] Products → **Batches** still works
- [ ] Settings shows **Devices & Sync**

---

## Notes / known follow-ups
- **Build hygiene (non-blocking):** `copy-desktop-spa` does not clean the SPA
  asset directory, so the packaged `resources/api/public/assets/` accumulates
  orphaned `index-*.js` bundles from prior builds. `index.html` loads only the
  fresh asset (`index-NbzunHdX.js`, verified to contain all new UX), so the app
  is correct — but the installer carries stale, unloaded bundles. Cleaning the
  dest before copy is a separate optional task.
