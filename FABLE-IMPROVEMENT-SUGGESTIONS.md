# Fable Improvement Suggestions

**Project:** BOFFO Order OS (Vite + React 18 client, Zoho Catalyst backend)
**Assessed:** 2026-06-11 · branch `feature/master-order-forms`
**Scope:** Read-only assessment — fast data load, fast screens, better UI. Nothing was changed or deleted.

---

## Verification / Test Results

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Pass (0 errors) |
| `vite build` | ✅ Pass, 1.75s, 90 modules |
| Main bundle | 201 kB (65 kB gzip) — healthy |
| CSS | 44.8 kB (8.9 kB gzip) |
| Route chunks | 24 lazy chunks, all < 18 kB — excellent code-splitting |
| Dependencies | Only `react`, `react-dom`, `react-router-dom` — zero bloat |

The build is healthy. The performance problems are **runtime data-loading patterns**, not bundle size.

---

## #0 — The Biggest Finding: Half the App Still Runs on Mock Data

`client/src/data.ts:1-4` is seeded mock data ("real data arrives with the Data Store backend later"). Live Catalyst data is wired into Orders, Quotes, Pallets, Designs, Containers — but these screens still render the **mock** `ORDERS` / `PARTIES` / `DESIGNS` / `QUOTES` constants:

| Screen | File | Data source |
|---|---|---|
| Dashboard | `features/dashboard/Dashboard.tsx:6` | Mock (`ORDERS`, `ACTIVITY`, `READY_TO_LOAD`) |
| Pipeline Kanban | `features/pipeline/Kanban.tsx:6` | Mock |
| Pipeline QuickView | `features/pipeline/QuickView.tsx:6` | Mock |
| By-Order view | `features/orders/ByOrderView.tsx:6` | Mock |
| Purchase Orders + Detail | `features/stages/PurchaseOrders.tsx:6`, `PurchaseOrderDetail.tsx:4` | Mock |
| Production + Form | `features/stages/Production.tsx:7`, `ProductionForm.tsx:11` | Mock |
| QC | `features/stages/QC.tsx:13` | Mock |
| Order Drawer | `features/orders/OrderDrawer.tsx:6` | Mock |
| Parties / CustomerDetail / ItemDetail | `features/masters/Parties.tsx:10`, `CustomerDetail.tsx:4`, `ItemDetail.tsx:4` | Mock |
| Sidebar counts (partially) | `App.tsx:10` | Mock + live quote count |

