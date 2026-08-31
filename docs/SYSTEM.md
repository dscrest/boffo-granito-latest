# BOFFO Order OS — System Reference (as built)

**Status:** current as of **2026-08-29**, branch `feature/master-order-forms`, HEAD `9656f22`
plus the uncommitted batch-stock/reports working set.

This is the as-built description of the whole system: what it does, how the flow runs, and the
rules the numbers obey. It is written from the code, not from the pre-build plan documents.
Where it disagrees with `BOFFO_Build_Plan.md`, `BOFFO_Technical_Plan.md` or `PLAN.md`, this
file and the code win — those three are pre-implementation history.

**Companion documents**

| Document | Owns |
|---|---|
| [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md) | Every table, column, type and FK. **Column-level truth.** This file summarises only. |
| [`PRODUCT.md`](../PRODUCT.md) | Users, product purpose, brand and design principles. |
| [`ARCHITECT-BLUEPRINT.md`](../ARCHITECT-BLUEPRINT.md) | House conventions for building a BOFFO-class app (design tokens, page archetypes, DO/DON'T). |
| [`BOFFO_Architecture.md`](../BOFFO_Architecture.md) | The locked architecture *decisions* and why they were made. |
| [`CHANGES.md`](CHANGES.md) | Dated narrative of what shipped, newest first. |
| [`CHANGE-REQUESTS.md`](CHANGE-REQUESTS.md) | The numbered change-request register + the process for filing one. |
| [`USER-MANUAL.md`](USER-MANUAL.md) | End-user guide. **Stale from 2026-07-23** for Palletization/Loading/Panel Craft; its §9 formula reference is still correct. |

---

## 1 · What BOFFO is

An order-tracking system for a ceramic/porcelain **tile exporter** (Plant Morbi). It follows
the physical pipeline end to end so anyone can answer *"where is this order?"* in seconds,
replacing spreadsheets and scattered WhatsApp updates.

```
Quote → Approval → Sales Order → Production → Palletization → Loading → Dispatch → Invoice
```

**Users.** Sales staff raising quotes and orders; production coordinators recording output;
logistics staff palletizing, loading containers and dispatching; an admin managing masters and
users. Non-technical, desktop-first, on warehouse laptops all day.

**Units.** The domain is unit-heavy and everything converts through the **box**:

```
pieces → boxes → pallets → containers
```

- Boxes are the unit of record. Every quantity in the system is boxes unless labelled otherwise.
- Pallets = boxes ÷ boxes-per-pallet, **rounded up**.
- Coverage: `Sq.M = (W/1000 × L/1000) × pcs-per-box`; `Sq.Ft = Sq.M × 10.763915`.
- Money is stored in integer minor units, per-document currency with the FX rate captured at
  creation. No live revaluation.

Full formula reference: [`USER-MANUAL.md` §9](USER-MANUAL.md#9-formula-reference).

**The golden rule.** Quantities are conserved and gated. A box cannot be palletized before it
is produced, loaded before it is palletized, or invoiced before it is loaded. Downstream numbers
are trustworthy because they are *derived* from what was recorded upstream — see §6.

---

## 2 · Architecture & runtime

```
client/          Vite + React 18 + TypeScript  →  Catalyst static hosting
functions/
  data-ops/      single Advanced-I/O router function (Express)  — 57 routes
    lib/
      appauth.js   app-level auth + role matrix  — 10 /auth/* routes
      fit.js       pure container-fit optimizer (no Catalyst deps)
  api-health/    liveness probe
prototype/       original visual reference, copied verbatim, never edited
scripts/         seed + smoke scripts (node, run by hand)
```

There is **no** per-resource `api-customers` / `api-designs` split; that was sketched in the
early plans and never built. One router function serves everything.

**Data Store** is reached through ZCQL. Two platform constraints shape the entire backend:

1. **No multi-row / multi-table transactions.** Every multi-write operation is a
   *compensating-action saga*: write, and on failure explicitly undo what already landed.
   Convert-quote→order, `production-record-lines`, `close-pallet` and `send-to-loading` all
   work this way.
2. **No compound unique indexes.** Uniqueness (`Design.unique_name`, SKU, batch-per-item) is
   enforced in application code before the insert, and returns `409` on conflict.

**URL shape.** The client calls `/server/data-ops/...` same-origin. The function strips that
prefix in middleware ([`index.js:65-68`](../functions/data-ops/index.js#L65-L68)) so routes
match with or without it.

**Table allowlist.** The generic CRUD routes only touch tables in the `ALLOWED` set
([`index.js:71+`](../functions/data-ops/index.js#L71)); anything else is rejected. `LoadBox`
and `PanelLine` additionally block direct inserts — they may only be created through their
own business routes.

### Environments

| | |
|---|---|
| **Live project** | `boffo-granito-export-tracker` — id `69851000000043001`, org OCTFIS `925638796` |
| **Dead project** | `boffo-latest-project` — **deleted 2026-07-04**. Every `76673…` row id in `DATASTORE-SCHEMA.md` refers to it and is dead; live ids are `69851…`. |
| **Deploy** | `catalyst deploy` from the repo root (client + both functions) |
| **Build** | `npm run build` → `tsc --noEmit && vite build` |
| **Dev** | `npm run dev` (Vite), `npm run serve` (Catalyst local) |

An open plan to move off Catalyst Web Client Hosting to **Slate** exists in
[`Migration to Slate plan.md`](../Migration%20to%20Slate%20plan.md) — not executed. Its key risk
is the same-origin `/server` path and the auth cookie.

---

## 3 · Data model

45 tables. Column-level truth lives in [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md); this is
the map.

**Lookups** — `Organization`, `Brand`, `Grade`, `Size`, `Finish`, `Category`, `Glaze`,
`PartyBrand`, `PaymentTerm`, `NumberMaster`, `TransactionSeries`, `Currency`.

**Masters** — `Customer`, `Design` (the Item), `Pallet` (pallet *format*), `DesignPallet`
(join), `Vehicle`, `Container`, `SalesPerson`.

**Documents** — `Quote` / `QuoteItem`, `SalesOrder` / `OrderItem` / `OrderItemEvent`,
`ProductionLog`, `Invoice`.

**Logistics** — `PalletizationPlan` / `PalletizationPlanLine` (the live flow), `LoadBox`,
plus `PalletisedBatch` / `PalletisedBatchLine` / `ContainerLoading` (legacy — see §6.6).

**Panel Craft** — `Panel`, `PanelLine`, `PanelOrder`, `CutPieceSize`, `CutPieceStock`.

**Auth & system** — `Role`, `AppUser`, `AuthSession`, `AppSetting`, `Activity`, `OperationLog`,
`StatusTransition`, `Notification`.

### Vocabulary that matters

| Term | Means |
|---|---|
| **Design / Item** | The sellable tile SKU. UI always says *Item*; the table is `Design`. |
| **Size** | Owns per-box packing data — dims, pcs/box, coverage, box weight. Items and pallets **snapshot** it so the operator is never asked twice. Editing a Size fans the new packing out to those snapshots ([`/resync-size-snapshots`](../functions/data-ops/index.js#L4668) backfills). |
| **Pallet Master** | The master of pallet *formats* (an Inventory master). |
| **Palletization** | The *process* under Sales that consumes pallet formats. **Never** merge the two — they are different things with similar names. |
| **Batch** | A production run of one item, numbered `B/FY/NNN`. Unique per item always; cross-item reuse is allowed by default, controlled by `AppSetting.allow_duplicate_batches`. |
| **PalPlan** | A `PalletizationPlan`, numbered `PAL/FY/NNN`. Can span multiple sales orders. |
| **LoadBox** | A vehicle/container slot that boxes are loaded into. Cross-plan. |
| **Customer** | Always "Customer" in the UI — never "Party", despite `Parties.tsx`. |
| **Shade** | **Retired 2026-08-29.** Columns still exist on `ProductionLog`, `PalletisedBatch` and `PalletisedBatchLine`; nothing reads or writes them. Batch is the only dimension. |

---

## 4 · Screens & routes

Routing is in [`App.tsx`](../client/src/App.tsx) — hash-based, all pages lazy-loaded. Sidebar
leaves are additionally filtered per signed-in role by `filterTreeByRole`
([`App.tsx:189`](../client/src/App.tsx#L189)).

### Sidebar

| Group | Leaves |
|---|---|
| **Dashboard** | Dashboard |
| **Inventory** | Items · Stock Details · Size Master · Pallet Master · Production |
| **Sales** | Customers · Quotes · Approvals\* · Sales Orders · Palletization · Loading · **Panel Craft** (Cut Stock · Panels · Panel Orders) |
| **Reports** | Reports · Audit Log |
| *header gear* | Settings (admin only) |

\* Approvals appears only for a role that may approve Quote, SalesOrder or Production.

### Route table

| Path | Component | Notes |
|---|---|---|
| `/dashboard` | `dashboard/Dashboard.tsx` | `/` redirects here; so does `*` |
| `/design` · `/design/:id` · `/design/:id/edit` · `/design/:id/clone` | `masters/DesignMaster` · `ItemDetail` · `DesignEdit` | Item master |
| `/stock` | `masters/StockDetails.tsx` | Batch-wise on-hand |
| `/sizes` · `/sizes/:id` | `masters/Sizes` · `SizeDetail` | |
| `/pallets` · `/pallets/:id` | `masters/Pallets` · `PalletDetail` | Pallet formats |
| `/prod` · `/prod/:id` | `stages/Production` · `ProductionDetail` | Kanban + Sheet |
| `/parties` · `/parties/:id` | `masters/Parties` · `CustomerDetail` | Customers |
| `/quotes` · `/quotes/:id` | `quotes/QuotesTable` · `QuoteDetail` | |
| `/quotes/:id/containerise` | `quotes/PlanContainerisation.tsx` | Quote-level container plan |
| `/approvals` | `quotes/Approvals.tsx` | Role-gated at nav **and** route |
| `/orders` · `/byorder` · `/kanban` | `orders/OrdersTable` · `ByOrderView` · `pipeline/Kanban` | One nav leaf, `ViewToggle` switches |
| `/orders/:id` | `orders/OrderDetail.tsx` | |
| `/orders/:id/containerise` | `quotes/PlanContainerisation.tsx` | The SO's own editable plan copy |
| `/packing` · `/packing/:id` | `stages/PalPlans` · `PalPlanDetail` | Palletization board |
| `/loading` · `/loading/:id` | `stages/LoadingBay` · `LoadingDetail` | Loading board |
| `/cut-stock` · `/panels` · `/panels/:id` · `/panel-orders` | `panels/*` | Panel Craft |
| `/reports` · `/reports/:id` | `reports/ReportsHome` · `Reports.tsx` (`ReportView`) | |
| `/ops` | `ops/OperationsLog.tsx` | Audit log |
| `/settings` · `/masters` · `/users` · `/roles` · `/currencies` · `/data-operations` | `settings/*`, `admin/*`, `masters/Masters` | **Admin only** — non-admins redirect to `/dashboard` |

**Registered but hidden.** The "Stages" nav block is commented out
([`App.tsx:160-174`](../client/src/App.tsx#L160-L174)); the routes still resolve if typed:
`/po`, `/po/:id`, `/qc`, `/containers`, `/fit`, `/loadplan`, `/invoices`.
`/final` (Final Loading) was **removed** on 2026-08-29 along with the legacy pallet flow (§6.6).

### Public, unauthenticated

| Route | Serves |
|---|---|
| `GET /public/design-image/:fileId` | Item images |
| `GET /public/pallet/:token` | Pallet QR scan page (`SharedPallet.tsx`) |
| `GET /public/batch/:token` | Batch QR slip (`SharedBatch.tsx`) |

Tokens are unguessable, minted on demand by `POST /load-box-share/:rowid` and
`POST /production-record-share/:rowid`. They expose one record only.

---

## 5 · The order-to-dispatch flow

Every state machine below is enforced **server-side** by a transition table; the client
`*Api.ts` copy exists only for labels and for disabling buttons. The server is authoritative —
if the two ever disagree, the server wins and the client is the bug.

| Object | States | Server transition table |
|---|---|---|
| Quote | `Draft → PendingApproval → Approved → Sent → Accepted`; `Rejected` from PendingApproval/Sent/Accepted, back to PendingApproval. Terminal `Converted` / `PartiallyConverted` are set by conversion, not by this map. | `QUOTE_TRANSITIONS` [`index.js:1029`](../functions/data-ops/index.js#L1029) |
| SalesOrder | `Draft → PendingApproval → Confirmed → InProgress`; `Cancelled` from Confirmed/InProgress and back to Confirmed; `Rejected → PendingApproval` | `SO_TRANSITIONS` [`index.js:1109`](../functions/data-ops/index.js#L1109) |
| PalPlan (plan) | `Planning → Loading → Completed`; Loading may return to Planning; Completed is terminal | `PAL_TRANSITIONS` [`index.js:2275`](../functions/data-ops/index.js#L2275) |
| PalPlan (line) | `Planning → Palletizing → ReadyToLoad`, freely reversible among the three | `PAL_LINE_TRANSITIONS` [`index.js:2281`](../functions/data-ops/index.js#L2281), mirrored [`palPlansApi.ts:35`](../client/src/features/stages/palPlansApi.ts#L35) |
| LoadBox | `Open → Dispatched` | `/load-box-dispatch` [`index.js:2948`](../functions/data-ops/index.js#L2948) |
| Production | `New → InProduction → Completed` (auto-stepped) | `PRODUCTION_STAGE_ORDER` [`productionApi.ts:433`](../client/src/features/stages/productionApi.ts#L433) |
| PanelOrder | `Received → InCutting → Ready → Dispatched`, **forward-only** | `PANEL_ORDER_TRANSITIONS` [`index.js:2378`](../functions/data-ops/index.js#L2378) |

Line-status labels differ from their stored values and the labels are what users say:
`Planning` = **"Ready for Palletization"**, `Palletizing` = **"Palletization"**,
`ReadyToLoad` = **"Ready for Loading"** ([`palPlansApi.ts:40-45`](../client/src/features/stages/palPlansApi.ts#L40)).

### 5.1 Quote

Screen `/quotes` → `/quotes/:id`. Routes `POST /quote-with-items`,
`POST /update-quote-with-items/:rowid`, `POST /quote-status/:rowid`.

- Header inherits **all** customer fields on pick — currency, payment terms, addresses,
  brand. Currency defaults to INR and comes from the `Currency` master via `rateFor()`; there
  is no hard-coded currency.
- Sales Person defaults to the logged-in user.
- Lines store `unique_name` so a line is size-exact and survives item renames.
- Three renderers (screen, print, PDF) all group lines into **DESIGN bands** — the same
  grouping in all three, by design.
- **Container plan** — `/quotes/:id/containerise` (`PlanContainerisation.tsx`) plans the
  quote's boxes into containers in either **Box Fitting** or **Weight Fitting** mode; a saved
  plan reopens in the mode it was saved in. Backed by the pure optimizer
  [`functions/data-ops/lib/fit.js`](../functions/data-ops/lib/fit.js), which enforces up to four
  co-equal hard caps simultaneously (pallet slots, area m², weight kg, boxes); any cap that is
  null/0 is treated as unconstrained, so mixed pallet types fall out for free.
- Public share link + `pdfmake` PDF.
- Approval runs through `/approvals`, writing `StatusTransition` rows and firing a
  `Notification` to the quote's sales person.

### 5.2 Convert → Sales Order

Route `POST /convert-quote/:rowid`. **Enabled only for `Accepted` or `PartiallyConverted`
quotes.** Full or partial; a partial conversion leaves the quote `PartiallyConverted`.

On conversion the quote's container plan is **snapshotted onto the SO**, which then owns its
own editable copy at `/orders/:id/containerise`. Saving the SO writes only the plan JSON.

**Confirming an SO auto-enqueues production.** `POST /so-status/:rowid` → `Confirmed` seeds
`ProductionLog` plan rows for the order's items. See §5.3 for how those interact with manual
requests.

### 5.3 Production

Screen `/prod` — a Kanban board and a Sheet (grid) view of the same rows.

**Stages:** `New → InProduction → Completed`. QC exists in the type but is **parked** — it is
dropped from the board, the tabs and the flow
([`productionApi.ts:432`](../client/src/features/stages/productionApi.ts#L432)).

**The approval step is retired.** `PRODUCTION_TRANSITIONS`
(`PendingApproval/Approved/Produced/Rejected`, [`index.js:3326`](../functions/data-ops/index.js#L3326))
and `POST /production-status/:group` are kept only so the change can be rolled back; nothing in
the UI drives them.

**Recording output.** One modal covers every item on the job — a section per item, Tab moves
across them (`RecordOutputForm.tsx`). Behind it:

- `POST /production-record/:rowid` — one line.
- `POST /production-record-lines/:rowid` — several batches (qty + batch + mfg date) against one
  plan line in a single call. `OrderItem` is bumped **once**; inserts are compensated on failure.
- Recording output **auto-steps the Kanban stage**: `New → InProduction` on the first record,
  `→ Completed` once records cover `qty_requested`. Stage can still be moved by hand via
  `POST /production-stage`.
- The Produced counter shows **committed** output only.

**Batches.** `Design.is_batched` marks batch-tracked items; the server refuses to flip the flag
once the item carries stock. Batch numbers are auto-minted `B/FY/NNN`. Duplicate batch on the
same item is always `409`; across items it is governed by
`AppSetting.allow_duplicate_batches`.

**Opening stock.** `POST /opening-stock/:designId`. Batched items store opening as
`ProductionLog` rows with `entry_type="opening"`, one per batch; singular items keep the single
`accounting_stock` number. **Locked after the first save** (`null` = still unlocked). An admin
may re-edit, but only with a required reason, which lands in `OperationLog`.

**Excel import.** `/prod` → Import (`ProductionImport.tsx`). No re-upload dedupe — importing
the same file twice will double-count.

**Auto-queued vs manual.** An auto-enqueued `so-…` job counts as in-production only **once
touched**. An untouched auto job is superseded by a manual request for the same item, so
confirming an SO and then raising the request by hand does not double-count.

**Remaining / Desired** defaults to `ordered − produced − inflight − stock`. The
order-completion *filters* are deliberately **not** stock-adjusted.

### 5.4 Palletization

Screen `/packing` (grid + kanban, board is the default). Title: "Palletization and Loading".
Plans are `PAL/FY/NNN` and may span sales orders.

**Three columns** since 2026-08-27: *Ready for Palletization* (grouped by SO) → *Palletization*
→ *Ready for Loading*. The Dispatch column and the separate "Mark ready" step were removed —
**Palletise now goes straight to `ReadyToLoad` in one hop.**

- Two entry points share `PalPlanForm`: **New** plan, and **Send to Palletise** from an order.
  A change to one almost always belongs in both — check before shipping one side.
- Multi-select checkboxes on the board open `PalletiseModal`.
- Pallet details prefill from the SO's container plan
  ([`containerPlanPrefill.ts`](../client/src/features/stages/containerPlanPrefill.ts)); the
  pallet picker on Record Output is hidden.
- **Mix Batch top-up** — `POST /pal-topup/:rowid` tops a pallet up from another batch via
  `pallet_group`.
- **One batch per customer** is the target: plan lines are per-batch, and a mixed-batch pallet
  raises a warning rather than a block.
- Pallet QR labels (`palletQrPdf.ts`), batch QR slips (`batchQrPdf.ts`), pallet slips
  (`palletSlipPdf.ts`) — all `pdfmake`, all with a public scan page.

**Every production record tops up the item's planning queue** (`produced − palletized`) on one
reused open plan per SO — `autoEnqueuePalletization` ([`index.js:2106`](../functions/data-ops/index.js#L2106)).

### 5.5 Loading

Screen `/loading` (kanban + sheet), detail at `/loading/:id`.

**Four stages, all derived** — nothing stores them
([`LoadingBay.tsx:5-8`](../client/src/features/stages/LoadingBay.tsx#L5)):

| Stage | Derived from |
|---|---|
| Ready | line has no box |
| In Loading | line is in an `Open` box |
| Ready for Dispatch | `Open` box **with** a container number or line seal captured |
| Dispatch | box status is `Dispatched` |

**Container-first.** `LoadContainerModal` replaced the old box picker at all three entry points.
Plan progress is consumed automatically; there is no per-container id to manage.

**Vehicle and seals are captured at Confirm Load — *before* dispatch**, not at dispatch time.
Confirm Load and Dispatch are two separate actions. `dispatch_date` is planned first, then
actual.

`POST /send-to-loading` can **skip palletization entirely**. Since 2026-08-29 it no longer
inserts a single blank-batch line: it calls `unqueuedBatches` and splits the requested boxes
across the item's unqueued batches FIFO, one plan line per batch chunk, so the batch trail
survives the shortcut. Only a residue beyond what has been produced falls to a blank-batch line.

### 5.6 Dispatch & Invoice

- `POST /load-box-dispatch/:rowid` — `Open → Dispatched`.
- `logRelated` fans every loading event onto **both** the sales order's and the PalPlan's
  activity feeds, so neither side has a gap.
- One shared `DispatchTab` renders on SO, PalPlan and Quote; Customer gets the same content as
  a section.
- `POST /invoice-for-container/:rowid` generates the invoice for a container
  (`invoicePdf.ts`).
- The plan's own status follows its boxes automatically — it is not set by hand.

### 5.7 Panel Craft

A parallel sub-flow for showcase panels that reps show retailers, plus the cut-piece jobs that
produce them. Screens: `/cut-stock` → `/panels` → `/panel-orders` (that is also the workflow
order: stock is entered, panels are assembled from it, orders dispatch against it).

**The rule that governs it (reversed 2026-08-27):** the **Panel master is decoupled from
stock.** Creating, editing or deleting a panel never touches `CutPieceStock`. Only a
**PanelOrder** moves stock: `Ready` adds, `Dispatched` subtracts. This is why
`PANEL_ORDER_TRANSITIONS` is forward-only — stepping backwards would double-add stock.

Routes: `POST /panel-save`, `POST /panel-delete/:rowid`, `POST /panel-order-status/:rowid`,
`POST /cut-stock-adjust`.

---

## 6 · Stock and the batch ledger

This is the accounting spine. Everything in §5 exists to feed it.

### 6.1 Counters are recomputed, never incremented

`recountOrderItems` ([`POST /recount-order-items`](../functions/data-ops/index.js#L4289))
recomputes `OrderItem`'s palletized / loaded / dispatched counters and its shipping stage from
ground truth. **Nothing increments them inline.** The route also exists as a backfill you can
run against historical data.

### 6.2 The single live-stock path

`designStock()` in [`client/src/lib/stock.ts`](../client/src/lib/stock.ts) is the one place
live stock is derived. Item detail, Reports and transaction line rows all go through it.
`openingStockFor()` picks between `accounting_stock` and summed opening-batch rows per item —
that choice is the guard against double-counting opening stock, and it must not be bypassed.

### 6.3 `deriveBatchStock` — the pure reducer

[`batchStockDerive.ts`](../client/src/features/stages/batchStockDerive.ts) has **zero imports**.
It takes supply and consumption, returns per-`(item, batch)` rows.

```
supply:      { designId, batch, qty, kind: "opening" | "produced", date }
consumption: { designId, batch, boxes, loaded, dispatched }
```

The netting rules, in order:

1. **Attributed consumption** (a real batch on the line) nets its own bucket first.
2. **Blank-batch consumption that is not loaded** only adds to the blank bucket's `palletised`.
   It does **not** reduce stock — palletising is not consumption.
3. **Blank-batch consumption that is loaded** nets **FIFO**: the blank bucket first, then the
   item's real batches oldest-mfg-date first, draining `max(0, opening + produced − loaded)`
   from each in turn.
4. Anything the buckets cannot absorb lands on the blank bucket as **`over`** and is **never
   reallocated** — an over-consumption is surfaced (amber ⚠ in the Batch-wise Stock report),
   not silently spread around.

Per row: `current = max(0, opening + produced − loaded)`, `over = max(0, loaded − (opening + produced))`.

**Conservation law**, asserted by
[`batchStockDerive.check.ts`](../client/src/features/stages/batchStockDerive.check.ts):

```
Σ current  =  Σ supply  −  Σ absorbed loaded boxes
```

### 6.4 `unqueuedBatches` — the server-side twin

[`index.js:2078`](../functions/data-ops/index.js#L2078). Per item, computes FIFO-available boxes
per batch = `Σ ProductionLog record qty − Σ boxes already enqueued for that batch (any status)`,
oldest first by the batch's first record's `CREATEDTIME`.

It backs **both** `autoEnqueuePalletization` **and** `/send-to-loading`. That is the point: one
FIFO rule, two callers, so palletising and skipping palletisation attribute batches identically.

### 6.5 `batchLedger` — where each batch went

[`batchLedger.ts`](../client/src/features/stages/batchLedger.ts) emits one row per
batch × consumer. A plan line counts once it is `ReadyToLoad` **or** sitting in a box — the same
rule `recountOrderItems` and `unqueuedBatches` use. Stage is `Palletised` (no box) / `Loaded`
(box, not dispatched) / `Dispatched`. The remainder emits a single `On hand` row.

Invariant: `Σ rows of a batch == its produced + opening`.

### 6.6 What is retired, and what is only *half* retired

Read this before "cleaning up" anything in this area.

**Shade — retired 2026-08-29, fully.** Columns kept on `ProductionLog`, `PalletisedBatch` and
`PalletisedBatchLine`; nothing reads or writes them. Removed from the import template, the Stock
Details grid, the batch QR PDF, and the `batchStockApi` grouping key (now `designId + batch`).

**Legacy pallet entry points — UI retired, data still live.** Five files carry a
`RETIRED 2026-08-29` header and no route or caller imports them: `FinalLoading.tsx`,
`DispatchForm.tsx`, `LoadContainerForm.tsx`, `PalletPackForm.tsx`, `Palletizations.tsx`. The
`/final` route is gone, and `PalletDetail`'s "Palletize Order" action was removed because it
drove the `/close-pallet` saga — a *second* record of boxes that the live PalPlan/LoadBox flow
already counts.

**But** `batchStockApi.ts` still **reads** `PalletisedBatch` / `PalletisedBatchLine` /
`ContainerLoading` as historical LEGACY supply and consumption. The data is still counted for
stock accuracy. Deleting those tables, or dropping those reads, would silently corrupt on-hand
stock for anything palletised before the cutover.

**Other dead ends:** `LoadBox.capacity` is unused (box fill is fractional against each line's
pallet capacity — `lineFrac`/`boxFill`); box swap is hidden behind `SHOW_SWAP`.

---

## 7 · Reports & audit

`/reports` lists 14 reports grouped into five sections (Sales, Customer, Item, Inventory,
Dispatch); a report may appear in more than one. Registry: `REPORTS` in
[`Reports.tsx`](../client/src/features/reports/Reports.tsx).

| id | Title | Shows |
|---|---|---|
| `by-item` | By Item | Ordered vs produced vs remaining, per design |
| `by-po` | By PO | The same rollup per purchase order |
| `customer-sales` | Customer Sales | Revenue and volume per customer |
| `salesperson-sales` | Salesperson Sales | Revenue and volume per sales person |
| `size` | Size-wise | Ordered boxes grouped by size |
| `production-batches` | Production Batches | Boxes produced per batch — list **or** item × date matrix |
| `stock` | Live Stock | Opening + produced − loaded, per design |
| `stock-batch` | Batch-wise Stock | On-hand per item × batch; over-consumed rows flagged ⚠ |
| `batch-movement` | Batch Movement | Where each batch went — list or pivot (by customer / by stage) |
| `ready` | Ready Pallets | Palletised and waiting, not yet in a loading |
| `pal-status` | Palletization Status | One row per plan, how far its boxes moved, % dispatched |
| `loading-status` | Loading & Dispatch | One row per LoadBox — container, vehicle, seals, transporter, LR, destination, fill % |
| `dispatch-register` | Dispatch Register | One row per dispatched line — date, container, customer, item, batch |
| `aging` | Quote Aging | Where quotes are stuck |

**Shared machinery**

- `ReportShell.tsx` — one layout for every report: date range, filter, CSV, plus a `bar` slot
  for report-specific controls (view/axis toggles) that renders right of the filter button.
- `PivotTable.tsx` — generic cross-tab. Rows sorted by total descending, columns
  lexicographically, with row/column/grand totals.
- `bucket.ts` — day / week / month bucketing. **Week keys are computed in UTC deliberately**, so
  a viewer west of Greenwich does not roll a Monday back into the previous week.

**Audit.** Every mutation writes to `Activity` (actor + human-readable detail); `OperationLog`
carries data-operation records including admin overrides and their reasons; `StatusTransition`
records every state-machine move. `/ops` renders the audit log with local-time timestamps.

---

## 8 · House standards

These are binding. They were learned from correction, and re-deriving them costs more than
reading them. A change to any of these is a change **everywhere the pattern exists**, not just
where it was reported.

**Grids** — every list grid: one-line rows (`.nw` / `.clip`, cap on the span, not the `td`);
footer pager; data-driven column defs with show/hide **and** reorder (`useColumns`, icon-only
`ColumnPicker`); advanced-search modal; Created/Modified hidden by default; **whole row** clicks
through to the detail page; newest-first default sort (`useSortRows(..., "created", -1)`).

**ColumnPicker Apply is locked.** Checkbox changes and reorder both *stage*; nothing applies
until **Apply**. Never make it immediate. Detail-page Fields pickers use the same component.

**Forms** — no negative values anywhere; pick lists are `Combobox` only and **always sourced
from the DB masters, never a static array**; required marker sits in-box with a legend;
grey = auto-derived, white = typable, `ƒx` marks a calculated field; inputs come before derived
values; Save-only buttons (no Save-and-new variants); `seq_code` is auto-generated — no Short
Code inputs; registration fields auto-format (`formatVehicleNumber`); **every date field
defaults to today** (`todayISO`), never blank; Sales Person defaults to the logged-in user
(`currentSalespersonName` / `storedAuth`).

**Detail pages** — one shared design, copied from Quotes / Item master. Header actions are
**always right-aligned**. Every detail page's More menu carries **Clone**, which seeds the
create form from the record and saves as new, never copying auto-generated identity fields.

**After create or clone, navigate to that new record** using the id the API returned — never to
a selected or arbitrary row.

**Controls** — one aesthetic for every control (button, select, chip, pill, input). Reuse the
existing component or style; never a bespoke one-off. No input is ever flat: the house skin is
9px radius, soft border, accent focus ring, defined globally in `styles.css`.

**Wording** — the UI never shows infrastructure names (Catalyst, Data Store, backend);
subtitles name the master only. Page titles match sidebar labels. It is always "Customer",
never "Party". No breadcrumbs — page head is title + sub, the sidebar carries location. Modal
headers are a title plus at most the record identity — never an instructional sentence.

**Typography** — the `--t-*` scale and the `App.tsx` density override move **together**; PDFs
are excluded from the app font scale.

Full rationale for each: `ARCHITECT-BLUEPRINT.md` and the project memory notes.

---

## 9 · Security & roles

Auth is **app-level**, not Catalyst Embedded Auth. Implemented in
[`functions/data-ops/lib/appauth.js`](../functions/data-ops/lib/appauth.js) over three tables:

- `Role` — `matrix` JSON: `{"modules":{"quotes":["view","create","edit","delete","export"],…},"approve":["Quote","SalesOrder"]}`. A null matrix (legacy role) is synthesised from the old
  `features` / `can_update` / `can_delete` columns. The role named **Admin** is a superuser: it
  bypasses the guard and is locked against edits.
- `AppUser` — email (unique), `password_hash` as `scrypt$salt$hash`, active, role FK.
- `AuthSession` — unique token, 7-day TTL, user FK with cascade.

**Ten `/auth/*` routes**: `login`, `logout`, `me`, `roles` (GET/POST/PATCH/DELETE),
`users` (GET/POST/PATCH). Role and user administration is Admin-only.

**A global guard sits in front of every other route** — a valid bearer token plus the matrix
permission for that route's module and action. Unmapped routes fall back to the legacy
`can_update` / `can_delete` rules. RBAC is enforced server-side; hiding a nav leaf is a
convenience, not a control.

**Session transport.** Token in `X-App-Token` **plus** an httpOnly, Secure, SameSite=Lax cookie
on path `/` (so it rides every same-origin `/server` request and survives opening a link in a
new tab). The token snapshot in `localStorage` keeps the tab signed in; `lib/api.ts` clears the
session on any 401. Session ends on TTL, on 401, or on explicit sign-out.

**Hardened 2026-07-24** (`e3b8946`): ZCQL injection, read-authorization, httpOnly cookie. CORS
is allowlisted by origin with credentials.

Remaining open items are tracked in [`docs/plans/audit-hardening-plan.md`](plans/audit-hardening-plan.md) —
A1/A2 closed, A3 gated on a cookie spike, B–D largely unverified since 2026-07-24.

---

## 10 · Build, deploy, verify

```bash
npm run dev            # Vite dev server
npm run build          # tsc --noEmit && vite build   (typecheck is part of the build)
npm run serve          # catalyst serve
npm run deploy         # catalyst deploy → client/dist + functions/*
```

Deploying the client and deploying `functions/data-ops` are **separate concerns in one command**
— a change that only touches `functions/` still needs the deploy, and a few past changes broke
because only the client shipped.

### Self-checks

The project deliberately uses **no test framework**. Non-trivial pure logic ships one runnable
`assert`-based check beside it:

```bash
node client/src/lib/stock.invariant.check.ts
node client/src/features/stages/batchStockDerive.check.ts
node client/src/features/stages/batchLedger.check.ts
node client/src/features/reports/bucket.check.ts
node client/src/features/quotes/planProgress.test.ts
node functions/data-ops/lib/fit.test.js
```

These are **not wired into any npm script and there is no CI** — they are run by hand. If you
change the stock, ledger, bucketing or fit logic, run the matching check before you claim it
works.

### Driving the app end to end

Typecheck is not verification. To drive the real flow, mint an `AuthSession` row via ZCQL and
inject it into `sessionStorage`. Watch for the admin-guard race on first load. Use the `ZZT`
prefix for test records so they are easy to find and remove.

---

## 11 · Open, parked and never-built

| | |
|---|---|
| **Slate migration** | Planned, not executed — [`Migration to Slate plan.md`](../Migration%20to%20Slate%20plan.md). Risk: same-origin `/server` + auth cookie. |
| **QC stage** | Exists in `ProductionStage`, dropped from the board and flow. |
| **Production approval** | Retired; server transitions kept for rollback only. |
| **Zoho Books integration** | Phase 6 in the original plan. **Never built.** No Books sync exists. |
| **Hidden routes** | `/po`, `/qc`, `/containers`, `/fit`, `/loadplan`, `/invoices` — registered, no nav entry. |
| **Clear / None on pick lists** | Every `Combobox` still needs a Clear affordance (reverses the None-removal in `b9a47f2`). |
| **Excel import dedupe** | Re-uploading the same production file double-counts. |
| **SO picker migration** | Quote lines carry `unique_name`; the SO picker migration to match is deferred. |
| **Flat `PalletisedBatch` grid** | Parked in favour of the PalPlan board. |
| **Detailed Grid design** | Built 2026-07-30, then reverted. Wanted as a portable prompt for *other* apps — BOFFO keeps whole-row → detail. |
| **Readable SKU rework** | Acronym-based SKU scheme, decisions locked, not built. |
| **`docs/USER-MANUAL.md`** | Stale from 2026-07-23 for §5.5 and §6. Needs a rewrite for the current loading / palletization / Panel Craft model. |

---

## Keeping this file true

`SYSTEM.md` describes the system as built. When a change ships:

1. Update the affected section here.
2. Add the dated entry to [`CHANGES.md`](CHANGES.md).
3. Close the row in [`CHANGE-REQUESTS.md`](CHANGE-REQUESTS.md) with its commit.
4. Update [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md) if any column moved.

A change is not done until all four are true.
