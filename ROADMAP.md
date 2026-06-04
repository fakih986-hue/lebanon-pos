# LebanonPOS — Adjusted Roadmap

> Reprioritized from the 66-item list. Organized by **what unblocks revenue**, not by feature category.
> Estimates are realistic and include the "sync tax" (see note below).

---

## ⚠️ The Sync Tax (read this first)

Every new data model (Quotation, GiftCard, JournalEntry, etc.) must be wired into **4 places**:
1. `apps/api/src/routes/sync.ts` — push handler (`processOperation`)
2. `apps/api/src/services/cloudSync.ts` — pull + upsert
3. `apps/desktop/src/features/pos/services/*.service.ts` — offline service + localStorage key
4. The desktop UI + `PULL_TARGETS` map in `sync.service.ts`

**Rule of thumb: any "new model" feature takes ~2x its naive estimate** because of this. The original roadmap ignored this entirely.

---

## ✅ ALREADY DONE (do not rebuild)

| Original item | Status |
|---------------|--------|
| 0.1 Merge fix (incremental pull) | ✅ Shipped — with settings id-less guard |
| 0.2 Dockerfile + prisma deps | ✅ Shipped — both Dockerfiles + lockfile |
| 0.3 JWT secret | ✅ Set in Railway + local `.env` |
| 0.5 Electron package.json | ✅ Created with electron-builder config |
| Cloud sync bridge (local ↔ Railway) | ✅ Built (not in original list) |
| Optimistic stock on receive | ✅ Shipped |

---

## ❌ CUT — do NOT build (wrong for a mini-market)

| Cut item | Why | Do instead |
|----------|-----|-----------|
| Phase 9 — Full accounting (GL, Balance Sheet, COA) | A separate product. Half-built double-entry is worse than none. | Export to Excel → owner's accountant uses QuickBooks/Xero |
| 6.4 Gift cards, 6.5 Loyalty | Mini-markets don't run loyalty programs | Skip until a customer pays for it |
| 5.4 Layaway, 5.5 Quotation, 5.6 Proforma | B2B/retail-chain features | Skip |
| 7.4 Bundles, 7.5 Recipe roll-up | Restaurant feature, not grocery | Skip (revisit if you sell to restaurants) |
| 10.1 Custom report builder | "1 week" = really 1 month | Use fixed reports (Tier 3) |
| 8.4 Multi-location transfer | Single-store customers | Skip |
| 12.2 Remove admin/order/driver from Dockerfile | ❌ **Contradicts your goal** — you WANT these on Railway | Keep them |

---

## TIER 0 — Finish what's in flight (THIS SESSION)

**Blocking everything. The product doesn't fully run yet.**

| # | Item | Status |
|---|------|--------|
| 0a | Local POS login working (`fakih` / PIN) | 🔧 In progress |
| 0b | Tenant auto-create on first bridge pull | 🔧 Just pushed, needs verify |
| 0c | End-to-end: local sale → Railway admin shows it | ⏳ Pending test |
| 0d | Railway redeploy with `/api/setup/tenant-info` | ⏳ Building |

---

## TIER 1 — Production-trustworthy (1 week)

**Before any paying customer. These protect money and data.**

| # | Item | Real effort | Notes |
|---|------|-------------|-------|
| 1.1 | **0.4** Image endpoint auth | 30min | Only real Phase-0 item left |
| 1.2 | **1.1** Float → Decimal for money | **1–2 days** ⚠️ | NOT 30min. Touches every price calc + localStorage numbers. Risky migration. Test heavily. |
| 1.3 | **8.3** Negative stock prevention | 2h | Block sale if stock insufficient. Critical for a POS. |
| 1.4 | **3.3** Sync data-loss test | 1h | Your #1 trust risk: never lose a sale |
| 1.5 | **1.4** Surface IndexedDB write errors | 1h | Silent failures = silent data loss |
| 1.6 | **1.2** DB indexes (SaleItem.productId, SyncOperation) | 30min | Cheap, real perf win |

---

## TIER 2 — Ship the commercial product (1–2 weeks)

**This is your actual differentiator: a one-click install for non-technical owners.**

| # | Item | Real effort | Notes |
|---|------|-------------|-------|
| 2.1 | Build + test the `.exe` installer | 2–3 days | electron-builder config exists; needs real icons, PostgreSQL-install wizard, testing on a clean Windows machine |
| 2.2 | First-run setup wizard | 2 days | "Server or client machine?" → install Postgres → pull from cloud |
| 2.3 | New-store onboarding (you create tenant + hand over creds) | 1 day | Script or admin button |
| 2.4 | **8.2** Low-stock alerts + suggested reorder | 1 day | Owners care about this daily |

---

## TIER 3 — Reports owners actually open (3–4 days)

Cut the 9-item reporting phase down to what a grocery owner looks at:

| # | Item | Effort |
|---|------|--------|
| 3.1 | **10.8/10.9** X report (mid-shift) + Z report (end-of-shift) | 4h |
| 3.2 | **10.5** Margin per product/category | 1h |
| 3.3 | **9.7** Customer debt aging (who owes, how overdue) | 1 day |
| 3.4 | **10.2** Export to Excel (the one accounting "feature" you need) | 1 day |

---

## TIER 4 — Hardening (when you have 2+ paying customers)

Don't do this early — it slows iteration while you have zero users.

| # | Item | Effort |
|---|------|--------|
| 4.1 | **2.2** helmet for security headers | 30min |
| 4.2 | **2.4** POS auto-lock after inactivity | 1h |
| 4.3 | **11.1–11.3** Manager PIN for discounts/voids/overrides | 1–2 days (genuinely useful + cheap) |
| 4.4 | **3.1** API route tests | 2 days |
| 4.5 | **4.1** Pagination (only when a store has 1000s of sales) | 1 day |
| 4.6 | **2.5** Persist rate limiting in DB | 1h |

---

## TIER 5 — Features ONLY when a customer asks & pays

Parking lot. Build on demand, charge for it.

- **5.1 Split tender** (Cash + Card same sale) — 2 days, reasonable for some shops
- **5.2 Partial debt payments** — 1 day, fits the debt feature you already have
- **6.3 Store credit on returns** — 2 days
- **7.1 Wholesale/multi-price** — 1 day, useful if a customer does wholesale

---

## Realistic timeline

| Milestone | Calendar time |
|-----------|---------------|
| Tier 0 (working end-to-end) | This session |
| Tier 1 (trustworthy) | 1 week |
| Tier 2 (sellable .exe) | +1–2 weeks |
| Tier 3 (owner reports) | +3–4 days |
| **First paying customer ready** | **~3–4 weeks** |
| Tier 4–5 | Ongoing, demand-driven |

The original "60 days for everything" → realistically **6–9 months** if you build it all. The point of this roadmap is: **you don't build it all.** You ship in ~1 month and let customers pull features from the parking lot.

---

## Next action

Finish **Tier 0** — get login + sync verified working. Everything else waits behind that.
