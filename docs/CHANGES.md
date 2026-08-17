# Changes

## 2026-08-12 — Production polish: designStock unification, SO picker filter, Excel import placement, container tab

- **designStock unification** — Item detail, Reports and transaction line rows all
  derive live stock through the one `designStock()` path in `client/src/lib/stock.ts`
  (`openingStockFor()` picks `accounting_stock` vs summed opening-batch rows per item —
  the guard against double-counting opening).
- **SO picker filter** — Production's Sales Order picker hides fully-produced orders.
- **Excel import** — `/prod` Import button placement finalized (`ProductionImport.tsx`);
  no re-upload dedupe yet.
- **Container planning** — quote-level container planning surfaced as a tab
  (`ContainerPlanCard` on QuoteDetail).
- Deployed LIVE 2026-08-12 (commit `a242dbc`).

## 2026-08-11 — Batch-wise production & opening stock + batch/shade UI revamp

- **`Design.is_batched`** — batch-tracked items. Server rejects flipping the flag
  once the item carries stock.
- **Batch-wise opening stock** — `POST /opening-stock/:designId` stores opening as
  `ProductionLog entry_type="opening"` rows (one per batch); locked after the first
  submission (admin-only re-edit with required `_reason` → OperationLog). Singular
  items keep the `accounting_stock` single number + same lock.
- **Multi-batch recording** — `POST /production-record-lines/:rowid` records several
  batches (qty + batch + mfg_date) against one plan line in one shot; OrderItem
  bumped once, inserts compensated on failure.
- **Duplicate-batch guard** — same item + same batch always 409; cross-item reuse
  controlled by the new **AppSetting** table (`allow_duplicate_batches`, Settings page).
- **Stock Details grid** (`/stock`, `StockDetails.tsx`) — batch-level stock view;
  `batchStockApi` derives per-batch on-hand.
- **Shared pallet page + pallet QR PDF** — `SharedPallet.tsx` public scanner page
  (`#/share/box/<token>`, tokenless `GET /public/pallet/:token`, token minted by
  `POST /load-box-share/:rowid`); printable pallet QR labels (`palletQrPdf.ts`).
- Commits `1342599` (deployed LIVE 2026-08-11) + `96db631`.

## 2026-08-07 — Production batches, mixed pallets, loading capture, auto-enqueue

- **Batch/shade columns** — `ProductionLog.batch_number` (`B/FY/NNN`, auto-minted) +
  `shade`; `PalletisedBatch`/`PalletisedBatchLine` carry batch/shade (header for
  single-batch pallets, per-line truth on mixed).
- **Mixed pallets** — `/combine-leftovers` combines sub-pallet leftovers across items
  into one `is_mixed` pallet (design null, batch/shade per line).
- **Loading capture** — LoadBox gains `container_number` / `line_seal` /
  `electronic_seal` / `loading_supervisor`, set via `/load-box-update` or at dispatch.
- **SO-confirm auto-enqueue** — confirming a Sales Order inserts one production plan
  row per order item (`request_group="so-{soId}"`, deduped on order_item). Auto-queued
  jobs count toward in-production only once *touched* (recorded or dragged out of New);
  a manual request supersedes an untouched auto job.
- **Production Sheet view** — per-row Record button + record prompt on Complete.
- Commits `7609790`, `d1e8509`/`df8abbb` (TDZ fixes), `a8e30f7`.

## 2026-07-31/08-03 — Plan Containerisation

- Quote-level container planning page: split plan boxes into containers, move boxes
  between containers, Remaining column driven by order quantities.
- **Box Fitting / Weight Fitting mode toggle** — Box Fitting (default; capacity fixed
  from the Pallet master) vs Weight Fitting; a saved plan reopens in its mode.
- Commits `2abed9b`, `be87adc`, `73d273f`, `21c39a6`, `27924f8`.

## 2026-07-28/29 — LoadBox vehicle slots + Dispatch Control Board

- **LoadBox** (new table) — cross-plan "boxes" on the Loading columns; dragging any
  Ready line onto In Loading auto-creates/reuses an open box (no +Box/kebab); vehicle
  attaches while Open or is asked at dispatch; a box dispatches as one unit and plan
  status auto-follows (`Loading` → `Completed`). Partial loads split the plan line.
- **Dispatch Control Board** — `/packing` board becomes the two-panel `DispatchBoard`
  (order kanban + Loading bay); `PalKanban` + groupBy swimlanes deleted.
- Commits `9cbdb78`, `c650e72`.

