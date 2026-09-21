# Changes

> Newest first. For the system as it currently stands, see [`SYSTEM.md`](SYSTEM.md);
> for what was requested and whether it shipped, see [`CHANGE-REQUESTS.md`](CHANGE-REQUESTS.md).

## 2026-09-19 — New Loading is two steps; vehicle sits with the sheet (CR-225)

- The "Vehicle & loading" step is gone. After **Select items** comes one step, **Seals, sheet & vehicle**:
  the loading sheet first — type truck, container, seals and LR against the designs and boxes — and
  below it the driver, mobile, container size, transporter, destination and supervisor for this container.
- Same day: that lower details card is hidden for now — the step shows the sheet and the Checks card;
  driver, transporter etc. are still editable from the loading's Edit.
- LIVE 2026-09-19 (client deployed); browser drive and commit pending.

## 2026-09-19 — New Palletization: customer on top, in-progress chip (CR-224)

- `/packing/new` no longer has the left customer rail: **Customer** is a required pick list at the
  top of the Plan section, and that customer's orders and designs list below it.
- The "⚠ This order already has an open palletization (PAL/…)" banner is gone. A row whose item is
  already on an open plan shows an amber **Palletization in progress** chip — no PAL number.
- LIVE 2026-09-19 (client deployed); browser drive and commit pending.

## 2026-09-19 — New Palletization starts from the customer (CR-223)

**LIVE 2026-09-19 (functions + client).**

- **New Palletization Plan** opens with a customer list on the left. Search the customer, pick
  them, and every order of theirs with stock to palletize shows on the right.
- Each design shows Order Qty, Produced, Available and the **batches** that production or stock
  allocation has given that order line. Type the boxes per design and choose the pallet.
- **One Save = one plan for that customer**, across as many of their orders as you like.
- **Batches are assigned automatically, oldest first**, when the plan is saved — a hand-made plan
  no longer loses its batch numbers.
- Send to Palletization from a Sales Order, Edit and Clone look the same as before.

---

## 2026-09-19 — Loading Sheet columns (CR-208)

**NOT deployed yet (client-only; LIVE column `PalletizationPlanLine.pallet_type` created).**

- **Design comes first** on each line: Design, Size, Finish, Batch, Box Brand, Pallet No., Boxes, Pallet type.
- **Pallet 2 is removed.** **Pallet type is typed by the user** — blank stays blank.
- **Box Brand fills itself** from the production record, else the Sales Order (which takes it from
  the quote), else the customer's default. It is no longer a dropdown on the sheet.

---

## 2026-09-19 — Security review fixes (CR-205…207)

**NOT deployed yet (server-only, `functions/data-ops`).**

- **Image uploads are raster-only.** The server checks the file's actual bytes — JPG, PNG, GIF,
  WebP, BMP or AVIF. An SVG is refused. Images already stored keep working; the public image
  link can no longer run script if someone opens it as a page.
- **Permissions no longer depend on how a URL is capitalised.** A role without the right for a
  business action (dispatch, create a Sales Order, …) is refused however the path is spelled.
- **A Quote or Sales Order cannot be created already approved.** Both are created only through
  their own forms' routes, where the starting status follows the approver rule; the generic
  create also refuses the status columns it already refused on edit.

---

## 2026-09-18 — New Loading is a three-step page (CR-203)

**DEPLOYED LIVE 2026-09-18 (client-only); browser drive and commit pending.**

