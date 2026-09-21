# Code review 2026-09-19 — findings and fix status

Review of the uncommitted `feature/master-order-forms` diff (CR-194…204).
Verdict: **C** = confirmed by reading the code, **P** = plausible, not confirmed.
Nothing here was reproduced at runtime. Status is updated as fixes land.

Status key: `Open` · `Fixed` (code changed, typecheck + tests pass) · `Needs decision` (behaviour choice is the user's).

## Correctness

| # | Where | Finding | V | Status |
|---|-------|---------|---|--------|
| 1 | `functions/data-ops/index.js:3583` | `/send-to-loading` cap is `min(ordered, produced) − palletized`; it does not subtract boxes already on a Planning/Palletizing line, so allocated boxes can be sent twice (200 boxes on a 100-box order). Pre-dates this diff; comment at :3596 is stale. **Comment corrected + gap flagged in code; the cap itself is unchanged.** | C | Needs decision |
| 2 | `client/src/features/quotes/PlanContainerisation.tsx:1173, 1288, 1294` | Reseed mappers copy `group` but not `over`; a CR-196 overridden container spills into a new one on reopen. **Fix: all three mappers now copy `over: g.over`.** | C | Fixed |
| 3 | `client/src/features/masters/vehiclesApi.ts:105` | `resolveVehicle` patches the shared Vehicle master's driver/mobile; LoadBox has no snapshot, so past dispatched loadings show the new driver. | C | Needs decision |
| 4 | `client/src/features/orders/AllocateStockModal.tsx:63` | Free batches matched by `designName`; server checks by Design ROWID and `design_name` is not unique across sizes. Same first-match-by-name in `ToProduce.tsx:39`. **Fix: modal joins on `designLabel === o.design` (unique_name) and brand lookup keys on `designId`. `ToProduce.tsx:39` untouched — design_name is the documented stock key there.** | C | Fixed (modal) · ToProduce open |
| 5 | `functions/data-ops/index.js:3994` | `/allocate-stock` is check-then-write on a stale `produced` read; double-click or two users over-claim and lose a counter update. | P | Needs decision |
| 6 | `functions/data-ops/index.js:1249` | SO cancel swallows every `deallocateCore` error; client busts only the orders cache after a cancel. **Fix: failures are now logged (`cancel dealloc`), and a cancel busts the production-log, pal-plans and batch-stock caches. Still best-effort — user is not told a claim stayed behind.** | C | Partly fixed |
| 7 | `functions/data-ops/index.js:3916` (+ `batchStockDerive.ts`, `lib/stock.ts:108`) | Surplus production and a cancelled SO's `record` rows stay reserved forever — never offered as free stock. | C | Needs decision |
| 8 | `functions/data-ops/index.js:3317`, `:2573` | Line splits (partial load remainder, partial-palletise slice) drop `box_brand` and `pallet_no`. **Fix: `box_brand` is fetched and copied at all FOUR split sites (incl. `/pal-topup`). CORRECTION: `pallet_no` is deliberately not carried (DATASTORE-SCHEMA.md) — a typed range belongs to one line; left as is.** | C | Fixed |
| 9 | `functions/data-ops/index.js:3628` | `/send-to-loading` ignores the `brand` that `unqueuedBatches` returns; lines are inserted without `box_brand`. **Fix: `brand` destructured and written as `box_brand`, same rule as the auto-enqueue.** | C | Fixed |
| 10 | `functions/data-ops/index.js:2127` | `assertPlanWithinOrdered` still caps at ordered qty, so a manual PalPlan bypasses the CR-199 allocated-only cap. | P | Needs decision |
| 11 | `client/src/features/stages/ProductionTable.tsx:263`, `ProductionDetail.tsx:121` | On a partial `recordNewProduction` failure the handler returns before reloading; the created job is invisible and a retry duplicates line 1. **Fix: when the job was created (`res.data`), both handlers show the error then refresh / open the job.** | C | Fixed |
| 12 | `client/src/features/panels/PanelOrderForm.tsx:210`, `PanelOrders.tsx:98` | Save has no in-flight guard during the sequential multi-create (double-click duplicates orders); a partial save closes the form without saying which panel failed. **Fix: form holds a `saving` guard across the whole run; the toast names the panels that did not save.** | C | Fixed |
| 13 | `client/src/features/stages/LoadingSession.tsx:121` | `void load(); navigate(...)` — going Back before the reload lands remounts step 2 from the pre-save box and the next Save blanks the capture fields. **Fix: parent awaits the reload before navigating (never strands on a failed reload); both steps stay busy through the hand-off so Save cannot fire twice.** | P | Fixed |
| 14 | `client/src/features/stages/SessionItemsStep.tsx:155` | `createLoadBox({ load_plan })` no longer sends `container_size`; Size can dispatch blank. | P | Needs decision |
| 15 | `client/src/features/quotes/PlanContainerisation.tsx:462` | Override stamps `over` on every row of the group; an oversized grouped row then lands whole in one container. | P | Needs decision |
| 21 | `client/src/lib/needProduction.ts:68` | First-come sort uses `Number()` on 17-digit ROWIDs (above 2^53); close ids compare equal. | P | Open (low) |

## Efficiency

| # | Where | Finding | V | Status |
|---|-------|---------|---|--------|
| 16 | `client/src/features/masters/LineStock.tsx:27` | `useStockLookup` returns a fresh closure each render and rebuilds the alloc map per call; downstream memos never hit. **Fix: alloc map built once per render, designs indexed by name. NOT memoized across renders on purpose — the alloc cache changes without local state changing, so a cross-render memo would show stale allocations.** | C | Partly fixed |
| 17 | `client/src/features/orders/AllocateStockModal.tsx:97` | One `/allocate-stock` invocation per order line; a 429 mid-loop leaves the SO half-allocated. | P | Needs decision |
| 18 | `client/src/features/masters/vehiclesApi.ts:85` | Full Vehicle fetch on every `resolveVehicle` call (once per edited container); dedupe is client-only. | C | Open |

## Reuse / simplification

| # | Where | Finding | V | Status |
|---|-------|---------|---|--------|
| 19 | `LoadingBay.tsx:1267`, `LoadingDetail.tsx:490`, `SessionItemsStep.tsx:50,124` | Hand-built `initialCapture` instead of `captureOf(box)`; re-implemented `palletsOf`/`boxFill` and `useBoxBrands()`. **Fix: both modals use `captureOf(box)` (verified field-for-field identical). SessionItemsStep reuse not done.** | P | Partly fixed |
| 20 | `functions/data-ops/index.js:1143` | `enqueueSoProduction` starts with `return;`, keeps ~45 dead lines, four live call sites and a stale comment at :1239. **Stale comment at the call site corrected. Dead body + calls kept — the existing `ponytail:` note says they are kept for rollback on purpose.** | C | Comment fixed |

## Verification (2026-09-19)

Before and after the fixes: `tsc --noEmit` clean, all 14 self-checks (`*.test.ts` / `*.check.ts`) pass,
`node --check functions/data-ops/index.js` clean, and a throwaway `vite build` succeeds.
**Not done:** nothing was driven in the running app and nothing was deployed — the server fixes
(#6, #8, #9) only take effect after the function is deployed.

## Decisions needed

- **#1** Send to Loading vs. already-queued boxes: should a send *consume* the matching Planning cards
  (recommended), or should queued boxes simply be excluded from what can be sent?
- **#3** Driver/mobile history: add `driver_name` + `mobile_number` snapshot columns on LoadBox
  (recommended; needs two Data Store columns), or accept that the master is the single truth.
- **#5 / #17** Make `/allocate-stock` take all lines in one call and re-read `produced` just before
  the write. Narrows the race; Catalyst has no transactions, so it cannot fully close it.
- **#7** When is produced stock released from an order: cap the claim at ordered qty, and release
  claims of Cancelled orders? Changes the free-stock numbers on three screens.
- **#10** Should a manual PalPlan be capped at allocated boxes like Send to Loading now is?
- **#14** New loadings without a size: stamp the default container type (old behaviour) or add Size
  to the step-3 missing-details check (recommended — no silent wrong value).
- **#15** Override scope: should `over` apply only to the moved row rather than the whole group?