**Why this matters for "fast data load":** any caching/fetching optimisation only helps the live screens. The migration of these screens to live data is the moment to introduce a proper data layer (see #1) — retrofit later costs double.

**Suggestion:** finish the mock→live migration screen by screen, and route every screen through one shared data layer as you do it.

---

## #1 — Fast Data Load

### 1.1 No shared cache — every page mount refetches everything (HIGH)
- `quotesApi.ts:36-64` has a nice module-level stale-while-revalidate cache (30s TTL). **No other API module has one** — `ordersApi`, `palletsApi`, `designsApi`, `containersApi`, `palletisationApi` refetch full tables on every mount (`Pallets.tsx:43-45` pattern: `useEffect(() => { void load() }, [])`).
- `OrdersTable.tsx:58-68` pulls **7 tables** (SalesOrder, OrderItem, Customer, Design, Size, Finish, Brand) on every visit to Orders.

**Fix (pick one):**
- **Quick (½ day):** extract the `quotesApi` cache pattern into a generic `cachedList(table, ttl)` helper in `lib/dataOps.ts`; adopt in all 5 API modules. Instant paint from cache + background revalidate.
- **Better (1–2 days):** adopt **TanStack Query**. Free request dedupe, stale-while-revalidate, mutation invalidation, devtools. Bundle cost ~12 kB gzip — trivial next to the win.

### 1.2 No request deduplication or cancellation (MED-HIGH)
- `lib/api.ts:30-46` is a bare fetch wrapper. Rapid sidebar navigation (Orders → Quotes → Orders) fires duplicate concurrent full-table fetches; nothing is aborted.
- `App.tsx:265` also fires `listQuotes()` on app mount for the sidebar badge — can race with the Quotes page's own fetch.

**Fix:** in-flight request map in `lib/api.ts` (`Map<url, Promise>` — return existing promise, clear on settle). ~30 lines. TanStack Query gives this for free.

### 1.3 Over-fetching: all columns, whole tables, client-side filtering (HIGH)
- All `list()` calls fetch every column — e.g. `designsApi.ts:85-100` pulls 25+ columns incl. `image_url` for the list view; `ordersApi.ts:29-36` pulls 7 full tables at `limit: 300`.
- Status/stage/search filters run client-side over the full dataset.

**Fix:**
- Add column projection to `dataOps.list()` (`columns: [...]` → `SELECT col1, col2`). Cuts list payloads 50–70%.
- Move status/search filters to ZCQL `WHERE` when tables grow.
- Lazy-load design images separately from the list query.

### 1.4 The 300-row ceiling (HIGH — future-proofing)
- `dataOps.ts:33-37` `ListOpts` has no `offset`; `quotesApi.ts:68` comment admits: *"Pagination TODO when any table grows past 300."*
- The day Quote/OrderItem/Design passes 300 rows, lists silently truncate.

**Fix:** add `offset` to `ListOpts` now, and a `listAll()` that pages in 300-chunks (or real paginated UI on the big tables).

### 1.5 Detail pages block on full hydration (MED)
- `QuoteDetail.tsx:92-107`: if cache cold, blank until 6 joined tables arrive; activity tab separately fetches `OperationLog` (limit 200) on click.

**Fix:** paint header from cache/route state immediately; stream related records in. Skeletons (see #3.4) hide the rest.

**Expected result of 1.1 + 1.2 + 1.3:** revisit navigation goes from ~1–2s of refetch to instant paint; first-visit payload drops by half or more.

---

## #2 — Fast Screens (Render Performance)

### What's already good ✅
- All 24 routes lazy-loaded via `React.lazy` (`App.tsx:14-38`) — chunks confirmed in build output.
- `HashRouter` + URL-driven state; deep links work.
- Hot computations mostly memoized (`Kanban.tsx:15-22`, `Dashboard.tsx:9-35`, `App.tsx:231`).
- Minimal dependency tree; no UI-lib bloat.

### 2.1 No virtualization on tables (HIGH at scale, fine today)
- `OrdersTable.tsx:174-223` renders every row in one `<tbody>`; same in Kanban columns and ByOrder groups. Fine at ~44 orders; will degrade at 500+.

**Fix:** when live data replaces mock and row counts grow, add `react-window` to OrdersTable + Kanban columns. Pairs with server-side pagination (#1.4) — do them together.

### 2.2 Unmemoized list components (MED)
- `NavNodeRow` (`App.tsx:172`), `KanbanColumn` (`Kanban.tsx:95`), `KanbanCard` (`Kanban.tsx:143`), ByOrder group rows — none wrapped in `React.memo`; KanbanCard gets fresh callback refs each render.

**Fix:** `React.memo` the row/card components, `useCallback` the handlers passed into loops. ~30 min.

### 2.3 Unmemoized grouping in PurchaseOrders (LOW-MED)
- `PurchaseOrders.tsx:10-30` groups + sorts all orders at component root on every render.

**Fix:** wrap in `useMemo`. 5 min. (Note: `ByOrderView.tsx:38`'s empty-deps `useMemo` is **correct** today because mock `ORDERS` is a module constant — but it becomes a real bug the moment live data arrives via state. Flag it in the migration.)

### 2.4 QuickView popover position flash (LOW)
- `QuickView.tsx:27-54` measures after first paint; can flash at wrong position.

**Fix:** render with `visibility: hidden` until positioned.

---

## #3 — Better UI

### What's already good ✅
- Real design-token system (`styles/styles.css:1-54`) — colors, type scale, spacing all `var(--*)`; no ad-hoc inline colors found.
- Primitives layer (`ui/primitives.tsx`): StageBadge, ProgressBar, KPI, Spark — used consistently.
- Sidebar IA is excellent: auto-expand ancestors, localStorage persistence, count badges, breadcrumbs (`App.tsx:54-161`).
- Sticky table headers, hover states, consistent radii.

### 3.1 Form validation is silent (HIGH)
- `OrderForm.tsx:147`: missing required fields just disable Submit — no message tells the user *why*. No error styling exists in CSS (`styles.css:1164-1172` has focus state only, no `.error`).
- No visible disabled/spinner state on Save buttons while requests run; no unsaved-changes guard on modals.

**Fix:** add input `.error` state (red border + message under label), per-field "X is required" on submit attempt, `disabled` + "Saving…" on submit buttons, and a dirty-check confirm before closing forms.

### 3.2 Fixed 1440px viewport — unusable below desktop (HIGH)
- `client/index.html:5`: `<meta name="viewport" content="width=1440" />`. Zero media queries in `styles.css` (only `@media print`). Sub-1440 screens get scaled/scrolled UI; tablets unusable.

**Fix:** switch to `width=device-width, initial-scale=1`; add one breakpoint (~1024px) that auto-collapses the sidebar to the existing 60px icon rail; let Kanban's 6-col grid wrap (`auto-fit, minmax(220px, 1fr)`).

### 3.3 Missing empty states & retry (MED)
- No list view shows "No quotes yet / No matching results" when empty; error cards (`QuotesTable.tsx:146-149`) have no Retry button.

**Fix:** shared `<EmptyState icon title hint action/>` primitive; add "Retry" to the error card pattern.

### 3.4 Loading is text, not skeletons (MED)
- Suspense fallback is `"Loading…"` (`App.tsx:361`); data loads show the same.

**Fix:** lightweight CSS-only skeleton rows for tables + KPI tiles (shimmer via one keyframe). Combined with the cache (#1.1) most users will never see them — that's the goal.

### 3.5 Notices are dim text, not toasts (MED)
- Save feedback like `setNotice("Quote saved (#...)")` renders as muted subtitle text (`QuotesTable.tsx:100`); easy to miss. No toast CSS exists.

**Fix:** small toast component (bottom-right, auto-dismiss, success/error variants) reused by all forms.

### 3.6 Accessibility gaps (MED)
- `Combobox.tsx:50-86`: no `role="combobox"`, `aria-expanded`, `aria-controls`.
- Clickable table rows (`.tbl tr.clickable`) have no keyboard handling (no `tabIndex`/Enter).
- Icon-only header buttons rely on `title` only — add `aria-label`.
- Modals: no focus trap, Escape-to-close inconsistent.

**Fix:** ARIA pass on Combobox + modals (focus trap, Esc), `tabIndex={0}` + Enter handler on clickable rows.

### 3.7 Header search is a placeholder (LOW)
- `App.tsx:345-348` search input does nothing. Either wire a quick cross-entity search (quotes/orders/designs by code/name from cache) or hide it — a dead control erodes trust.

---

## Prioritized Roadmap

| # | Item | Effort | Payoff |
|---|---|---|---|
| 1 | Generic stale-while-revalidate cache for all 5 API modules (or TanStack Query) | ½–2 days | Instant repeat navigation — biggest perceived-speed win |
| 2 | Request dedupe in `lib/api.ts` | ½ day | Kills duplicate fetch storms |
| 3 | Form validation messages + saving states + toasts | 1 day | Biggest UX trust win |
| 4 | Responsive viewport + sidebar auto-collapse breakpoint | ½–1 day | App usable on laptops/tablets |
| 5 | Column projection in `dataOps.list()` + lazy design images | 1 day | 50–70% smaller payloads |
| 6 | Empty states + Retry + skeletons | 1 day | Polished feel |
| 7 | `offset` pagination in `ListOpts` (kill 300-row ceiling) | 1 day | Required before production data volume |
| 8 | `React.memo` on Nav/Kanban rows, memoize PurchaseOrders grouping | ½ day | Cheap render wins |
| 9 | Accessibility pass (Combobox ARIA, focus trap, keyboard rows) | 1 day | WCAG baseline |
| 10 | Mock→live migration for Dashboard/Kanban/Production/QC/Parties screens | ongoing | Prerequisite for items above to matter app-wide |
| 11 | Virtualize OrdersTable/Kanban (`react-window`) | ½ day | Only when row counts pass ~200 |

**Suggested order:** 1 → 2 → 3 → 4 first (one week, transforms perceived speed + UX), then 5/6/7 alongside the mock→live migration (10).

---

## Fix Tracker

Baseline commit: `1cf6c00` — "FABLE CHANGES Started" (pushed 2026-06-11).

- [x] **Group A** — Stale-while-revalidate cache for all API modules + request dedupe in `lib/api.ts` (§1.1, §1.2) ✅ new `lib/cache.ts`; all 5 API modules cached, mutations auto-invalidate; GET dedupe in `lib/api.ts`
- [x] **Group B** — `React.memo` Nav/Kanban rows + memoize PurchaseOrders grouping (§2.2, §2.3) ✅ NavNodeRow/KanbanColumn/KanbanCard memoized, toggleGroup useCallback, PurchaseOrders grouping in useMemo
- [ ] **Group C** — Form validation messages + saving states + toasts (§3.1, §3.5)
- [ ] **Group D** — Empty states + Retry + skeleton loaders (§3.3, §3.4)
- [ ] **Group E** — Responsive viewport + sidebar auto-collapse breakpoint (§3.2)
- [ ] **Group F** — Column projection in `dataOps.list()` + offset pagination, kill 300-row cap (§1.3, §1.4)
- [ ] **Group G** — A11y pass: Combobox ARIA, modal focus trap, keyboard rows (§3.6)
- [ ] **Big #1** — Mock→live migration: Dashboard, Kanban, Production, QC, Parties… (§0)
- [ ] **Big #2** — Virtualization (deferred until rows > ~200) (§2.1)

---

*Assessment only — no code, data, or files were modified or deleted. One agent finding was verified false and excluded (ByOrderView `useMemo` empty deps is currently correct; noted as a future-migration risk in §2.3).*
