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
| **Size** | Owns per-box packing data — dims, pcs/box, coverage, box weight. Items and pallets **snapshot** it so the operator is never asked twice. Editing a Size fans the new packing out to those snapshots ([`/resync-size-snapshots`](../functions/data-ops/index.js#L5051) backfills — full overwrite, clobbers manual weights). **Box weight is the one override:** the Size value is only the default on the Item form and the Pallet form (CR-133, CR-190); a typed value is kept by the fan-out. Consumers read the **Item's** weight first (Plan Containerisation Weight Fitting, server loading-capacity check), the Pallet format's only as fallback. |
| **Pallet Master** | The master of pallet *formats* (an Inventory master). |
| **Palletization** | The *process* under Sales that consumes pallet formats. **Never** merge the two — they are different things with similar names. |
| **Batch** | A production run of one item, numbered `B/YYYY-MM/NNN` (series per item per calendar month; format changed 2026-09-04, older batches keep `B/FY/NNN`). Unique per item always; cross-item reuse is allowed by default, controlled by `AppSetting.allow_duplicate_batches`. |
| **PalPlan** | A `PalletizationPlan`, numbered `PAL/FY/NNN`. Can span multiple sales orders. |
| **LoadBox** | A vehicle/container slot that boxes are loaded into. Cross-plan. Numbered `LOAD/FY/NNN` (`load_number`, since 2026-09-04; the MAX-scan uses ZCQL's `*` wildcard — `%` matches nothing, CR-209; older boxes fall back to vehicle / "Container N"). One LoadBox = one container; a multi-container loading plan groups sibling LoadBoxes via `load_plan.group`. |
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
| **Sales** | Customers · Quotes · Approvals\* · Sales Orders · Palletization · Loading and Dispatch · **Panel Craft** (Cut Stock · Panels · Panel Orders) |
| **Reports** | Reports · Audit Log |
| *header gear* | Settings (admin only) |

\* Approvals appears only for a role that may approve Quote, SalesOrder or Production.

### Route table

| Path | Component | Notes |
|---|---|---|
| `/dashboard` | `dashboard/Dashboard.tsx` | `/` redirects here; so does `*` |
| `/design` · `/design/:id` | `masters/DesignMaster` · `ItemDetail` | Item master |
| `/design/new` · `/design/:id/edit` · `/design/:id/clone` | `masters/DesignEdit.tsx` | CR-220: the one Item form page |
| `/stock` | `masters/StockDetails.tsx` | Batch-wise on-hand |
| `/sizes` · `/sizes/:id` | `masters/Sizes` · `SizeDetail` | |
| `/pallets` · `/pallets/:id` | `masters/Pallets` · `PalletDetail` | Pallet formats |
| `/pallets/new[?size=<id>]` · `/pallets/:id/edit` · `/pallets/:id/clone` | `masters/PalletFormPage.tsx` | CR-220; `?size=` locks the Size and returns to `/sizes/:id` |
| `/prod` · `/prod/:id` | `stages/Production` · `ProductionDetail` | Kanban + Sheet |
| `/prod/new` · `/prod/:id/clone` · `/prod/:id/edit` | `stages/ProductionFormPage.tsx` | CR-220: Start New Production (CR-234) / Edit Production pages |
| `/prod/record` | `stages/ProductionLogSheet.tsx` | CR-244: Record Production sheet — many items, one Save, straight to stock |
| `/parties` · `/parties/:id` | `masters/Parties` · `CustomerDetail` | Customers |
| `/parties/new` · `/parties/:id/edit` · `/parties/:id/clone` | `masters/PartyFormPage.tsx` | CR-220: Customer form page (`:id` = customer code) |
| `/quotes` · `/quotes/:id` | `quotes/QuotesTable` · `QuoteDetail` | |
| `/quotes/new[?customer=]` · `/quotes/:id/edit` · `/quotes/:id/clone` | `quotes/QuoteFormPage.tsx` | CR-219: the Quote form is a page (create / edit / clone), never a modal |
| `/quotes/:id/containerise` | `quotes/PlanContainerisation.tsx` | Quote-level container plan |
| `/approvals` | `quotes/Approvals.tsx` | Role-gated at nav **and** route |
| `/orders` · `/byorder` · `/kanban` | `orders/OrdersTable` · `ByOrderView` · `pipeline/Kanban` | One nav leaf, `ViewToggle` switches |
| `/orders/new[?quote=<id>]` · `/orders/:id/edit` · `/orders/:id/clone` | `orders/OrderFormPage.tsx` | CR-219: the Sales Order form is a page; `?quote=` = Convert-to-SO |
| `/orders/:id` | `orders/OrderDetail.tsx` | |
| `/orders/:id/containerise` | `quotes/PlanContainerisation.tsx` | The SO's own editable plan copy |
| `/packing` · `/palletizing` · `/packing/:id` | `stages/PalPlans` (×2, `stages` prop) · `PalPlanDetail` | Ready for Palletization (queue) · In Palletization (+ Ready for Loading) — CR-160 |
| `/packing/new[?fromOrder=<soId>]` · `/packing/:id/edit` · `/packing/:id/clone` | `stages/PalPlanFormPage.tsx` | CR-222: Palletization form page (New + Send to Palletization share it) |
| `/loading` · `/loading/:id` | `stages/LoadingBay` · `LoadingDetail` | Loading and Dispatch board |
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

### Onboarding tours (CR-158, CR-159)

First login (per user per browser, `localStorage["tour.seen.v1.<rowid>"]`) shows a welcome
modal offering a guided tour; Next/Back/Skip coach marks then walk the business flow in
sidebar order, navigating to each page and spotlighting its menu item. Role-hidden pages
auto-skip; replay lives under the user menu ("Take a tour"). All logic and step copy in
[`Tour.tsx`](../client/src/features/tour/Tour.tsx) (`TourHost` mounted beside `ConfirmHost`);
anchors are `data-tour` attributes (`nav-<id>` on every sidebar leaf, plus `search`,
`settings`, `usermenu`).

**Page tours** (CR-159): `/packing` and `/loading` each have a process guide that auto-starts
on a user's first visit (`tour.seen.<id>.v1.<rowid>`) and replays via user menu → "Page
guide". Steps may omit `anchor` (centered explainer card) and set `waitMs` (anchor lookup
retries while the lazy page/data loads); `AUTO_TOURS` maps route → tour id. Adding a tour for
another page = a `TOURS` entry + an `AUTO_TOURS` row + `data-tour` attributes on stable
toolbar controls.

---

## 5 · The order-to-dispatch flow

Every state machine below is enforced **server-side** by a transition table; the client
`*Api.ts` copy exists only for labels and for disabling buttons. The server is authoritative —
if the two ever disagree, the server wins and the client is the bug.

| Object | States | Server transition table |
|---|---|---|
| Quote | `Draft → PendingApproval → Approved → Sent → Accepted`; `Rejected` from PendingApproval/Sent/Accepted, back to PendingApproval. Terminal `Converted` / `PartiallyConverted` are set by conversion, not by this map. | `QUOTE_TRANSITIONS` [`index.js:1029`](../functions/data-ops/index.js#L1029) |
| SalesOrder | `Draft → PendingApproval → Confirmed → InProgress`; `Cancelled` from Confirmed/InProgress and back to Confirmed; `Rejected → PendingApproval`. **Auto roll-up (CR-230/233):** `PartiallyCompleted / Completed` written by `rollupSoStatus` after every `recountOrderItems` — SO status is the order LIFECYCLE only; palletization + loading progress are derived grid columns / detail fields (`palStatus`, `loadStatus` in `ordersApi.ts`), and `soLiveStatus` is the one display function for grid + detail (dispatched vs ordered over all lines; promote-only, approval states + Cancelled untouched; an SO edit may demote). **Manual (CR-231):** `/so-status` with `manual: true` = any status, reason mandatory. **Edit (CR-232):** `/update-so-with-items` edits lines in place, allowed after work is recorded (worked line: item frozen, qty ≥ palletised/loaded/dispatched, not removable). | `SO_TRANSITIONS` [`index.js:1109`](../functions/data-ops/index.js#L1109) |
| PalPlan (plan) | `Planning → Loading → Completed`; Loading may return to Planning; Completed is terminal | `PAL_TRANSITIONS` [`index.js:2275`](../functions/data-ops/index.js#L2275) |
| PalPlan (line) | `Planning → Palletizing → ReadyToLoad`, freely reversible among the three | `PAL_LINE_TRANSITIONS` [`index.js:2281`](../functions/data-ops/index.js#L2281), mirrored [`palPlansApi.ts:35`](../client/src/features/stages/palPlansApi.ts#L35) |
| LoadBox | `Open → Dispatched` | `/load-box-dispatch` [`index.js:2948`](../functions/data-ops/index.js#L2948) |
| Production | `New → InProduction → Completed` (auto-stepped) | `PRODUCTION_STAGE_ORDER` [`productionApi.ts:433`](../client/src/features/stages/productionApi.ts#L433) |
| PanelOrder | `Received → InCutting → Ready → Dispatched`, **forward-only** | `PANEL_ORDER_TRANSITIONS` [`index.js:2378`](../functions/data-ops/index.js#L2378) |

Line-status labels differ from their stored values and the labels are what users say:
`Planning` = **"Ready for Palletization"**, `Palletizing` = **"In Palletization"**,
`ReadyToLoad` = **"Ready for Loading"** ([`palPlansApi.ts:40-45`](../client/src/features/stages/palPlansApi.ts#L40)).

### 5.1 Quote

Screen `/quotes` → `/quotes/:id`; the form is a page — `/quotes/new`, `/quotes/:id/edit`, `/quotes/:id/clone` (CR-219). Routes `POST /quote-with-items`,
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
  plan reopens in the mode it was saved in. Packing is item-wise (`containerPack.ts`); boxes
  can then be **moved between containers** (⇄ Move on an item inside a container, drag a card
  onto another, or an Adjust-panel suggestion) — a move splits the row and tags the moved
  boxes with the target container's `group`, grouped rows pack into one mixed container
  (fractional fill), and a saved mixed container reseeds as grouped rows, so merges survive
  Save + reopen (CR-188). Backed by the pure optimizer
  [`functions/data-ops/lib/fit.js`](../functions/data-ops/lib/fit.js), which enforces up to four
  co-equal hard caps simultaneously (pallet slots, area m², weight kg, boxes); any cap that is
  null/0 is treated as unconstrained, so mixed pallet types fall out for free.
- Public share link + `pdfmake` PDF.
- Approval runs through `/approvals`, writing `StatusTransition` rows and firing a
  `Notification` to the quote's sales person. **Approver bypass (CR-139, 2026-09-10):** a user
  who can approve the doc type (Admin, or a role-approver) creates quotes born `Approved` and
  SOs born `Confirmed` (convert included), and their edits keep the approved status instead of
  resetting to Draft — the Draft → PendingApproval loop only applies to non-approvers.

### 5.2 Convert → Sales Order

Screen `/orders/new?quote=<id>` (the Sales Order form page in convert mode, CR-219). Route `POST /convert-quote/:rowid`. **Enabled only for `Accepted` or `PartiallyConverted`
quotes.** Full or partial; a partial conversion leaves the quote `PartiallyConverted`.

On conversion the quote's container plan is **snapshotted onto the SO**, which then owns its
own editable copy at `/orders/:id/containerise`. Saving the SO writes only the plan JSON.

**Confirming an SO auto-enqueues production.** Entering `Confirmed` (via `/so-status`, or at
create/convert under the approver bypass) runs `enqueueSoProduction`, seeding `ProductionLog`
plan rows for the order's items. See §5.3 for how those interact with manual requests.

### 5.3 Production

Screen `/prod` — a Kanban board and a Sheet (grid) view of the same rows.

**Production first, then SO allocation (CR-197…200, 2026-09-18).** The factory produces to
**stock**; stock is then allocated to Sales Orders.
- **Record Production** (CR-244, `/prod/record`, header button on `/prod`) is the fast path for
  make-to-stock output: a ruled sheet in the Loading Plan sheet's `.psheet` skin, one row per item —
  Design · Batch No. (blank = auto) · Date (blank = the sheet's Production date) · Qty, plus optional
  Size / Box Brand / Remark columns (ColumnPicker). 20 rows to start, grows as the tail is typed in;
  Enter/↑/↓ walk a column; a copied Excel block pastes across rows (item matched sku → unique name →
  design name, shared with the Excel import). Save is **two requests for any row count**:
  `/production-log` (`stage: "InProduction"`) mints the jobs, then `/production-complete` records every
  row and completes it — that route now takes per-line `production_date`, `box_brand`, `note`. Batches
  mint one by one inside the server loop, so the per-item counter cannot race. A row keeps its `jobId`
  once minted: after a failed completion, Save re-sends only `/production-complete` and the server
  records `qty − already recorded`, so nothing is duplicated. Save errors show in the page foot (a
  sticky toast would cover Save). Pure half + self-check: `productionLogSheetEdit.ts` / `.test.ts`.
- **Start New Production** (CR-234, was one-step "Record New Production") is order-independent and
  creates the **job only**: lines (Item · Qty), details below; Save posts `/production-log` with
  `stage: "InProduction"` (server accepts only `New` | `InProduction`), so the job lands in the In
  Production queue at 0 produced
  ([`ProductionForm.tsx`](../client/src/features/stages/ProductionForm.tsx), `presetLines` prefill).
  Output is logged batch by batch from the row's **+ menu** (CR-235: Start Production · Log
  Production · Complete Production — `plusMenuItems` in `ProductionTable.tsx`, shared `MoreMenu`);
  Batch No. + Box Brand are captured there (`RecordOutputForm`), a blank batch is minted server-side
  (`nextBatchNumber`, CR-211). Over-production stays blocked (`capFor` + server 409).
- **/prod Grid + Sheet are flat, one row per logged batch** (CR-236, `batchRows` in
  `productionSheetEdit.ts`): Production ID/Design/Order/Customer repeat, line-level cells (qty,
  status, +, checkbox, edit inputs) render on a job's first row only; paging, sort, selection and
  band totals stay keyed by job, never by batch row. **Group** (Item · Customer · Order · Size) now
  works on Grid, Sheet and Board. Batch numbers also show on the kanban card + popup, the detail
  Items table, an "Already logged" list in the record dialog, and a Batch No. input on Production
  Completion (CR-237, duplicate-guarded by `assertBatchesAllowed`).
  The SO no longer offers it, and **confirming an SO no longer creates production jobs**
  (`enqueueSoProduction` early-returns; existing open `so-…` jobs still record order-linked).
- **Record Output** captures **Batch + Box Brand** — one Box Brand per item section, stored on
  every record row (`ProductionLog.box_brand`). It is **prefilled from the orders**: the SO's brand
  on an order-linked line, else the brand most in demand among open orders waiting on that item.
- **What to produce** is derived, never stored ([`needProduction.ts`](../client/src/lib/needProduction.ts)):
  each open order line reads *Allocated / Stock ready / Partial stock / In production / Need
  production*, lines of one item sharing its free stock first-come by SO. `/prod` ▸ **To Produce**
  ([`ToProduce.tsx`](../client/src/features/stages/ToProduce.tsx)) lists per item the open demand,
  free stock, in production, need-production and the Box Brand wanted; ticked rows prefill a job.
- **Allocate Stock** (SO ▸ More) hands free boxes of chosen batches to an order line — see §6.2a. The modal is one flat table (item row → batch rows: Batch ·
  Available · Allocate) with an item search (CR-219); the Items-card button shows while ANY line
  is Stock ready / Partial stock — per line, never the header label (CR-220).

**Sheet edit mode** (sheet view only). **Edit** turns three columns editable across every row —
**In Production** (the plan qty, `qty_requested`), **Produced** (boxes made now) and **Status** —
and nothing is written until **Save**. Edits are staged in a draft keyed by plan-line id; caps and
lock rules live in [`productionSheetEdit.ts`](../client/src/features/stages/productionSheetEdit.ts)
(`resolveSheetEdit`, self-checked by `productionSheetEdit.test.ts`), so an invalid cell disables
Save instead of firing a doomed request. Save runs per row, in order:
`POST /production-update` → `POST /production-record` → `POST /production-stage` (stage last, so an
explicit choice outranks the auto-step). It is sequential and non-atomic; failed rows stay in the
draft with a per-row toast. Inline output leaves the batch blank, so the server mints `B/YYYY-MM/NNN` (per item per month) —
a specific batch still means the `+` dialog. In Production is locked once a line has output
(`/production-update` refuses it). Outside edit mode the sheet behaves as before: Status commits on
change, `+` opens Record Output.

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
once the item carries stock. Batch numbers are auto-minted `B/YYYY-MM/NNN` — a per-item series that restarts at 001 each calendar month. Duplicate batch on the
same item is always `409`; across items it is governed by
`AppSetting.allow_duplicate_batches`.

**Opening stock.** `POST /opening-stock/:designId`. Batched items store opening as
`ProductionLog` rows with `entry_type="opening"`, one per batch; singular items keep the single
`accounting_stock` number. **Locked after the first save** (`null` = still unlocked). An admin
may re-edit, but only with a required reason, which lands in `OperationLog`.

**Excel import.** `/prod` → Import (`ProductionImport.tsx`). No re-upload dedupe — importing
the same file twice will double-count.

**Auto-queued vs manual** (legacy — no new `so-…` jobs since CR-198). An auto-enqueued `so-…` job counts as in-production only **once
touched**. An untouched auto job is superseded by a manual request for the same item, so
confirming an SO and then raising the request by hand does not double-count.

**Remaining / Desired** defaults to `ordered − produced − inflight − stock` — a **hint only
since CR-131 (2026-09-10)**: the qty input has no upper clamp, covered lines/SOs stay
requestable, and the server cap against `ordered` is gone. The order-completion *filters* are
deliberately **not** stock-adjusted.

### 5.4 Palletization

**Two sidebar pages over one board since 2026-09-14 (CR-160)**: `/packing` **Ready for
Palletization** (the Planning queue only) and `/palletizing` **In Palletization** (the Palletizing
stage only since CR-170 — a `ReadyToLoad` line whose whole batch is palletised leaves for the
**Ready for Loading** section of `/loading`; a gated slice stays here wearing a **Recorded** chip,
CR-176, while the unrecorded rows of a partially palletised item read **Partial**). Same
`PalPlans` component scoped by a `stages` prop; both nav leaves share feature id `packing`.
Kanban/Sheet toggle, Group, Today's Report and New Palletization Plan sit on both. The Sheet is
ColumnDef-driven (CR-161: Customer, Item, Order, Batch, Boxes, Ordered, Completed, Remaining, Age,
**PAL** last and hideable; checkbox / edit inputs / "+" cell fixed) and has **no stage band**.
The Sheet ends in a **`TotalsRow` tfoot** (CR-187, same shape as /loading): "Total · N pallets"
in the first visible column, Boxes / Ordered / Completed / Remaining sums under their own headers
(Ordered/Completed deduped per order item). Under the grid (both views) sits the **totals /
selection bar** (CR-178): idle it reads **Total · N pallets · N boxes** in Kanban only (`palletsOf`;
blank on the Sheet, whose tfoot carries the totals), with rows ticked it reads *N selected · N boxes*
+ actions. Every row
carries the one "+" menu (CR-168). Sheet **Edit** mode (CR-153) stages Palletise qty / Top Up
donor per row; **✓ / ✗ per row** commit or discard that row alone, the header Save (N) commits
all (CR-169).
Plans are `PAL/FY/NNN` and may span sales orders. Plan detail (`/packing/:id`) is Edit + More + ✕
only — the legacy plan-level Begin Dispatch / Mark Dispatched / Assign Vehicle buttons went in
CR-163; dispatch is per LoadBox and the plan status follows.

**Three columns**: *Ready for Palletization* (grouped by SO) → *In Palletization*
→ *Ready for Loading*. **Two-step flow since 2026-09-04** (reverses the 2026-08-27 one-hop):
All per-card/row actions live in **one "+" menu** (CR-150; shared `MoreMenu`, three options
always listed, inapplicable ones greyed): **Start Palletisation** confirms the pallet
(`PalletiseModal`) and moves the line to *In Palletization* (`Palletizing`); **Top Up Batch**
is the CR-149 Mix Batch flow; **Complete Palletisation** (CR-148, was "Record Palletised")
records the finished boxes to *Ready for Loading* (`ReadyToLoad`) — always through the dialog,
pallet and full qty prefilled. On a queue line, Complete records straight to Ready for
Loading, skipping In Palletization (the old "+" shortcut).
**Partial palletise (CR-132, 2026-09-10):** the dialog takes a per-line Boxes qty; less than
the full line splits it via `/pal-line-status` `boxes` — only the slice transitions, the
remainder keeps its column, so a partial never lands the whole line in Ready for Loading.
This is the recording mechanic behind CR-148: 700 today, 300 tomorrow, batch identity riding
each slice.
**Batch-complete loading gate (CR-151, 2026-09-12):** a `ReadyToLoad` slice is *loadable* only
when its whole batch group (order item + `batch_number`; blank batch = whole order item) is
fully palletised — every sibling line `ReadyToLoad` or already boxed. Until then the slice
stays in the *In Palletization* column (its "+" menu's Complete greyed as already recorded)
and is absent from every loading pool: the board's Load/`LoadContainerModal`, the
LoadingWorkspace Items tab, and the New Loading modal. Client predicate `loadableLineIds`
([`palLoadGate.ts`](../client/src/features/stages/palLoadGate.ts), re-exported from
`palPlansApi`); server backstop `assertBatchesComplete` rejects `/pal-lines-box` and
`/pal-line-box` with 409 for incomplete groups.
**Pallet Slips (CR-148):** printed **on demand only** (auto-fires removed 2026-09-12 — the
user verifies first): **one slip per physical pallet** (`packingReportPdf.ts`
`downloadPalletSlipsForEntries`) — batch-sequential, batch number on every page,
`pallet_group` mixed pallets as one slip listing every batch. The tabular Pallet Packing
Report and Pallet Slips both sit on the board's selection bar (plus PalPlanDetail, Today's
Report).
**Sheet edit mode (CR-153, 2026-09-12):** the Sheet gained an always-on **Boxes** column and
an **Edit** button (same pattern as the /prod sheet): Edit adds a **Palletise** qty cell
(record palletised boxes inline — a partial qty splits the line, same `/pal-line-status`
call as the dialog) and a **Top Up From** donor-batch Combobox (donor + qty = the CR-149
Mix Batch top-up via `/pal-topup`). Nothing writes until **Save**; per-row validation lives
in the pure [`palSheetEdit.ts`](../client/src/features/stages/palSheetEdit.ts)
(`resolvePalSheetEdit`, self-checked by `palSheetEdit.test.ts`) so a bad cell red-borders
and disables Save. Recording is **per row** — a Mix Batch row does not pull its
`pallet_group` siblings here; the "+" menu's Complete still records the whole physical
pallet together.

**Loading starts on this board (2026-09-04).** Ready-for-Loading cards/rows carry the **Load**
button (and load-together checkboxes): it opens `LoadContainerModal` through the shared
[`useLoadFlow`](../client/src/features/stages/useLoadFlow.ts) hook — the same all-or-nothing
`POST /pal-lines-box` confirm `/loading` used to own. `/loading` no longer shows un-boxed lines.

- Two entry points share `PalPlanForm`: **New** plan, and **Send to Palletise** from an order.
  A change to one almost always belongs in both — check before shipping one side.
  **Layouts differ since CR-223:** New is customer-first (CR-224: required Customer
  Combobox on top of the Plan section, no rail —
  customer → all their orders → design rows with read-only Produced + Batches); Send to
  Palletise, Edit and Clone keep the single-order sections. One customer per plan, many SOs.
- **Batch attribution on create (CR-223):** the form plans per design; `createPalPlan` runs
  `attributeBatches`, splitting each batch-less line FIFO over `unqueuedBatches` (§6.4) and
  carrying Box Brand. Boxes planned beyond production stay one blank-batch line.
- Multi-select checkboxes on the board open `PalletiseModal`.
- Pallet details prefill from the SO's container plan
  ([`containerPlanPrefill.ts`](../client/src/features/stages/containerPlanPrefill.ts)); the
  pallet picker on Record Output is hidden.
- **Mix Batch top-up (CR-149)** — "Top Up Batch" in the "+" menu on In-Palletization
  cards/rows (`TopUpModal`) moves boxes from a same-design queue line (donor list is
  same-design only) onto the open pallet via `POST /pal-topup/:rowid`, stamping
  `pallet_group` on both ends. Complete Palletisation then records the whole group together
  and the pallet slip prints it as one page listing every batch.
- **One batch per customer** is the target: plan lines are per-batch, and a mixed-batch pallet
  raises a warning rather than a block.
- Pallet QR labels (`palletQrPdf.ts`), batch QR slips (`batchQrPdf.ts`), pallet slips
  (`palletSlipPdf.ts`) — all `pdfmake`, all with a public scan page.

**Every production record tops up the item's planning queue** (`produced − palletized`, capped
at `ordered`) on one reused open plan per SO — `autoEnqueuePalletization`. **Manual edits pin
the plan (CR-129, 2026-09-10):** `/pal-plan` and `/update-pal-plan` stamp their lines
`manual_edit`; an item with a manual Planning line is skipped by the top-up (the un-queued
remainder stays in the work list for the user to queue as another line). Plan edits replace
**Planning lines only** — advanced lines keep their status/box/pallet-group — and total planned
boxes per order item across all lines/plans are capped at the SO ordered qty
(`assertPlanWithinOrdered`, mirrored by the form clamp).

### 5.5 Loading and Dispatch

Screen `/loading` (Sheet + Loadings grid + Customer Sheet; Workspace and kanban hidden, code
kept), detail at `/loading/:id`. Nav label renamed **"Loading and Dispatch"** 2026-09-04.

**Ready for Loading lives here since CR-170 (2026-09-14).** The Sheet's first stage is *Ready
for Loading*: un-boxed `ReadyToLoad` lines that pass `loadableLineIds` (whole batch palletised).
Their "+" menu has one item, **Load**, which opens `LoadContainerModal` through `useLoadFlow`
(the same flow the palletization board used until CR-170). Then *In Loading* → *Ready for
Dispatch* → *Dispatched* as before. The Sheet and the Loadings grid end in a **Total · N pallets /
Σ boxes** footer (CR-171). **Sheet Edit mode (CR-173):** per Open-box line a *Loaded* qty (fewer
→ remainder back to Ready for Loading) and a *Container* Combobox (another Open loading, or
Unload); pure resolver [`loadSheetEdit.ts`](../client/src/features/stages/loadSheetEdit.ts),
commits via `/pal-line-box`; per-row ✓ / ✗ or the header Save (CR-169). **Loadings grid
customers/orders** fall back per field from loaded lines → plan JSON → live order heads (CR-174).
**New Loading** also starts from the Sales Order detail (More → New Loading / Items-card button,
CR-175) — `/loading/new?so=<id>`, that SO only, no customer rail.

**Workspace (CR-145, 2026-09-11; hidden since CR-172, 2026-09-14).** Was the default `/loading` view, from the Claude Design
"Loading Sheet" spec — structure/UX from the design, house skin. Pick Customer + Sales Order
(Comboboxes; SO options newest-first from the orders cache), then an SO summary strip (ordered /
planned / palletised / balance boxes, planned %) and three tabs:
**Items** — the SO's items split into *Ready for Loading* (multi-select → target container
picker → **Assign to Loading** modal: per-item load quantity clamped to ready stock,
`allocateFifo` → `/pal-lines-box` all-or-nothing into an existing Open box or one minted by
`/load-box` with the capture fields — container no / size / vehicle / transporter / LR / seals /
destination — all optional, Confirm Load still works later) and *In Palletisation* (read-only
`palletizedQty/orderQty` progress + batches; "Palletise" links to `/packing` — palletising never
happens here). **Container Plan** — the SO's LoadBoxes as cards (fill bar via `boxFill`, status
chip, delete when empty): one row per pallet line, whole-line **Move** between containers /
new / out via `/pal-line-box` (quantities split only at assign time), an amber "Ready, not in
any container" strip with per-item Add-to, and an Add-container card (28ft/30ft). **Loading
Sheet** — `LoadingCustomerSheet` scoped by its new `soFilter` prop (same columns/edit mode, SO
rows only, customer picker hidden). View in
[`LoadingWorkspace.tsx`](../client/src/features/stages/LoadingWorkspace.tsx); zero server
changes.

**Customer Sheet (CR-140, 2026-09-10).** Fourth `/loading` view: pick one customer and see
every loaded line across all their SOs as the export-style loading sheet — grouped by container
(merged Sr / L.R. / Truck / Container / seal cells), P.O. per SO run, design/size/finish/batch
per line (the Design cell prints the design name alone since CR-183 — Size and Finish have their
own columns), **Pallet No.** (typable since CR-184: `PalletizationPlanLine.pallet_no` wins, blank
= the auto running range "1 TO 16" from `ceil(boxes / boxesPerPallet)`, shown grey; one rule,
`palletNumbers()`, shared with the Dispatch Entry / Dispatch Copy prints), a typed **Pallet type**
(`PalletizationPlanLine.pallet_type`, blank stays blank — CR-208 dropped the Pallet master A/B
arrangement columns and Pallet 2), and a Total footer. Line columns run Design → Size → Finish →
Batch → Box Brand → Pallet No. → Boxes → Pallet type; **Box Brand is read-only** (line brand from
the production record → the order's → the customer default, CR-208). The sheet
wears the standard `.tbl` grid inside its rounded card since CR-186 (the one-off full-border
`ruled` variant is gone). **Truck No. is a typable cell (CR-185)** — the save resolves the
registration to a Vehicle row via `resolveVehicle()`. **Always editable
in place since CR-145** (no Edit toggle, rows don't navigate): the load-detail captures
(P.O. → `SalesOrder.po_number`, L.R./truck/container/seals → `/load-box-update`) plus the
per-line Pallet No. / Pallet type; **Box Brand** is shown read-only since CR-208 (Brand master, relabeled "Box Brand" 2026-09-11 — the short-lived
separate BoxBrand table was merged into it; **Quote and SalesOrder carry `box_brand` too since
2026-09-14 (CR-162)** — a Box Brand Combobox on both forms, DB-sourced from the Brand master,
prefilled from the customer's default, carried by `/convert-quote`; **the master carries an
image since CR-181** (`Brand.logo` = File Store file id, uploaded on the Box Brand master form via
`ImageUploader` — a single-image click-or-drop tile with Replace/Remove since CR-189 —, shown as a thumbnail in the Combobox popup and as a preview beside the field on
the Quote, SO and Customer forms — `useBoxBrands()` in `masters/boxBrands.tsx`); the free-text
`SalesOrder.box_branding` is retired (read-only on old orders). Sheet precedence is line
brand → SO brand → customer default; customer default on `Customer.box_brand`,
line brand on `PalletizationPlanLine.box_brand`, stamped from the production record) stage into drafts — Save/Cancel appear once
dirty and save sequentially — pure diff/range logic in
[`customerSheetEdit.ts`](../client/src/features/stages/customerSheetEdit.ts), view in
[`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx).

**Loading-first sheet (CR-141, 2026-09-10).** The Sheet's pinned first column is **Loading** —
`boxLabel` (LOAD/FY/NNN, vehicle-number or "Container N" fallback) — not the display-only
PAL-NNN pallet sequence (which stays on `/packing`); the redundant Container column is gone and
the advanced-filter facet is labelled "Loading" (key `container` retained for saved filters).
**Group by offers Customer only** for now, on both kanban and sheet; stale persisted
`loading.groups` selections filter out on read.

**Dispatch is always listed for an Open loading (CR-166, 2026-09-14)** — in the row "+" menus
and the detail More menu — greyed with the reason from the shared `dispatchGate(box, lineCount)`
(Already dispatched / Assign a vehicle first / Load at least one item first; the server's exact
rule). Seals are **not** a gate: blank container no. / seals / transporter / LR / destination /
supervisor only warn — `dispatchConfirmMessage` lists them in the Dispatch confirm and
`/loading/:id` shows a standing amber note (`missingLoadDetails`) while the loading is open.
The detail header is **Edit** (vehicle + load details) + **More** (CR-167); the row "+" kebab
stays on the grids. Sheet/Loadings-grid columns: Customer, Design lead and the LOAD code is a
normal last, hideable column (CR-161, keys `loadingColumns.v2` / `loadingBoxColumns.v2`).

**Three stages, all derived** — nothing stores them. Un-boxed lines (including Ready for
Loading) live on `/packing` / `/palletizing` since 2026-09-04 / 2026-09-14; this board holds boxed lines only:

| Stage | Derived from |
|---|---|
| In Loading | line is in an `Open` box |
| Ready for Dispatch | `Open` box **with** a container number or line seal captured |
| Dispatched | box status is `Dispatched` |

**Plan-only loadings are visible everywhere (CR-127, 2026-09-09).** A loading minted by the
SO-first flow has a `load_plan` but no boxed lines, so it produces no line rows. Every view
now surfaces it: the Loadings grid derives Customers/Orders/Boxes from the plan JSON (SO
ROWIDs resolved via pal-plan lines, then the orders cache), the sheet shows one **Planned**
summary row per such box at the top, and the kanban shows the dashed stub card in In Loading —
in grouped mode as a "Planned / empty loadings" strip above the lanes. Search matches the
stub's LOAD number / SOs / customers. Planned is a presentation state, not a fourth stage.
The detail page follows suit (CR-128, 2026-09-09): with nothing loaded, Loaded Items renders
the plan lines as **Planned** rows, header counts and the subtitle read from the plan,
Container Planning resolves its SOs from the plan JSON, and Details shows Order(s) / Customer /
Planned Boxes. Edit Load Details saves without a vehicle (the server always allowed it;
dispatch still requires one), so seals/transporter/LR can be captured on their own.

**Vehicle is free text (CR-185, 2026-09-14).** Assign Vehicle / Edit Load Details, the new-container
form (Load / Send to Loading / Add Items) and the Loading Sheet's Truck No. cell all take a typed
Vehicle Number (auto-formatted `SS-DD-LL-NNNN`), Driver Name and Mobile — no Combobox, no
"New vehicle" step, nothing required. `resolveVehicle()` (`masters/vehiclesApi.ts`) keeps the
Vehicle master in sync silently: match by formatted number on a fresh list, update driver/mobile
when typed and different, else create. `LoadBox.vehicle` stays an FK to that row, so every
display, report, the QR share page and the dispatch gate are unchanged; the Vehicle master under
Settings is a reference list. **Prints show the design name only (CR-183):** the Dispatch Entry,
Dispatch Copy PDF and pallet QR label print `PalPlanLine.designName` (not the composite
`unique_name`) and no PAL code; their Pallet No. column is the sheet's manual-or-auto number.

**Container-first for pallet loads; New Loading is a two-step page (CR-203, merged by CR-225).** `LoadContainerModal`
replaced the old box picker at the multi-select Load entry points (/packing's Load button);
the load confirm + SO-plan hint live in the shared `useLoadFlow` hook, and the confirm now
lands on the loading's **detail page** (`/loading/:id`). Since CR-144 (2026-09-10, undoing
the CR-143 workspace) "New Loading" was a modal; since **CR-203 (2026-09-18)** it opens the
**Loading Session page** ([`LoadingSession.tsx`](../client/src/features/stages/LoadingSession.tsx);
`/loading/new[?so=<id>]`, then `/loading/:id/session?step=1|2` once the LoadBox exists) — a
step strip (`.steps`) over two steps (three until CR-225), each with a sticky Cancel/Back + Save footer
(`.session-foot`): **1 Select items** ([`SessionItemsStep.tsx`](../client/src/features/stages/SessionItemsStep.tsx)),
**2 Seals, sheet & vehicle** (CR-225 — the vehicle is assigned looking at designs + boxes, so the
sheet comes first and owns Truck / Container / seals / LR; under it the shared
[`LoadDetailsFields`](../client/src/features/stages/LoadDetailsFields.tsx) field set with
`sheetOwned` — Driver, Mobile, Size, Transporter, Destination, Supervisor for this container — the same
one `VehicleLoadModal` renders in full; Save = sheet save, then `/load-box-update` + `resolveVehicle`
for those fields;
`LoadingCustomerSheet` fixed to the customer's **Open** containers, one merged row-group each,
plus a checks card and a warn-only duplicate container-no./seal check across all loadings —
pure [`sealChecks.ts`](../client/src/features/stages/sealChecks.ts) + self-check). Save on step 2
lands on the loading detail; Dispatch stays there. `NewLoadingModal.tsx` is **deleted**.
Step 1 is the CR-201/202 pick list unchanged (superseding CR-194's pickers): the **left rail**
lists customers with Ready-for-Loading stock (one customer per container); the **right pane**
lists every order of the picked customer as SO bands → one row per batch
(Design · Box Brand · Batch · Ready · Load; the design's first batch row carries the Design +
Box Brand), shaped by the pure
[`newLoadingRows.ts`](../client/src/features/stages/newLoadingRows.ts). Since **CR-204
(2026-09-19)** there is no "N batches" summary row and no design-level quantity — Load is typed
per batch (Fill from plan still spreads FIFO); the page has no title block (the step strip carries Back + the loading label · customer); the rail has a customer search and the pane a
design search (matches design name or SO number; **display-only** — picked/totals/save read the
unfiltered bands), and the rail + pane fill the viewport and scroll independently
(`.session-fill`; page scroll returns on the stacked mobile layout). Any mix of orders and
designs loads into the one container. The SO's saved containerisation plan is a **helper**: a
per-SO **Fill from plan** button prefills the next not-yet-sent container's quantities — nothing
is hidden or locked by the plan. Partly palletised batches stay listed, greyed, with their
"N/M palletised" reason. No container size here — size, number, vehicle and seals are step 2.

**⚠ Since CR-240 (2026-09-21) the session is ONE scrolling page with no steps** — the step strip,
`?step=`, the "Seals, sheet & vehicle" step and its checks card are gone. It serves **New Loading**
and the loading detail's **Edit** (`/loading/:id/session`; the old Edit modal and the More-menu
Add Pallets / Add Items are removed from `/loading/:id`). Sections top → bottom, one Save:
**Loaded items** (edit only — typed Boxes, fewer = the rest returns to Ready for Loading, 0 / ✕ =
remove; ops from the pure `resolveLoadSheetEdit`, sent via `/pal-line-box`) → **Add pallets** (the
pick list above, render-only `SessionItemsStep` fed by the page's `useSessionPick`, in a fixed
460px window) → **Add items** (CR-241 — inline direct send, the customer's order items with
`remainingOf > 0`, one `/send-to-loading` per SO; replaces the modal's `presetBoxId` use) →
**Vehicle & load details** (the full `LoadDetailsFields`, warn-only duplicate-seal banner). Save
order: `resolveVehicle` → (new: `/load-box` with load_plan + vehicle + typed captures) → unload /
shrink → `/pal-lines-box` → `/send-to-loading` → `/load-box-update` (diff). It stops at the first
failure, keeps what saved, reloads; a new loading minted before the failure re-opens as its own
edit page so a retry never mints a second. A dispatched loading shows the details section only.
The ruled Loading Sheet is NOT on this page — it lives on the detail's Loading Sheet tab, whose
columns now lead with **Design · Batch · P.O. No.** (CR-243; P.O. No. kept).

**Loading Plan page — TRIAL (CR-227)** ([`LoadingPlanPage.tsx`](../client/src/features/stages/LoadingPlanPage.tsx);
`/loading/plan[?so=<id>]`, then `/loading/:id/plan?step=1|2`; opened by **New Loading (sheet)** on
`/loading`). A second skin over the same flow, from the `Plan.dc.html` mock in app tokens
(`.psheet-*`): **1 Item selection** ([`PlanSheetStep.tsx`](../client/src/features/stages/PlanSheetStep.tsx) —
toolbar with an All customers | Selected customer toggle and the Columns picker (text columns
show/hide, Size hidden by default), ruled sheet **grouped by customer** (CR-228: Customer column
first, then a gap; no subtotals, no Fill / Load-all buttons, no fill indicators, no vehicle fields),
collapsible customer bands, Qty to load the only typed cell, status chips, sticky totals) and **2 Vehicle assignment** (full `LoadDetailsFields` — vehicle, loading details and
seals on one form — beside the loaded items + live checks). Both pages share the selection/save
hook `useSessionPick` in `SessionItemsStep.tsx`. Same endpoints, same rules (one customer, one container per save). If approved it
replaces `/loading/new`; if not, delete the two files, the routes, the button and `.psheet-*`.
**One session = one loading**: the
LoadBox is minted via `POST /load-box` with a single-slice `load_plan` snapshot (no
`group`, so the CR-127/128 Planned-row fallbacks still render if the allocation fails),
then the picked per-line quantities land via the
all-or-nothing `POST /pal-lines-box` (partial takes split server-side); you land on step 2.
The detail header's Edit still opens Edit Load Details for a quick change. The loading
detail's **Add Pallets** opens step 1 of that loading's session (no new LoadBox, customer
locked to the loading's; Save with nothing picked just moves on). The CR-143 queue board, `StartLoadingModal`,
the `/loading/:id/plan` pallet-first workspace and `virtualPallets.ts` are **deleted**;
`/loading` opens on the Workspace view since CR-145 (a persisted "board" view key falls back
to kanban).
The Container Planning tab on the loading detail still embeds the full editable SO planner
(`PlanSoContainerisation soId embedded`).

**Multi-select loading (2026-08-31).** The modal takes `lines: PalPlanLine[]`: checked Ready
items plus the clicked one all appear in it (table with a per-line fit readout — "All N" /
"N of M — rest stays in Ready" / "Won't fit"), and "Load selected" opens the same modal instead
of writing straight from a dropdown. Save goes through `POST /pal-lines-box` — one
all-or-nothing batch call (validates the container and every line before any write); the
per-line `POST /pal-line-box/:rowid` remains for unload. Containers display as **"Container N"**
(`boxLabel`), never "Box N".

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

**Panel images (CR-192).** `Panel.image_urls` holds the same JSON list as `Design.image_urls`,
served by the public `design-image` endpoint. Reps see them at every touchpoint: the New Panel
Order picker is a tile grid, the form shows all images of the picked panel, and a front-view thumb
sits on the orders board/sheet, the `/panels` grid and both Showcase Panels tables — all via the
shared `ImageThumb` / `ImageLightbox` in
[`features/common/ImageLightbox.tsx`](../client/src/features/common/ImageLightbox.tsx), which
`ImageManager` (Item/Panel detail) also uses.

**One sale, several panels (CR-193).** A `PanelOrder` row is still one panel × qty. The New
Panel Order form multi-picks panels and writes one row per panel (shared customer, date, sales
person) — deliberately not a header + lines model, so the forward-only stock machine and the
board stay per-panel. A shared sale reference is the next step if the sale must be grouped.

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

### 6.2a Allocation and free stock (CR-199)

An allocation is a `ProductionLog` row with `entry_type="alloc"` (design, batch, order item, SO,
boxes, the batch's box brand). It is a **claim, never supply**: `batchStockApi` does not feed it
to `deriveBatchStock`, and `designStock()` subtracts `allocated` so the boxes are not counted in
both the SO line's `producedQty` and the stock output they came from — **on-hand is unchanged by
allocating**. What changes is **free** stock:

`free(design, batch) = max(0, current − Σ per order item max(0, claim − its loaded boxes))`

where a claim is order-linked output (record / legacy plan rows) plus allocations; an order
item's blank-batch loads net its claims FIFO (`reservedByBatch` / `freeOf` in
[`batchStockDerive.ts`](../client/src/features/stages/batchStockDerive.ts), self-checked).
`POST /allocate-stock` re-checks with `serverFreeStock` (a permissive backstop), bumps
`produced_qty_boxes`, inserts the rows and calls `autoEnqueuePalletization` — so the queue,
palletising, loading and dispatch are untouched. `POST /deallocate-stock/:rowid` refuses once the
boxes left the Planning queue, trims auto Planning cards, and blocks on a manual one. Cancelling
an SO releases its allocations; deleting stock output that orders hold is refused;
`/send-to-loading` caps at `min(ordered, produced) − palletized`.

**Container fill may exceed 100% (CR-195/196).** The Load Container modal and the planner's move
prompt each carry an *Override* tick. The planner flag is group-level (`over` on the rows and on
the saved plan container); `fillPct` is unclamped. Never treat fill ≤ 1 as an invariant.

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
per batch = `Σ ProductionLog record + alloc qty − Σ boxes already enqueued for that batch (any status)`
(also returning the batch's box brand, which the new plan line inherits),
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
Detail pages' Activity/Status tabs filter server-side (`?where=` on `entity_rowid`, else
`table_name` — CR-128); the old global newest-N fetch dropped older records' history.

---

## 8 · House standards

These are binding. They were learned from correction, and re-deriving them costs more than
reading them. A change to any of these is a change **everywhere the pattern exists**, not just
where it was reported.

**Grids** — every list grid: one-line rows (`.nw` / `.clip`, cap on the span, not the `td`);
footer pager; data-driven column defs with show/hide **and** reorder (`useColumns`, icon-only
`ColumnPicker`); advanced-search modal; Created/Modified hidden by default; **whole row** clicks
through to the detail page; newest-first default sort (`useSortRows(..., "created", -1)`).

**Default view.** Every page with a Kanban/Sheet switch (`/prod`, `/packing`, `/loading`,
`/panel-orders`) opens on **Sheet/Grid**. The default is org-wide and settable — Settings →
Preferences → *Default view* writes `AppSetting.default_view` (`sheet` | `kanban`, missing row =
`sheet`). Boards seed from it through `useViewState` ([`usePersistedState.ts`](../client/src/lib/usePersistedState.ts));
a user's own toggle still wins for the rest of that browser session. Never hard-code a view
default in a page — go through `useViewState` so the setting keeps reaching every board.

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
**always right-aligned** and are always **`Edit` + `More` (+ ✕)** — Edit is never hidden, only
disabled with a reason when the record is locked (CR-167, 2026-09-14: Loading detail's header
"+" became Edit + More, Production detail's Edit left the More menu, Plan detail keeps Edit on
Completed plans). The "+" kebab is a grid-ROW idiom only (CR-168). The Purchase Order detail
(`/po/:id`, not in the sidebar) has no edit form and no Edit — flagged, not built.
Every detail page's More menu carries **Clone**, which seeds the
create form from the record and saves as new, never copying auto-generated identity fields.
The left sibling-list rail is extracted as [`DetailRail`](../client/src/features/common/DetailRail.tsx)
(CR-154, 2026-09-12) — PalPlan and Loading detail use it (Loading detail gained the rail then;
the other detail pages still carry the inline copy) and both rows read **customer · status
above, the PAL/LOAD code (mono) below** (CR-179, 2026-09-14 — swapped from code-first).

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

- **ZCQL `LIKE` uses `*`, never `%`** (CR-209). A `%` pattern silently matches nothing.
- **Mutations that move OrderItem counters invalidate the orders cache** — `palPlansApi.bust`,
  `productionApi.bust`, `bustStageCaches` all fan out; `useOrders` refetches on invalidation, and
  `createListCache` drops fetches that started before the invalidate (CR-213).
- **Pallet pick lists = `palletsForSize`** ([`palletSize.ts`](../client/src/features/masters/palletSize.ts)):
  full `WxH` match, size-less pallets always offered. Never re-implement the filter per form (CR-217).
- **Spelling: Palletization / palletized** in all user-visible copy (CR-218).

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

**Hardened 2026-09-19** (CR-205…207):

- **Uploads** — `/upload/design-image` accepts raster images only, judged by magic bytes
  ([`lib/sniffImage.js`](../functions/data-ops/lib/sniffImage.js)); the stored extension is made
  to match the bytes. The public `design-image` route is same-origin with the app, so every
  response carries `X-Content-Type-Options: nosniff` and a sandboxing CSP — a legacy SVG renders
  in `<img>` but can never run script as a page.
- **Guard lookup is case-insensitive** for `ROUTE_PERM`, matching Express's routing. Table names
  are exact-case end to end.
- **State columns are closed to the generic CRUD on insert as well as update** — one list,
  `STATE_COLUMNS` in `index.js`. Quote and SalesOrder cannot be inserted generically at all;
  born status is decided by `canApprove` in their own create routes. A new status-machine table
  adds its column to that list.

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
node client/src/lib/needProduction.check.ts
node client/src/features/masters/palletSize.check.ts
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
