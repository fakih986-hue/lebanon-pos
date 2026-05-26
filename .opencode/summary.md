## Goal
- Sell Lebanon POS as a multi-business offline-first retail system with cloud sync, deployed online.

## Constraints & Preferences
- Desktop POS for Lebanese retail: React 19, TypeScript 6, Tailwind 4, Zustand 5, Vite 7.
- Offline-first design with API backend (Express 5 + Prisma + PostgreSQL).
- User Mohamad Fakih (fakih986@gmail.com), GitHub fakih986-hue.
- Deploying to Railway ($5/mo Hobby plan).
- Vite 7.3.3 + `@vitejs/plugin-react@4` (compatible pair, avoids rolldown bug).

## Progress
### Done
- **Phase 1 & 2** — Security PIN hashing, dead code cleanup, strict TypeScript, ErrorBoundary, loading states, tests, ConfirmDialog, delete/void functions, session auto-lock, page decomposition, printing, form validation, IndexedDB migration.
- **API Backend** — Express 5 + TypeScript at `apps/api/`. Full Prisma schema (22 models). JWT auth, `POST /api/sync/push`, `GET /api/sync/pull`. Dockerfile builds and deploys to Railway.
- **Sync** — `sync.service.ts` with `setupBackgroundSync()` (30s push / 120s pull). Dual-write to IndexedDB + localStorage. All entity handlers implemented server-side.
- **Railway deployed** — API live at `https://lebanon-pos-production.up.railway.app`. PostgreSQL plugin active. Health check at `/api/health` returns `{"status":"ok"}`. Sync working between desktop and cloud.
- **Dockerfile fixed** — Uses `npm install` (not pnpm). `CMD node dist/index.js`. Prisma client generated at build time.
- **Migrations committed** to git — `prisma/migrations/` tracked. `prisma migrate deploy` runs on startup via `setup.ts`.
- **`.js` extensions** added to all relative imports in source (Node16 moduleResolution requires them for ESM).
- **User replaced desktop files** with AI-generated new version — major changes reviewed (WorkspaceTabs pattern, React Router v7, new security middleware, bcrypt PIN migration, idb API fix, Vite port 5174 locked).
- **UI polish fixes applied** — Cart floating button overlap, barcode search centering, "New Sale" button visibility, dead `App.css` removal, `active:scale-[0.97]` globally, toast icons, Spinner theme, ErrorBoundary icon, focus-visible outline, ProductReceivePage column alignment, DashboardPage race condition fix, 7 orphaned directories deleted, duplicate `escapeHtml` removed.
- **Enhancement Phase 1-5** — Loading/error/empty states, search debouncing (200ms), form validation (react-hook-form + zod on SettingsPage + AccountingPage), keyboard shortcuts (Ctrl+F, F8, Escape via useHotkey hook), animations (framer-motion page transitions + CartDrawer spring physics).
- **All 24 tests pass, TypeScript compiles clean** throughout all changes.
- **CartDrawer redesigned** — Discount section collapsed to a simple toggle (default collapsed, neutral gray border, no purple theme, mode toggles + preset buttons inline with input). Held sales section collapsible (default collapsed, neutral gray). Layout reordered: payment methods first (always visible), discount below (collapsible), held sales below cart items (collapsible). Payment method buttons `h-14` with `Payment method` label. Totals: Total USD `text-2xl tracking-tight` with `border-t-2 border-zinc-900` separator, Total LBP `text-base`. Complete Sale button `h-14 rounded-xl text-lg shadow-md active:scale-[0.97]`.
- **`changeCurrency` removed** — Removed from CartDrawer UI (Return USD/Return LBP toggle), POSPage state/calls/LastSaleSummary type, ReceiptPreview (now shows both Change USD and Change LBP), printReceipt.ts (same). Deleted all related Prop interface entries, destructured props, and JSX.
- **Business web dashboard created** — `apps/api/src/routes/dashboard.ts`: `GET /api/dashboard/kpi` (JWT-protected) returns today/week/month aggregates, 30-day sales trend, payment breakdown, top 10 products, 10 recent sales. `apps/api/public/dashboard.html`: self-contained page with login form, 4 KPI cards, Chart.js line chart (30-day trend), doughnut chart (payment methods), top products table, recent sales table, auto-refresh every 60s, refresh button, chart instance cleanup on re-render. `apps/api/src/app.ts`: registered `/api/dashboard` routes + `express.static("public")`. Served from same Express API at `/dashboard`.
- **StaffPage search added** — `useRef`, `useDebounce(200ms)`, `useHotkeys(Ctrl+F)`, `Search` icon. Filtered `users` by name/mobile/role, `shifts` by shiftNumber/openedByName/status, `auditEvents` by summary/userName/action. Search input inline with WorkspaceTabs (responsive flex row). Empty states differentiate "no data" vs "no match".
- **SuppliersPage search moved** — Search input lifted from Accounts section header to inline with WorkspaceTabs (matches CustomersPage/StaffPage pattern). Visible from any workspace tab. Removed redundant `Search` icon import (already imported). Responsive `flex-col sm:flex-row`.
- **API PrismaClient TS error fixed** — Added `output = "../src/generated/prisma"` to `prisma/schema.prisma` generator. Updated import in `src/lib/prisma.ts` to `"../generated/prisma/index.js"`. Client regenerated successfully.
- **All API TypeScript errors fixed** — Remaining 4+ Express 5 type issues resolved. Switched `auth.ts`, `security.ts`, `errorHandler.ts` middleware and route files from Express `Request`/`Response`/`NextFunction` to `node:http`'s `IncomingMessage`/`ServerResponse`. Replaced all `res.status().json()` calls with `res.statusCode`/`res.setHeader`/`res.end(JSON.stringify(...))`. Fixed `AuthRequest` type to include `body` and `query` properties. 0 errors in both API and desktop.

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Multi-tenant architecture: each business isolated via Tenant model with tenantId on all entities.
- Desktop is primary UI; API is sync target and optional web backend.
- No form library rewrite — added minimal validation layer instead of refactoring all forms with react-hook-form/zod (installed but not applied broadly).
- Framer-motion for page transitions and drawer animations (spring physics: damping 28, stiffness 300).
- Custom useHotkeys hook over hotkey library (lightweight, no dependencies).
- Dashboard served from Express API as static HTML+Chart.js (no separate Railway service, no extra cost).
- `changeCurrency` removed entirely (show both USD/LBP change amounts; toggle was pointless).
- Prisma client output path set explicitly (`../src/generated/prisma`) to fix pnpm hoisting issue.
- Express 5 types are incompatible with `res.json()`, `req.body`, `req.headers`, `req.query`, and `res.setHeader()` when used with TypeScript strict mode. Solution: use `node:http`'s `IncomingMessage`/`ServerResponse` types directly and replace Express response conveniences with raw `res.statusCode`/`res.setHeader`/`res.end(JSON.stringify(...))`.