- **One page, three steps**: New Loading (toolbar, Sales Order detail, and Add Pallets on a
  loading) opens a full page instead of a modal — **1 Select items** (the same customer rail and
  pick list, plus a container-fill meter) → **2 Vehicle & loading** (vehicle, driver, container,
  seals, transporter… beside what is in the container) → **3 Seals & sheet** (the Loading Sheet
  for all of that customer's open containers, with a checks list). Each step saves with Save.
- **Duplicate warning**: a container number or seal already recorded on another loading shows an
  amber warning on step 3. It never blocks the save.
- Dispatch is unchanged and stays on the loading's detail page.

## 2026-09-18 — New Loading: customer rail, one pick list, batch pick (CR-201…202)

**DEPLOYED LIVE 2026-09-18 (client-only); browser drive and commit pending.**

- **Pick the customer on the left, load on the right** (CR-201): every order of the customer with
  its designs — Design · Box Brand · Batch · Ready · Load — in one list. No Customer / Sales Order /
  Container Size fields any more; container and vehicle details go in Assign Vehicle after Save.
  Batches that are only partly palletised show greyed with the reason instead of disappearing.
- **Choose the batches; the plan only helps** (CR-202): type a design quantity and it spreads
  oldest-batch-first, then adjust any batch. Several designs and orders share the one container.
  **Fill from plan** prefills an order's next planned container — designs outside the plan still load.

## 2026-09-18 — Production first, then SO allocation; container override; customer-wide loading (CR-194…200)

**DEPLOYED LIVE 2026-09-18 (column → function → client), commit pending; browser drive pending.**

- **Production goes to stock** (CR-197/198): Record New Production is Item + Qty only; confirming
  an SO no longer creates production jobs; the SO lost "Record New Production". Record Output
  takes a **Box Brand** per item (prefilled from the orders waiting on it) and the Excel import
  reads an optional Box Brand column.
- **Allocate Stock** (CR-199): on the SO, pick free boxes per batch for each line. The allocation
  is a claim (`alloc` row), not supply — on-hand is unchanged, **free** stock drops — and it feeds
  Ready for Palletization exactly as a production record used to. De-allocate from the SO
  Production tab until the boxes are palletised. Send-to-Loading only ships allocated boxes.
- **Record New Production redesigned, same day** (CR-197 follow-up, client-only, LIVE): the form
  IS the recording — lines first (**Item · Batch No. · Box Brand · Qty**), then Note / Recorded by /
  Production date below. Save creates the job and records each line's output with its batch +
  brand in one go (`productionApi.recordNewProduction`; the job auto-steps to Completed). Batch
  No. is mandatory for batch-tracked items, auto-numbered otherwise; Box Brand prefills from the
  orders waiting on the item. Record Output (`+`) still exists for legacy / partially recorded jobs.
- **What to produce** (CR-200): every open order line shows Allocated / Stock ready / Partial
  stock / In production / Need production; `/prod` has a **To Produce** view with the shortfall
  and the carton brand wanted per item, which prefills a new production job.
- **Overrides** (CR-195/196): a tick lets a container load — and the planner pack — beyond 100%.
- **Loading by customer** (CR-194): New Loading starts from the customer and mixes all their
  orders and designs into one container.
- `scripts/seed-flow.mjs` now produces to stock and allocates (the old step needed SO-confirm jobs).

## 2026-09-15 — Panel images at every sales touchpoint, several panels per sale (CR-192…193)

**DEPLOYED LIVE 2026-09-15 (client-only deploy), commit pending.**

- **Several panels in one sale** (CR-193): the picker tiles multi-select; the form lists each
  picked panel with its thumb, a qty and a remove button; the stock check sums need across all
  of them. Save writes one Panel Order row per panel with the shared customer, date and sales
  person, so the board and the stock machine are unchanged and each panel dispatches on its own.

- **Panel picker is an e-commerce tile grid**: each showcase panel shows its front-view image,
  code, sizes and design names; the picked tile wears the accent ring. Search is unchanged.
- **Order form shows the picked panel**: a thumb beside the picker and a **Panel** section with
  every image; click any image for the lightbox with ‹ › across all of them.
- **Thumbs everywhere else a rep meets a panel**: Panel Orders board cards and Sheet, a new
  Image column on `/panels`, and both Showcase Panels tables (Item + Customer detail). Click
  zooms, never navigates; no image = dashed placeholder.
- Mechanism: the lightbox left `ImageManager` for a shared `ImageLightbox` / `ImageThumb`
  (`features/common`). No server change — images were already in the panel list payload.

## 2026-09-15 — Weight on the Item form, Item wins in planning, form regroup (CR-190…191)

**DEPLOYED LIVE 2026-09-15 (client-only deploy), commit pending.**

- **Box Weight (kg) on the Item** (CR-190): typable in Dimensions & Coverage, prefilled from the
  picked Size (placeholder shows the Size value); a typed value is the item's own and survives
  Size edits (CR-133 guard). Two ƒx fields beside it: **Weight / piece** = box ÷ pcs/box and
  **Weight / m²** = box ÷ coverage m². Item detail Overview gets a **Box weight** row.
- **Planning precedence flipped**: Weight Fitting in Plan Containerisation reads the Item's box
  weight first, the Pallet format's as fallback — matching the server loading-capacity check
  (which always used the Item weight). Before, the planner preferred the Pallet format's copy.
- **Form regroup** (CR-191): Identity → Classification → Dimensions & Coverage (Width, Length,
  Rate / ft², Rate / m², weight group) → **Misc** (Random Faces, Status, Batch-tracked item,
  Opening Stock on edit). Numeric inputs on this form now use the house `NumberInput`.

## 2026-09-14 (night) — Single-image upload tile on the Box Brand form (CR-189)

**Built 2026-09-14, deploy pending.** Client-only.

- The Box Brand master's **Image** field is a 120 px tile instead of a raw file input: click or
  drop to upload, cover preview once set, **Replace** / **Remove** beside it. `ImageUploader`
  is single-image only now; `ImageManager` (Item/Panel detail) is unchanged.

## 2026-09-14 (night) — Container merging in Plan Containerisation (CR-188)

**DEPLOYED LIVE 2026-09-14 (client-only deploy), commit pending.**

- **⇄ Move on every item inside a container** (SO, Quote and Loading-tab planners): pick the
  target container ("C3 · can take 240 boxes") and the quantity (defaults to the most that
  fits). Drag-a-card and the Adjust panel's "Move here" suggestions use the same action.
- **Merges persist.** A move splits the row and tags the moved boxes with the target
  container's `group`; grouped rows pack into one container, and a saved mixed container
  reseeds as grouped rows — so Save + reopen keeps the merge instead of re-packing item-wise
  (the old session-only `moves` layer is gone). Plan JSON unchanged.

## 2026-09-14 (night) — Loading Sheet: design name on prints, manual Pallet No., free-text vehicle, sheet look (CR-183…186)

**DEPLOYED LIVE 2026-09-14 (client-only deploy; LIVE column `PalletizationPlanLine.pallet_no` created), commit pending.**

- **Design name only on prints** (CR-183): Dispatch Entry, Dispatch Copy PDF and pallet QR
  label print `design_name` alone — no composite unique name, no PAL code, no doubled size.
  The Loading Sheet's Design cell follows (it has Size/Finish columns).
- **Manual Pallet No.** (CR-184): typable on the Loading Sheet; typed wins, blank = auto
  range (grey); same value on the two dispatch prints.
- **Vehicle as free text** (CR-185): Vehicle Number / Driver / Mobile are plain inputs in
  Assign Vehicle / Edit Load Details, the new-container form and the sheet's Truck No.;
  `resolveVehicle()` keeps the Vehicle master in sync without the user seeing it.
- **Sheet look** (CR-186): standard rounded house grid (the black-bordered `ruled` variant
  is deleted); "Pallet 1" → "Pallet type".

## 2026-09-14 (evening) — SO tab trims, totals bar, rail order, batch on SO Palletization, Box Brand image (CR-177…182)

**DEPLOYED LIVE 2026-09-14 (LIVE column + client), committed c1d6400.**

- **SO Production tab** (CR-177): Remaining column removed.
- **Totals bar** (CR-178): on /packing and /palletizing the bar under the grid reads
  *Total · N pallets · N boxes* when nothing is ticked (both views, every viewer); the
  "Tick items…" hint and the Sheet's tfoot Total row are gone on these pages.
  - **CR-187 (2026-09-14 night, deploy pending):** the Sheet's totals moved back into a
    column-aligned tfoot (pallets in the first column, Boxes/Ordered/Completed/Remaining
    under their headers); the bar's idle text now shows in Kanban only.
- **Rails** (CR-179): `/packing/:id` and `/loading/:id` sibling rows read *customer · status*
  above and the PAL/LOAD code below.
- **SO Palletization tab** (CR-180): Batch column (mono chip) after Design.
- **Box Brand image** (CR-181): `Brand.logo` (File Store id) created on LIVE; Image upload on the
  Box Brand master; thumbnails in the Box Brand Combobox popup + preview beside the field on the
  Quote, SO and Customer forms (`useBoxBrands()`); Combobox options accept `icon`.
- **Held** (CR-182): Completed / Remaining boxes on the SO Palletization tab — user paused it.

## 2026-09-14 — Two Palletization pages, column pickers, Box Brand, SO tabs, Dispatch always reachable, Edit + More everywhere (CR-160…168)

**DEPLOYED LIVE 2026-09-14 (data-ops + client), committed 3e672e8; manual drive pending.**

- **Palletization is two sidebar pages** (CR-160): `/packing` Ready for Palletization (queue) and
  `/palletizing` In Palletization (+ Ready for Loading, where the Load handoff sits). Same board,
  scoped by a `stages` prop.
- **Column pickers** (CR-161): the /packing Sheet is ColumnDef-driven; on /packing, /loading and
  /prod the ID column (PAL / Loading / Production ID) is last and hideable, and Customer → Design
  lead the default order. Storage keys bumped to `.v2`.
- **Box Brand on Quote + SO** (CR-162): FK `box_brand` → Brand on both tables (LIVE columns
  created), Combobox from the Brand master, prefilled from the customer, carried on convert;
  the free-text Box Branding input is retired. Customer Sheet brand fallback = line → SO → customer.
- **Plan detail** (CR-163): Begin Dispatch / Mark Dispatched / Assign Vehicle removed.
- **SO detail** (CR-164/165): Items table drops In Production + Available; Palletization tab =
  Design · Date · Pallets (fractional, 1 dp) · Boxes · Status + Total, PAL column gone.
- **Dispatch always listed** (CR-166): greyed with the reason until a vehicle is assigned and items
  are loaded; blank seals/transporter/etc. warn in the confirm and in a standing note on `/loading/:id`.
- **Edit + More on every detail page** (CR-167) and **"+" menu on every grid row** (CR-168).

## 2026-09-10 — CR-143 undone: New Loading is a modal form (CR-144)

**DEPLOYED LIVE 2026-09-10 (client only), uncommitted.** The same-day queue board + pallet-first workspace
(CR-143 below) is deleted — `LoadingQueueBoard`, `StartLoadingModal`, `LoadingPlan`,
`virtualPallets`, the `/loading/:id/plan` route and `LoadingDetailsModal` are gone
(28ft/30ft container sizes from CR-142 stay). "New Loading" opens **`NewLoadingModal`**:
SO picker (optional Customer filter, options from Ready-for-Loading stock) + container
size; the SO's containerisation plan propagates (containers with `planProgress` chips,
first unsent container prefilled against ready stock FIFO, all editable), or a flat
checkbox+qty list of palletised lines when no plan exists. One submit = one loading:
`/load-box` minted with a single-slice `load_plan`, `allocateFifo` + `/pal-lines-box`
allocate the lines, land on `/loading/:id`. LoadingDetail's "Plan Loading" → **Add
Pallets** (same modal scoped to the box); `/packing`'s Load confirm lands on the loading
detail; `/loading` opens on Sheet (a persisted "board" view falls back to kanban).