## 2026-07-24 — Security hardening + palletization form polish

- ZCQL injection sweep, read-authz on list routes, httpOnly session cookie (`e3b8946`).
- Palletization form: vehicle picker, PAL links, date rename; instructional modal
  subtitles dropped app-wide (`73113ec`). Vehicle master: auto-hyphen registration
  formatting + Save button (`b8bc2c0`).

## 2026-07-23 — Palletization: per-item stages, produced gate, detail tabs

- **Per-item kanban movement** — palletising is now tracked **per line**, not per
  plan. New `PalletizationPlanLine.status` (`Planning` → `ReadyToLoad`); dragging
  one item card between **In Palletization** and **Ready for Loading** moves only
  that item (`setPalLineStatus` → new server route `POST /pal-line-status/:rowid`).
  Loading & Dispatch stay **per vehicle**: once every line of a plan is Ready, a
  **Load vehicle** button on the Ready column assembles the whole plan onto a
  vehicle and it advances as one card through **In Loading → Dispatched**.
- **"Palletized" stage removed** — plan lifecycle simplified to `Planning →
  Loading → Completed`; the board is now 4 columns. `PAL_TRANSITIONS` and
  `STATUS_CHIP` updated on both client and `data-ops`. **Requires a migration**
  (add `PalletizationPlanLine.status`; backfill lines of already-loaded/dispatched
  plans to `ReadyToLoad`; remap plan `Palletized`/`ReadyToLoad` → `Planning`) and
  a `functions/data-ops` redeploy.
- **Palletization detail tabs** — `PalPlanDetail` splits into **Palletise items /
  Timeline / Activity** tabs (default items).
- **Form: Palletise Boxes** — renamed from "Load Boxes"; rows with **nothing
  produced are disabled** ("⚠ needs production") and box entry is **capped at the
  produced-available qty**. Added the SO-style **stock signal dot**
  (`LineStockChip`) per line and a **dedup hint** ("in PAL-N") when an item is
  already in an open plan.
- **Come-back-later flag** — Sales Orders list + Order detail now show a
  **"Partially palletised — N left"** / "Ready for Palletisation — N" chip; the
  Palletization page shows a banner counting orders with produced boxes still to
  palletise.

## 2026-07-23 — Palletization: item-wise board + unified send flow

