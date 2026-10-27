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
| [`DATA-FLOW.md`](DATA-FLOW.md) | **Who may change what, and where the rule lives.** Every mutation path (server route + client surface) per entity, the owner helper of each rule, and the register of paths that diverge. Read its row before touching how an entity is created / edited / deleted / re-statused. |
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
      appauth.js   app-level auth + role matrix  — 12 /auth/* routes (+ Zoho OAuth legs)
      zoho.js      Zoho OAuth + Books/CRM API helpers; PROVIDERS, ACTIVE_PROVIDER; /zoho/:provider/* routes (CR-324/325/356/359)
      customerSync.js  provider-agnostic customer sync core: watermark pull, import, push (CR-359)
      crmSync.js   Zoho CRM Accounts adapter — the ACTIVE customer source (CR-359); Books zcrm_account_id check → books_contact_id (CR-362)
      booksSync.js Zoho Books adapter — hidden since CR-359, kept (CR-356/358)
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

49 tables. Column-level truth lives in [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md); this is
the map.

**Lookups** — `Organization`, `Brand`, `Grade`, `Size`, `Finish`, `Category`, `Glaze`,
`PartyBrand` (per customer since CR-393), `SurfaceApplication`, `Punch` (with image), `Series`,
`Catalogue` (the four Design Master lookups, CR-394), `PaymentTerm`, `NumberMaster`,
`TransactionSeries`, `Currency`.

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
| **Design / Item** | The sellable tile SKU. UI always says *Item*; the table is `Design`. **Item code (CR-473):** `Design.item_code` = `ABBR-SIZE-NNN` (initials of the design name · Size code · 3 random chars from an unambiguous alphabet), server-stamped on insert / first edit / `POST /backfill-item-codes`, never typed, never reused — the catalog code shown on the item page, grid, pickers, ⌘K, Panel Craft Stock, panel lines and the Panel Order PDF. **Design Master spec (CR-391…396, 2026-10-23):** the form is five sections — Main Information (name, Base Design picked from items — Combobox + 🔍 `ItemSearchModal` since CR-434, Design Owner + Custom Design Buyer = Customers, the buyer's brand), Calculations (Size → dims read-only; **Pcs Per Packing typed per item**, coverage ƒx from the item's own numbers, box weight), Design Data (image, random faces, finish, category, surface application, punch type, glaze, grade — **Brand left the form in CR-430**, not required; grid / filter / bulk edit / detail still show it, SKU slot `00`), Working Data (status, batch-tracked, opening stock), Marketing Data (collection, series, catalogue). Owner defaults from AppSetting `default_design_owner`. |
| **Size** | Owns the per-box packing **defaults** — dims, pcs/box, coverage, box weight. Pallets **snapshot** coverage + weight; Items take dims read-only and start their own pcs/box + box weight from it. Editing a Size fans the defaults out ([`/resync-size-snapshots`](../functions/data-ops/index.js) backfills — overwrites typed weights). **Overrides:** box weight on Item + Pallet (CR-133, CR-190) and, since **CR-391, the Item's pcs/box and coverage** are the item's own (coverage stamped server-side from `width × length × pcs`; the fan-out never touches them). Consumers read the **Item's** weight + coverage first (Plan Containerisation Weight Fitting, `/load-container`, `/fit-suggest`), the Pallet format's only as fallback. **CR-427:** every Quote / SO line **freezes** `box_weight_kg` at creation (`designBoxWeights`); Container Planning reads the line's value before the live Item, so a bulk weight edit on Items (Bulk edit ▸ Box Weight) changes only orders made afterwards; `/load-container` + `/fit-suggest` stay live. |
| **Pallet Master** | The master of pallet *formats* — boxes per pallet + weights, nothing per container since CR-261 (an Inventory master). |
| **Container Master** | `ContainerFormat`: what ONE container of a Size holds — pallet formats × count, Σ pallets, Σ boxes. A Size may have several (CR-273); the loading picks the one it uses (`LoadBox.container_format`), readers with no pick take the size's largest. The planner's Box Fitting picks one per ROW — a Container column after Pallet Type on every item row, narrowed to the containers built from that row's pallet (CR-300; was one per Size in a toolbar strip, CR-274) — saved per container as `containerFormat` and a loading made from the plan starts on that pick. The only source of per-container capacity (fill %, planner box fitting, quote Suitable Containers). CR-261. |
| **Palletization** | The *process* under Sales that consumes pallet formats. **Never** merge the two — they are different things with similar names. |
| **Batch** | A production run of one item, numbered `B/YYYY-MM/NNN` (series per item per calendar month; format changed 2026-09-04, older batches keep `B/FY/NNN`). Unique per item always; cross-item reuse is allowed by default, controlled by `AppSetting.allow_duplicate_batches`. |
| **PalPlan** | A `PalletizationPlan`, numbered `PAL/FY/NNN`. Can span multiple sales orders. |
| **LoadBox** | A vehicle/container slot that boxes are loaded into. Cross-plan. Numbered `LOAD/FY/NNN` (`load_number`, since 2026-09-04; the MAX-scan uses ZCQL's `*` wildcard — `%` matches nothing, CR-209; older boxes fall back to vehicle / "Container N"). One LoadBox = one container; a multi-container loading plan groups sibling LoadBoxes via `load_plan.group`. |
| **Customer** | Always "Customer" in the UI — never "Party", despite `Parties.tsx`. Customers toolbar (CR-463/466): no status pills — Working Status is a field of the Search Customers modal; **New customer** + a caret `MoreMenu` (From Zoho CRM picker; Admin-only Refresh from Zoho CRM = `POST /zoho/crm/sync`). |
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
| **Inventory** | Items · Stock Details · Stock Adjustments (CR-308) · Transfer Orders (CR-330) · Production |
| **Sales** | Customers · Quotes · Approvals\* · Sales Orders · Palletization · Loading and Dispatch · **Panel Craft** (Dashboard · **Stock** (CR-448, was "Cut Piece") · Pending Cut Piece · Orders · Loading) |
| **Masters** (CR-436; CR-439 layout; **CR-440: NO sidebar entry** — reached from Settings ▸ Masters; `/masters` is only the redirect / ⌘K / tile landing) | `/masters` = the **Settings workspace (`SettingsHome`) opened on its Masters menu**. **CR-439 (2026-10-24): the Settings rail carries Masters ▸ Item · Panel · Export as a menu + sub-menu (`.set-subgroups`); the pane (`MastersPane`, `Masters.tsx`) = the group title + horizontal `.fbar .btn` pill tabs of its masters (CR-440: pills, not the faint underline), master rendered in place; Item first; non-admins see the Masters menu only.** Groups: **Export Master** (Pallet Master · Container Master · Vehicles · Payment Terms · Adjustment Reason · Currencies · Warehouses & Locations) · **Item Master** (Items · Size Master · Finish · Category · Glaze · Box Brand · Customer Brand · Grade · Surface Application · Punch Type · Series · Catalogue) · **Panel Master** (Panel Items · Cut Piece Size · MDF · Panels); each master declares the nav id it needs (or Admin). Visible to Admin and any role whose matrix grants Items or Panel Craft view (`MODULE_NAV` adds `masters` to both) |
| **Reports** | Reports · Audit Log |
| *header gear* | Settings (admin only) |

\* Approvals appears only for a role that may approve Quote, SalesOrder or Production.

### Route table

| Path | Component | Notes |
|---|---|---|
| `/dashboard` | `dashboard/Dashboard.tsx` | `/` redirects here; so does `*` |
| `/design` · `/design/:id` | `masters/DesignMaster` · `ItemDetail` | Item master |
| `/design/new` · `/design/:id/edit` · `/design/:id/clone` | `masters/DesignEdit.tsx` | CR-220: the one Item form page |
| `/stock` | `masters/StockDetails.tsx` | Batch-wise on-hand (hidden Adjusted column since CR-308) |
| `/stock-adjustments` · `/stock-adjustments/new` | `masters/StockAdjustments.tsx` · `StockAdjustmentSheet.tsx` → `common/StockAdjustForm.tsx` | CR-308: box-stock inventory adjustments — list of adjusted lines + (CR-446/457) the Zoho Books FORM: header Mode of adjustment · Date · Reason · Description over an Item Table (Item · Batch · Location · Available · New on hand · signed Qty adjusted · Remark), one line by default; CR-458 mode **Location Transfer** (From → To in the header, `?mode=transfer`) saves ONE Transfer Order via `/stock-transfer` |
| `/stock-transfers` · `/stock-transfers/new` · `/cut-stock/transfer` | `masters/StockTransfers.tsx` · `StockTransferSheet.tsx` · `panels/CutStockSheetPage.tsx` (kind transfer) | CR-330: Transfer Orders — every transferred line (boxes + cut pieces) with TRF # · From → To · reason; the bulk sheet with From / To / Reason in the bar |
| `/warehouses` → redirect `/masters?g=export&m=warehouses` | `masters/Warehouses.tsx` (Admin, inside the hub) | CR-329: Warehouse master — Name · Primary ★ · Purposes · Note; the Primary tick → `/warehouse-primary` |
| `/sizes` → redirect `/masters?g=item&m=sizes` · `/sizes/:id` | `masters/Sizes` (inside the hub) · `SizeDetail` | CR-436 |
| `/pallets` → redirect `/masters?g=export&m=pallets` · `/pallets/:id` | `masters/Pallets` (inside the hub) · `PalletDetail` | Pallet formats |
| `/pallets/new[?size=<id>]` · `/pallets/:id/edit` · `/pallets/:id/clone` | `masters/PalletFormPage.tsx` | CR-220; `?size=` locks the Size and returns to `/sizes/:id` |
| `/containers` → redirect `/masters?g=export&m=containers` · `/containers/:id` | `masters/ContainerFormats` (inside the hub) · `ContainerFormatDetail` | CR-261 Container Master (several per Size since CR-273) |
| `/containers/new` · `/containers/:id/edit` · `/containers/:id/clone` | `masters/ContainerFormatFormPage.tsx` | CR-261; a clone keeps the size (CR-273 — same size, new mix). CR-269: pallets are added as lines (Pallet picker · count · Add line · ✕), like Quote Line Items |
| `/prod` · `/prod/:id` | `stages/Production` · `ProductionDetail` | Table + Sheet (Kanban, To Produce, Import hidden — CR-417) |
| `/prod/new` · `/prod/:id/clone` · `/prod/:id/edit` | `stages/ProductionFormPage.tsx` | CR-220: Start New Production (CR-234) / Edit Production pages |
| `/prod/record` | `stages/ProductionLogSheet.tsx` | CR-244: Bulk Record Production — many items, one Save, straight to stock. CR-469: the Adjust Stock FormPage shape (Production section + Item Table: Size · Item · Batch · Qty · Box Brand · Location per line), Size narrows Item, Excel paste kept |
| `/parties` · `/parties/:id` | `masters/Parties` · `CustomerDetail` | Customers. Detail = Details · Transactions (collapsible Sales Orders / Quotes / Samples / Panels) · Dispatch · Activity tabs (CR-384) |
| `/parties/new` · `/parties/:id/edit` · `/parties/:id/clone` | `masters/PartyFormPage.tsx` | CR-220: Customer form page (`:id` = customer code) |
| `/settings/zoho` (`/settings/zoho-books` redirects) | `settings/ZohoSyncSettings.tsx` | CR-325/356/359 (Admin): connect / reconnect / disconnect the **active Zoho customer source** (`ZOHO` in `zohoApi.ts` — Zoho CRM Accounts since CR-359; Books hidden, its connection kept); **Customer sync** card = last run, **Refresh now** (incremental pull, same as the webhook / cron), **Import all customers** (full pull, 10 per request, safe to re-run — imported + unchanged accounts are skipped, CR-362). Hand mapping stays: Customers ▸ From Zoho CRM or a customer's More ▸ Map / Re-pull / Unmap → `ZohoSearchModal` → PartyFormPage prefilled from the **server-mapped** record (`records/:id` → `mapped`); More ▸ **Create in / Push to Zoho CRM** sends the customer the other way; `Customer.crm_account_id` is the link |
| `/quotes` · `/quotes/:id` | `quotes/QuotesTable` · `QuoteDetail` | |
| `/quotes/new[?customer=]` · `/quotes/:id/edit` · `/quotes/:id/clone` | `quotes/QuoteFormPage.tsx` | CR-219: the Quote form is a page (create / edit / clone), never a modal |
| `/quotes/:id/containerise` | `quotes/PlanContainerisation.tsx` | Quote-level container plan; Box Fitting picks the container on each item row, narrowed by the row's pallet (CR-300) |
| `/approvals` | `quotes/Approvals.tsx` | Role-gated at nav **and** route |
| `/orders` · `/byorder` · `/kanban` | `orders/OrdersTable` · `ByOrderView` · `pipeline/Kanban` | One nav leaf, `ViewToggle` switches. CR-353/355: the grid leads Customer, Design, then the customer **PO Number** (all inside the picker); SO Number is the last column, hidden by default; By-Order cards lead with the PO (`orderLabel` in `ordersApi.ts`); the Kanban still says the SO number |
| `/orders/new[?quote=<id>]` · `/orders/:id/edit` · `/orders/:id/clone` | `orders/OrderFormPage.tsx` | CR-219: the Sales Order form is a page; `?quote=` = Convert-to-SO; CR-468: no Location field (CR-453 reversed — stock carries its own bay) |
| `/orders/:id` | `orders/OrderDetail.tsx` | CR-353: title = customer PO (`orderLabel` = `poNumber \|\| orderNumber`), sub line = `SO/FY/NNN · Customer` small; Details card PO Number then SO Number. The SO number stays the identity (URL = ROWID, `order_number` server-minted); the print and the container plan keep it as their document number |
| `/orders/:id/containerise` | `quotes/PlanContainerisation.tsx` | The SO's own editable plan copy; same per-row container pick (CR-300) |
| `/packing` · `/palletizing` · `/palletized` · `/packing/:id` | `stages/PalPlans` (×3, `stages` prop) · `PalPlanDetail` | Ready for Palletization (queue) · In Palletization · Palletization Completed (recorded Ready for Loading rows: Load + Release) — CR-160, CR-360 |
| `/packing/new[?fromOrder=<soId>]` · `/packing/:id/edit` · `/packing/:id/clone` | `stages/PalPlanFormPage.tsx` | CR-222: Palletization form page (New + Send to Palletization share it) |
| `/loading` · `/loading/:id` | `stages/LoadingBay` · `LoadingDetail` | Loading and Dispatch board |
| `/panel-dashboard` · `/panel-items` → redirect `/masters?g=panel&m=panel_items` · `/panels` → redirect `/masters?g=panel&m=panels` · `/cut-piece-sizes` → redirect `/masters?g=panel&m=cut_piece_size` (CR-436) · `/panel-items/:designId` · `/cut-stock` · `/cut-stock/:designId/:cutSizeId` (CR-461 `CutPieceDetail`) · `/cut-stock/record` · `/cut-stock/adjust` · `/panels` · `/panels/new` · `/panels/:id/edit` · `/panels/:id/clone` · `/panels/:id` · `/panel-orders` | `panels/*` (`PanelFormPage.tsx` for the form routes, CR-285; `PanelDashboard`, `PanelItems` / `PanelItemDetail`, `CutStockSheetPage` for the CR-306…311 pages) | Panel Craft |
| `/panel-orders` (ONE register, Type = Panel \| Sample, CR-345) · `/panel-orders/new` + `/sample-orders/new` (`OrderFormPage`, type first) · `/sample-orders` → redirect `?type=Sample` · `/sample-orders/:id/edit` · `/sample-orders/:id/clone` · `/sample-orders/:id` · **`/panel-loading`** (CR-348) | `panels/Orders` · `OrderFormPage` · `SampleOrderFormPage` · `SampleOrderDetail` · `PanelLoading` · `PanelLoads` (Dispatch tab + Record Load) | Orders + Loading (CR-315…317, 345…348) |
| `/reports` · `/reports/:id` | `reports/ReportsHome` · `Reports.tsx` (`ReportView`) | |
| `/ops` | `ops/OperationsLog.tsx` | Audit log |
| `/settings` · `/users` · `/roles` · `/data-operations` | `settings/*`, `admin/*` | **Rail groups since CR-436 (2026-10-24): **Organization (CR-445: logo, company name, tax, contact, bank — the branding source for the whole app)** · Users & Roles · **Masters ▸ Item · Panel · Export (CR-439: menu + sub-menu in the rail, masters render in the pane as horizontal tabs; the tiles are the search / ⌘K index only, deep-linking `/masters?g=…&m=…` = this page)** · Data Operations · Preferences.** **Admin only** — non-admins redirect to `/dashboard` |
| `/masters?g=<export\|item\|panel>&m=<key>` · `/currencies` → redirect `…g=export&m=currencies` | `masters/Masters.tsx` (`HUB_GROUPS`, `hubPick.ts`; big pages lazy-loaded inside; `admin/Currencies.tsx` rendered there) | **CR-436 Masters hub** — the query string IS the selection (`?g=` wins, a lone legacy `?m=` infers its tab); Admin or `hasFeature("masters")` |

**Registered but hidden.** The "Stages" nav block is commented out
([`App.tsx:160-174`](../client/src/App.tsx#L160-L174)); the routes still resolve if typed:
`/po`, `/po/:id`, `/qc`, `/container-shipments` (the legacy per-shipment Container page; `/containers` is the Container Master since CR-261), `/fit`, `/loadplan`, `/invoices`.
`/final` (Final Loading) was **removed** on 2026-08-29 along with the legacy pallet flow (§6.6).

### Public, unauthenticated

| Route | Serves |
|---|---|
| `GET /public/design-image/:fileId` | Item images + the org logo |
| `GET /public/org-profile` | Organization profile (CR-445) — explicit `org_*` allowlist; login page, shared pages and PDF builders read it without a token |
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

**Page tours** (CR-159): `/packing` (also `/palletizing`, `/palletized`) and `/loading` each have a process guide that auto-starts
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
| PalPlan (line) | `Planning → Palletizing → ReadyToLoad`, freely reversible among the three; **Release** (CR-361) takes a loaded line's boxes out of an Open box, or a ReadyToLoad line's boxes out of the plan and back to free stock; **Discard** (CR-369) does the same for a Planning / Palletizing line; plan Delete (CR-370) and SO Cancel (CR-371) release every line | `PAL_LINE_TRANSITIONS` [`index.js:2281`](../functions/data-ops/index.js#L2281), mirrored [`palPlansApi.ts:35`](../client/src/features/stages/palPlansApi.ts#L35) |
| LoadBox | `Open → Dispatched` | `/load-box-dispatch` [`index.js:2948`](../functions/data-ops/index.js#L2948) |
| Production | `New → InProduction → Completed` (auto-stepped) | `PRODUCTION_STAGE_ORDER` [`productionApi.ts:433`](../client/src/features/stages/productionApi.ts#L433) |
| PanelOrder | `NewRequest ("New") → Received → InCutting → Ready → Dispatched` (+ direct `Received → Dispatched` when stock covers), **forward-only**; every order is born `NewRequest` (CR-294) | `PANEL_ORDER_TRANSITIONS` [`index.js:2851`](../functions/data-ops/index.js#L2851), `INSERT_INITIAL` [`index.js:5773`](../functions/data-ops/index.js#L5773) |

Line-status labels differ from their stored values and the labels are what users say:
`Planning` = **"Ready for Palletization"**, `Palletizing` = **"In Palletization"**,
`ReadyToLoad` = **"Ready for Loading"** ([`palPlansApi.ts:40-45`](../client/src/features/stages/palPlansApi.ts#L40)).

### 5.1 Quote

Screen `/quotes` → `/quotes/:id`; the form is a page — `/quotes/new`, `/quotes/:id/edit`, `/quotes/:id/clone` (CR-219; Zoho-style label-left rows + Customer search modal, CR-275 / CR-276). Routes `POST /quote-with-items`,
`POST /update-quote-with-items/:rowid`, `POST /quote-status/:rowid`. Names on quote / SO lines resolve to
ROWIDs through `designMap` / `customerMap` (index.js `cachedMap` → `buildMap`): **paged** via `zcqlAllRows`
(ZCQL caps one query at 300 rows — CR-339) and rebuilt once when a name the request needs is missing from
the per-instance cache.

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

Screen `/orders/new?quote=<id>` (the Sales Order form page in convert mode, CR-219; same Zoho-style rows as the Quote, CR-275 / CR-276). Route `POST /convert-quote/:rowid`. **Enabled only for `Accepted` or `PartiallyConverted`
quotes.** Full or partial; a partial conversion leaves the quote `PartiallyConverted`.

On conversion the quote's container plan is **snapshotted onto the SO**, which then owns its
own editable copy at `/orders/:id/containerise`. Saving the SO writes only the plan JSON.

**Confirming an SO auto-enqueues production.** Entering `Confirmed` (via `/so-status`, or at
create/convert under the approver bypass) runs `enqueueSoProduction`, seeding `ProductionLog`
plan rows for the order's items. See §5.3 for how those interact with manual requests.

### 5.3 Production

Screen `/prod` — a Table and a Sheet view of the same rows (the Kanban board and To Produce view are hidden since CR-417, code kept).

**Production first, then SO allocation (CR-197…200, 2026-09-18).** The factory produces to
**stock**; stock is then allocated to Sales Orders.
- **Bulk Record Production** (CR-244, `/prod/record`, header button on `/prod`) is the fast path for
  make-to-stock output. **Since CR-469 (2026-10-27) it is a `FormPage` in the Adjust Stock shape**
  (`common/StockAdjustForm.tsx`, CR-457): a **Production** section — Production date \* · Recorded by ·
  Description (saved as every line's `note`) — over an **Item Table** (`.ord-lines` / `.adj-line`) —
  Size · Item \* · Batch No. (blank = auto) · Qty \* · Box Brand · Location per line (blank = the
  Production bay, CR-438). One line to start, "+ Add line"; no toolbar, no ColumnPicker, no per-row
  Date / Remark. A copied Excel block still pastes across lines from the focused cell (`LOG_COLS` =
  size · design · batch · qty · brand · note · date · warehouse; item matched sku → unique name →
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
  Batch No. + Box Brand are captured there **per batch row** (`RecordOutputForm`, CR-257; the
  CR-200 order-based brand prefill seeds each row), a blank batch is minted server-side
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
  production*, lines of one item sharing its free stock first-come by SO. `/prod` ▸ **To Produce** (segment hidden since CR-417 — Start New Production prefills the same shortfalls)
  ([`ToProduce.tsx`](../client/src/features/stages/ToProduce.tsx)) lists per item the open demand,
  free stock, in production, need-production and the Box Brand wanted; ticked rows prefill a job.
- **Deallocate Stock** (CR-263): the Items table shows Remaining = Ordered − Allocated with a totals footer; a ✕ per allocated line (and SO ▸ More ▸ Deallocate Stock for the whole order) opens `DeallocateStockModal` — that line's `alloc` rows, ✕ each → `POST /deallocate-stock/:rowid` (`deallocateCore`: refused once palletised; trims auto Planning lines, lowers `produced_qty_boxes`, soft-deletes the alloc row, recounts) → free stock rises.
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

**Excel import.** `/prod` → Import (`ProductionImport.tsx`; button hidden since CR-417). No re-upload dedupe — importing
the same file twice will double-count.

**Auto-queued vs manual** (legacy — no new `so-…` jobs since CR-198). An auto-enqueued `so-…` job counts as in-production only **once
touched**. An untouched auto job is superseded by a manual request for the same item, so
confirming an SO and then raising the request by hand does not double-count.

**Remaining / Desired** defaults to `ordered − produced − inflight − stock` — a **hint only
since CR-131 (2026-09-10)**: the qty input has no upper clamp, covered lines/SOs stay
requestable, and the server cap against `ordered` is gone. The order-completion *filters* are
deliberately **not** stock-adjusted.

### 5.4 Palletization

**Three sidebar pages over one board since 2026-10-21 (CR-160 two, CR-360 three — one stage each)**:
`/packing` **Ready for Palletization** (the Planning queue only), `/palletizing` **In Palletization**
(the Palletizing stage only — CR-360 took the Ready rows CR-278 had put here back out) and
`/palletized` **Palletization Completed** (the recorded, not-yet-loaded `ReadyToLoad` rows — they
wear the **Palletized** chip (CR-176, relabelled from "Recorded" by CR-299), carry **Load** and
**Release…** in their "+" menu (CR-361), and also appear in the **Ready for Loading** section of
`/loading`; the unrecorded rows of a partially palletised item read **Partial**). Same `PalPlans`
component scoped by the `stages` prop; all three nav leaves share feature id `packing`. **No status
dropdown** (CR-364) — each page lists its own stage only; the page | All filter of CR-228/246/278/299
and the board's read-only Done rows are gone.
**Release (CR-361) / Discard (CR-369)** — ONE server route `POST /pal-line-release/:rowid {boxes?, reason}` reverses
palletization work for one line, partial or whole, **reason mandatory for every role** (`requireReason`, CR-369 — no Admin exemption):
a line in an **Open** container loses `boxes` (the existing `writeLineIntoBox` split, remainder un-boxed)
and they return to **Ready for Loading**; an un-boxed line of ANY stage (ReadyToLoad = Release, Planning /
Palletizing = **Discard…** in the "+" menu) shrinks / soft-deletes and the
boxes return to **free stock** — `releaseLineToStock`: the order's `alloc` rows are returned through `deallocateCore` (same
batch first), after `recountOrderItems` so the palletized counter has already dropped; refused when the
order's allocation does not cover the count and when the box is dispatched. The same core serves **plan Delete (CR-370)** —
`discardPlanLines` returns every live line first, 409 while any line sits in a container — and **SO Cancel (CR-371)** —
`cancelSoPalletization` runs before the status write: 409 naming the container while any box is dispatched, else un-box from
Open containers, release every line, `deallocateCore` the rest (errors throw; the old best-effort try/catch is gone).
lines (they keep drag-back / partial Complete). Entry points: the "+" menu on `/palletized` rows and on
`/loading` rows (Ready rows → stock; loaded rows → Ready for Loading, replacing the old reason-less
"Unload item"). Stock card effect: loaded release → In loading ↑ Available ↑; stock release →
Available ↑ (Awaiting palletization unchanged, since produced fell with palletized).
Group, Today's Report and New Palletization Plan sit in the header (the Kanban/Sheet toggle is hidden since CR-418 — Sheet only). The Sheet is
ColumnDef-driven (CR-161/279/472, key `packingSheetColumns.v4`: Customer, Item, Order, Batch, Boxes,
**Ordered Boxes** = the BATCH's boxes sent to palletization (back since CR-472 — CR-279 had removed it),
**Ready Pallets** `N (boxes)` = the batch's palletized boxes ÷ `Pallet.boxes_per_pallet` rounded up,
**Pallet** = the master's `pallet_type` (line `palletKind`, composite name on hover), **Boxes / Pallet** =
the master's capacity (CR-472), Location, **Remaining** = the batch's boxes not yet palletized, Date, Status,
Age, **PAL** last and hideable; checkbox / edit inputs / "+" cell fixed) and has **no stage band**.
**Progress is per order item × batch** (`batchProgressOf` in palPlansApi, keyed by `batchKey`; CR-472 — it
used to be per order item, so a loaded batch's 100 boxes read as "4 (100)" on its sibling batch's row).
The Sheet ends in a **`TotalsRow` tfoot** (CR-187, same shape as /loading): "Total · N pallets"
in the first visible column, Boxes / Ordered / Ready Pallets / Remaining sums under their own headers
(deduped per batch; `readyPalletsLabel()` is the one formatter, shared with the
Complete Palletization dialog which shows each batch's `Ready N (boxes) · Remaining N`, CR-280).
A **partial Complete** (Palletizing → ReadyToLoad with fewer boxes than the line) splits off the
recorded slice and sends the **remainder back to Planning** (CR-281, server) so it re-queues on
`/packing` with Start available. Under the grid (both views) sits the **totals /
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
**⚠ CR-248 (2026-09-21) REVERSED the gate below:** every un-boxed `ReadyToLoad` line is loadable —
300 palletized of a 400-box batch load now, the other 100 later. `loadableLineIds` no longer tests
the batch group, `assertBatchesComplete` and its two calls are deleted from data-ops, and
`groupReady` flags such lines `partial` (a "300 of 400 palletized" note on the Item Table batch
list, the bulk picker and the older pick lists) instead of `blocked`. The paragraph is history.

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
- **Queue claim (CR-249, 2026-09-21):** when no un-queued batch is left because the auto-enqueue
  already put the item's boxes on its queue plan, `attributeBatches` takes them from there —
  pure `claimQueuedBatches` over the item's batched, un-boxed **Planning** lines, oldest first.
  The new lines carry the donor's batch + Box Brand; after they are inserted `shrinkDonors`
  shrinks / soft-deletes the donors (restoring them if it fails). Claimed boxes are netted off
  `assertPlanWithinOrdered` (they move, they are not added). Before this a second plan for a
  queued item minted a blank-batch, brand-less line and queued the item twice; the admin one-off
  `/reattribute-blank-lines` (`{ order_item? }`) repairs such lines the same way. Self-check:
  `node scripts/claim-queued-batches.check.mjs`.
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
Loading) live on `/packing` / `/palletizing` / `/palletized` since 2026-09-04 / 2026-09-14 / 2026-10-21; this board holds boxed lines only:

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
per-SO **Plan container** picker + **Fill from plan** (CR-338) prefills the CHOSEN planned container's
quantities — nothing is hidden or locked by the plan. Partly palletised batches stay listed, greyed, with their
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

**⚠ Since CR-247 (2026-09-21) the page is laid out like a Sales Order form** (same routes, same
Save order, client-only). Top → bottom: **Customer** `Combobox` (customers with Ready-for-Loading
stock; locked by `?so=` or once the loading has lines; changing it after picks asks, then clears —
one customer per container) → **Loading Details** (Loading No. auto + `LoadDetailsFields
part="details"`: Size, Destination, Transporter, Supervisor) → **Item Table** (`.ord-line.load-line`;
palletized stock only: Item `Combobox` = design · SO → Batch `Combobox` → Boxes; a partly palletized
batch is listed with its n/m badge but `pickable` refuses it; a batch held by one row leaves the
other rows' lists; **Add New Row** + **Add Items in Bulk**
([`BulkLoadItemsModal.tsx`](../client/src/features/stages/BulkLoadItemsModal.tsx) — list | selected;
since CR-259 a selected row is two lines: name + batch on top, typed pallets count (no − / + buttons
since CR-260, hover = "of N full pallets") / loose tick / = boxes right-aligned under it, modal 1100px
wide); in Edit the already-loaded lines are the table's first rows, replacing the
Loaded-items card) → **Vehicle & Container Seal Details** (`part="vehicle"`; all optional — a
loading saves without them and takes them later from Edit, the Loading Sheet's Truck No. cell or
Assign Vehicle; only Dispatch needs a vehicle, CR-251). **⚠ CR-250 (2026-09-21): the CR-241 "Add
items" direct-send card is REMOVED from this page** (with its `listOrders` fetch and the
`/send-to-loading` step of the Save order) — the page loads palletized stock only. `/send-to-loading`
itself and the SO detail's Send to Loading stay.

**⚠ Since CR-256 (2026-09-21) an Item Table row is an ITEM, not a batch** — `ItemRow = { rowKey, off[] }`
(`off` = batches the picker left out). The Batches cell opens the batch picker = `BulkLoadItemsModal`
scoped to that one item (`initial` = `pick.qty`; Apply → `applyPicks` rewrites every line in scope,
so boxes are chosen PER BATCH; Add Items in Bulk is the same modal over all bands); Boxes typed on the row → `pick.setDesign(row, v, skip)` → `spreadQty(lines, want, skip)`
→ `allocateFifo`, so `qty` stays per line id and the `/pal-lines-box` payload is unchanged. **CR-258
(2026-09-28): the picker reads and takes PALLETS** — `pickerEntries(bands)` → one entry per line, or ONE
entry per shared `palletGroup` (Mix Batch = one physical pallet, moves whole); each entry shows
`palletBoxesLabel` ("12 pallets + 6 boxes" = `palletSplit(boxes, boxesPerPallet)`) with the box
conversion, and the selection has a pallets stepper + a tick for the loose remainder (all-or-none).
State is still boxes per line id; pallets/loose are derived (`floor(v/bpp)`, `v%bpp>0`). bpp 0 = the old boxes stepper.
Round 2 (2026-09-30): **the Item Table types PALLETS** (Pallets column typed → `pick.setDesignPallets` →
`spreadPallets(lines, n, skip)` = whole pallets oldest batch first, `min(line.boxes, k×bpp)`; Boxes is the read-only
conversion; loaded rows the same via `setGroupPallets`); a Mix Batch pallet is a parent + `└` children tree with
an `MXBATCH` chip (`MxChip`, also on `/loading/:id`); `/loading/:id` Loaded Items and the `/loading` grid carry a
Pallets column + totals (`palletsOf` / `palletsOfLine`). Loaded
lines (Edit) group by `salesOrderId|designId`; a typed total is spread FIFO into the per-line
`loadedDraft` (newest batch gives way first). `batchOptions` / `pickable` below are gone;
`itemOptions(bands, takenRows)` keeps an item to one row. Double-loading is still stopped by the
server (`load_box` already set → 409); a part-loaded batch's split remainder stays loadable.

**⚠ Since CR-252…255 (2026-09-21) the page order is Customer → Item Table → tabs.** Customer is an
optional FILTER (`useSessionPick({ anyCustomer: true })`): blank lists every customer's
Ready-for-Loading stock (labels `design · SO · customer` via `bandLabel`), picks survive a filter
change (`picked` reads `allBands`), and a container may mix customers — the older "one customer per
container" text above is history for this page (the `/loading/plan` trial is unchanged). The Item
Table ends in a **totals row on the same grid** (Boxes / Pallets under their columns, loaded-after-
edits + picks, plus `fill` % of a container); the footer carries only a blocking error + Cancel /
Save. Under it, a **Container Planning hint** per listed order — since CR-338 a **Plan container**
Combobox over every planned container (see the CR-338 paragraph below) with **Fill from plan**
(`fillFromPlan` returns the filled lines → table rows).
**Loading Details | Vehicle Details** are tabs below the items (RecordDetail `tabStyle`, both
mounted). Boxes still live in `useSessionPick`'s `qty` map — a table row only names the
line it shows; option shaping is pure (`itemOptions` / `batchOptions` / `pickable` in
`newLoadingRows.ts`, self-checked). The customer-rail pick list (`SessionItemsStep` render,
`SessionSheetView`) is no longer mounted here; the files are kept.

**Plan-container picker (CR-338, 2026-10-13).** The plan-hint row in `ContainerRows` (both views) is a **Plan container** `Combobox` per order band: `planSlices(so, planBySo, plans, boxes, designIdOf)` (containerPlanPrefill.ts) returns EVERY container of the SO's plan as a `PlanSlice {ci, no, lines, containerFormat(Name), pallets, boxes, status, claimedBy}` — `status` from `planProgress`'s dispatched drain, `claimedBy` = the Open loading whose `load_plan.plan[so] === ci` (`planClaims`, planProgress.ts). `LoadingSession.slicesFor(key, band)` marks each slice `takenBy` (another tab's title, or `boxLabel` of an Open loading outside this group) and picks `chosen` = the tab's own claim else the first free one. Option label `C{no} · {format} · {pallets} pallets · {boxes} boxes`, hint = per-design `{pallets}P {palletName} · {boxes} {design}`, badge = Planned / Partially sent / Sent / Claimed by …; Sent and claimed stay selectable. `claimPlan(key, band, slice?)` writes `draft.plan[so]` (undefined clears) and starts `container_format` on the plan's pick while blank; `fillFromPlan` = claim + `planFill`. **Persisted**: `loadPlanJson(bands, qty, group, plan)` writes `load_plan.plan { [so]: ci }` on create (primary too), Edit seeds drafts from it (`planOf(box)`) and patches `load_plan` when the claim changed (`dirty()` includes it). `unsentPlanContainers` = not Sent AND not claimed by an Open loading — the fix for "the same C1 offered twice" (before, only dispatched boxes counted); `nextPlanContainer(…, forBoxId)` returns a loading's own claim first (LoadingDetail, LoadingBay). The server never reads `load_plan`. The plan stays advisory for palletization (user decision 2026-10-13): the pallet type at palletization is NOT taken from the plan.

**Sheet mode (CR-335, 2026-10-12).** A `.seg` **Tabs | Sheet** toggle in the strip (`useViewState("loading.workspace.view", "sheet", "tabs")` — seeds from `AppSetting.default_view` like the boards, last pick per browser). Sheet = one `.tbl.load-sheet` for the whole loading: per container a **band row** (`tr.load-band`: status dot · `titleOf` / LOAD code · status chip · `BandCell`s bound to the draft for Name, Container No., Vehicle (`formatVehicleNumber`), Driver, E-seal, Line seal · fill % · **More fields** toggles a `tr.band-more` holding `LoadDetailsFields part="more"` · Add Items in Bulk · Dispatch (same gate as the rail) · **Documents** `MoreMenu` from `docItems` · ✕ via `removeOf`) followed by that container's rows from the shared **`ContainerRows`** engine (pick rows, auto blank row, portaled per-batch picker, plan-hint rows), a dashed + Add container row and one totals `tfoot`. `ContainerSection` (Tabs) renders the same `ContainerRows` inside its own table. Drafts are shared, so a view switch keeps every pick.

**CR-350 (2026-10-15): design + container first.** The Container (format) Combobox sits in each
container's title row ABOVE its sheet (`LoadDetailsFields part="format"`; in Sheet mode it is the first
cell of the band); every vehicle / seal / shipping field (rail, band cells, More fields) is `disabled`
while a NEW container has no item (`lockedOf`: no box and nothing picked) with the Note "Add at least one
item first…"; saved containers never lock. The strip shows **Party · PO nnnn** bold with the SO numbers
small (`loadIdentity` in `newLoadingRows.ts` over the picked + kept lines, else the Customer filter);
`/loading/:id` leads its subtitle the same way; the sheet's Order column is small `mono dim` with customer ·
PO in the tooltip. `SoBand` carries `poNumber`.

**CR-354 (2026-10-19): two steps per container, C k naming.** `codeOf` → `C${i+1}` for unsaved containers
(tabs, bands, footer, Dispatch label all follow). Sheet mode: the band row is step 1 (`chip 1` "Designs &
pallets" · Add Items in Bulk · Documents · ✕ — NO fields); `ContainerRows` gained `after?: ReactNode`,
emitted after the plan-hint rows, carrying the step 2 row `tr.band-step` (`chip 2` "Container & vehicle":
`LoadDetailsFields part="format"` · Name · Cont. · Veh. · Driver · E-seal · Line · fill % · More fields ·
Dispatch) + the `band-more` row. Tabs mode: the format pick left the title row; the rail is titled step 2 and
renders `part="format"` then `part="rail"`. While `lockedOf` (unchanged, the ONE gate) step 2 is HIDDEN
behind one line / the Note, not disabled — the `disabled` prop on `LoadDetailsFields` and `BandCell`
(CR-350) is deleted. Client-only; save order (CR-301) untouched.

**⚠ Since CR-326 (2026-10-12) the page is the Loading Workspace — ONE TAB PER CONTAINER** (design
canvas https://claude.ai/artifact/YP9GKRqMBNybyrzR3XVdt9; supersedes CR-301's stacked sections, whose
save order it keeps). Layout: Customer (every active customer + 🔍 `CustomerSearchModal`, CR-327 — an
optional FILTER for the design picker; customers with Ready stock sort first with "N pallets · M boxes
ready"; nothing loadable → a `Note` from `blockers("load", …)`, CR-328) → the **tab strip** (`.ctabs`:
status dot · `Container k` / LOAD code · container no. or vehicle · `N pal · M bx`; **+ Add container**
last) → the active tab (`ContainerSection`, the others stay mounted `hidden` so their rows survive):
**sheet** (`.tbl.load-sheet`: # · Design Combobox over the stock the OTHER tabs left (`scopeBands`,
`emptyText` = the reason) · Order · Batch (click = the per-batch `BulkLoadItemsModal`) · **Pallets typed**
(`spreadPallets`, oldest batch first) · Boxes · **Pallet No.** · **Pallet type** · Box Brand · ✕; a blank
row appends itself, every row has a ✕ (blank = clear); header = status chip (`boxStatusOf`) · fill % · **Add Items in Bulk**; the container's own ✕ is ON ITS TAB (`.ctab-x`, CR-334); plan hints with
Fill from plan below; `tfoot` totals) and the **rail** (`LoadDetailsFields part="rail"`: Container format ·
Container No. · Vehicle · Driver · Mobile · E-seal · Line seal · Size · Transporter · LR · Destination ·
Supervisor — the Loading Details | Vehicle Details sub-tabs and the Loading No. field are gone) with
**Dispatch Container k** (edit, open box: `dispatchGate` + "Save your changes first" shown inline) and the
**Documents** row (Loading Sheet → `/loading/:id` · Dispatch Copy · Pallet QR labels · Packing Report,
`downloadPackingReportForLines`; header **Print all** loops the group). A dispatched tab is read-only
(green note; pallet no./type and details stay editable). **Removals ask the CR-270 reason (CR-334):** ✕ on a loaded row → `confirmDelete` → the reason rides on the Save's `/pal-line-box` unload; ✕ on a saved Open tab = Delete loading (`deleteLoadBox(id, reason)`); unsaved rows/tabs clear silently. State: `ContainerDraft[] {key, boxId?, qty,
capture, vehicle, plan, meta}` — `meta` = Pallet No./type per sheet row (`so|design` key), written onto
the loaded lines via the generic `PATCH /PalletizationPlanLine` (`pallet_no`, `pallet_type` — the same
columns the Loading Sheet edits) right after each container's `/pal-lines-box`, re-targeted through the
`remainders` remap. **Edit = the whole group**: `/loading/:id/session` opens every box whose
`load_plan.group.id` matches (primary first) as tabs; each existing box saves as before (unload / shrink
→ add → metas → `/load-box-update`); a container added in Edit is minted with `group {id, no: N+1, of}`
and the primary's `group.of` is bumped. Stock sharing, `pickTotals` / `pickEntries` / `loadPlanJson` /
`planFill`, `unsentPlanContainers`, the `remainders` remap, the group link and the duplicate-seal check
are exactly CR-301's (below, kept for the save contract).

CR-301 save contract (still the one in force): `resolveVehicle` for every container first, then per
container `/load-box` (containers 2…N with `load_plan.group {id: primary, no, of}`) → `/pal-lines-box`;
the route returns `remainders` (the Ready remainder a partial load split off, entry order) and the page
re-targets the next container's entries to it (`remap`, original id → current id); the primary's slice
is patched with its group via `/load-box-update` last. This is the **first writer of `LoadPlan.group`**
— LoadingBay's `C k/N` chip, LoadingDetail's sibling card and the workspace's Edit read it. First
failure stops the save; minted containers stay, the toast names them, a retry continues on the failed
box's `/session`. Save is disabled while a new tab has no items (footer names it).

**Loading Plan page — TRIAL (CR-227)** ([`LoadingPlanPage.tsx`](../client/src/features/stages/LoadingPlanPage.tsx);
`/loading/plan[?so=<id>]`, then `/loading/:id/plan?step=1|2`; opened by **New Loading (sheet)** on
`/loading`). A second skin over the same flow, from the `Plan.dc.html` mock in app tokens
(`.psheet-*`): **1 Item selection** ([`PlanSheetStep.tsx`](../client/src/features/stages/PlanSheetStep.tsx) —
toolbar with an All customers | Selected customer toggle and the Columns picker (text columns
show/hide, Size hidden by default), ruled sheet **grouped by customer** (CR-228: Customer column
first, then a gap; no subtotals, no Fill / Load-all buttons, no fill indicators, no vehicle fields),
collapsible customer bands, Qty to load the only typed cell, status chips, sticky totals) and **2 Vehicle assignment** (full `LoadDetailsFields` — vehicle, loading details and
seals on one form — beside the loaded items + live checks). Both pages share the selection/save
hook `useSessionPick` in `SessionItemsStep.tsx`. Same endpoints, same rules (one customer, one container per save — the trial did not get CR-301's sections). If approved it
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
produce them. Screens: `/panel-dashboard` · `/panel-items` → `/cut-stock` → `/panels` →
`/panel-orders` (that is also the workflow order since CR-306: items are picked from the master
and given cut pieces, stock is entered against those pieces, panels are assembled from them,
orders dispatch against it).

**Panel Items and cut-piece items (CR-306/307, 2026-10-07; CR-426 → CR-436 2026-10-24: the `CutPieceSize` lookup is the Cut Piece Size tab of Masters ▸ Panel Master — generic `MasterTable` + `CUT_PIECE_SIZE_DEF`; `/cut-piece-sizes` redirects there).** A design is "in Panel Craft" when it
has at least one `CutPieceStock` row — that row IS the cut-piece item: (design, cut size,
`weight_kg`, on-hand qty; qty 0 = defined, nothing on hand). There is no flag on `Design`. `/panel-items`
lists those designs (Add Item = pick from the master → the full-size cut piece is created at 0 pcs with the
item's weight per piece; **Add Stock** beside it, CR-414 = the receipt sheet over the WHOLE master — any
design, any size, blank = full size, Create … for a new size — defining the pair with the ƒx weight while
receiving, so import + stock is one Save); `/panel-items/:designId` is the ONE place cut pieces are added (the
"+ Cut piece" row has an On Hand qty since CR-414: with a qty it posts a receipt, blank defines at 0), weighed
(ƒx `cutPieceWeight` = weight per piece × the cut's share of the tile face when the name reads
`W x H` — **CR-449: never typed**, the add row shows it read-only and stores it) and removed (server: qty 0 and no
`PanelLine` uses the pair). **CR-449:** the item page's Details tab is informative (cut pieces read-only · panels ·
locations · history); the add row, ✕ and Add Stock · Adjust · Transfer sit on its **Actions** tab. `/cut-stock`
(**sidebar "Stock" since CR-448**) is a two-level list: one row per ITEM (item · size · Σ on hand / booked /
free / stock weight) with its cut pieces beneath (`↳ <cut size>` rows, their own figures), every item open by
default, chevron folds, search by item / size / cut size; CR-456: an item whose only piece is its full size is ONE
plain row — chevron and ↳ rows appear only when it has another cut size. **CR-460/461:** a row opens THAT cut piece's
detail `/cut-stock/:design/:cut` (`CutPieceDetail.tsx` — item row = its full-size piece; no Image column), which stays
inside Panel Craft: fields on hand · booked · free · weight, Locations, Panels using the piece, Orders booking it, its own
Stock History; Actions = Add / Adjust / Transfer with `?design=&cut=` (the sheets prefill the piece and Back returns) + a
Panel Item link to the master. Stock moves ONLY through the bulk `StockEntrySheet`
([`features/common/StockEntrySheet.tsx`](../client/src/features/common/StockEntrySheet.tsx), the
`/prod/record` skin; pure `stockEntrySheetEdit.ts` with a self-check) for **Add Stock** (`/cut-stock/record`,
receipt with an Entry date; CR-414: a line's missing pair is created with its `weight_kg`, an unweighed one
back-filled) and Transfer Orders, and through the **Adjust Stock** form (`/cut-stock/adjust`, CR-446/457:
`common/StockAdjustForm.tsx` — Zoho Books shape: header Mode · Date · Reason · Description over an Item Table of
Item · Location · Available · New on hand · signed Qty adjusted · Remark, one line by default; CR-459: the Item
picker lists the STOCK ROWS ("Item" for the full-size piece, "Item · 600x600" for a special cut) — no cut-size column;
CR-458: the **Location Transfer** mode (From → To) posts `kind:"transfer"` = one TRF document). Both open prefilled from
the item page (`?design=`). Both post `/cut-stock-entry`, which verifies every deduction before any write and, through `adjustCutStock`,
writes a dated **`CutStockEntry`** ledger row (kinds `receipt` · `adjustment` · `order_ready` ·
`order_dispatch`, with reason, note, the panel order as `ref_rowid`, performed_by) while
`CutPieceStock.qty` stays the cached on-hand. Generic POST / PATCH / DELETE on `CutPieceStock` and
`CutStockEntry` are refused (DF-02 closed). The Panel form offers only Panel Items and that item's cut
pieces; `/panel-save` registers every line pair as a cut piece (`ensureCutPiece`).

**MDF and weight (CR-309, CR-344, CR-349).** MDF is a **size-keyed master** (CR-344 reversed CR-342's
per-panel link the same day): `Mdf` rows = Size · Thickness · Weight (kg), edited in Settings ▸ Masters ▸
MDF (generic writes; `BLOCK_DELETE` keeps a thickness an order line uses; `Mdf.panel` is dormant;
`/migrate-mdf-sizes` merged the CR-342 duplicates). The Panel master states only `Panel.mdf_size`
(Combobox over the master's sizes). Each `PanelOrderLine.mdf` picks a master row whose `size` matches the
panel's MDF size (auto when exactly one; mandatory once that size has rows — client `mdfMissing` +
server 400 "Pick the MDF thickness for PANEL-NNN"; another size → 400). `mdfLabel(row)` = "size ·
thickness"; the MDF checkpoint sums it × qty (the procurement need). The pure `panelWeightSplit(panel,
weights, mdfWeight)` = { pieces: Σ cut-piece `weight_kg` × pieces, mdf: the board } (null until every
piece is weighed); **`lineWeightSplit`** (CR-349) = what already SHIPPED (Σ `PanelLoadLine.weight_kg`
stamped at load time, frozen) + what is pending × the live unit — so a master weight edit moves pending and
future orders, never a dispatched one. The detail's Items card shows Pieces kg · MDF kg · Total kg per line
and the Total Weight field names the split; the form ƒx shows the total with the split in its tooltip. The picker (CR-310) filters by Design · Panel Size · Cut Piece
Size · In stock only; each applied filter clears with × (CR-321, shared `FilterSelect`). `/panel-dashboard` (CR-311) is the Panel Craft home: KPIs, pipeline strip, panels
by status, orders per week, shortages across open orders, most-ordered panels, latest orders.

**The rule that governs it (reversed 2026-08-27):** the **Panel master is decoupled from
stock.** Creating, editing or deleting a panel never touches `CutPieceStock`. Only a
**PanelOrder** moves stock: `Ready` adds (the PENDING need, since CR-347), and each **load**
subtracts the pieces it carries (CR-347 — `Dispatched` is derived from the loads, no longer a
button). This is why `PANEL_ORDER_TRANSITIONS` is forward-only — stepping backwards would double-add stock.

**Loading entries (CR-346…349, 2026-10-15).** A panel order ships in parts on several vehicles — the
cut-piece "panel" first, the MDF board later, loose cut pieces whenever. A line is a PANEL (`panel` [+
`mdf`]) or a loose CUT PIECE (`design` + `cut_piece_size`, CR-346; one piece per unit in every need; a BLANK
cut size on save = the design's full size via `fullSizeCutPiece`, CR-357 — the CR-289 Panel-form rule).
Materials a line ships: Panel line → **Panel** (its cut pieces leave stock, booking-gated per load) and
**Mdf** (when a board is picked; not stock); cut-piece and sample lines → **Item**. One `PanelLoad` row per
order per trip (`LD/FY/NNN` shared across the orders of a multi-order trip; `order_type`, `load_date`,
`vehicle_number` free text + `driver_name` / `driver_mobile` (CR-351), `note`, `photos` on the File Store, `performed_by`) + `PanelLoadLine`
(`order_line`, `material`, `qty`, `weight_kg` stamped). `POST /panel-load-save` verifies every order's picks
(open order, qty ≤ pending, `allocation[k] ≥ need` → 409 "Book N more pcs … before loading", on hand) before
writing anything, then `adjustCutStock(−need, kind "order_load")`, `allocation[k] −= need` (Σ bookings ≤ on
hand holds), and flips the order to **Dispatched** when nothing is pending (`logTransition`, note = LD
number; `logRelated` `panel-order-load` onto order, SO, Quote, Customer). A sample pick runs the lifted
`verifySampleSupply` / `applySampleSupply` (the old `/sample-order-supply` is gone). `POST
/panel-load-delete/:rowid` (reason) unwinds stock, booking and `supplied_qty` while the order is open; a
load that closed an order cannot be removed (409). `panelOrderNeeds(orderId)` without explicit lines = the
PENDING pieces (Ready adds and books only what has not left; `/panel-order-allocate` caps there); a loaded
order can no longer be edited or deleted (409). Client: pure `loadProgress` · `loadingStatus` (Not loaded ·
Partially loaded · Loaded; legacy Dispatched / Supplied read Loaded) · `pendingText` · `pendingNeedLines`
(the Requirements card, `/pending-cut-stock` and the dashboard shortages all work on the pending need);
the **Dispatch** tab (`PanelLoadsTab`) on both order pages = Pending to Load table + the trips (photos,
stamped kg, Remove load) + **Record Load** (`RecordLoadModal`: date · vehicle number · driver name · driver mobile · note · photos · per order
a section of line × material rows, Load now = pending by default, a Note while pieces are unbooked; one
submit may span several orders); a Loading Status chip sits beside the lifecycle chip; the Orders grid
gains Loading Status + Pending. **`/panel-loading`** (CR-348) lists every order with something pending,
with the house "+" menu per row (Load…, Open order) and a selection bar → one trip for the ticked orders;
the dashboard counts them as **Pending to Load**.

**Vehicle details + Load Copy, line (i) cards (CR-351 / CR-352, 2026-10-19).** Record Load takes **Vehicle Number**
(auto-formatted `SS-DD-LL-NNNN`, required) · **Driver Name** · **Driver Mobile**; `saveLoad` first runs `resolveVehicle()`
(CR-185: the Vehicle master is maintained silently, a master failure never blocks the load) and the trip stores the
free text (`PanelLoad.driver_name` / `driver_mobile`). The Loads table shows driver · mobile under the vehicle and its
kebab offers **Load Copy** — `panelLoadCopyPdf.ts`, the branded Dispatch Copy template (LOAD COPY band, VEHICLE block
with number / driver / mobile, LD no. · date · order · customer, line × material × qty × stamped kg, total band,
driver / company signatures; no money, no photos), on demand only. **CR-433 (2026-10-24):** the Actions tab head carries the same per-trip copies as a **Load Copy ▾** menu, newest trip first — each PDF holds only what left on THAT vehicle (one shared `loadCopy()` helper for both entry points; nothing shows before the first load). The Line column on both load tables shows only
the short label (`PANEL-005`, or design · cut size) with an **(i)** toggle; the details card (panel size · vinyl size ·
MDF · ordered qty + the panel's design rows) renders as a full-width row under ALL of that line's material rows
(`lineDetails` inside the `InfoTag` floating card, CR-386; the under-row block is gone). House rule since CR-352: **every explanatory note sits at the bottom**
of its page or modal, under the content it explains — the booking warning moved below the order's table (sweep 2026-10-21: Loading detail dispatch-details note + Item stock-breakdown explainer too), and the
bottom note says how to load one material only ("Load Now is what goes on this vehicle — leave 0 on a Panel or MDF
row that stays back").

Routes: `POST /panel-save`, `POST /panel-delete/:rowid`, `POST /panel-order-status/:rowid`,
`POST /cut-stock-entry`, `POST /cut-piece-save`, `POST /cut-piece-delete` (the absolute-set
`/cut-stock-adjust` was deleted by CR-307).

**Panel images (CR-192).** `Panel.image_urls` holds the same JSON list as `Design.image_urls`,
served by the public `design-image` endpoint. Reps see them at every touchpoint: the New Panel
Order picker is a tile grid, the form shows all images of the picked panel, and a front-view thumb
sits on the orders board/sheet, the `/panels` grid and both Showcase Panels tables — all via the
shared `ImageThumb` / `ImageLightbox` in
[`features/common/ImageLightbox.tsx`](../client/src/features/common/ImageLightbox.tsx), which
`ImageManager` (Item/Panel detail) also uses. While a file uploads, the tile shows the house
processing indicator `BoffoLoader` ([`ui/BoffoLoader.tsx`](../client/src/ui/BoffoLoader.tsx), the
organization's name (`getOrg().name`, BOFFO by default) as a wordmark with letters pulsing in sequence,
CR-293) — never a bare glyph or the raw filename. `ImageUploader` (Box Brand logo) and the sign-in
"checking" screen use the same loader. On the demo build (`IS_DEMO`, CR-454) the loader renders no
wordmark — only its label pulsing, "Processing…" when the caller passes none.

**One order, several panels — header + lines (CR-302, 2026-10-07; reverses CR-193).** A
`PanelOrder` is a HEADER (customer, server-minted `order_number` `PNL/FY/NNN` via the shared
`nextOrderNumber(catalyst, "PanelOrder", "PNL")`, order date, sales person, status, source
Quote / SO, checklist) with `PanelOrderLine` rows (panel × qty — Panel + Qty only, no rate).
Header + lines save in ONE call, `/panel-order-save` (create mints the number and is born
`NewRequest`; update is allowed only while `NewRequest` / `Received` and replaces the lines
wholesale; duplicate panel, empty lines and qty ≤ 0 are 400s). `/panel-order-delete/:rowid`
soft-deletes header + lines, same stage rule, reason mandatory. Generic POST / DELETE on both
tables are refused; generic PATCH on `PanelOrder` stays for the checklist. The status machine
sums every line's PanelLine pieces × line qty per (design, cut size) before moving stock
(Ready +, Dispatched −, verify-all first). Client: `panelOrderNeeds.ts` holds the pure
`requirementsFor` / `shortagesFor` (self-check beside it) — each requirement also carries
`panels[]` (panel id, code, share of the need), shown as the **Panels** column of the detail's
Requirements checklist and as a `code ×n` suffix on the form's stock check (CR-303); the card carries no "Short:" sentence — a short row's In Stock figure is red (CR-305), the sentence survives only as the chip / Dispatch tooltips; the form
([`PanelOrderForm.tsx`](../client/src/features/panels/PanelOrderForm.tsx)) is the Sales Order
shape — Order Details rows + a Panels line table (`.ord-line.pnl-line`: panel Combobox, thumb +
sizes + designs, Qty, ✕) with **Pick from showcase** only (the multi-select tile picker; the blank-row Add panel button was removed by CR-304) and a
`N panels · Σ pcs` total; routes `/panel-orders/new` · `:id/edit` · `:id/clone` (clone copies
customer + lines, never number / status / source). The detail
([`PanelOrderDetail.tsx`](../client/src/features/panels/PanelOrderDetail.tsx)) sits on the
shared `RecordDetail`: title = PNL number, customer link, Edit (visible always, enabled only
while editable), stage buttons, More ▸ Clone / Delete; Items card (one row per line, total) +
the Requirements checklist aggregated across lines (same `stockKey` ticks). Grid, kanban,
`SourcePanelOrders`, Panel detail and the Customer section list one row per order. Legacy
`PanelOrder.panel` / `qty` columns stay but are never read or written; `/migrate-panel-orders`
(admin, idempotent) turns any legacy row into header + one line.

**Panel master UX (CR-282…285, 2026-10-06; CR-425 2026-10-24: `Panel.remarks` free text — old reference ID — on the form, panel page and `/panels` search).** `/panels` opens as a **Photo** view (one
`PanelTile` per panel — the picker's tile, shared via `pcBits.tsx`) with a Grid toggle; both views
share filter, search, sort and pager, and **no row carries an edit / delete icon** — the row (or
tile) opens `/panels/:id`, where Edit and More ▸ Clone / Delete live (house rule since CR-283;
`/cut-stock` rows open the item on `/panel-items/:designId` since CR-307). New / Edit /
Clone are `FormPage` routes `/panels/new` · `/panels/:id/edit` · `/panels/:id/clone`
([`PanelFormPage.tsx`](../client/src/features/panels/PanelFormPage.tsx)). **`panel_code` is
server-assigned** — `/panel-save` mints `PANEL-NNN` (max numeric suffix + 1 over all Panel rows,
deleted included) when a create arrives with a blank code; edits keep theirs, clones get a new one.
The cut-piece "Add Stock" button opens the bulk receipt sheet since CR-307 (the dialog is gone).

**Born "New" + stock wording (CR-294…296, 2026-10-07).** Every `PanelOrder` is born `NewRequest`,
labelled **"New"** (chip `NEW`) — direct orders and Quote / SO requests alike. **CR-400 (2026-10-23): the
lifecycle column is DORMANT** — no Accept / Start Cutting / Ready buttons; an order stays `NewRequest`
until its last load writes `Dispatched` (or `/panel-order-cancel` writes `Cancelled`), and `PANEL_ORDER_OPEN`
includes `NewRequest` on both sides so marks, booking and loads work from birth. The sheet's Stock column reads
`Available` / `Unavailable · n` (missing pieces in the tooltip; the detail keeps the `shortageText`
hint). The Item master detail shows Overview | Production only — its Panels tab is hidden; the
Customer detail renders `PanelsPanel` as the "Panels" section of its Transactions tab (CR-384).

**Booking + production checkpoints (CR-312…314, 2026-10-07).** `PanelOrder.allocation` (JSON
`{design|cutSize: pcs}`) is the cut pieces **booked** to that order — a claim on on-hand, never a
movement (`CutStockEntry` stays a pure ledger). Invariant: Σ bookings over open orders (Received /
In Cutting / Ready) ≤ on hand per cut piece, guarded at `/panel-order-allocate` (0 ≤ q ≤ need and
≤ on hand − `otherAllocations`), at `/cut-stock-entry` (a removal may not dip below Σ bookings) and
at `/panel-order-save` (an edit clamps the booking to the new need); `Ready` adds the order's output
and books it, so it cannot break the invariant. **Dispatch requires every piece booked** (409 "Book N
more pcs … before dispatch") — the on-hand check stays as a sanity 409. Client maths is pure
(`panelOrderNeeds.ts`): free = on hand − Σ booked; an order's Short = need − allocated − free; the
Requirements card (**on the Actions tab since CR-450** — `panels/RequirementsCard.tsx`, with the Available tick; Details = fields + Items only) shows Allocated · Short and one "Allocate Stock" modal that sets the booked figure in
both directions (the manual Available tick stays beside it). `PanelOrder.checkpoints` holds four
independent marks — MDF (Pending · Ordered · Received · Ready), Vinyl Printing (Pending · Printing ·
Ready), Cut Pieces (Pending · Ready), Vinyl Pasted on MDF (Pending · Ready, CR-323) — set via `/panel-order-checkpoint` (who / when stamped from
`currentActor`, mirrored on the source SO / Quote), never gating the lifecycle — the one dependency (CR-366):
Vinyl Pasted on MDF may be Ready only once MDF and Vinyl Printing are (`pastedAllowed`, 409 + greyed Combobox).
**CR-376: MDF · Vinyl Printing · Vinyl Pasted are marked PER PANEL** — `checkpoints.panels[panelId][key]` (Panel ROWID
key: one line per panel per order, survives the line rewrite on edit; `/panel-order-checkpoint {key, status, panel}`,
`panel` required for the three, must be on a live line, the pasting gate per panel); Cut Pieces stays the one
order-level mark; the legacy order-level marks are the fallback for a panel without its own (`lineCheckpoint`, server
`lineCp`; no migration). On the detail (CR-377) the three marks are columns of the **Items card** (Image · Panel (i) ·
MDF · Vinyl · Pasted · kg… · Qty; Panel Size / Designs / MDF spec behind the (i) `InfoTag` card); the Production
Readiness card keeps only the Cut Pieces row — **superseded by CR-400/402 below.**
The ONE status a panel order shows (CR-367 → **CR-400**, `panelProgress(o, reqs)`, never stored): Cancelled →
**Cancelled**; Dispatched → **Dispatched**; any panel line whose MDF · Vinyl · Pasted are not all Ready → **New**;
every panel pasted → **Ready**; Ready AND every requirement booked → **Completed** — the Orders grid Status column,
kanban columns, Status filter, dashboard pipeline / KPIs and the detail chip all read it (`PROGRESS_STATES`); there
is no Stage field and no stage button. The order-level Cut Pieces mark is dormant (its Production Readiness card is
gone). **CR-399:** the detail title is the customer, `PNL/FY/NNN` small in the sub line. **CR-402:** the three
per-panel marks are set on the **Actions** tab (CR-365, `PanelActionsTab`): every line × material with Ordered ·
Loaded · Pending · **MDF · Vinyl · Pasted** (one cell set per line, `rowSpan` over its Pieces + MDF rows;
`markCell`, Combobox while editable + open) · Ready-or-missing (`materialReadiness`) · Load Now; **Dispatch**
opens Record Load pre-filled (`initialQty`) — one Dispatch = one vehicle, so panels of one order ship on
different trips. **CR-431 (reverses CR-401):** MDF and Vinyl are marked independently — no vinyl gate on client or
server; Pasted still waits for MDF + Vinyl (CR-366). **CR-432:** marks update instantly (optimistic local copy, cache patched in place, no refetch). **CR-403 (reverses CR-380/383):** an
**MDF row is Ready once the vinyl is pasted on it**; a **Panel (pieces) row or Item row is Ready once booked** —
no mark gates pieces, so pieces, boards or both leave on any trip. A blocked row sits at 0 and disabled (title =
the missing list) on the Actions tab and in Record Load (Status column, "Load all ready"); each row carries the
house "+" menu → **Load…** = Record Load preset to that row alone (greyed with the reason). The server mirrors the
rule: `/panel-load-save` 409s an MDF pick whose panel is not pasted (`materialBlockers`) and any pieces pick that is
not booked. **CR-405…407 (2026-10-23): load rows are per CUT-PIECE KIND** — a panel line = one `Item` row per piece
kind on the panel (`pcs × qty`, keyed design\|cut: `PanelLoadLine.design` / `cut_piece_size`) + its `Mdf` row
(**CR-406: always**, thickness picked or not); a loose cut-piece line = one `Item` row. Any count may leave on a
row ("2 of the 6 grey pieces"); stock, booking and pending move per kind. `material = Panel` (whole panels) is
legacy, read as qty × pcs over the panel's kinds, never written (400). Server `panelLineRows` / client
`lineLoadRows` own the row list (a new material = both); `loadProgress(lines, loads, panelsById)`,
`pendingNeedLines` → per-kind need lines, `rowKey` / `rowLabel`, `lineWeightSplit(lineId, loads, rows, unitOf)`;
`pendingText` = "12 pcs · 2 MDF". **CR-407 → CR-419 (2026-10-24):** the Actions tab is a
master–detail — card 1 one row per order line (Panel ⓘ · Pieces `pending of ordered` · MDF/Vinyl/Pasted marks ·
Board · Load board · Status · "+" **Load whole panel** / **Load board…**), click a row to select it (`.sel`); card 2
the selected line's cut pieces (Cut piece · Ordered · Loaded · Pending · Status · Load Now · "+" **Load…**) with
**Allocate Stock** in its head; no `rowSpan`; the mark Comboboxes are not clearable (150px). Dispatch tab weight =
pieces once per line + the board on its row (`unitOf(row)`); Loads table + Load Copy name the piece kind. The Requirements card
bands its rows per panel (`reqBands`, key = the row's panel-code set; rows stay one per design × cut). **Cancel** (CR-368): `POST /panel-order-cancel/:rowid
{reason}` (reason for every role; NewRequest…Ready with no loads; `status Cancelled`, `allocation "{}"`) and
`POST /sample-order-cancel/:rowid {reason}` (nothing supplied / loaded; Cancelled = the one stored sample status);
Cancelled is terminal and drops out of every demand / booking reader like Dispatched. Both JSON columns sit in
`STATE_COLUMNS`. `/pending-cut-stock` lists per cut piece Required · On Hand · Booked · Free ·
Shortage (= Required − On Hand) · Orders (`N orders` + (i) → per-order links in the `InfoTag` floating card, CR-386) over every non-dispatched order plus every cut-piece item
(`demandByKey`); the Orders cell lists each order as a link with its share of Required (CR-322);
`/cut-stock` shows Booked · Free.
**CR-404 Readiness tab** (first tab after Details on `/panel-orders/:id` and `/sample-orders/:id`, `OrderReadinessTab`):
the user's "Order Readiness Dashboard" design on the glass skin — hero ring N/total ready to load + headline + four tiles,
one ring per stage, one table row per line with six stage cells. Everything is derived in `lineStages(line, order, reqs,
weightKnown)` (`panelOrderNeeds.ts`): MDF · Vinyl · Pasted = the panel's marks (loose cut piece → not applicable, counted
done); Cut pieces = booked (`materialReadiness`) or already left; Weighed = `lineWeight` known; Loaded = every material
pending 0 — ready to load = the first five done. A sample order shows the one stage Supplied (`remaining(l) === 0`).
Nothing is stored; the tab never restates the header status (CR-390).

**Sample Orders (CR-315…317, 2026-10-08; one register with Panel orders since CR-345)** — a SECOND order
type in Panel Craft, shown in the same Orders grid (Type column / filter, New Order asks the type first)
and linked to the same Customer: a customer's request for item samples, each line = any
Item-master design × Full tile | Cut piece (× cut size) × qty. `SampleOrder` (SMP/FY/NNN, status,
optional source SO / Quote, note) + `SampleOrderLine` (`piece_kind`, `cut_piece_size`, `qty`,
`supplied_qty`, `supplied_on`, `note`) save in one `/sample-order-save` call; edit / delete only while
`New`. Supply is recorded per line on `/sample-orders/:id` as a LOAD since CR-347 (Dispatch tab / **Record Load**
→ `/panel-load-save`: date, vehicle, photos + qty per line, partial allowed; 0 skips a line; the old
`/sample-order-supply` is gone). The header status is never set by hand — it is
derived from the lines (`sampleStatus` server / `deriveSampleStatus` client): New → Partially Supplied →
Supplied. Stock: a **Cut** line deducts cut-piece stock through `adjustCutStock` with ledger kind
`sample` (409 when free stock — on hand minus open panel-order bookings — is short); a **Full** tile is
record-only (box stock is counted in boxes; the godown writes the opened box off on Stock Adjustments
with reason "Sample / Display"). "Request Samples" sits beside "Request Panels" on the Quote and SO More
menus (shared `useSaleSource` resolver: customer locked, designs preselected); the request and every supply
mirror onto the source record's AND the Customer's Activity. The Customer page's **Samples** section lists
every sample line (order, item, piece, requested, supplied, supplied on, status, source) — the register of
what each customer received.

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
The Item detail STOCK card itemises on-hand (CR-298): **In production** (open production lines'
remaining), **Awaiting palletization** (Σ per order line `max(0, produced − palletized)` — boxes an
order owns that are not on a pallet yet, e.g. the remainder of a partial Complete), **In loading**
(Σ `max(0, palletized − loaded)`), then **Available stock** = opening + adjusted + produced − loaded. Each
number drills down per order. **Since CR-341 (2026-10-13) the stock key is the Design ROWID**:
`designStock(designId, …)` filters orders on `Order.designId` and logs on `ProductionEntry.designId`;
`openingByDesign` / `adjustedByDesign` (batchStockApi) and `cachedAllocByDesign` (productionApi) are keyed by
ROWID; `useStockLookup()` takes a ROWID; `needProduction` groups demand per `designId`. The plain
`design_name` is shared by every size · finish of a design, so keying on it pooled their stock and
disagreed with Allocate Stock (which keys by the unique label). Item detail still matches its *orders
list* on `designName` for display grouping.

### 6.2b Inventory adjustments (CR-308)

Breakage, theft, a count correction: a **signed `entry_type="adjust"` ProductionLog row** per
(item, batch), written only by `POST /stock-adjust` (N lines, one `request_group` `adj-<stamp>` per
submission; **CR-446: `date` and `reason` (from the `AdjustmentReason` master) travel PER LINE — the body-level
ones are fallbacks for older callers — and the on-hand floor is netted per `design|batch|warehouse` across the
finer `…|date|reason` lines; since CR-457 the client `StockAdjustForm` enters date + reason ONCE in its header and
stamps them on every line — the route is unchanged; its CR-458 Location Transfer mode posts `/stock-transfer` instead). The
server verifies every removal against that batch's **physical on-hand** (`serverFreeStock(…, { onHand:
true })` — supply minus loaded, no claim netting) before any insert and rolls back on failure; a
removal MAY dip below what sales orders reserved (the sheet warns; `free` clamps at 0) because
breakage is reality. No edit / delete — reverse with the opposite entry. Every reader carries the
signed term: `deriveBatchStock` (`adjusted` per cell, `current = max(0, opening + produced + adjusted
− loaded)`, an adjust-only batch still emits a row), `batchStockApi` (`adjustedByDesign`, never folded
into `openingByDesign` — singular items read opening from `accounting_stock`), `designStock`
(`adjusted` term, see §6.2), `batchLedger`, `productionApi` (adjust rows are never plan lines;
`adjustEntries` feed Inventory ▸ Stock Adjustments and the Item detail Production tab), server
`serverFreeStock` and the `is_batched` guard. Cut-piece stock has the same movement through
`/cut-stock-entry {kind:"adjustment"}` (§5.7). Self-checks: `batchStockDerive.check.ts` (case 8),
`stock.invariant.check.ts`, `batchLedger.check.ts`.

### 6.2c Warehouses and transfer orders (CR-329…332)

Stock keeps ONE global figure per design × batch (§6.2 / §6.3 are unchanged); a warehouse is a
**second axis read from the same rows**. Rules:

1. `Warehouse` master (Settings ▸ Warehouses & Locations): name, exactly one `is_primary`, `purposes` (comma
   list; only **Loading Bay** has behaviour), note. **No warehouses = the feature is dormant** — every
   picker, the Locations tab / card and the report hide or say so. The first warehouse saved becomes
   primary (the client calls `/warehouse-primary` after the insert).
   **CR-409 — Locations.** A warehouse holds LOCATIONS: rows of the same table with `parent` set (one
   level; codes like `A1 … F12`, 60–70 per warehouse, generated from the row's "+" as rows A–F × bays
   1–12 in ONE insert). A location inherits its warehouse's purposes, is never primary, and its name is
   unique **among siblings** (`warehouseSiblingScope` on the generic insert / PATCH; `parent` never
   changes via PATCH). Stock rows still carry ONE `warehouse` id — the **leaf**: a location, or the
   warehouse itself when it has none. Pickers offer leaves only (default = the primary's first location,
   natural order via `codeCollator`); every label reads **Warehouse ▸ Location** (`nodeLabel` /
   server `warehouseMeta.label`); stock recorded on a warehouse node that now has locations reads
   **▸ Unassigned** until a Transfer Order moves it. `BLOCK_DELETE.Warehouse` also refuses a warehouse
   with locations and (CR-410) one a panel order is placed at. The reducer and its server twin are
   unchanged — nodes are just more ids (`toWarehouseIn` builds them, both fetch paths).
2. Stock rows carry a logical-FK `warehouse` (`ProductionLog` opening / record / adjust / transfer
   rows, every `CutStockEntry`). **null = the primary.** To keep that stable, `POST
   /warehouse-primary/:rowid` first stamps the OLD primary's ROWID onto every null-warehouse stock
   row, then moves the flag. `is_primary` is a `STATE_COLUMN`; the primary and any warehouse with
   stock history refuse deletion (`BLOCK_DELETE.Warehouse`).
3. A **transfer is a pair of signed rows** sharing one code `TRF/<FY>/NNN` (`nextTransferNumber`
   scans both `ProductionLog.request_group` and `CutStockEntry.doc_number`): boxes =
   `entry_type="transfer"` (−from / +to, `status:""`, `stage:"Completed"`, `reason` free text, no
   order item) via `POST /stock-transfer`; cut pieces = `kind="transfer"` via `/cut-stock-entry`
   (`CutPieceStock.qty` nets to zero). Net zero per key ⇒ **every global reader ignores the type**
   (`productionApi` plan-line denylist, `batchStockApi` supply loop, `serverFreeStock`, the
   `is_batched` guard; `/production-delete` refuses a leg). No edit / delete — reverse with the
   opposite transfer.
4. **One pure reducer** `client/src/lib/warehouseStock.ts` (`deriveWarehouseStock(warehouses,
   moves, claims)`, Node self-check): a move with a warehouse nets that warehouse; null supply →
   primary; a **null removal** (loaded boxes = what `deriveBatchStock` absorbed per batch, dispatched /
   sampled pieces, pre-ledger residual) and null claims (reserved boxes, booked pieces) are **spread**:
   Loading Bay-purpose warehouses first, then the largest balance, ties by id, never below zero; what
   nobody can absorb lands on the primary as `over`. Unknown / deleted warehouse id → primary.
   Invariant per key: Σ onHand = Σ moves + Σ over. The server carries a JS twin `warehouseReduce`
   (`serverWarehouseOnHand` / `serverCutWarehouseOnHand`) for the floors — `warehouseReduce.check.js`
   lifts it out of `index.js` and runs the same scenarios. **Change both.**
5. Feeders: `batchStockApi` builds the moves from the rows it already has and exposes `byWarehouse`
   on the same cache; `panelOrdersApi.cutWarehouseCells(warehouses, entries, stockRows, booked)` does
   the cut side (ledger rows + a null residual of `CutPieceStock.qty − Σ ledger`).
6. Floors: a transfer line ≤ the From warehouse's on-hand; a negative adjustment ≤ that warehouse's
   on-hand (409 "… at <warehouse>"). Loading / palletising screens are untouched by design (user
   decision 2026-10-12: manual transfers only).

7. **CR-410 — panels.** `PanelOrder.warehouse` = the Warehouse node where the order's panels sit (More ▸
   Set Location on the order, generic PATCH; open orders only). Manual placement — loading / dispatch never
   touch it. Shown as the **Location** field, a default-hidden grid column and the **Panels** segment of
   Reports ▸ Stock Locations (open orders placed somewhere, qty = the order's pieces). CR-413: the Panel Order
   form also takes a Location (create / edit, `/panel-order-save` header; no default — a new order has nothing on
   the floor yet).

8. **CR-411 — every box writer records a location; purposes drive the default.** `defaultNodeFor(rows, purpose)`
   (`warehousesApi.ts`, exposed as `useWarehouses().primaryFor`) = the first leaf of the first warehouse carrying
   that purpose, else `defaultNode`. Record Output, the bulk Record Production sheet, the Complete Production
   dialog, the Excel import and the inline grid record all default to the **Production** bay (the sheet, dialog
   and import gained the picker; the inline cell defaults silently). Nothing lands on "▸ Unassigned" from a
   production screen any more. **CR-438 — the location is per item / per row, never only per form.** Record
   Output asks it in every item's section (its batches share it), Complete Production per line, and the bulk
   sheets (`/prod/record`, cut-stock Add / Adjust, box-stock Adjust) carry a last **Location** column per row
   whose blank cell means "the bar's" — the bar picker is the default, not the rule. Resolution is server-side on
   `/production-record-lines`, `/production-complete`, `/cut-stock-entry` and `/stock-adjust`:
   `line.warehouse ⊳ body.warehouse ⊳ primary`; the stock routes merge duplicates per `design|cut (batch)|warehouse`
   and check a removal against the LINE's bay. Paste / import accept the "Warehouse ▸ A1" label or the bare code
   (`warehouseIndex`, `productionLogSheetEdit.ts`). Transfer orders keep one From / To pair.

9. **CR-412 — a pallet has a location until it enters a container.** `PalletizationPlanLine.warehouse` (col
   69851000000376694) = the node where the pallet stands. Captured in the **Palletise dialog** (one Location for
   every item; Start defaults to the **Palletization** bay, Complete to the **Loading Bay**) and passed through
   `/pal-line-status` (`body.warehouse`); changed later via **Set Location** — the boards' "+" menu (acts on the
   checked items too), the selection bar **Set Location (n)**, the loading row menu (Ready for Loading only) and
   the plan detail More menu (every un-loaded line) — all a generic PATCH through `setPalLineLocation`. Splits keep
   it (`/pal-line-status` slice, `writeLineIntoBox` remainder; a `/pal-topup` donor takes the TARGET's). Shown as
   the **Location** column on the packing and loading sheets (`packingSheetColumns.v3`, `loadingColumns.v4`;
   hidden while no warehouse exists), a Location group-by on the packing board, the card's meta line, the plan
   detail lines table, Item ▸ Locations ▸ **On pallets at**, and the **Pallets** segment of Stock Locations
   (palletized lines not yet in a container, qty = boxes, linked to the plan). **A tag, never a stock
   movement** — the reducers are untouched; loose-box figures already exclude palletized boxes, so Boxes and
   Pallets never double count. A loaded line reads "—": the container is its place. Shared modal:
   `common/SetLocationModal.tsx` (moved out of `PanelOrderDetail`).

Surfaces: Settings ▸ Warehouses & Locations; Inventory ▸ Transfer Orders (+ Cut Stock ▸ Transfer); Location pickers
on Record Output, Record Production sheet, Complete Production, Production import, Opening Stock, Stock Adjustment
and the cut sheets (default = the purpose bay, else the primary's first location; type a code to jump); the
Palletise dialog + Set Location on /packing · /palletizing · /loading · plan detail (CR-412); Item detail ▸
**Locations** tab (+ On pallets at) and Panel Item ▸ **Locations** card (CR-332; only locations that hold
something); Panel Order ▸ Location field + form field + More ▸ Set Location (CR-410/413); Reports ▸
**Stock Locations** (CR-331, Boxes | Cut pieces | Panels | Pallets).

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
palletising, loading and dispatch are untouched. `POST /deallocate-stock/:rowid` returns the whole
row or, with `boxes` (1…row qty, CR-297), part of it — a partial return trims the row's `qty_boxes`,
a full one soft-deletes it; either way it refuses once the boxes left the Planning queue, trims auto
Planning cards, and blocks on a manual one. The Deallocate Stock modal caps Return at allocated −
palletised per line and sits beside Allocate Stock on the SO Items card (both always shown to stages
editors, greyed with the reason). Cancelling
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
| `stock-warehouse` | Stock Locations | CR-331: what sits at each location — Boxes \| Cut pieces \| Panels (CR-410) \| Pallets (CR-412), list or Item × Location matrix (occupied locations only), a tile per warehouse |
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
records every state-machine move. **Deletes carry a reason (CR-270):** `confirmDelete()` in
`ui/ConfirmDialog.tsx` is the one delete confirm — Admin gets the plain Yes/No, every other role must
type a reason; `remove(table, rowid, reason)` sends it as `?reason=` (the `/panel-delete`,
`/load-box-delete`, `/production-delete` ops take `body.reason`) and the server's `deleteReason()`
rejects a non-admin delete without one and stores it in the `OperationLog` payload. `/ops` renders the audit log with local-time timestamps.
Detail pages' Activity/Status tabs filter server-side (`?where=` on `entity_rowid`, else
`table_name` — CR-128); the old global newest-N fetch dropped older records' history.

---

## 8 · House standards

These are binding. They were learned from correction, and re-deriving them costs more than
reading them. A change to any of these is a change **everywhere the pattern exists**, not just
where it was reported.

**Names are Title Case (CR-429).** Every human-entered name — item design names, customer / company /
contact names, drivers, transporters, loading supervisors, users, sales persons, lookup-master values — is
stored as `Dhiraj Shah Of ABC Exports LLP` by ONE server helper, [`lib/names.js`](../functions/data-ops/lib/names.js)
(`titleCase`, `NAME_COLUMNS`, `normalizeNames`), applied in the generic POST / PATCH routes before the
natural-key check and in every writer that bypasses them (panel loads, load boxes, `appauth`, the Zoho pull
mappers). A word typed ALL-CAPS with ≤3 letters and the legal suffixes (LLP, LTD, PVT…) keep their capitals;
codes, SKUs, `unique_name`, vehicle numbers, Size names and locations are never touched. A new name column =
add it to `NAME_COLUMNS`; a new bypassing writer calls `titleCase`. The client mirror (`lib/format.ts`) is
used only where a derived key must match the stored text (Item `unique_name`, the party-brand SKU segment).

**Next-step reasons (CR-328).** A stage action that cannot proceed is never silent and never only a
hover `title`: the screen shows the reason and what to do first through `ui/States.tsx` `Note`
(`.note.warn|info|ok`) fed by ONE rule, `soNextStep(items, lines)` / `blockers(want, customer, orders,
lines)` in [`nextStep.ts`](../client/src/features/stages/nextStep.ts) (closed → approve → allocate →
palletize → palletizing → load → dispatch → done). New Loading, New Palletization, the SO detail Items
card ("Next:"), Send to Loading and the Load dialog use it; an empty pick list names its reason through
`Combobox emptyText`. A new gate joins this rule — never a bespoke string. Derived loading status is
`boxStatusOf(box, lineCount)` (`palPlansApi.ts`), nowhere else.

**Grids** — every list grid: one-line rows (`.nw` / `.clip`, cap on the span, not the `td`);
footer pager (`GridFooter`: "x–y of z" + « ‹ pages › » First / Prev / Next / Last arrow buttons, CR-467); data-driven column defs with show/hide **and** reorder (`useColumns`, icon-only
`ColumnPicker`); advanced-search modal; Created/Modified hidden by default; **whole row** clicks
through to the detail page; newest-first default sort (`useSortRows(..., "created", -1)`).
**Customer → Design lead, system numbers hidden (CR-355, global since 2026-10-19):** the default
column order starts with Customer then Design (Item / Name on masters); the server- or client-minted
number (SO, QT, PNL, SMP, PRD, PAL, LOAD, TRF, CUS-, SKU, panel code) is an ordinary `ColumnDef` at the
END of the order and in `defaultHidden` — never pinned outside the picker. Customer-supplied numbers
(PO Number, Container No.) stay visible. "Design" on an order-level grid is the record's design names
in one clipped cell — `ui/DesignNames.tsx` (Panel Craft rows feed it `lineCodeList` from
`PanelLoads.tsx`). A changed default order or hidden set bumps the `useColumns` key (`.v2`, `.vN`),
because saved prefs win over code defaults. A grid with no detail page opens its edit form on row click
(CR-283); ledger grids (Stock Transfers / Adjustments) open the item's stock tab.

**Default view.** Every board (`/prod`, `/packing`, `/loading`, `/panel-orders`) opens on
**Sheet/Grid**, and since CR-418 (2026-10-24) the **Kanban option is hidden everywhere** — a
persisted `kanban` / `board` value is coerced to the Sheet in the page (`rawView` → `view`), the
board code is kept. The Settings → Preferences *Default view* row is hidden with it;
`AppSetting.default_view` and `useViewState` ([`usePersistedState.ts`](../client/src/lib/usePersistedState.ts))
stay in place, so a board still goes through `useViewState` and the toggle can return by
un-commenting one line.

**Organization profile (CR-445, 2026-10-25).** Branding is data, never a constant: `client/src/lib/org.ts`
holds the profile (`getOrg()` sync for pdfmake, `useOrg()` for React, `orgLogoUrl()`, tax / contact / bank
helpers), loaded once in `main.tsx` from the public route. Settings ▸ Organization (`OrgProfile.tsx`) edits the
15 `org_*` AppSetting rows (Logo + Company Name required; Admin-only on the server). Every renderer —
`pdfHeader`, `quoteTemplate.COMPANY` getters + `bankRows()`, `logoDataUrl()`, sidebar, login, tour, shared
pages — reads it. A new place that shows the company name or logo imports `lib/org.ts`; never a string literal.
Fallback (nothing saved) = the bundled BOFFO logo and the old constants on live. The demo build (`IS_DEMO` =
`VITE_DEMO=1`, CR-454) falls back to a neutral "Demo / Demo Company" profile with no logo, contact or bank rows;
`logoDataUrl()` then resolves to "" and the three PDF builders (quote, dispatch copy, panel load copy) print the
brand name in the logo band instead. Server sign-in errors name no company ("No account for …").

**ColumnPicker Apply is locked.** Checkbox changes and reorder both *stage*; nothing applies
until **Apply**. Never make it immediate. Detail-page Fields pickers use the same component.
The button lights up (`.btn.active`, same as an applied Search) when the view is non-default:
`useColumns().customised` → `active` for column/field pickers, `groupBy.length > 0` for Group (CR-245). Status filters open on **All** on every grid (except the two
palletization pages, which open on their own stage since CR-278) and their
`<select>` takes `.fbar select.on` (same indigo) when narrowed (CR-246).

**Forms** — no negative values anywhere; pick lists are `Combobox` only and **always sourced
from the DB masters, never a static array**; required marker sits in-box with a legend;
grey = auto-derived, white = typable, `ƒx` marks a calculated field; inputs come before derived
values; Save-only buttons (no Save-and-new variants); `seq_code` is auto-generated — no Short
Code inputs; registration fields auto-format (`formatVehicleNumber`); **every date field
defaults to today** (`todayISO`), never blank; Sales Person defaults to the logged-in user
(`currentSalespersonName` / `storedAuth`). **Layout (CR-275, tightened by CR-277):** every form on `FormPage` lays its header
fields out in `.form-rows` — label left, control right, two pairs per row. The label column is
`fit-content(160px)` shared across the section through CSS subgrid (as wide as the longest label, never a
fixed hole); `.span2` for a field that owns its row (the Customer row, a formula Name, Remarks / Note) —
its control stays ONE control wide, never the page width; `.form-rows.one` for a single column (notes
sections, address columns), `.form-divider` between groups, `.ctl-row` for a control with a button or
preview beside it. Every Remarks / Note field is a `<textarea>` (`.form-rows textarea` min-height 84px),
never a single-line input. Modals keep `.form-grid`. Every Customer picker on a transaction form carries a magnifier
that opens [`CustomerSearchModal`](../client/src/features/masters/CustomerSearchModal.tsx) (CR-276) —
the shared search surface; never a per-form picker.

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

**One skin: BOFFO Glass** (CR-378, 2026-10-22). `styles/glass.css` (loaded last; spec in
[`DESIGN-SYSTEM-GLASS.md`](DESIGN-SYSTEM-GLASS.md)) is the app-wide look. `main.tsx` sets
`<html data-skin="glass">` before the first paint and every glass rule is prefixed with that attribute, so
removing the attribute restores the slate/indigo theme (`styles/theme.css`, kept as the base layer that
glass re-themes through its primary tokens). Theme = `<html data-theme>` from `lib/theme.ts` (per-device
`localStorage["boffo.theme"]`, dark default, light / system picked in the rail user menu — CR-379: the
account chip at the bottom of the sidebar, `features/shell/HeaderMenus.tsx` `UserMenu`, also Settings,
Keyboard shortcuts, tours and Sign out; the header keeps Search + Bell only). The rail stays dark in
both themes (logo), toasts stay opaque, print sheets (`.qprint-*`, `.qp-*`, `.dentry-*`) and the login
screen keep their own palettes, and `backdrop-filter` is never put on `.card` / `.main` / `.app` — it would
turn the card into the containing block of the fixed grid footer. New UI uses the `--g-*` tokens and the
spec's §5 classes; a literal colour belongs in glass.css under the skin, never in TSX. Status chips
(`ui/Chip`) carry their colour as a `tone-*` class so the skin can re-tint them. **CR-388 house rules
from the glitch sweep:** every numeric cell (`.tbl td.num` and the sheet/print variants) is `nowrap`; a
card header is `className="card-head"`, a compact toolbar button is `.hbtn.sm`, a dashed add-row button is
`.btn.dashed` — never the inline style; theme.css owns the `--t-xs…lg` scale (styles.css no longer declares
it); a glass hover rule must not outrank `.sel` / `.load-band` rows. **CR-389:** a raw record id (ROWID,
CRM / Books id) never prints inline or in a toast — it sits behind an (i) `InfoTag` card or is left out; a
route path is never shown as text, name the page; `ƒx` appears only on forms that carry its legend. **CR-390:** a status that the title, subtitle or header
chip already shows is not repeated as a field or a second chip; a field that restates the title (PO on the SO
page, date on a production) is not listed; a grid column empty on every row is default-hidden; vehicle /
driver belong to loading, not palletization; every change to a `useColumns` / `RecordDetail` default-hidden
list bumps its storage key (`.vN`).

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
- `AppUser` — email (unique), `password_hash` as `scrypt$salt$hash` (**nullable since CR-337** — a blank
  password = Zoho sign-in only), active, role FK, `zoho_zuid` + `zoho_linked_at` (CR-337 — stamped on the
  first Zoho sign-in; the Users grid derives **Sign-in** = Zoho / Password / Both / None from them).
- **Staff** (CR-336) — the default role for every new account: view + create + export on every module, no
  edit / delete / approve. Self-seeded by `defaultRoleId()` the first time it is needed. `POST /auth/users`
  without a role, the Users page's New user form and Zoho self-provisioning all land here.
- `AuthSession` — unique token, 7-day TTL, user FK with cascade.

**Guard classification (CR-336)** is the pure `routeAction(path, method, body)` in `appauth.js`
(`ROUTE_PERM` business routes, `UPSERT_ROUTES` = create without `body.rowid` / edit with, `ADMIN_ROUTES`
= 403 for non-Admin, `TABLE_MODULE` × HTTP method for generic CRUD; `null` = legacy `can_update` /
`can_delete` fallback for side tables), tested in `lib/appauth.test.js`.

**Twelve `/auth/*` routes**: `login`, `logout`, `me`, `roles` (GET/POST/PATCH/DELETE),
`users` (GET/POST/PATCH), and the two Zoho OAuth legs `zoho/start`, `zoho/exchange` (anonymous, like
`login`). Role and user administration is Admin-only.

**Sign in with Zoho (CR-324).** Custom OAuth 2.0 authorization-code flow in
[`lib/zoho.js`](../functions/data-ops/lib/zoho.js) — not Catalyst Embedded Auth, identity only
(`AaaServer.profile.READ`, `access_type=online`, no Zoho token is stored). `POST /auth/zoho/start`
sets a 10-minute `boffo_oauth_state` cookie (`<nonce>.login`) and returns the consent URL on
`accounts.zoho.<ZOHO_DC>` (default `in`); Zoho returns the browser to the SPA
`/app/?code=…&state=…&location=…` (the redirect URI — trailing slash, `/app?code` is a 404);
`AuthGate` posts `{code, state, location}` to `POST /auth/zoho/exchange`, which checks the state
against the cookie, exchanges the code on the DC named by `location`, reads `/oauth/user/info` and
mints the session through the same `mintSession` as `/auth/login`. An existing active `AppUser` signs in
(and is stamped `zoho_zuid` / `zoho_linked_at` the first time); a disabled one is refused. **An unknown
email self-provisions as Staff (CR-337)** when its domain is listed in AppSetting `zoho_login_domains`
(comma-separated; Admin edits it on Settings ▸ Users, and only Admin may write that key through the
generic routes — `ADMIN_SETTINGS`); any other email is refused ("No BOFFO account for …"), and a
soft-deleted email is refused rather than re-created.
Config: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, `ZOHO_DC` in
`functions/data-ops/catalyst-config.json` (gitignored since CR-324; `catalyst-config.example.json`
lists the keys). The Zoho API-console client must be **Server-based**, with the SPA `/app/` as its
Authorized Redirect URI and Multi-DC "same credentials for all data centers" on. When a production
or custom domain arrives, add its `/app/` in the console **and** switch `ZOHO_REDIRECT_URI` in the
same deploy — one deployment serves one redirect URI.

**Zoho Books connection (CR-325, CR-356) — ⚠ hidden since CR-359, see the CRM paragraph below.** The same OAuth client, a second purpose: `POST
/zoho/books/connect` (Admin) starts consent for `ZohoBooks.contacts.READ,ZohoBooks.contacts.CREATE,
ZohoBooks.contacts.UPDATE,ZohoBooks.settings.READ` with `access_type=offline&prompt=consent`; the state
cookie reads `<nonce>.books`, so the shared exchange stores the connection instead of minting a session
(it first re-checks that the caller is a signed-in Admin). The connection is **one org-wide refresh
token** in five `AppSetting` rows (`zoho_books_refresh_token`, `zoho_books_dc`, `zoho_books_org_id`,
`zoho_books_org_name`, `zoho_books_scope` — the granted scope; first organisation of the account).
`SECRET_SETTINGS` in `zoho.js` strips the token row from the generic `GET /AppSetting` reads
(`isSecretSetting`, `index.js`; a `?columns=` projection always keeps `setting_key`), and every
`zoho_books_*` row is Admin-only on the generic writes (`assertSettingWrite`). Scopes are granted at
consent — **nothing to configure in the Zoho API console**; a connection made before CR-356 is read-only
(`canWrite=false` on `/zoho/books/status`) until an Admin reconnects. Reads for the hand mapping:
`GET /zoho/books/status`, `GET /zoho/books/contacts?q=`, `GET /zoho/books/contacts/:id`;
`DELETE /zoho/books/connection` (Admin) revokes and forgets (the sync watermark survives). Guard:
`ROUTE_PERM.zoho = customers:edit`. A 409 `reauth_required` means "connect Zoho Books in Settings".

**Customer sync via Books (CR-356, `lib/booksSync.js`) — ⚠ hidden since CR-359; the loop now lives in `lib/customerSync.js`.** Reverses the CR-325 "never a sync" rule.
*Books → add-on:* `GET /cron/books-sync?key=` (same `FX_CRON_KEY`, registered before the guard) is
fired by **Catalyst Signals** (CR-358: Zoho Books publisher, events `customer_created` / `customer_updated`,
Webhook target = this URL, dispatch Instant, 1 call/s) and once a day by the backstop URL cron
`books_sync_daily`; `POST /zoho/books/sync` (Admin, "Refresh now") is the same pull. All three run
`syncFromBooks({full:false})` — one run at a time per instance (`inflight` lock, CR-358): one `GET /contacts?contact_type=customer&sort_column=last_modified_time
&sort_order=D&per_page=200` (Books has no "since" filter), stop at the watermark `AppSetting
zoho_books_sync_at`, then `GET /contacts/:id` for each changed contact, oldest first, 50 per run (the
rest come next run; the watermark advances only past written contacts). Match by `books_contact_id`,
else by name (case-insensitive, among unmapped customers → **links** it), else insert with the next
`CUS-` code (`nextCustomerCode` twin). `contactToCustomer` = server twin of `booksMap.ts`: a Books
value overwrites only where non-empty, add-on-only columns (code, box_brand, port_of_discharge,
handling_person, main_party_name, working_status, overseas, additional_addresses) are never touched,
`status=inactive` → `active=false`, payment term by label, `country_code` from the billing country
name, legacy `address` composed. Every write → OperationLog (`books-sync:create|update|link`, actor
`zoho-books-sync`); per-contact errors go to the summary (`zoho_books_sync_summary`) and stop the run so
the watermark stays behind them. **No watermark = nothing imported yet**: the refresh does nothing and
says "Run Import all first" — the full pull is always explicit. *Import all:* `POST /zoho/books/import
{page}` (Admin) = `syncFromBooks({full:true,page})`, 25 contacts per call (inside the function timeout),
the Settings page loops until `done`; page 1's newest row becomes the watermark. *Add-on → Books:*
`POST /zoho/books/push/:rowid` (`customers:edit`, needs `canWrite`) builds the contact with
`customerToContact` (eight fields, addresses, contact persons; opening balance never pushed) and does
`POST /contacts` (stores the new `books_contact_id`) or `PUT /contacts/:id`; a Books "already exists"
answer is surfaced with "use Map to Zoho Books instead". Budget: 100 calls/min, 1 000–10 000/day by
Books plan — the schedule costs 48 list calls a day plus one per changed contact. Self-check:
`node functions/data-ops/lib/booksSync.check.js`.

**Zoho CRM Accounts — the active customer source (CR-359).** The two paragraphs above describe the
Books provider, which is **hidden since CR-359** (its connection, routes, cron target and
`books_contact_id` values stay). `lib/zoho.js` is provider-keyed: `PROVIDERS = {books, crm}` (scope, API
base `/books/v3` | `/crm/v8`, org param, canWrite regex), **`ACTIVE_PROVIDER = "crm"`** is the one server
flag (client twin: `ZOHO` in `zohoApi.ts`), AppSetting rows are `zoho_<provider>_refresh_token / _dc /
_org_id / _org_name / _scope` (+ `_sync_at`, `_sync_summary` written by the sync), every `zoho_*` row is
Admin-only on the generic writes, and every route is `/zoho/:provider/…` (`status` adds `provider`,
`active`; `records?q=` searches — CRM `Accounts/search?criteria=(Account_Name:starts_with:q)`; `records/:id`
returns **`{record, mapped}`**, the server's own Customer mapping, so the form prefill has no client
twin any more). `apiCall(provider)` maps CRM answers: 304 → `{notModified:true}`, 204 → `{data:[]}`,
`INVALID_TOKEN` → 409 `reauth_required`, `DUPLICATE_DATA` → 409 "already exists". **Access tokens are cached
per refresh token** (`tokenCache` Map, CR-363 — Zoho allows 10 token requests per 10 min per app; a single
slot thrashed on every CRM ⇄ Books switch), a throttled refresh is 429 "wait 10 minutes", not a reconnect. `connect(provider)`
names the CRM org from `GET /crm/v8/org`. **Sync core `lib/customerSync.js`** (lifted from
`booksSync.js`, same rules, same CR-358 lock, one lock for both providers) drives an adapter:
`listChanged / loadAux / fetch / toCustomer / toRecord / create / update / search`. **CRM adapter
`lib/crmSync.js`:** list = `GET /Accounts?fields=id,Account_Name,Modified_Time&sort_by=Modified_Time
&sort_order=desc&per_page=200` with **`If-Modified-Since: <watermark>`** (a quiet pull = one call, 304;
import pages of **10** without the header (CR-362: 25 ran 26–36 s per page with the Books check and hit the
gateway's ~30 s limit; a re-run skips hits already linked and unchanged since the watermark — `pickChanged`
`linked`, reported as `skipped`); `// ponytail:` page-based paging stops at 2 000 accounts);
fetch = `GET /Accounts/{id}` + `GET /Accounts/{id}/Contacts` + **CR-362** Books `GET /contacts?zcrm_account_id={id}` when
Books is connected (`loadAux.books`; a hit → `books_contact_id`, so the client derives CRM & Books / CRM only /
Books only — `zohoLinkOf` in `zohoApi.ts`; no hit → left as is; a Books failure stops the checks for the run and
is reported once in the summary errors, CR-363); **`recheck`** (CR-363) = Books-only lookup for the hits a full
import skips as unchanged when the row has no Books id yet (700 ms apart — Books 100 calls/min), so Import all is
the re-check; `loadAux` = PaymentTerm maps + the org's
**custom** Account fields from `GET /settings/fields?module=Accounts` matched by label (GSTIN, PAN, GST
Treatment, Place of Supply, Credit Limit, Payment Term, Opening Balance — `detectCustomFields`, cached
10 min per instance; no such field = column left alone); `accountToCustomer`: Account_Name →
name/company, Website, Description → notes, `Currency` when present, Account_Type Individual/Consumer →
customer_type individual, Billing_*/Shipping_* → addresses (+ `country_code`, legacy `address`), first
Contact → `contact_*`, the rest → `contact_persons`, GST treatment text → Books codes; `customerToAccount`
is the reverse (opening balance never pushed), `create` = `POST /Accounts` then `POST /Contacts` (bulk,
`Account_Name:{id}`, `Last_Name` falls back to the first name), `update` = `PUT /Accounts/{id}` then
Contacts **upserted by email**. Entry points: `GET /cron/crm-sync?key=` (webhook target / URL cron
`crm_sync_30m`; `/cron/books-sync` answers `{disabled:true}` while CRM is active), `POST
/zoho/crm/sync` (Refresh now), `POST /zoho/crm/import {page}`, `POST /zoho/crm/push/:rowid`. The link
column is `Customer.crm_account_id`; `books_contact_id` is untouched. Self-check:
`node functions/data-ops/lib/crmSync.check.js`. Switching back to Books = flip `ACTIVE_PROVIDER` and
`ZOHO` — nothing else.