## 2026-09-10 — Loading redesign: queue board + pallet-first workspace, 28ft/30ft (CR-142…143)

**DEPLOYED LIVE 2026-09-10, uncommitted.** The Loading pages follow the Claude Design "Container
Loading" spec (layout + features; house slate/indigo skin, fonts unchanged).

- **Container sizes are 28ft / 30ft** (CR-142): `CONTAINER_TYPES` shrunk from 20ft/40ft/40HQ,
  default 28ft everywhere a default exists; legacy stored sizes still display as-is. The
  **Send as Single/Multiple toggle is gone** — packing is automatic (fits in one container →
  one; overflow chunks into siblings).
- **`/loading` queue board** (CR-143): new default view — active-loading cards (one per Open
  LoadBox: status, customers, container, loaded/planned boxes, fill) + the Loading queue
  (ready work grouped by SO, derived pallet counts, Start loading →). "New Loading" opens
  `StartLoadingModal` (Sales order / Customer / Container / Free pick tabs). Kanban / Sheet /
  Loadings / Customer Sheet unchanged.
- **Pallet-first loading workspace** (CR-143): `/loading/:id/plan` rebuilt — 3 columns:
  Container gauges + Order requirement · Ready pallets (virtual pallet cards from
  `virtualPallets.ts`: full/partial per batch, weight incl. tare; scan input matching pallet
  code / batch / LOAD number; design filters) · Loading plan (floor map + ordered list).
  **Suggest fill** plans full pallets from the requirement and proposes a **Compose mixed
  pallet** for the shortfall (plan-level composition across batches). **Save plan** = advisory
  `load_plan` JSON only (plan-only loadings intact; lines gain `plt`/`mix` keys); **Send for
  loading** also allocates lines via `/pal-lines-box` (partial takes split server-side). The
  old items-table planner (Dispatch Qty grid, SO-plan seeding via `loadingPlanSeed.ts`) is
  retired — `loadingPlanSeed.ts` deleted.

