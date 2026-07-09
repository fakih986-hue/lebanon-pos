# TITAN POS Top 100 UX/UI Improvements

Date: 2026-07-09

## P0 - Immediate Commercial Fixes

1. Remove all mojibake artifacts (`â`, `Ã`, `Â`) from source and UI strings.
2. Rename cart action `Clean` to `Clear Sale`.
3. Rename `Receiving` to `Stock Receiving`.
4. Rename `Debt` to `Customer Debt`.
5. Make POS scanner input the permanent primary focus on checkout.
6. Add visible scanner focus state and last scanned item feedback.
7. Add one-tap `Exact USD`, `Exact LBP`, and common mixed-payment presets.
8. Add a clearly visible `Still due` and `Change due` block in payment.
9. Add Card payment to `QuickPOSMode` payment options or explain why not.
10. Make `Complete Sale` dynamic: `Pay $X`.
11. Add manager approval affordance for below-cost / sell-at-cost.
12. Replace POS empty cart text with actionable scan-first instructions.
13. Add explicit offline sale banner when sync is offline.
14. Add branch/register/shift status in the POS canvas, not only sidebar/topbar.
15. Add low-stock and out-of-stock states directly on product cards.
16. Make product cards minimum 156px high with 44px action zones.
17. Increase product card price hierarchy: name 14px, metadata 12px, price 18px.
18. Use one consistent card radius: 8-12px, no random `rounded-2xl`.
19. Stop remapping emerald globally to bronze where it represents success.
20. Reserve green only for success/paid/online.
21. Reserve bronze only for brand, active state, and primary actions.
22. Add a real premium table pattern for product/customer/sales/staff tables.
23. Add keyboard shortcut hints only where relevant; move global help into a modal.
24. Add focus trap to all modals/drawers.
25. Add Escape close behavior consistently to all dialogs.
26. Add `aria-label` to icon-only buttons.
27. Replace text `X`/mojibake close buttons with lucide `X`.
28. Remove visible hardcoded `v1.0.6`; bind to real version or hide.
29. Normalize all buttons to `btn-*` classes.
30. Normalize all form inputs to `.input` with visible labels.

## P1 - Workflow Redesign

31. Split `ProductsPage` into Catalog, Stock, Lots, Alerts, and Setup submodules.
32. Split `SettingsPage` into Business, Sync, Security, Backup, Delivery modules.
33. Split `StaffPage` into Team, Shifts, Audit.
34. Add a dedicated customer debt payment flow from POS customer picker.
35. Add fast customer creation inside POS without leaving sale.
36. Add customer risk indicator in POS when selecting a debt customer.
37. Add debt limit explanation before blocking sale.
38. Add full sale review with item list, tender, customer, change, and warnings.
39. Add refund wizard with quantity, reason, tender method, and stock restoration.
40. Add return sale mode in POS separate from receipt refund.
41. Add held sales shelf with time, cashier, customer, item count, value.
42. Add weighted item workflow: scan -> weight -> price confirmation.
43. Add barcode-not-found manager flow: create product or temporary item.
44. Add quick product creation after unknown barcode scan.
45. Add product aliases UI in the creation flow.
46. Add supplier receiving wizard: supplier -> items -> costs -> lots -> confirm.
47. Add stock count session progress and variance review.
48. Add batch/expiry risk view with FEFO recommendation.
49. Add reorder queue grouped by supplier with suggested quantities.
50. Add inventory history on product detail.
51. Add product detail drawer instead of editing inline everywhere.
52. Add customer detail drawer with statement, debt, loyalty-ready section.
53. Add customer statement export/print.
54. Add dashboard above-the-fold action queue: low stock, expiry, debt, sync, cash close.
55. Add owner dashboard gross/net/profit split with definitions.
56. Add shift close discrepancy explanation.
57. Add cash drawer expected-vs-counted visual reconciliation.
58. Add accounting close-day checklist before final close.
59. Add delivery kanban by order status.
60. Add driver assignment panel.

## P2 - Responsive, Touch, And Accessibility

61. Define POS monitor layout for 1366x768.
62. Define 22-inch touch layout with larger product grid and persistent cart.
63. Define tablet layout with cart drawer and bottom tender bar.
64. Define mobile layout for manager tasks, not full cashier workflow only.
65. Set minimum touch target to 44px, POS primary actions 52-64px.
66. Add high-contrast mode.
67. Add reduced-motion behavior for POS overlays.
68. Add screen-reader names for sync, cart, payment, and scanner controls.
69. Add table keyboard row navigation.
70. Add visible focus state inside custom dropdowns and segmented controls.
71. Add error summary at top of long forms.
72. Add required field indicators with text, not color only.
73. Add confirmation copy that names the destructive object.
74. Make empty states operational: include next action button.
75. Add loading skeletons to customer/products/sales tables.
76. Add stale/offline state for pages that require API.
77. Add success state for product create, sale complete, payment recorded.
78. Add printer failure state after sale.
79. Add payment failure state with cart preserved.
80. Add sync conflict state with resolution path.

## P3 - Premium Brand And Enterprise Polish

81. Create final TITAN black/graphite/bronze token sheet.
82. Create POS-specific command bar component.
83. Create POS-specific scanner input component.
84. Create product card variants: compact, image, list, favorite.
85. Create payment method tile component.
86. Create register status component.
87. Create sync health component with offline queue drilldown.
88. Create KPI tile component with consistent hierarchy.
89. Create action queue component for owner dashboard.
90. Create premium empty-state illustration style.
91. Replace generic page headers with operational headers.
92. Remove inconsistent `bg-zinc-*`, `bg-emerald-*`, `bg-indigo-*` leftovers.
93. Add route-level page width rules.
94. Add drawer design spec.
95. Add modal design spec.
96. Add toast design spec with undo/action support.
97. Add icon usage rules: stroke width, size, semantic color.
98. Add receipt/customer display design.
99. Add customer-facing payment display mode.
100. Add full design QA checklist to the repo.