**Duplicates (CR-372/373, 2026-10-22).** The sync's existing-customer read is paged (`allRows`; the
unbounded ZCQL hit the 300-row cap and the 2026-10-21 imports minted a twin per account — 822 rows for
≈530 accounts — and reused `CUS-` codes). Matching: link column → ONE unmapped customer with the same
name is linked (CRM → Books → add-on: CRM values win non-empty) → else create. A name already on a
customer linked to another CRM account, or on several unmapped customers, is a **duplicate: nothing
written**, `summary.duplicates` + an `errors` line, and the watermark advances (a decision for the user,
not a retry). `POST /customer-dedupe` (Admin, `ADMIN_ROUTES`; planner `lib/customerDedupe.js`, self-check
`customerDedupe.check.js`): groups by `crm_account_id` — keeper = the Books-linked row, else the lowest
code; Quote / SalesOrder / PanelOrder / SampleOrder repointed, a twin's Books id copied onto the keeper,
twins soft-deleted (`dedupe:merge` log); survivors sharing a code are re-coded (`dedupe:recode`); one
name on different CRM accounts = `conflicts`, reported only. Dry run by default; `{apply:true}` merges.
Settings ▸ Zoho CRM ▸ **Duplicate customers** card (Find duplicates → table + conflicts Note → Merge N
duplicates, Yes/No); **Import all refuses while duplicates exist**.

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