## 2026-09-10 — Loading-first sheet + Customer-only grouping + dispatch reset (CR-141)

**DEPLOYED LIVE 2026-09-10** (this deploy also shipped CR-140's client + data-ops). The
`/loading` Sheet's pinned first column now identifies the **Loading** (LOAD/FY/NNN via
`boxLabel`, vehicle/"Container N" fallback) instead of the display-only PAL-NNN pallet
sequence; the duplicate Container column is gone and the advanced-filter facet is relabelled
"Loading". **Group by offers Customer only** for now — Order/Container/Batch/Item dims removed
from board and sheet; stale persisted selections self-filter on read. Alongside, the LIVE
loading/dispatch test data was reset for a clean Loading retest: every LoadBox soft-deleted,
boxed plan lines un-boxed back to Ready for Loading, plans reverted (ReadyToLoad, or Planning
when only Planning lines remain; dispatch dates cleared), legacy loaded/dispatched
PalletisedBatch rows back to closed, OrderItem loaded/dispatched counters zeroed with stage →
packing, and dispatch history purged (OrderItemEvents, LoadBox/plan/OrderItem
StatusTransitions, OperationLog `dispatched` fan-outs). New loadings continue the LOAD number
sequence.

## 2026-09-10 — Customer Sheet on /loading + Box Brand master (CR-140)

**DEPLOYED LIVE 2026-09-10 (with CR-141).** Fourth `/loading` view **Customer Sheet**: pick one customer
and see every loaded line across all their SOs as the export-style loading sheet — one section
per container (merged Sr / L.R. / Truck / Container / E-seal / Line-seal cells), P.O. per SO
run, Design/Size/Finish/Batch per line, auto-computed pallet ranges ("1 TO 16", running per
container from `ceil(boxes / boxesPerPallet)`), Pallet 1/2 from the Pallet master's A/B
arrangements, Total footer. **Edit** stages everything into drafts and saves sequentially:
L.R./truck/container/seals → `/load-box-update`, P.O. → `SalesOrder.po_number`, per-line
**Box Brand** override → new `PalletizationPlanLine.box_brand` (grey = inherited from the new
`Customer.box_brand` default, set in the customer form). New **BoxBrand** lookup master
(Settings ▸ Product Masters ▸ Box Brand); table + both FK columns already live
(`BoxBrand` 69851000000265385). Server change: `BoxBrand` added to the generic-CRUD ALLOWED
set — **requires a `functions/data-ops` redeploy**. Pure sheet logic in
`customerSheetEdit.ts` with an `npx tsx` self-check.

