# Audit & Hardening — remediation plan

Date: 2026-07-23 · Branch: `feature/master-order-forms`

Source: full-codebase audit (security, data-correctness, UX consistency, architecture).
We fix these as we go; tick the box and note the commit when each lands.

Status legend: ⬜ open · 🟡 in progress · ✅ done
Severity: 🔴 security/data-loss · 🟠 correctness · 🟡 UX consistency · 🟢 quality/perf

---

## 🔴 Fix first — security

- [x] **A1 · 🔴 ZCQL injection on generic routes.** DONE 2026-07-24. Added `assertWhere`
  (single-predicate grammar), `assertOrder` (identifier allowlist), and `rowidParam` digit
  coercion in `functions/data-ops/index.js`; applied to list/getOne/PATCH/DELETE/restore.
  Zero client churn (all 13 live `where` clauses pass). Self-check green.
- [x] **A2 · 🔴 Unmapped tables are world-readable.** DONE 2026-07-24. `GET_SHARED` allowlist for
  cross-cutting lookups; `ProductionLog` → items|stages|reports view; `OperationLog` → reports.view;
  everything else default-deny GET (`lib/appauth.js` guard). No screen breakage (verified readers).
- [~] **A3 · 🔴 Token exposure.** IN PROGRESS 2026-07-24. Server + CORS shipped (httpOnly
  `boffo_session` cookie set on login / cleared on logout; `bearer()` reads cookie-first with
  `X-App-Token` fallback; CORS origin-allowlist + credentials). Client `credentials:"include"` +
  dev cookie rewrite shipped (safe — header path still active). **GATED next step:** deploy to dev,
  run the cookie spike (curl: Set-Cookie survives gateway + Cookie honored); on PASS, final cutover
  = drop the localStorage token, always-call `/auth/me`, remove `X-App-Token`. On FAIL, fallback
  = short TTL + refresh + CSP. See `~/.claude/plans/give-me-plan-to-nifty-zephyr.md`.

## 🟠 Data correctness / logic

- [ ] **B1 · 🟠 `listAll` silently truncates at ~10.2k rows** (`lib/dataOps.ts:70`, MAX_PAGES=34)
  and returns `ok:true`. `ProductionLog` crosses it first → `designStock()` understates
  `available`, order/quote totals drop rows. Make the cap throw/warn instead of dropping.
- [ ] **B2 · 🟠 Duplicate Design `seq_code` under concurrency.** Client max+1 (`lib/seq.ts:4`);
  server uniqueness backstop is on `unique_name`, not `seq_code`. Assign `seq_code` atomically
  in the data-ops insert.
- [ ] **B3 · 🟠 `rateFor()` silently returns 1** for an unloaded/missing currency
  (`features/masters/currenciesApi.ts:112`) and persists as `exchange_rate` — EUR quote saved
  before the list resolves stores rate 1. Block save / error when the rate is unresolved.
- [ ] **B4 · 🟠 Hydration ignores `ok:false` on lookup lists.** `ordersApi.ts:64` (and quotes/
  production) check only the primary list; a transient 500 on Customer/Design paints a
  "successful" grid with blank fields. Check every list's `ok`, fail the whole load.
- [ ] **B5 · 🟠 Never-invalidated backend lookup cache.** Module-level `_cache`
  (`index.js:105`) survives warm invocations → a just-added Customer/Design resolves as
  "not found" until cold start. Invalidate on the relevant inserts.
- [ ] **B6 · 🟢 Client vs server per-line rounding mismatch** (`data.ts:229` unrounded per line
  vs server `round2`) — form preview total can differ from saved value by a cent. Round per line.
- [ ] **B7 · 🟢 GET dedupe can serve pre-mutation data** (`lib/api.ts:55`). Low priority.
- [ ] **B8 · 🟢 `loaded_qty` clamp can silently drop boxes** (`index.js:2266`).

## 🟡 UX / UI consistency (against our own standards)

- [ ] **C1 · 🟡 Combobox-only violated.** Raw `<select>` in `OrderForm.tsx:343`,
  `QuoteForm.tsx:293`, `PartyForm.tsx` (6 fields), `ContainerForm`, `DispatchForm`,
  `LoadContainerForm`; bespoke `<input list=datalist>` for box_branding. Migrate all to
  `ui/Combobox`; source Container type/status from a master, not static arrays.
- [ ] **C2 · 🟡 AdvancedFilter missing** on Sizes, Containers, Pallets, PurchaseOrders grids.
- [ ] **C3 · 🟡 No sortable headers** on Sizes/Containers/Pallets (and DesignMaster) — decide
  masters-wide and apply uniformly (`SortTh` + `useSortRows`).
- [ ] **C4 · 🟡 Whole-row-click missing** on PurchaseOrders (`:175`) and Invoices;
  Invoices still uses inline per-row action buttons; Parties carries a redundant legacy filter
  bar alongside AdvancedFilter (`Parties.tsx:200`); PurchaseOrderDetail lacks the More menu.

## 🟢 Architecture / performance / quality

- [ ] **D1 · 🟢 O(designs × orders) stock report** — `Reports.tsx` re-filters all orders+prodLogs
  per design (`lib/stock.ts:43`). Pre-group into Maps once, pass pre-filtered slices.
- [ ] **D2 · 🟢 "Fetch all, join in browser" everywhere** — dedupe the shared `mapBy`/`str`/`num`
  hydration; long-term push joins server-side.
- [ ] **D3 · 🟢 God components** — QuoteDetail (834), Reports (827), ItemDetail (760),
  PartyForm (729). Split fetch/state/render as touched.
- [ ] **D4 · 🟢 "Party" naming debt** — `PartyForm`, `/parties`, `PartyBrand` still say Party
  while UI says Customer. Rename component/route/file for consistency (live code, nothing to delete).
- [ ] **D5 · 🟢 `DSRow = {[col]:unknown}` unvalidated** (~138 `as` casts). Add a per-entity
  parse at the fetch boundary so bad shapes fail loudly.
- [ ] **D6 · 🟢 401 → hard `window.location.reload()`** (`api.ts:27`) loses form state / risks a
  reload loop; ErrorBoundary wraps only `<main>` (`App.tsx:404`); no typecheck-in-CI, near-zero tests.

---

## Recommended order

1. A1, A2 — closes the real exposure, tightly-scoped backend diffs.
2. B1, B3, B4 — silent-wrong-data.
3. C1 — most visible consistency win.
4. Remainder opportunistically as we touch each area.