- **Uploads** — `/upload/design-image` (item images and, since CR-445, the org logo; the File Store folder `design_images` is found by name or created on first use) accepts raster images only, judged by magic bytes
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

Catalyst URL crons (console, not in the repo): `fx_refresh_daily` → `/cron/fx-refresh?key=` and
`books_sync_daily` → `/cron/books-sync?key=` (CR-356 made it 30-min; CR-358 demoted it to a daily
backstop behind the Signals webhook), both keyed by `FX_CRON_KEY`. Catalyst **Signals** (console, not in
the repo): publisher `boffo_books` (Zoho Books, the Boffo org — the console login must be a member of
that org), webhook target `GET …/server/data-ops/cron/books-sync?key=`, rules on `customer_created` and
`customer_updated`, dispatch Instant, rate limit 1/s, 3 retries.
`functions/data-ops/catalyst-config.json` holds the function's env vars (`FX_CRON_KEY`, `ZOHO_*`) and is
**gitignored** — copy `catalyst-config.example.json` and fill it in before the first deploy from a fresh
clone; `catalyst deploy` reads `env_variables` from the local file.

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
node client/src/lib/warehouseStock.check.ts
node functions/data-ops/lib/warehouseReduce.check.js
node client/src/features/reports/bucket.check.ts
node client/src/lib/needProduction.check.ts
node client/src/features/masters/palletSize.check.ts
node client/src/features/masters/hubPick.check.ts
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