## 2026-09-09 — SO-first New Loading (CR-126)

**DEPLOYED LIVE 2026-09-09 (client only), uncommitted.** "New Loading" on `/loading` now asks for just
the **Sales Order** and opens the load planner at `/loading/new/plan?so=…` — no record yet.
The planner seeds from the SO's container plan remainder when one exists (empty planner with
Add-item otherwise, same as before); the first **Save mints the LoadBox(es)** — primary created
plain, group stamped once the ROWID exists, siblings pointing at it — and pops a **skippable
container/vehicle details modal** (`LoadingDetailsModal`, reusing the ContainerPicker form;
"Later" defers to Confirm Load). Abandoning the planner leaves nothing behind. The old
container-details-first branch of `useLoadFlow.confirmLoad` is deleted; pallet-mode Load from
`/packing` is unchanged. No server change.

## 2026-09-08 — Batch series setting (CR-125)

**DEPLOYED LIVE 2026-09-08, uncommitted.** Settings → Preferences: admin sets the batch series
**prefix, separator and start number** (defaults `B`, `/`, `1`) with a live preview; the server
builds the auto-minted format `<prefix><sep>YYYY-MM<sep>NNN` from AppSetting keys
(`batch_series_*`, read by `nextBatchNumber`). Per-item monthly restart unchanged. Changing
prefix/separator starts a fresh series (old batches no longer match the scan's LIKE).

## 2026-09-04 — Multi-container loading plan, LOAD series, per-item-month batches (CR-120…124)

**DEPLOYED LIVE 2026-09-08** (`LoadBox.load_number` column → functions → client, in that order), **uncommitted**.

- **Loading plan goes multi-container + SO-plan-seeded** (CR-120): an empty `/loading/:id/plan`
  seeds from the box's own lines + the SO container plan's remainder (`loadingPlanSeed.ts` + test);
  "Send as Single / Multiple containers" auto-packs item-wise with the shared `containerPack.ts`
  math (extracted from the SO planner + test) and Save creates/updates one **sibling LoadBox per
  extra container**, linked via `load_plan.group {id,no,of}` (JSON key, no new column). Items
  table gains Pcs/Box, Ordered, Balance-after; container cards show per-container pallet cells,
  status and vehicle. Reverses CR-119's "one loading = one container" note; stock still moves
  only via the load modal flows.
- **Multi-select Load lands on the plan screen** (CR-121): `useLoadFlow.confirmLoad` navigates
  to `/loading/:id/plan` after loading lines.
- **LOAD series** (CR-122): `LoadBox.load_number` = `LOAD/FY/NNN`, minted in `/load-box`
  (`nextLoadNumber`, prefix-scoped scan); `boxLabel` and server dispatch labels prefer it; old
  boxes keep the fallback label (no backfill). `/packing` item codes stay PAL-NNN.
- **Batch format** (CR-123): auto-minted batches are now `B/YYYY-MM/NNN`, series **per item per
  calendar month** — `nextBatchNumber(catalyst, designId)` with a design+month-scoped scan (also
  fixes the 300-row ZCQL truncation the old global scan silently hit). Typed batches unchanged.
- **Container Planning tab embeds the editable SO planner** (CR-124): `PlanSoContainerisation`
  takes `{soId, embedded}`; multi-SO loadings get an SO chip selector. Save still writes
  `SalesOrder.container_plan`; the `/orders/:id/containerise` route stays.
- Loadings grid + detail derive a **Planned** display state (Open + plan, nothing loaded) and
  show `C n/of` sibling chips / a sibling strip.

## 2026-09-04 — Loading & Dispatch revamp + SO planner fix (CR-115…119)

**DEPLOYED LIVE 2026-09-04** (column → functions → client, in that order), **uncommitted**.
Plan Loading screen re-laid-out same day from the Claude Design "Loading and Dispatch" spec
(info cards + SO chips, mono items table, container pallet-cell graphic), palette mapped to
app theme tokens.

- **BUG fixed:** SO Plan Containerisation's item combobox showed empty — lines were seeded
  with plain `designName` while options are keyed `uniqueName || name`. One-word fix
  (`o.design || o.designName`); also stops the SO planner opening dirty. Quote planner now
  reopens on the saved pallet; "Ready Pallets" header corrected to "Pallets".
- **Two-step palletise** on `/packing` (reverses 2026-08-27's one-hop): Palletise → *In
  Palletization* (pallet confirmed in the modal), then **Mark Palletised** → *Ready for
  Loading*. Middle column/status label renamed "In Palletization".
- **Load lives on `/packing`** now: Ready-for-Loading cards/rows have the Load button and
  load-together checkboxes (shared `useLoadFlow` hook, extracted from LoadingBay). `/loading`
  drops its "Ready for Loading" panel — boxed lines only: In Loading → Ready for Dispatch →
  Dispatched (+ the Loadings grid). Sidebar renamed **"Loading and Dispatch"**.
- **Per-loading plan** (`/loading/:id/plan`, "Plan Loading" on the detail): lines = item +
  batch + order across ANY SOs/customers; "Ready" column = palletised un-boxed stock;
  fulfillment bar = planned % and palletised-covered % of container capacity (Box/Weight
  fitting); per-line "planned earlier" hint from the SO container plan. Stored as
  `LoadBox.load_plan` JSON (text 10000; whitelisted in `/load-box` + `/load-box-update`).
- Deploy order for the plan feature: column (done) → `catalyst deploy` functions → client.
- Verified: tsc, vite build, `productionSheetEdit` + `planProgress` self-checks.

## 2026-09-04 — Design system applied APP-WIDE (slate/indigo)

Working tree — **built, not deployed.** The Panel Craft trial (below, same day) was accepted;
the theme now applies to the whole app.

- **`styles/panelcraft.css` → `styles/theme.css`** — tokens moved to `:root`, all component
  rules de-scoped (the `.nd` wrapper is gone from CSS and the four page roots). The file
  still loads after `styles.css`; equal-specificity ties resolve to it, which is how it
  re-skins the old rules without editing them. Extra `.fbar`/`.page-head`/`.lp-search`
  control overrides were added at the specificity the old 26px skins held.
- **Legacy aliases now on `:root`** — `--panel`, `--fg`, `--muted`, `--c-*`, `--t-*`… point
  at the new palette, so all ~2300 lines of styles.css re-theme untouched. Retire an alias
  only by migrating every rule that reads it.
- **`App.tsx` boot accent override deleted** (`TWEAK_DEFAULTS`/`applyAccent`) — it wrote the
  old orange onto `<html>` at runtime, which would have beaten the `:root` tokens.
- **Deliberately unchanged:** the logo and dark sidebar (`--sidebar-bg`/`--sb-*` not
  remapped), the login screen (`.boffo-auth` scoped), print sheets (own palette), and
  per-grid *behaviour* on non-Panel-Craft pages (row-click, text toolbars) — the new
  conventions (hover row-actions, icon toolbars, `Chip`) retrofit page-by-page as follow-ups.
- Verified: tsc + build clean; headless-Chromium sweep over /quotes, /orders, /prod,
  /loading, /settings, /cut-stock — all themed, no page errors.

## 2026-09-04 — Panel Craft design-system TRIAL (light slate/indigo)

**Superseded same day** — trial accepted and applied app-wide (entry above). Kept for the
record of what the trial covered.

- **`styles/panelcraft.css`** (new, imported after `styles.css`) — the full token set
  (slate surfaces, `--blue` primary, `--accent` indigo, radius/shadow tokens, Inter /
  Space Grotesk / JetBrains Mono) scoped under a **`.nd`** wrapper class, plus a trial-only
  legacy-alias block that re-points the old token names (`--panel`, `--fg`, `--muted`,
  `--c-*`, `--t-*`…) so global classes inside `.nd` re-theme with no TSX changes. Same
  scoping pattern as `login.css`/`.boffo-auth`. Fonts self-hosted in `public/fonts/`
  (7 woff2 files), matching the Puvi precedent.
- **`.nd` applied to the four Panel Craft roots only**: `/cut-stock`, `/panels`,
  `/panels/:id`, `/panel-orders` (+ their in-tree modals). `PanelsPanel` embeds on
  Item/Customer detail keep the old look. Toast/Confirm hosts sit outside the scope (known
  trial limitation).
- **New grid conventions (trial)** — no row-click; hover pencil/trash `.row-actions`
  (always visible on touch), record code is an indigo link to the detail, toolbar is a
  slate bar joined to the grid card with 30×30 icon buttons (`pcBits.tsx` `IconBtn`:
  Edit/Clone enabled at exactly 1 selected, Delete ≥1, disabled = dimmed), per-column
  `FilterSelect` fed by distinct data values, 44px footer.
- **`ui/Chip.tsx`** (new) — the one status-chip component: 9-tone map, tinted pill
  (tone + `18` alpha), CamelCase→spaced labels, renders nothing without a status.
  Panel-order tones: Received amber, InCutting blue, Ready teal, Dispatched green
  (`STAGE_COLOR` dots now match).
- **Page upgrades riding along**: Panels grid gained header sorting (was unsortable) and
  toolbar edit/clone/delete without leaving the grid; Panel Orders sheet became a full
  record grid (sorting, pagination + `GridFooter`, search, status filter — both views
  share the filters); Panel Orders/Panels/CutStock chips + statuses render via `Chip`.
- **`ui/Icon.tsx`**: added `trash`, `copy`, `refresh` (additive).
- Verified via headless-Chromium drive with mocked `data-ops` responses: all 4 pages +
  modal render to spec; `.nd` appears only on the 4 page roots; tsc + vite build clean.

## 2026-09-02 — Sheet-first: every board opens on the grid, default is a setting

Working tree — **built, not deployed.** CR-113, CR-114.

- **Sheet/Grid is the default view** on `/packing`, `/loading`, `/panel-orders` (all three
  previously opened on Kanban) and stays the default on `/prod`. The per-page toggle is
  unchanged and still wins for the rest of the browser session.
- **`useViewState(key, sheet, kanban)`** (`lib/usePersistedState.ts`) — one seam every board
  goes through. Thin wrapper over `usePersistedState`: same sessionStorage behaviour, but the
  initial value comes from the org preference instead of a hard-coded literal.
- **Settings → Preferences → Default view** (Sheet | Kanban) writes `AppSetting.default_view`;
  a missing row means Sheet. `settingsApi.ts` was generalised — the per-key bodies now sit on
  shared `rowFor` / `putSetting` helpers, and the duplicate-batch functions are unchanged
  wrappers over them.
- The setting is fetched asynchronously but a view is seeded synchronously at mount, so
  `settingsApi` mirrors the resolved value to `localStorage["pref.defaultView"]` and
  `cachedDefaultView()` falls back to it. No first-paint flip on a cold tab. `App.tsx` refreshes
  the preference on boot alongside the session check.
- **`/prod` view state moved from `localStorage` to sessionStorage** (key `productionView` →
  `production.view`) so it matches the other three boards and the org default actually applies
  on a new session. Anyone who had Production pinned to Board loses that pinning — one click to
  restore. Its status-tab seed (board → All, else Pending) now reads the resolved view.

## 2026-09-02 — Production sheet: edit mode (bulk qty + status)

Working tree — **deployed LIVE 2026-09-02, not yet committed.** CR-111, CR-112.

- **Edit mode on `/prod` sheet view** (`ProductionTable.tsx`). **Edit** makes three columns
  editable across every row — **In Production** (`qty_requested`), **Produced** (boxes made now),
  **Status** — staged in a draft keyed by plan-line id. Nothing reaches the server until **Save**;
  Cancel or leaving the view asks before discarding. Remaining and the group band totals recompute
  live from the draft. Kanban and grid views are untouched.
- The sheet's old `Requested` column **is** the new editable In Production column (same field);
  the `Produced` column hidden on 2026-08-12 is back, now as the inline output input.
- **`productionSheetEdit.ts`** — pure `resolveSheetEdit(entry, draft)` → server ops or an error.
  Mirrors `RecordOutputForm.capFor()` (line remaining ∩ order remaining, reading the drafted plan
  qty) and refuses a qty change once output exists, matching `/production-update`. An invalid cell
  turns red and disables Save. Self-check: `npx tsx client/src/features/stages/productionSheetEdit.test.ts`.
- **Save** runs per row: `/production-update` → `/production-record` → `/production-stage`, stage
  last so an explicit choice outranks the server's auto-step. Sequential and non-atomic (no
  array-accepting production endpoint); failed rows stay in the draft with a per-row toast.
- Inline output sends **no batch number** — the server mints `B/FY/NNN`. Batch-specific entry
  still goes through the `+` dialog, which is hidden while editing.

## 2026-08-29 — Batch stock overhaul: FIFO reducer, 5 new reports, shade retired

Working tree — **deployed LIVE 2026-08-29, not yet committed.**

- **`deriveBatchStock` reducer** (`client/src/features/stages/batchStockDerive.ts`, zero
  imports) — pure supply/consumption netting per (item, batch). Attributed consumption nets
  its own batch first; blank-batch consumption that is *loaded* nets **FIFO** (blank bucket
  first, then real batches oldest-mfg-date first); the unabsorbed remainder becomes `over` on
  the blank bucket and is never reallocated. Palletising alone does not reduce stock.
  Conservation law `Σ current = Σ supply − Σ absorbed loaded` asserted by
  `batchStockDerive.check.ts` (7 scenarios).
- **`unqueuedBatches` shared helper** (`functions/data-ops/index.js:2078`) — FIFO-available
  boxes per production batch. `autoEnqueuePalletization` was refactored onto it (~25 duplicated
  lines removed), and **`/send-to-loading` now uses it too**: instead of one blank-batch plan
  line per item, it splits the requested boxes across the item's unqueued batches FIFO, one
  line per batch. Skipping palletization no longer loses the batch trail.
- **`batchLedger`** (`client/src/features/stages/batchLedger.ts`) — one row per batch ×
  consumer (Palletised / Loaded / Dispatched / On hand), same "counts once ReadyToLoad or in a
  box" rule as `recountOrderItems`. Invariant `Σ rows == produced + opening`.
- **Five new reports** — Batch-wise Stock (`stock-batch`, over-consumed rows flagged ⚠),
  Batch Movement (`batch-movement`, list + pivot by customer/stage), Palletization Status
  (`pal-status`), Loading & Dispatch (`loading-status`), Dispatch Register
  (`dispatch-register`). Production Batches gained a List/Matrix toggle. Registry is now 14
  reports across 5 sections.
- **`PivotTable.tsx`** — generic cross-tab (row/col/grand totals, rows by total desc);
  **`bucket.ts`** — day/week/month bucketing, week keys computed in **UTC** so a viewer west of
  Greenwich does not roll Monday into the previous week. `ReportShell` gained a `bar` slot for
  per-report controls beside the filter button.
- **Shade retired** — `ProductionLog.shade`, `PalletisedBatch.shade`, `PalletisedBatchLine.shade`
  marked `RETIRED 2026-08-29` in the schema: columns kept, nothing reads or writes them. Removed
  from every insert in `data-ops`, from the Excel import template, the Stock Details grid, the
  batch QR PDF, and the `batchStockApi` grouping key (now `designId + batch` only).
- **Legacy pallet entry points retired** — `FinalLoading.tsx`, `DispatchForm.tsx`,
  `LoadContainerForm.tsx`, `PalletPackForm.tsx`, `Palletizations.tsx` carry a `RETIRED` header
  and have no callers; the `/final` route is deleted; `PalletDetail`'s "Palletize Order" action
  is gone (it drove the `/close-pallet` saga — a second record of boxes the live PalPlan/LoadBox
  flow already counts). **`batchStockApi` still reads the legacy `PalletisedBatch` /
  `ContainerLoading` data as historical supply** — the UI is retired, the data is not.

## 2026-08-27 — Panel Craft, palletise straight to Ready, image manager

- **Panel Craft** — new module: `Panel` / `PanelLine` / `PanelOrder` / `CutPieceSize` /
  `CutPieceStock` tables, `/cut-stock` → `/panels` → `/panel-orders` screens, routes
  `/panel-save`, `/panel-delete/:rowid`, `/panel-order-status/:rowid`, `/cut-stock-adjust`.
  **Reversal in the same pass:** the Panel master is **decoupled from stock** — create/edit/
  delete never touch `CutPieceStock`; only PanelOrder `Ready` (+) and `Dispatched` (−) move it.
  `PANEL_ORDER_TRANSITIONS` is forward-only for that reason.
- **Palletise straight to Ready** — `/packing` drops to 3 columns (Dispatch column gone,
  "Mark ready" deleted); Palletise → `ReadyToLoad` in one hop. Pallet details prefill from the
  SO container plan (`containerPlanPrefill.ts`); the Record Output pallet picker is hidden;
  `/loading` relabels its last column "Dispatched" and shows a plan hint.
- **Image manager** — shared `common/ImageManager.tsx`.
- Commit `9656f22`.

## 2026-08-25 — Container-first loading, Dispatch tab, Record Output multi-item

- **Container-first loading** — `LoadContainerModal` replaces the box picker at all three entry
  points; plan progress is consumed automatically, with no per-container id to manage.
  `dispatch_date` is planned first, then actual. (`0b21918`)
- **Dispatch visibility** — `logRelated` fans loading events onto both the sales order's and the
  PalPlan's activity feeds; one shared `DispatchTab` renders on SO, PalPlan and Quote, and the
  same content as a section on Customer. (`0b21918`)
- **Record Output multi-item modal** — one modal, a section per item, Tab moves across items.
  (`0b21918`)
- **Production stage auto-step** — recording output steps the Kanban stage `New → InProduction`
  on the first record and `→ Completed` once records cover `qty_requested`. QC stays manual-only
  and is dropped from the board. (`0b00bdd`)
- **Produced counter shows committed output only.** (`fa40145`)
- **Loading first-class** — `/loading/:id` detail page, New Loading + delete, `/send-to-loading`
  to skip palletization entirely, Shipping Stage chip; grouped DESIGN-band estimates in all
  three quote renderers, lines storing `unique_name`. (`8d9b75c`)

## 2026-08-22 — Dispatch Control Board redesign + Palletization 2nd stage

- **Dispatch Control Board declutter** — full-width 4-column board, one header Kanban/Sheet
  toggle; dock + loading panes paused (own section later); checkbox multi-select opens
  `PalletiseModal`; Mix Batch top-up via `pallet_group` + `POST /pal-topup`.
- **Palletization 2nd stage** — the Palletizing line status becomes its own "Palletization"
  column; the pallet picker is dropped; Record Output gains a 2nd-stage checkbox. The
  queued-filter invariant holds throughout.
- Deployed LIVE 2026-08-22, commit `b600df5`.

## 2026-08-17 — Batch-aware loading + batch QR share

- **One batch per customer** — PalPlan lines are per-batch; a mixed-batch pallet raises a
  "Mixed batches" warning rather than a block.
- **Batch QR slip + public share page** — `batchQrPdf.ts`, `SharedBatch.tsx`, tokenless
  `GET /public/batch/:token`, token minted by `POST /production-record-share/:rowid`.
- **Uniform Record Output lines.**
- Deployed LIVE 2026-08-17, commit `9349e36`.

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