## Next Steps
1. Deploy latest changes to Railway (git push triggers deploy).
2. Continue polish on any remaining UI inconsistencies.

## Critical Context
- API URL: `https://lebanon-pos-production.up.railway.app`
- Desktop dev server: `http://localhost:5174`
- Vite 7.3.3 + `@vitejs/plugin-react@4` (compatible pair, avoids rolldown bug).
- `setup.ts` runs `prisma migrate deploy` then `tsx prisma/seed.ts` before starting Express app.
- Railway Root Directory: `apps/api`, Builder: Docker. Deploy auto-triggers on `git push`.
- 24 desktop tests passing, 13 API tests passing.
- Dashboard accessible at `/dashboard` on the API server.
- Prisma client now generated to `apps/api/src/generated/prisma/` (custom output path).

## Relevant Files
- `apps/desktop/src/features/pos/components/CartDrawer.tsx`: Redesigned — collapsible discount/held sales, larger totals, bigger Complete Sale button.
- `apps/desktop/src/pages/staff/StaffPage.tsx`: Search added for Team/Shifts/Audit with useDebounce + hotkey.
- `apps/desktop/src/pages/suppliers/SuppliersPage.tsx`: Search moved inline with WorkspaceTabs.
- `apps/api/src/routes/dashboard.ts`: `GET /api/dashboard/kpi` — KPI endpoint for web dashboard.
- `apps/api/public/dashboard.html`: Self-contained dashboard page with login + charts (Chart.js CDN).
- `apps/api/src/app.ts`: Dashboard routes registered, static file serving for `public/`.
- `apps/api/prisma/schema.prisma`: Generator output path set to `../src/generated/prisma`.
- `apps/api/src/lib/prisma.ts`: Import updated to `"../generated/prisma/index.js"`.
- `apps/api/src/middleware/auth.ts` / `security.ts` / `errorHandler.ts`: Rewritten with `node:http` types (no Express type dependencies).
- `apps/api/src/routes/auth.ts`: Rewritten with `IncomingMessage`/`ServerResponse` types, all `res.json()` replaced with raw HTTP response methods.
- `apps/desktop/src/pages/pos/POSPage.tsx`: `changeCurrency` state/props removed.
- `apps/api/src/routes/sync.ts`: Existing route patterns for reference (still uses `Response` from express but works via AuthRequest).