### Demo / test environment (CR-441)

A second, fully separate stack for demos and testing — **never the live project or its data**.
Catalyst project `export-tracker-demo` (`69851000000395215`, org OCTFIS) holds a clone of the live
Data Store schema (60 tables; snapshot in `docs/schema/live-datastore-schema.json`, ids in
`docs/schema/demo-table-ids.json`) and both functions, deployed by `bash scripts/deploy-demo.sh`
(swaps a demo `catalyst-config.json` in and restores the live one; `.catalystrc` is untouched).
The front end is Catalyst **Slate** at `https://export-tracker-demo.onslate.com`, built from `client/`
of the company mirror repo with `VITE_API_BASE` pointing at the demo functions — the one place the
client is cross-origin, so the Slate domain must be an Authorized Domain (CORS) in the demo project.
Dummy data: `scripts/seed-demo-masters.mjs` then `seed-multi.mjs` / `seed-panel-stages.mjs` with
`SEED_HOST` = demo. Runbook: `docs/DEMO-ENVIRONMENT.md`. `origin` pushes to both GitHub repos.

---

## 11 · Open, parked and never-built

| | |
|---|---|
| **Slate migration** | Planned, not executed — [`Migration to Slate plan.md`](../Migration%20to%20Slate%20plan.md). Risk: same-origin `/server` + auth cookie. |
| **QC stage** | Exists in `ProductionStage`, dropped from the board and flow. |
| **Production approval** | Retired; server transitions kept for rollback only. |
| **Zoho integration** | Customers sync both ways with **Zoho CRM Accounts** since CR-359 (2026-10-21; Books CR-356/358 hidden behind `ACTIVE_PROVIDER`, kept). Still open: invoices / sales orders to Books, several organisations, a 429 retry, CRM page_token past 2 000 accounts, Signals CRM publisher as the webhook source. |
| **Hidden routes** | `/po`, `/qc`, `/container-shipments`, `/fit`, `/loadplan`, `/invoices` — registered, no nav entry. |
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
5. Update the entity's row in [`DATA-FLOW.md`](DATA-FLOW.md) if the change added a write path
   (route, button, bulk action, sheet) or a rule — and apply the rule to every path in that row.

A change is not done until all five are true.
