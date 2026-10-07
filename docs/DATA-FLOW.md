# BOFFO Order OS — Data Flow (who may change what, and where the rule lives)

**Status:** snapshot **2026-10-03**, branch `feature/master-order-forms`, working tree after CR-271.
Line numbers point at that tree; re-grep the symbol if a number drifts.

The recurring failure in this project is a rule enforced on one path and absent on its sibling.
Today's example (CR-271): removing a Sales Order line was refused on the SO form once work was
recorded (CR-232), while the SO page's **Delete** went through the generic table route and knew
nothing about work. Same entity, two paths, two rule sets.

This file is the checklist that prevents that. For every business entity it lists **every path**
that can create, edit, delete or re-status it — server route and client surface — and names the
**one place** each rule is supposed to live. Before changing how an entity is mutated, read its row
here and touch every path in it. `SYSTEM.md §5` tells the story; this file is the audit.

---

## 0 · How to use this file

1. **Adding a rule** → implement it once, in the helper named in §2, and call that helper from
   every path in the entity's §3 row. Never inline a rule in one route or one component.
2. **Adding a path** (a new route, a new button, a new bulk action, a new sheet) → add it to the
   entity's §3 row in the same commit, and inherit the row's guards.
3. **Generic-route policy.** An entity that has a dedicated business route is either
   **banned** from the generic `POST / PATCH / DELETE /:table` routes (the `LoadBox` pattern,
   [`index.js:5727`](../functions/data-ops/index.js#L5727), [`:5829`](../functions/data-ops/index.js#L5829),
   [`:6008`](../functions/data-ops/index.js#L6008)) **or** the generic route calls the same helper.
   Either is fine. *Neither* is the bug.
4. **Client layering.** Only `features/**/*Api.ts` may import `insert` / `update` / `remove` from
   [`lib/dataOps.ts`](../client/src/lib/dataOps.ts#L113). A component that calls them directly has
   stepped around every guard the Api wrapper carries.
5. **A fixed divergence** gets its §5 row marked Done with the commit. Rows are never deleted.

---

## 1 · The two layers

```
  client surface ──► features/**/*Api.ts ──► lib/dataOps  op()      ──► dedicated route  ──► rule helpers ──► Data Store
  (form / detail /                           lib/dataOps  insert/   ──► generic /:table  ──► allowlists only ──► Data Store
   grid / bulk / sheet /                                  update/remove
   modal / kanban / "+")
```

The left column is where **client** guards live (`can()`, `worked`, `dispatchGate`, `confirm*`).
The right column is where **server** guards live. A rule that exists only on the left is a
suggestion; a rule that exists only on one right-hand route is a divergence.

### 1.1 Server — generic routes and what they check

| Route | Line | Guards applied | Not applied |
|---|---|---|---|
| `GET /:table` | [5608](../functions/data-ops/index.js#L5608) | `assertTable`, `assertWhere`, `assertOrder`, column allowlist, `deleted_at is null`, LIMIT 300 | — |
| `GET /:table/:rowid` | [5658](../functions/data-ops/index.js#L5658) | `assertTable`, `rowidParam` | no `deleted_at` filter |
| `POST /:table` (+ `rows[]` bulk) | [5723](../functions/data-ops/index.js#L5723) | bans LoadBox, PanelLine, Quote, SalesOrder; `assertNoStateWrite` + `INSERT_INITIAL`; `assertNoNegatives`; `assertUnique(NATURAL_KEY)`; `withOpLog` | FK existence, line/doc totals, counter init, recount |
| `PATCH /:table/:rowid` | [5810](../functions/data-ops/index.js#L5810) | `assertNoStateWrite` (status-ish columns only, [`STATE_COLUMNS:5703`](../functions/data-ops/index.js#L5703)); bans PanelLine, LoadBox; `Design.is_batched` flip guard; `assertNoNegatives`; `assertUnique`; OrderItem `stage` → `logTransition`; `Size` → `propagateSizeSnapshots` | **any qty counter, `batch_number`, `entry_type`, `boxes`, `pallet` is writable**; no recount; no status machine for tables outside `STATE_COLUMNS` |
| `DELETE /:table/:rowid` | [6004](../functions/data-ops/index.js#L6004) | bans LoadBox; Panel/PanelLine soft-ban; `deleteReason` (CR-270); **SalesOrder work guard** (CR-271, [6025](../functions/data-ops/index.js#L6025)); `BLOCK_DELETE` ([408](../functions/data-ops/index.js#L408)); `withOpLog`; `recountAfterParentToggle` (headers only) | work guard for OrderItem; recount for *line* tables; `?hard=1` physically deletes after the same checks |
| `POST /:table/:rowid/restore` | [6103](../functions/data-ops/index.js#L6103) | `assertTable`, `withOpLog`, `recountAfterParentToggle` | **nothing else** — no reason, no state check, no re-link of disassociated children, no doc-total recompute |
| `POST /resync-size-snapshots` | [5682](../functions/data-ops/index.js#L5682) | — | no Admin check, no `withOpLog`, overwrites manual box-weight overrides |
| `POST /seed/masters` | [6137](../functions/data-ops/index.js#L6137) | per-block natural-key dedupe | not in `ROUTE_PERM`, no `withOpLog` |

Request-level authorisation sits in front of all of these:
[`appauth.js:132`](../functions/data-ops/lib/appauth.js#L132) `ROUTE_PERM` (business routes),
[`:105`](../functions/data-ops/lib/appauth.js#L105) `TABLE_MODULE` (generic routes). A business
route **absent** from `ROUTE_PERM` falls to the legacy `can_update` / `can_delete` role flags — see DF-05.

### 1.2 Client — generic helpers and who bypasses the Api layer

| Helper | Line | Meant to be called from |
|---|---|---|
| `insert(table, payload)` | [`dataOps.ts:113`](../client/src/lib/dataOps.ts#L113) | `*Api.ts` only |
| `update(table, rowid, patch)` | [`dataOps.ts:122`](../client/src/lib/dataOps.ts#L122) | `*Api.ts` only |
| `remove(table, rowid, reason?)` | [`dataOps.ts:137`](../client/src/lib/dataOps.ts#L137) | `*Api.ts` only (CR-270 reason) |
| `op(path, body)` | [`dataOps.ts:147`](../client/src/lib/dataOps.ts#L147) | `*Api.ts` only |

Components that write through `lib/dataOps` directly today (DF-10):

| Component | Line | Writes |
|---|---|---|
| `quotes/PlanContainerisation.tsx` | [1313](../client/src/features/quotes/PlanContainerisation.tsx#L1313) | `update("SalesOrder", {container_plan})` |
| `stages/LoadingCustomerSheet.tsx` | [187](../client/src/features/stages/LoadingCustomerSheet.tsx#L187), [195](../client/src/features/stages/LoadingCustomerSheet.tsx#L195) | `update("PalletizationPlanLine", {pallet_no, pallet_type})`, `update("SalesOrder", {po_number})` |
| `masters/ItemDetail.tsx` | [232](../client/src/features/masters/ItemDetail.tsx#L232), [250](../client/src/features/masters/ItemDetail.tsx#L250), [286](../client/src/features/masters/ItemDetail.tsx#L286) | `update("Design", …)` opening stock / images / status |
| `panels/PanelDetail.tsx` | [97](../client/src/features/panels/PanelDetail.tsx#L97) | `update("Panel", {image_urls})` |
| `masters/LoadBoard.tsx` | [105](../client/src/features/masters/LoadBoard.tsx#L105) | `update("ContainerLoading", {container})` on drag — no `can()` |
| `masters/DesignForm.tsx` | [336](../client/src/features/masters/DesignForm.tsx#L336) | `insert("PartyBrand", {name})` — no `can()` |

---

## 2 · Rule owners — the single-source register

One row per rule. "Called from" is where it is enforced today; "Gap" is a path in §3 that should
call it and does not. Fix the gap by adding the call, not by copying the rule.

### 2.1 Server

| Rule | Owner | Called from | Gap |
|---|---|---|---|
| A line with work (produced / purchased / palletized / loaded / dispatched > 0, or on a plan line) keeps its item, its qty floor, and cannot be removed (CR-232) | `hasWork` [1386](../functions/data-ops/index.js#L1386) inside `/update-so-with-items`; mirrored for the whole order in `DELETE /SalesOrder` [6025](../functions/data-ops/index.js#L6025) (CR-271) | `/update-so-with-items`, `DELETE /SalesOrder` | `DELETE /OrderItem` (generic), `/delete-order-item` (DF-01) |
| Counters `palletized / loaded / dispatched_qty_boxes` + OrderItem stage promotion are **recomputed, never incremented** | `recountOrderItems` [1835](../functions/data-ops/index.js#L1835) → `rollupSoStatus` [1805](../functions/data-ops/index.js#L1805) | 19 business routes + `recountAfterParentToggle` | `PATCH /OrderItem` can set them directly (DF-02); generic `DELETE` of a *line* table does not recount (DF-02) |
| `produced_qty_boxes` ≤ ordered; allocation ≤ free stock | `/production-record` [4461](../functions/data-ops/index.js#L4461), `/production-record-lines`, `/allocate-stock` [4193](../functions/data-ops/index.js#L4193) + `serverFreeStock` [4125](../functions/data-ops/index.js#L4125) | those routes | `/production-complete` is uncapped by design [4802](../functions/data-ops/index.js#L4802); `PATCH /OrderItem` and `PATCH /ProductionLog` bypass (DF-02) |
| Downstream-reference delete block | `BLOCK_DELETE` [408](../functions/data-ops/index.js#L408) | `DELETE /:table` only | Design row misses PlanLine / PanelLine / CutPieceStock / DesignPallet (DF-13); dedicated delete routes do not consult it |
| Delete needs a reason unless Admin (CR-270) | `deleteReason` [375](../functions/data-ops/index.js#L375) | `DELETE /:table`, `/panel-delete`, `/load-box-delete`, `/production-delete` | `/delete-order-item`, `/restore` |
| Quote / SO status graph + approval authority | `QUOTE_TRANSITIONS` [1089](../functions/data-ops/index.js#L1089), `SO_TRANSITIONS` [1214](../functions/data-ops/index.js#L1214), `canApprove` [1099](../functions/data-ops/index.js#L1099) | `/quote-status`, `/so-status` (manual jump allowed with reason, CR-231) | `rollupSoStatus` uses `SO_RANK` promote-only ([`soStatus.js:8`](../functions/data-ops/lib/soStatus.js#L8)); `/convert-quote` writes `Converted` states outside the graph (by design, DF-04b) |
| Plan status graph; vehicle required before Completed | `PAL_TRANSITIONS` [2697](../functions/data-ops/index.js#L2697) in `/pal-status` | `/pal-status` (**dead client-side**) | `setPlanStatus` [3261](../functions/data-ops/index.js#L3261) writes the column with no graph and no vehicle gate, from 5 loading routes (DF-04) |
| Plan line status graph + partial split (partial Palletizing→ReadyToLoad remainder → Planning, CR-281) | `PAL_LINE_TRANSITIONS` [2703](../functions/data-ops/index.js#L2703) | `/pal-line-status` | — |
| Σ plan boxes ≤ ordered; pallet mandatory; FIFO batch attribution | `assertPlanWithinOrdered` [2257](../functions/data-ops/index.js#L2257), `normalizePlanLines` [2224](../functions/data-ops/index.js#L2224), `attributeBatches` [2342](../functions/data-ops/index.js#L2342) | `/pal-plan`, `/update-pal-plan` | `POST / PATCH /PalletizationPlanLine` generic (DF-02) |
| Duplicate batch number (per item, 2 tiers) + series mint | `assertBatchesAllowed` [2191](../functions/data-ops/index.js#L2191), `nextBatchNumber` [2164](../functions/data-ops/index.js#L2164) | record / complete / opening-stock routes | `PATCH /ProductionLog.batch_number`; `POST /ProductionLog` generic (DF-02, DF-14) |
| Opening stock locks after first save; Admin + reason to re-edit | `/opening-stock/:designId` [4685](../functions/data-ops/index.js#L4685) | that route | `POST /ProductionLog {entry_type:"opening"}` generic (DF-14) |
| Box dispatch gate: Open, has vehicle, non-empty; plan → Completed | `/load-box-dispatch` [3448](../functions/data-ops/index.js#L3448) | that route | — (generic LoadBox banned ✔) |
| Line → box: box Open, line ReadyToLoad, n ≤ line, dispatched box immutable | `/pal-line-box` [3660](../functions/data-ops/index.js#L3660), `/pal-lines-box` all-or-nothing [3600](../functions/data-ops/index.js#L3600) | both routes | `PATCH /PalletizationPlanLine.load_box` is blocked by `STATE_COLUMNS` ✔ |
| One invoice per container; `TransactionSeries` mint | `/invoice-for-container` [5415](../functions/data-ops/index.js#L5415) | that route | `POST /Invoice` generic mints without bumping the series (DF-18) |
| Size packing fan-out preserves manual overrides | `propagateSizeSnapshots(oldBw)` [5769](../functions/data-ops/index.js#L5769) | `PATCH /Size` | `/resync-size-snapshots` calls it without `oldBw` (DF-19) |
| Audit: every write wrapped, fan-out onto SO + plan | `withOpLog` [305](../functions/data-ops/index.js#L305), `logRelated` [243](../functions/data-ops/index.js#L243) | all dedicated routes, generic CRUD | `/seed/masters`, `/resync-size-snapshots` |

### 2.2 Client

| Rule | Owner | Called from | Gap |
|---|---|---|---|
| Permission per module × action | `can()` [`auth.ts:146`](../client/src/lib/auth.ts#L146), `canApprove()` [`:156`](../client/src/lib/auth.ts#L156), `isAdmin()` [`:140`](../client/src/lib/auth.ts#L140) | ~100 sites | `invoices` and `settings` modules are declared but never checked; `Invoices.tsx`, `AdvanceButton.tsx`, `LoadBoard.tsx` check nothing (DF-12) |
| Delete asks a reason unless Admin (CR-270) | `confirmDelete()` [`ConfirmDialog.tsx:77`](../client/src/ui/ConfirmDialog.tsx#L77) | every delete call site (26) | — |
| Discard is a Yes/No question (CR-268) | `confirmDiscard()` [`ConfirmDialog.tsx:61`](../client/src/ui/ConfirmDialog.tsx#L61) | `FormPage`, every sheet edit exit | — |
| SO line with work: item frozen, qty floor, not removable | per-line `worked` [`OrderForm.tsx:180`](../client/src/features/orders/OrderForm.tsx#L180); whole-order `workRecorded` [`OrderDetail.tsx:425`](../client/src/features/orders/OrderDetail.tsx#L425) | OrderForm remove/swap, OrderDetail Delete | `OrdersTable` bulk delete [282](../client/src/features/orders/OrdersTable.tsx#L282) (DF-06) |
| Box may dispatch only when Open + vehicle + lines | `dispatchGate()` [`palPlansApi.ts:135`](../client/src/features/stages/palPlansApi.ts#L135), `missingLoadDetails()` [`:144`](../client/src/features/stages/palPlansApi.ts#L144) | LoadingBay, LoadingDetail | `LoadingPlanPage` re-implements the eight fields inline |
| Seal numbers unique across boxes | `duplicateSeals` (`sealChecks.ts`) | LoadingSession, LoadingPlanPage | LoadingBay `VehicleLoadModal`, LoadingCustomerSheet (DF-09) |
| Record-output cap and duplicate batch check | `capFor` (`productionSheetEdit.ts:28`), `batchNumberExists` [`productionApi.ts:131`](../client/src/features/stages/productionApi.ts#L131) | RecordOutputForm, /prod sheet edit | `ProductionImport` (DF-16), `/prod/record` sheet (mints own jobs — cap N/A, dup check missing) |
| Sheet edits resolve through one pure resolver per sheet | `resolveSheetEdit`, `resolvePalSheetEdit`, `resolveLoadSheetEdit`, `resolveCustomerSheet`, `resolveLogSheet` | the five sheets | — |
| Convert-to-SO only from Accepted / PartiallyConverted | `convertible()` (`data.ts`) | QuoteDetail, OrderFormPage | — |

---

## 3 · Entity matrix

Columns: **Mutation** · **Server path(s)** · **Client surface(s)** · **Rule(s) enforced** ·
**Parity** — `SAME` (every path enforces the row's rules) · `DIFFERENT` (a path is missing a rule;
named) · `BANNED` (generic route refuses the table) · `DEAD` (no client caller) · `SINGLE` (one path).

### 3.1 Quote

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create | `POST /quote-with-items` [867](../functions/data-ops/index.js#L867) | QuoteFormPage | `assertUnique`, `assertDateOrder`, `computeLines`, `docCompute`, `canApprove` → born status | SINGLE (generic `POST /Quote` BANNED [5730](../functions/data-ops/index.js#L5730)) |
| Edit header + lines | `POST /update-quote-with-items` [963](../functions/data-ops/index.js#L963) | QuoteFormPage [45](../client/src/features/quotes/QuoteFormPage.tsx#L45); PlanContainerisation planner [1210](../client/src/features/quotes/PlanContainerisation.tsx#L1210) | approval reset → Draft; `converted_qty_boxes` carried | **DIFFERENT** — neither surface blocks editing lines of a `Converted` / `PartiallyConverted` quote; the grid bulk-status *does* skip them (DF-14) |
| Status | `POST /quote-status` [1105](../functions/data-ops/index.js#L1105) | QuoteDetail header buttons; QuotesTable bulk; Approvals | `QUOTE_TRANSITIONS`, `canApprove`, reject reason | SAME |
| Convert → SO | `POST /convert-quote` [1626](../functions/data-ops/index.js#L1626) | OrderFormPage (quote mode) | status gate, cumulative over-conversion cap | SINGLE |
| Delete | `DELETE /Quote` generic + `BLOCK_DELETE.Quote` (SalesOrder only) | QuoteDetail More; QuotesTable bulk | `can`, `confirmDelete` | SAME between surfaces; no status rule on either |
| Share token | `PATCH /Quote {share_token}` generic | QuoteDetail More | — | SINGLE |
| `updateQuote` (generic PATCH) | — | — | — | DEAD ([`quotesApi.ts:204`](../client/src/features/quotes/quotesApi.ts#L204)) |

### 3.2 QuoteItem

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Replace lines | inside `/update-quote-with-items` | as above | `computeLines`, totals, `converted_qty_boxes` carry | — |
| Generic CRUD | `POST / PATCH / DELETE /QuoteItem` | none | `NATURAL_KEY` only; no quote total recompute | **DIFFERENT** (no UI today; close by banning, DF-02) |

### 3.3 SalesOrder

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create | `POST /so-with-items` [1315](../functions/data-ops/index.js#L1315) → `createSalesOrder` [1536](../functions/data-ops/index.js#L1536); `/convert-quote` | OrderFormPage; quote conversion | `nextOrderNumber`, `assertUnique`, `computeLines`, `docCompute`, `canApprove` | SINGLE (generic `POST /SalesOrder` BANNED [5731](../functions/data-ops/index.js#L5731)) |
| Edit header + lines in place (CR-232) | `POST /update-so-with-items` [1353](../functions/data-ops/index.js#L1353) | OrderFormPage [65](../client/src/features/orders/OrderFormPage.tsx#L65) | `hasWork`: item frozen, qty floor, no removal, no removal while on a plan line; approval reset unless worked; `recountOrderItems(allowDemote)` | SAME (server + form agree) |
| `container_plan` | `PATCH /SalesOrder` generic | PlanContainerisation [1313](../client/src/features/quotes/PlanContainerisation.tsx#L1313) | `can("orders","edit")` | SINGLE — no status check (a Cancelled SO's plan is writable). JSON carries `formats` (Size → ContainerFormat) + per-container `containerFormat` since CR-274; readers pass unknown keys through |
| `po_number` | `PATCH /SalesOrder` generic | LoadingCustomerSheet [195](../client/src/features/stages/LoadingCustomerSheet.tsx#L195) | `can("stages","edit")` | **DIFFERENT** from OrderForm — a stages-only role edits an orders field (DF-10) |
| Status | `POST /so-status` [1225](../functions/data-ops/index.js#L1225) | OrderDetail header buttons (graph); ChangeStatusModal + OrdersTable bulk (`manual=true`, reason); Approvals | `SO_TRANSITIONS`, manual jump + reason (CR-231), `canApprove`, Cancelled → `deallocateCore` | SAME by design (manual path is deliberate) |
| Auto roll-up | `rollupSoStatus` [1805](../functions/data-ops/index.js#L1805) | — | `SO_RANK` promote-only | SINGLE |
| **Delete** | `DELETE /SalesOrder` generic: `deleteReason`, **work guard [6025](../functions/data-ops/index.js#L6025)** (CR-271), `BLOCK_DELETE.SalesOrder` (own lines, ProductionLog, PalletisedBatch, Invoice) | OrderDetail More [623](../client/src/features/orders/OrderDetail.tsx#L623) (`disabled: workRecorded`); OrdersTable bulk [282](../client/src/features/orders/OrdersTable.tsx#L282) | server 409 on work; `confirmDelete` | **DIFFERENT** on the client: bulk lacks `workRecorded` (DF-06). Note DF-20: own lines in `BLOCK_DELETE` make a clean draft SO undeletable too |
| Allocate / deallocate stock (CR-199, CR-263) | `/allocate-stock` [4162](../functions/data-ops/index.js#L4162), `/deallocate-stock` [4314](../functions/data-ops/index.js#L4314) | AllocateStockModal; DeallocateStockModal (More + per-line ✕); Production tab ✕ | SO status gate, room ≤ ordered−produced, `serverFreeStock`; dealloc refuses once palletised | SAME |
| Send to loading (skip palletization) | `/send-to-loading` [3738](../functions/data-ops/index.js#L3738) | SendToLoadingModal | box Open, items belong to SO, cap ordered ∧ produced − palletized | SINGLE |

### 3.4 OrderItem (SO line)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create | inside `createSalesOrder` / `/update-so-with-items` | OrderForm | `computeLines`, zeroed counters | **DIFFERENT** — generic `POST /OrderItem` [5723](../functions/data-ops/index.js#L5723) creates a line with no totals, no counters, no SO recompute (DF-02) |
| Edit qty / item / rate | `/update-so-with-items` | OrderForm | `hasWork` floor + frozen item | **DIFFERENT** — generic `PATCH /OrderItem` can set `ordered_qty_boxes` and every counter; only `stage` is special-cased (DF-02) |
| **Delete** | (a) `/update-so-with-items` removal branch [1416](../functions/data-ops/index.js#L1416): `hasWork` + plan-line check → 409; (b) `/delete-order-item` [5906](../functions/data-ops/index.js#L5906): last-line 409, **disassociates** production, recomputes SO total, no work guard; (c) generic `DELETE /OrderItem` + `BLOCK_DELETE.OrderItem` (ProductionLog only) | (a) OrderForm ✕ (disabled when `worked`); (b) **no caller** ([`ordersApi.ts:328`](../client/src/features/orders/ordersApi.ts#L328)); (c) none | three different rule sets | **DIFFERENT ×3** (DF-01 — agreed next fix) |
| `stage` | generic `PATCH /OrderItem {stage}` → `logTransition`; also promoted by `recountOrderItems` | `AdvanceButton` [30](../client/src/features/orders/AdvanceButton.tsx#L30) from ByOrderView + OrderDrawer | `NEXT_STAGE` existence only | **DIFFERENT** — no `can()`, no qty check; recount never demotes (DF-12) |
| Counters | `recountOrderItems` **sole writer** | — | derived from plan lines / boxes / batches | **DIFFERENT** — generic PATCH (DF-02) |

### 3.5 ProductionLog (plan rows, record rows, alloc rows, opening rows)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Start job (plan row) | `/production-log` [3915](../functions/data-ops/index.js#L3915) | ProductionFormPage; `/prod/record` sheet (ProductionLogSheet); ProductionImport | qty > 0, supersede untouched auto jobs, stage ∈ {New, InProduction} | SAME on the route; Import force-sets Completed |
| Record output | `/production-record` [4419](../functions/data-ops/index.js#L4419), `/production-record-lines` [4525](../functions/data-ops/index.js#L4525) | RecordOutputForm (from /prod "+" menu, kanban drag → Completed, sheet stage → Completed, ProductionDetail More); /prod sheet edit Save; `/prod/record`; ProductionImport | remaining cap, **ordered cap**, `brandOrNull`, `assertBatchesAllowed`, `nextBatchNumber`, `autoStepProductionStage`, `autoEnqueuePalletization` | **DIFFERENT** on the client: Import has no `capFor`, no duplicate-batch check (DF-16); server caps still hold |
| Complete | `/production-complete` [4767](../functions/data-ops/index.js#L4767) | ProductionCompleteForm; `/prod/record` | **no remaining cap by design**, batch guard only if typed | SAME |
| Stage move | `/production-stage` [4724](../functions/data-ops/index.js#L4724) | ProductionDetail select; /prod kanban drag, inline select, sheet edit, "+" menu | `PRODUCTION_STAGES` allowlist (no from→to matrix); Completed re-routed to capture dialog on every surface | SAME |
| Edit plan qty | `/production-update` [4867](../functions/data-ops/index.js#L4867) | ProductionEditForm (locked when any record row exists); /prod sheet edit (locked when `producedSoFar > 0`) | plan-only, no change after record, request ≤ ordered | DIFFERENT (near-equivalent locks: "any record row" vs "produced > 0") |
| **Delete** | `/production-delete` [4024](../functions/data-ops/index.js#L4024): `deleteReason`, `serverFreeStock` allocation check, `newProduced < palletized` 409, cascades children, reverses produced | ProductionDetail More (`!palletised`); ProductionTable bulk (`independent \|\| status !== "Produced"`) | as left | **DIFFERENT** — detail and bulk use different client predicates (DF-07); generic `DELETE /ProductionLog` has none of the server rules and no cascade (DF-02) |
| Opening stock | `/opening-stock/:designId` [4654](../functions/data-ops/index.js#L4654) | OpeningStockForm (ItemDetail) | lock-after-first, Admin + reason, `assertBatchesAllowed` | **DIFFERENT** — generic `POST /ProductionLog {entry_type:"opening"}` bypasses the lock (DF-14) |
| Alloc rows | `/allocate-stock`, `deallocateCore` [4261](../functions/data-ops/index.js#L4261) | see SalesOrder | claim-never-supply | SAME |
| Approve / reject (retired) | `/production-status/:group` [4336](../functions/data-ops/index.js#L4336) | Approvals | `canApprove("Production")` never granted (`APPROVABLES` = Quote, SalesOrder) | DEAD in effect |
| Any column | generic `PATCH /ProductionLog` | none | `assertNoNegatives` only | **DIFFERENT** — `qty_boxes`, `batch_number`, `entry_type`, `status` all writable (DF-02) |

### 3.6 PalletizationPlan (PAL/FY/NNN)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create | `/pal-plan` [2413](../functions/data-ops/index.js#L2413) → `createPalPlan` [2374](../functions/data-ops/index.js#L2374); `ensureOpenPlan` (from `/send-to-loading`, `autoEnqueuePalletization`) | PalPlanFormPage (New / clone); auto-enqueue | `nextPalNumber`, `assertUnique`, `normalizePlanLines`, `attributeBatches`, `assertPlanWithinOrdered`, born Planning | SINGLE |
| Edit header + Planning lines | `/update-pal-plan` [2632](../functions/data-ops/index.js#L2632) | PalPlanFormPage (Edit blocked when Completed) | advanced lines preserved, last-line 409, recount both sets | SAME |
| Status | `/pal-status` [2709](../functions/data-ops/index.js#L2709) (`PAL_TRANSITIONS`, vehicle before Completed) **vs** `setPlanStatus` [3261](../functions/data-ops/index.js#L3261) from `/pal-line-box`, `/pal-lines-box`, `/load-box-delete`, `/load-box-dispatch`, `/send-to-loading` | `setPalStatus` DEAD; status follows loading automatically | two graphs | **DIFFERENT** (DF-04); generic PATCH blocked by `STATE_COLUMNS` ✔ |
| Vehicle | `/pal-vehicle` [3158](../functions/data-ops/index.js#L3158) | DEAD ([`palPlansApi.ts:495`](../client/src/features/stages/palPlansApi.ts#L495)) | plan must be Loading | DEAD |
| Delete | generic `DELETE /PalletizationPlan` + `recountAfterParentToggle` | PalPlanDetail More | `can`, `confirmDelete`, recount | SINGLE — **no Completed / palletised guard although Edit has one** (DF-17) |

### 3.7 PalletizationPlanLine

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create / boxes / pallet | via `/pal-plan`, `/update-pal-plan` | PalPlanForm | pallet mandatory, boxes > 0, FIFO batch, ≤ ordered | **DIFFERENT** — generic `POST / PATCH /PalletizationPlanLine` writes `boxes`, `pallet`, `order_item` with none of it (DF-02) |
| Line status / palletise / top-up | `/pal-line-status` [2757](../functions/data-ops/index.js#L2757), `/pal-topup` [3075](../functions/data-ops/index.js#L3075) | DispatchBoard kanban drag, PalletiseModal, sheet edit, "+" menu (`/packing` and `/palletizing` are one component) | `PAL_LINE_TRANSITIONS`, partial split (a partial Complete's remainder re-queues to Planning, CR-281), donor Planning, recount | SAME |
| `pallet_no`, `pallet_type` | generic `PATCH /PalletizationPlanLine` | LoadingCustomerSheet [187](../client/src/features/stages/LoadingCustomerSheet.tsx#L187) | `can("stages","edit")` | SINGLE but bypasses the Api layer; no plan/box status check (DF-10) |
| `load_box` | `/pal-line-box` [3641](../functions/data-ops/index.js#L3641), `/pal-lines-box` [3579](../functions/data-ops/index.js#L3579) | LoadingBay sheet / unload / empty; LoadingWorkspace select + modal; LoadingSession / SessionItemsStep save; LoadContainerModal (`useLoadFlow`) | box Open, line ReadyToLoad, n ≤ line, dispatched immutable, promote/demote plans, recount | SAME on the server; only the LoadingBay sheet runs `resolveLoadSheetEdit` client-side |
| Delete | via `/update-pal-plan`, `/load-box-delete` | — | recount, `demoteEmptyPlans` | **DIFFERENT** — generic `DELETE /PalletizationPlanLine` leaves counters stale (header-only recount, DF-02) |

### 3.8 LoadBox (LOAD/FY/NNN — the reference pattern)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create | `/load-box` [3268](../functions/data-ops/index.js#L3268) | LoadingSession, SessionItemsStep, LoadingWorkspace (3 spots), LoadContainerModal, SendToLoadingModal | `nextBoxNumber`, `nextLoadNumber`, born Open; `container_format` FK via `applyLoadBoxFields` (CR-273, also on update / dispatch); client prefills it from the SO plan's `containerFormat` on `?so=` open, Fill from plan and the Load dialog's new container — only while blank (CR-274) | SAME; generic POST **BANNED** ✔ |
| Edit load details (vehicle, seals, …) | `/load-box-update` [3350](../functions/data-ops/index.js#L3350) | LoadingBay `VehicleLoadModal`; LoadingSession; LoadingPlanPage; LoadingCustomerSheet; LoadingWorkspace | vehicle non-blank, capacity > 0 | **DIFFERENT** — `duplicateSeals` only on Session / PlanPage; Bay and customer sheet edit **dispatched** boxes (DF-09). Generic PATCH BANNED ✔ |
| Dispatch | `/load-box-dispatch` [3438](../functions/data-ops/index.js#L3438) | LoadingBay row More + box-grid More; LoadingDetail More | Open, vehicle, non-empty; `dispatchGate` + confirm on every surface | SAME |
| **Delete** | `/load-box-delete` [3390](../functions/data-ops/index.js#L3390): `deleteReason`, Open-only, un-allocates lines, `demoteEmptyPlans`, recount | LoadingBay (Open); LoadingDetail (Open); LoadingWorkspace (Open **and empty**) | as left | **DIFFERENT** on the client — Workspace requires an empty box, Bay/Detail do not (DF-08). Generic DELETE BANNED ✔ |
| Vehicle master write-through | `resolveVehicle` → generic `POST / PATCH /Vehicle` | 5 loading surfaces | none beyond host `canEdit` | **DIFFERENT** from Masters admin editor (DF-11) |

### 3.9 PalletisedBatch / Container / ContainerLoading (legacy flow — data still read)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Close pallet / combine | `/close-pallet` [1940](../functions/data-ops/index.js#L1940), `/combine-leftovers` [2033](../functions/data-ops/index.js#L2033) | `Palletizations.tsx` — **not routed** | compensation, events, recount | DEAD |
| Load / dispatch container | `/load-container` [4924](../functions/data-ops/index.js#L4924), `/dispatch/:rowid` [5062](../functions/data-ops/index.js#L5062) | no caller | capacity gates, batch status flips, recount | DEAD |
| `PalletisedBatch.status`, `Container.status` | generic PATCH (not in `STATE_COLUMNS`) | none | — | **DIFFERENT** — flips the exact values `recountOrderItems` reads (DF-02) |
| Container master rows | generic CRUD | Containers.tsx modal (New has `can`, **row-click edit has none**), bulk delete | `NATURAL_KEY` | DIFFERENT (DF-12) |
| ContainerLoading move | generic `PATCH /ContainerLoading` | LoadBoard drag [105](../client/src/features/masters/LoadBoard.tsx#L105) | **none** | SINGLE, no `can()` (DF-12) |

### 3.10 Invoice

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Generate | `/invoice-for-container` [5384](../functions/data-ops/index.js#L5384) | Invoices.tsx modal | one per container, has loadings, `nextSeriesNumber` | **DIFFERENT** — generic `POST /Invoice` skips the series bump (DF-18); no `can("invoices", …)` anywhere (DF-12) |
| Delete | generic `DELETE /Invoice` | Invoices.tsx row trash | `confirmDelete` only | SINGLE, no `can()` (DF-12) |

### 3.11 Design (Item master)

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Create / edit | generic `POST / PATCH /Design` | DesignEdit form; DesignMaster bulk edit; ItemDetail inline (status, images, opening stock) | `assertUnique(NATURAL_KEY)`, `assertNoNegatives`, `is_batched` flip guard, `propagateSizeSnapshots` on Size | SAME permission; ItemDetail opening stock adds `stockLocked`/Admin + reason, bulk edit has no per-field lock |
| Delete | generic `DELETE /Design` + `BLOCK_DELETE.Design` (QuoteItem, OrderItem, ProductionLog, PalletisedBatch) | ItemDetail More; DesignMaster bulk | `can`, `confirmDelete` | SAME between surfaces; **blocker list misses PalletizationPlanLine, PanelLine, CutPieceStock, DesignPallet** (DF-13) |
| `DesignPallet` join | generic (exempt from `deleteReason`) | reconciled on Item save | — | SINGLE |

### 3.12 Size · Pallet · ContainerFormat · Customer · Currency · generic Masters

| Entity | Server | Client surfaces | Rules | Parity |
|---|---|---|---|---|
| Size | generic; `PATCH` → `propagateSizeSnapshots(oldBw)`; `/resync-size-snapshots` (no `oldBw`, no Admin) | Sizes modal, SizeDetail modal, SizeDetail More delete, Sizes bulk delete | `NATURAL_KEY`, fan-out | **DIFFERENT** — resync clobbers manual overrides (DF-19) |
| Pallet | generic | PalletFormPage, PalletDetail More, Pallets bulk | `NATURAL_KEY`, `BLOCK_DELETE`? (none) | SAME |
| ContainerFormat (CR-261) | generic | ContainerFormatFormPage, ContainerFormatDetail More, ContainerFormats bulk | several per Size (CR-273; no `NATURAL_KEY`); capacity rule = `palPlansApi` line build: loading's `container_format` → else size's largest `total_boxes`; "largest" and the planner's per-size pick share ONE helper `resolveFormatBySize` (containerOptions.ts, CR-274) | SAME |
| Customer | generic + `BLOCK_DELETE.Customer` (Quote, SalesOrder) | PartyFormPage, CustomerDetail More (delete, active, addresses) | `can("customers", …)` | SAME |
| Currency | generic; `/fx-refresh` | Currencies admin modal | route `isAdmin` | SAME |
| Finish / Category / Glaze / Brand / PartyBrand / Grade / CutPieceSize / Vehicle / PaymentTerm | generic via `mastersApi` | Masters admin editor (`isAdmin`) **and** write-through creates: `resolveVehicle` (5 loading surfaces), `createCutSize` (PanelForm, CutStockForm), `insert("PartyBrand")` (DesignForm) | admin route gate only on the editor | **DIFFERENT** (DF-11) |

### 3.13 Panel Craft

| Mutation | Server | Client | Rules | Parity |
|---|---|---|---|---|
| Panel save / delete | `/panel-save` [2984](../functions/data-ops/index.js#L2984) (`nextPanelCode` just above it), `/panel-delete` | `PanelFormPage` (`/panels/new` · `:id/edit` · `:id/clone`, CR-285), Panels bulk delete, PanelDetail (More delete, ImageManager via generic PATCH) | **`panel_code` server-assigned `PANEL-NNN` when blank on create (CR-284)**, unique, lines valid, PanelOrder-in-use 409, `deleteReason` | SAME; generic PanelLine BANNED ✔, `?hard=1` escape documented |
| PanelOrder status + stock movement | `/panel-order-status` [2868](../functions/data-ops/index.js#L2868) → `adjustCutStock` [2849](../functions/data-ops/index.js#L2849) | PanelOrders grid row + kanban card | `PANEL_ORDER_TRANSITIONS`, verify-all-before-deduct, ≥ 0 | SAME |
| PanelOrder create / delete | generic | PanelOrders modal; row + card delete (`Received` only on both) | `can` | SAME |
| CutPieceStock | `/cut-stock-adjust` [2933](../functions/data-ops/index.js#L2933) | CutStock modal; PanelOrders modal | integer ≥ 0, composite upsert | **DIFFERENT** — generic `POST /CutPieceStock` has no composite `NATURAL_KEY` → duplicate on-hand rows (DF-02) |

### 3.14 AppSetting (configuration that *is* a rule)

| Key | Written by | Read by | Parity |
|---|---|---|---|
| `allow_duplicate_batches`, `batch_series_*`, `default_view` | `settingsApi.writeSetting` → generic `POST / PATCH /AppSetting` (route `isAdmin`) | `assertBatchesAllowed`, `batchSeriesSettings`, `useViewState` | SINGLE — no value validation, no rule-change marker in the op log (DF-22, low) |

---

## 4 · Invariants — the chain, in one place

| Invariant | Owner | Path that can break it today |
|---|---|---|
| `dispatched ≤ loaded ≤ palletized ≤ produced ≤ ordered` per line (`SYSTEM.md §1` golden rule) | `recountOrderItems` for the first three; record / allocate caps for `produced`; `hasWork` floor for `ordered` | generic `PATCH /OrderItem` (DF-02); `/production-complete` is uncapped by design |
| Counters are recomputed from ground truth, never incremented | `recountOrderItems` [1835](../functions/data-ops/index.js#L1835) | generic PATCH on OrderItem / PalletisedBatch / Container status (DF-02) |
| A plan line is never pallet-less (CR-146) | `normalizePlanLines` | generic `POST /PalletizationPlanLine` (DF-02) |
| Σ plan boxes per order item ≤ ordered | `assertPlanWithinOrdered` | generic `POST / PATCH /PalletizationPlanLine` (DF-02) |
| Σ batch rows of a batch == produced + opening (`SYSTEM.md §6.5`) | record routes + `assertBatchesAllowed` | generic `PATCH /ProductionLog.entry_type / qty_boxes` (DF-02) |
| Fill % is **not** an invariant — may exceed 100 % (CR-195/196) | `fillPct` unclamped | — |
| One invoice per container; `TransactionSeries` monotonic | `/invoice-for-container` | generic `POST /Invoice` (DF-18) |
| A worked SO line keeps its item and is never removed; a worked SO is cancelled, never deleted (CR-232, CR-271) | `hasWork` + `DELETE /SalesOrder` guard | generic `DELETE /OrderItem`, `/delete-order-item` (DF-01) |
| Plan status follows its lines; `Completed` only with a vehicle | `PAL_TRANSITIONS` | `setPlanStatus` (DF-04) |
| Every delete carries a reason unless Admin (CR-270) | `deleteReason` + `confirmDelete` | `/delete-order-item`, `/restore` |

---

## 5 · Divergence register — snapshot 2026-10-03

Severity: **data-loss** (counters or ledgers go wrong) · **rule-bypass** (a business rule can be
skipped) · **permission** (a role can do what its matrix denies) · **layering** · **cleanup**.
Fix shape: **ban** (refuse the generic route for the table) · **helper** (move the rule to a shared
helper and call it from every path) · **client** (add the client guard) · **delete** (remove dead code).

| DF | Entity · what differs | Paths | Severity | Fix shape | CR |
|---|---|---|---|---|---|
| **01** | OrderItem delete has three rule sets: form refuses on work; `/delete-order-item` disassociates production and has no work guard (and no client caller); generic `DELETE /OrderItem` has only `BLOCK_DELETE` | [1416](../functions/data-ops/index.js#L1416) · [5906](../functions/data-ops/index.js#L5906) · [6004](../functions/data-ops/index.js#L6004) | rule-bypass | helper (`hasWork` + plan-line check) or ban generic; decide fate of `/delete-order-item` | **next — agreed 2026-10-03** |
| 02 | Generic `PATCH / POST / DELETE /:table` can write any non-status column: OrderItem counters, `ordered_qty_boxes`, ProductionLog `qty_boxes` / `batch_number` / `entry_type`, PlanLine `boxes` / `pallet`, PalletisedBatch / Container `status`, QuoteItem, CutPieceStock duplicates; line-table deletes do not recount | `STATE_COLUMNS` [5703](../functions/data-ops/index.js#L5703); [5723](../functions/data-ops/index.js#L5723); [5810](../functions/data-ops/index.js#L5810) | data-loss | ban the transaction tables from generic write routes (LoadBox pattern) — only masters + AppSetting stay generic | Open |
| 03 | `/restore` has no guards: no reason, no state check, no re-link of disassociated production, no SO total recompute, header-only recount | [6103](../functions/data-ops/index.js#L6103) | data-loss | helper (mirror the delete-side checks) | Open |
| 04 | Plan status written by two graphs: `/pal-status` (`PAL_TRANSITIONS`, vehicle gate) vs `setPlanStatus` (none) from 5 loading routes | [2709](../functions/data-ops/index.js#L2709) · [3261](../functions/data-ops/index.js#L3261) | rule-bypass | helper (one `setPlanStatus` that applies the graph; delete the dead `/pal-status` client fn) | Open |
| 04b | `rollupSoStatus` (`SO_RANK`) and `/convert-quote` write statuses outside `SO_TRANSITIONS` / `QUOTE_TRANSITIONS` | [1805](../functions/data-ops/index.js#L1805) · [1753](../functions/data-ops/index.js#L1753) | by design — document only | — | Noted |
| 05 | `ROUTE_PERM` misses `update-so-with-items`, `delete-order-item`, `production-*`, `allocate-stock`, `deallocate-stock`, `send-to-loading`, `combine-leftovers`, `resync-size-snapshots`, `seed/masters`, `fx-refresh`, `upload/design-image` → legacy `can_update` fallback | [`appauth.js:132`](../functions/data-ops/lib/appauth.js#L132) | permission | add rows; make the fallback deny | Open |
| **06** | SO bulk delete on the grid lacks the `workRecorded` skip the detail page has (server now 409s, but the bulk reports N failed with no reason shown per row) | [`OrdersTable.tsx:282`](../client/src/features/orders/OrdersTable.tsx#L282) | rule-bypass (client) | client (filter worked rows, say why) | **next — agreed 2026-10-03** |
| 07 | ProductionLog delete: detail blocks on `palletised > 0`, bulk blocks on `status !== "Produced"` | [`ProductionDetail.tsx:237`](../client/src/features/stages/ProductionDetail.tsx#L237) · [`ProductionTable.tsx:544`](../client/src/features/stages/ProductionTable.tsx#L544) | rule-bypass (client) | helper (one `canDeleteProduction(e)` in `productionApi.ts`) | Open |
| 08 | LoadBox delete: LoadingWorkspace requires an empty box, LoadingBay / LoadingDetail delete a loaded box (lines fall back) | [`LoadingWorkspace.tsx:254`](../client/src/features/stages/LoadingWorkspace.tsx#L254) · [`LoadingBay.tsx:610`](../client/src/features/stages/LoadingBay.tsx#L610) · [`LoadingDetail.tsx:219`](../client/src/features/stages/LoadingDetail.tsx#L219) | rule-bypass (client) | decide one rule; helper | Open |
| 09 | Load details / seals: `duplicateSeals` only on LoadingSession + LoadingPlanPage; LoadingBay `VehicleLoadModal` and LoadingCustomerSheet write seals on **dispatched** boxes with no check | `sealChecks.ts` · [`LoadingBay.tsx:577`](../client/src/features/stages/LoadingBay.tsx#L577) · [`LoadingCustomerSheet.tsx:180`](../client/src/features/stages/LoadingCustomerSheet.tsx#L180) | rule-bypass | helper (seal check + Open gate inside `updateLoadBox` server-side) | Open |
| 10 | Six components call `lib/dataOps` `update()` / `insert()` directly (see §1.2) | §1.2 table | layering | move each write into its `*Api.ts` wrapper | Open |
| 11 | Write-through masters: Vehicle (5 loading surfaces), CutPieceSize (PanelForm, CutStockForm), PartyBrand (DesignForm) created by non-admin roles with no `can()` | [`vehiclesApi.ts:85`](../client/src/features/masters/vehiclesApi.ts#L85) · [`panelsApi.ts:195`](../client/src/features/panels/panelsApi.ts#L195) · [`DesignForm.tsx:336`](../client/src/features/masters/DesignForm.tsx#L336) | permission | decide: allowed (document) or gate on the host module's `create` | Open |
| 12 | No `can()` at all: `Invoices.tsx` (generate + delete), `AdvanceButton.tsx` (OrderItem stage), `LoadBoard.tsx` (ContainerLoading drag), `Containers.tsx` row-click edit | [`Invoices.tsx:116`](../client/src/features/invoices/Invoices.tsx#L116) · [`AdvanceButton.tsx:30`](../client/src/features/orders/AdvanceButton.tsx#L30) · [`LoadBoard.tsx:105`](../client/src/features/masters/LoadBoard.tsx#L105) | permission | client (`can("invoices", …)` exists in the matrix and is never used) | Open |
| 13 | `BLOCK_DELETE.Design` misses `PalletizationPlanLine.design`, `PanelLine.design`, `CutPieceStock.design`, `DesignPallet.design`; `Customer` misses Invoice via SO | [408](../functions/data-ops/index.js#L408) | data-loss | extend the map | Open |
| 14 | Quote lines editable after `Converted` / `PartiallyConverted` from both the form and the planner; opening stock insertable via generic `POST /ProductionLog` bypassing the lock | [`QuoteFormPage.tsx:45`](../client/src/features/quotes/QuoteFormPage.tsx#L45) · [`PlanContainerisation.tsx:1210`](../client/src/features/quotes/PlanContainerisation.tsx#L1210) · [4685](../functions/data-ops/index.js#L4685) | rule-bypass | helper (server 409 in `/update-quote-with-items` when converted; ban generic ProductionLog insert) | Open |
| 15 | Dead mutations: `deleteOrderItem`, `setPalStatus`, `setPalVehicle`, `updateQuote`, `setDesignPallets`, `deleteContainer`, all of `palletisationApi.ts` writes, `Palletizations.tsx`, `DispatchForm.tsx`, `ProductionQCForm.tsx` | `ordersApi.ts:328`, `palPlansApi.ts:490/495`, `quotesApi.ts:204`, `palletisationApi.ts:383…485` | cleanup | delete (after confirming the legacy data readers stay) | Open |
| 16 | ProductionImport records output with no `capFor`, no duplicate-batch check, and force-sets Completed | [`ProductionImport.tsx:186`](../client/src/features/stages/ProductionImport.tsx#L186) | rule-bypass (client; server caps hold) | client (reuse `capFor` + `batchNumberExists`) | Open |
| 17 | PalPlan delete has no Completed / palletised guard although Edit is locked | [`PalPlanDetail.tsx:91`](../client/src/features/stages/PalPlanDetail.tsx#L91) | rule-bypass | helper (server-side, in the generic DELETE like CR-271 did for SO, or ban + dedicated route) | Open |
| 18 | Generic `POST /Invoice` mints an invoice without bumping `TransactionSeries` | [5723](../functions/data-ops/index.js#L5723) vs [5356](../functions/data-ops/index.js#L5356) | data-loss | ban | Open |
| 19 | `/resync-size-snapshots` fans out without `oldBw` → overwrites manual box-weight overrides; no Admin check, no op log | [5682](../functions/data-ops/index.js#L5682) | data-loss | pass `oldBw`; Admin gate | Open |
| 20 | `BLOCK_DELETE.SalesOrder` lists own `OrderItem` rows, so even a clean draft SO cannot be deleted (Quote excludes its own lines) | [408](../functions/data-ops/index.js#L408) | behaviour | decide: soft-delete lines with the header, or exclude own lines like Quote | Open |
| 21 | Generic `GET /:table/:rowid` returns soft-deleted rows | [5658](../functions/data-ops/index.js#L5658) | behaviour | add the `deleted_at` filter | Open |
| 22 | AppSetting values are rules (`allow_duplicate_batches`, `batch_series_*`) with no validation and no rule-change marker | §3.14 | low | document; validate on write | Open |

---

## Keeping this file true

1. A new route or client call site that **writes** → add it to the entity's §3 row in the same commit.
2. A new **rule** → name its owner helper in §2 and call it from every path in the row (standing
   rule 3 in `CHANGE-REQUESTS.md`: a new rule is retrofitted, not just applied going forward).
3. A fixed divergence → mark its §5 row **Done** with the commit. Rows are never deleted.
4. The snapshot date in the header moves only when §5 has been re-audited end to end.

This is the fifth place a change must touch — see `SYSTEM.md` "Keeping this file true" and
`CHANGE-REQUESTS.md` "Closing a change".
