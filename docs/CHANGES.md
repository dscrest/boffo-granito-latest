# Changes

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