- **Item-wise board** — the Palletization Kanban (`PalKanban`) now renders **one
  card per plan line (item)** instead of one per plan. Each line gets a
  display-only sequential **`PAL-NNN`** code (computed in
  `palPlansApi.fetchPalPlans`, mirrors Production's `PROD-NNN`) shown on the card
  and in the plan detail's item rows. Dragging any item card advances its whole
  plan (a plan = one SO's palletised items; per-line stages were not added).
- **Unified send flow** — Sales Order detail **More → Palletization** now opens
  the same `/packing?fromOrder=<so>` screen as *New Palletization* and
  Production's *Send to Palletization* (no longer the old Close Pallet form). The
  inline "Send selected" per-line shortcut still opens the legacy Close Pallet
  form.
- **Select-SO on New Palletization** — `PalPlanForm` in New mode adds a **Sales
  Order** picker (orders with produced-but-unpalletised stock); choosing one
  scopes the item table to that SO and pre-fills Load Boxes with available.
  Always SO-associated — no independent palletization.
- **Vehicle moved to the Loading step** — entering **In Loading** no longer
  prompts for a vehicle (the `VehicleLoadModal` gate is gone). A plan In Loading
  now gets an **Assign Vehicle** action (truck button on the board card + a
  button on the detail); the vehicle is **required before Dispatch** (Mark
  Dispatched is disabled / server 400 until one is set). New server route
  `POST /pal-vehicle/:rowid` + `setPalVehicle`; `/pal-status` swaps the
  "vehicle required to enter Loading" guard for "vehicle required to Complete".
  The advisory `VehicleFillBar` planning stays in the form.
- **SO send fully unified** — the SO detail's inline **Send selected** (per-line
  checkboxes) is replaced by a single **Send to Palletization** button →
  `/packing?fromOrder=`; the old close-pallet form, `PalletPackForm`, and the
  item-selection machinery are removed from `OrderDetail`.
- **Partial-friendly palletization form** — `PalPlanForm` Load Boxes now start
  **blank** (both New and Send-to-Palletise), so a subset — even one item — can be
  palletised and the rest done later; a per-order **Fill available** button fills
  them. The advisory **`VehicleFillBar` was removed** from the form (no vehicle at
  palletization; it's assigned at the Loading step).

## 2026-07-11 — Quotation redesign (Books parity)

- **Quotes list** — page heading removed, New Quote moved to the fbar (masters
  layout); row checkboxes with a bulk status-change + delete bar (DesignMaster
  pattern).
- **Quote detail** — tabs Details / Orders / Activity; a Details | PDF
  segmented toggle renders the real pdfmake document inline; Convert to Master
  Order moved into the More menu; shared `ActivityLog` replaces the bespoke
  table.
- **quotesApi** — collects ALL SalesOrders per quote (`sos[]`) instead of a
  last-write-wins single SO; feeds the Orders tab.
- **PDF fix** — pdfmake 0.3.x font VFS registration (Download PDF failed with
  "Roboto-Medium.ttf not found"); new `pdfDataUrl()` for previews.

## 2026-07-10/11 — Customer master redesign (Books parity)

- **Form** — Books-style field order (Company/Display Name above Primary
  Contact), contact-person rows with validation (started row requires first
  name, valid email, phone; save blocked otherwise), address Country/Region as
  a typable Combobox with the full country list, phones digits-only capped at
  10\. New `Customer.contact_persons` JSON column (see DATASTORE-SCHEMA.md).
- **Detail** — editable primary details, contacts & addresses; Contact Persons
  tab; More-menu actions; status locked at create; quote deep-link; Associated
  Orders grouped by PO and kept beside Primary Details on normal widths.
- **Fix** — radio/checkbox exempted from the shared input skin.

## 2026-07-10 — Brand palette + uniform form/grid pass

- Brand palette from boffogranito.com: orange accent, warm neutrals, dark
  sidebar; brand logo + dark login theme.
- Uniform form & grid design pass across Size/Pallet masters and all forms.

## 2026-07-09 — Size & Pallet masters: own pages + detail views

- **Size Master** — own page with packing data (`tile_type`, `thickness_mm`,
  `pcs_per_packing`, `box_weight_kg`, remark) and computed `sqm_per_box` /
  `sqft_per_box` on save; Size is now the single source of truth for per-box
  packing (new columns in DATASTORE-SCHEMA.md).
- **Detail pages** — Size and Pallet get detail pages; Associated Pallets on
  Size detail, Associated Orders (order number + boxes) on Pallet detail;
  More > Create Pallet (from Size) and More > Palletize Order (from Pallet).
- **Related lists** — rows link to the records they name.
- **Activity log + confirm dialog** — readable details, unified date format;
  destructive confirms use explicit wording; Puvi-only fonts.
- The 2026-07-08 deferred item is closed: `.gsearch` magnifier adopted on the
  remaining 8 grids.

## 2026-07-08 — Item master + grid UI batch

Design/UI changes apply across every grid via shared surfaces (global CSS,
the shared `AdvancedFilter` and `ActivityLog` components).

- **Bold grid headers** — `.tbl th` font-weight 500 → 700 (all grids).
- **Un-clipped advanced-filter popup** — the magnifier "Search" modal no
  longer uses `.card` (`overflow: clip`); a new `.filter-modal` panel with
  `overflow: visible` lets the multiselect dropdowns and panel corners render
  fully. Fixes every grid's advanced filter.
- **Items grid** — removed the inline "All sizes" / "All statuses" selects;
  Size and Status remain filterable via the advanced (magnifier) filter. The
  quick-search box is now a single wide input with a leading magnifier icon
  (new `.gsearch` wrapper), matched on the Orders grid.
- **Activity log (all logs)** — timestamps render in the viewer's local time
  via new `fmtLocalDateTime`; the **Status** column was removed.
- **Preserve uploaded image filename** — `data-ops` `/upload/design-image`
  keeps the original filename (spaces/parens/unicode); strips only path
  separators and control chars. **Requires a `functions/data-ops` redeploy.**
- **Keep selection after edit** — saving an item edit now lands on that item's
  detail (`/design/:id`) instead of the grid list.
- **No refresh on the selected item** — status toggle and image save/delete on
  the item detail patch only the affected design in state + cache (new
  `ListCache.patch` / `patchDesignCache`) instead of `invalidate()` + full
  `listDesigns()` refetch; the list and scroll position stay put.

Notes: breadcrumbs were already removed (2026-07-06); no change needed. New
per-grid Filter options and adopting `.gsearch` on the remaining grids
(Parties, Pallets, Containers, Invoices, Quotes, Reports, SalesPersons, Users,
PurchaseOrders) are deferred.
