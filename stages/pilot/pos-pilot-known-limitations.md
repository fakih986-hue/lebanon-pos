# POS Pilot — Known Limitations

**Date:** 2026-07-09
**Release:** Pilot-ready (78/100)
**Audit Reference:** `stages/ux-ui/pos-final-release-readiness-audit.md`

---

## Operating Limitations

| # | Limitation | Impact | Workaround |
|---|-----------|--------|------------|
| 1 | **Desktop-only** | No tablet/mobile POS. Manager screens (Products, Customers, Accounting) work on desktop only. | Use a laptop or desktop PC for the pilot. Screen resolution 1024px+ required. |
| 2 | **No full refund wizard** | Refunds require entering exact quantities per item. Cashier must know how many of each item to refund. | Train cashier on the refund flow. Print a guide showing: select sale → enter quantity per item → record refund → confirm. |
| 3 | **No product card stock badges in POS** | Product cards in the POS grid show name + price only; stock status only visible after scan. Low-stock items are not visually distinct from in-stock. | Use the Products page "Low stock" quick-view tab to check before opening POS. Out-of-stock items show "Out of stock" after scan. "No barcode" badge appears on cards. |
| 4 | **Receipt is text/HTML only** | No branded PDF output. Receipt prints via browser dialog. | Accept for pilot. Branded thermal printer template can be added later. |
| 5 | **No inline customer creation in POS** | Cashier must navigate to Customers page to add a new customer for Debt sales. | Create customer list before shift. Use the searchable customer picker in POS for existing customers. |
| 6 | **Cash drawer reconciliation not persisted** | Counted cash + variance is displayed but not saved to DailyClose. | Record counted cash on paper or in closing note. Reconciliation screen shows expected vs counted clearly. |

---

## Technical Limitations

| # | Limitation | Impact | Notes |
|---|-----------|--------|-------|
| 7 | **4 monolithic pages** | ProductsPage (1350L), POSPage (1210L), SettingsPage (1130L), StaffPage (1100L) are single-file monoliths. | Not user-facing. Maintainability improvement planned post-pilot. |
| 8 | **No loading skeletons on all pages** | Products, Customers, and Dashboard have skeletons. Sales and other pages show content immediately (no loading state). | Minor visual jitter on first load. |
| 9 | **Sync is best-effort offline** | Sync retries automatically. Failed operations appear in Settings → Cloud sync. Stuck operations need manual retry. | Check Settings after a busy day. Failed ops are recoverable. |
| 10 | **No previous-period KPI deltas** | Dashboard KPIs show current values only. No "+12% vs last week" comparison. | Owner should check Accounting page for historical data. |
| 11 | **No promise-to-pay / installments** | Customer debt is binary: owed/paid. No partial payment plan tracking. | Record partial payments as separate transactions with reference notes. |

---

## Integration Limitations

| # | Limitation | Impact |
|---|-----------|--------|
| 12 | **WhatsApp sharing via web** | Receipts shared via WhatsApp Web link. No native app integration. |
| 13 | **No email receipts** | Receipts can be printed or WhatsApp-shared only. No email delivery. |
| 14 | **AI image generation optional** | Product images generated via HuggingFace API. Requires `HF_TOKEN` env var. Works without it (shows colored initials instead). |
| 15 | **No integrated payment terminal** | Card/Wallet/Debt payment methods are recorded but not processed. Cashier manually handles card terminal. |

---

## Pilot Go/No-Go Decision

**VERDICT: READY FOR PILOT WITH DOCUMENTED LIMITATIONS**

The pilot shop can operate fully: scan products, collect cash/card/wallet/debt, issue receipts, manage inventory with batches, track customer debt, close days with cash reconciliation, and monitor via dashboard.

The 15 limitations above are documented, non-blocking for a supervised pilot, and addressable in post-pilot sprints.
