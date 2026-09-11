# Change Requests — process and register

Every change to BOFFO gets a number here. The register is the answer to *"what was asked, did
it ship, when, and where's the proof"*.

Raw requests as originally written live in [`change-requests/raw/`](change-requests/raw/).
The system as it currently stands is [`SYSTEM.md`](SYSTEM.md); the dated narrative of what
shipped is [`CHANGES.md`](CHANGES.md).

---

## How to file a change request

Six fields. **CHANGE and WHERE are mandatory**; the rest sharpen the result.

```
CHANGE:    <the outcome, one line>
WHERE:     <screen / form / master>
WHY:       <the user goal — this sets how deep to build>
APPLY TO:  <"everywhere this pattern exists" | a list | "only here">
LIKE:      <an existing thing to match>
DONE WHEN: <the acceptance check>
```

`APPLY TO` is the field that matters most. The recurring failure in this project is a change
made in one place and left in its siblings.

## Standing rules — applied to every change without being asked

1. **Consistency sweep.** Grep the pattern across every sibling form, grid and master, and fix
   them together — at the root, not at one caller. `APPLY TO: everywhere` means exhaustively.
2. **Reuse, no one-offs.** Use the existing component, style or util. Never a bespoke duplicate.
3. **A new *rule* goes to memory AND gets retrofitted** in the same pass — to every existing
   screen, not just going forward.
4. **Verify by driving the flow.** A typecheck is not verification.

Any rule can be overridden per-request in one line (`APPLY TO: only here`).

## Statuses

| Status | Means |
|---|---|
| **Open** | Requested, not built. |
| **In progress** | Being built now. |
| **Done** | Built and verified. **Must cite a commit or `file:line`** — an uncited Done is not a Done. |
| **Deployed** | Done and live, with the date. |
| **Parked** | Deliberately not doing it now. Needs a reason and a date. |
| **Superseded** | Overtaken by a later decision. Names what replaced it. |

## Closing a change

A change is not finished until all four are true:

1. The code ships.
2. [`SYSTEM.md`](SYSTEM.md) reflects the new behaviour.
3. [`CHANGES.md`](CHANGES.md) has the dated entry.
4. The row here carries `Done`/`Deployed` **and its citation**.

---

# Register

Seeded 2026-08-29 from the raw request files that had accumulated at the repo root. Every item
below was checked against the code before it was given a status. Where the check was
inconclusive the status is **Open** — deliberately, because a register that guesses is worse
than one that admits it doesn't know.

Numbering is by source cluster, not by date raised — the raw files were undated.

## In flight

Work that has shipped to LIVE but is **not yet committed**. Tracked here so its state is
unambiguous if asked again.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 102 | Batch stock derived by one pure FIFO reducer, replacing the scattered netting | **Deployed 2026-08-29, uncommitted** | [`batchStockDerive.ts`](../client/src/features/stages/batchStockDerive.ts) + its 7-scenario check |
| 103 | `/send-to-loading` must not lose the batch trail when palletization is skipped | **Deployed 2026-08-29, uncommitted** | `unqueuedBatches` now backs both callers ([`index.js:2078`](../functions/data-ops/index.js#L2078)) |
| 104 | Reports for batch stock, batch movement, palletization status, loading, dispatch register | **Deployed 2026-08-29, uncommitted** | 5 new entries in `REPORTS`; `PivotTable.tsx`, `bucket.ts` |
| 105 | Retire **shade** — it was never populated | **Deployed 2026-08-29, uncommitted** | Columns marked `RETIRED 2026-08-29` in `DATASTORE-SCHEMA.md`; removed from every writer and reader |
| 106 | Retire the legacy pallet entry points that double-counted boxes | **Deployed 2026-08-29, uncommitted** | 5 files headed `RETIRED`; `/final` route deleted; `PalletDetail`'s Palletize Order removed. **The legacy *data* is still read by `batchStockApi` — do not delete it.** |
| 107 | Document the system as built and put change requests on a tracked register | **Done 2026-08-29** | This file, [`SYSTEM.md`](SYSTEM.md), backfilled [`CHANGES.md`](CHANGES.md), rewritten [`README.md`](../README.md) |
| 111 | Production sheet edit mode — qty and status editable until Save | **Deployed 2026-09-02, uncommitted** | `editMode` + `draft`, `saveDraft` ([`ProductionTable.tsx`](../client/src/features/stages/ProductionTable.tsx)); caps in [`productionSheetEdit.ts`](../client/src/features/stages/productionSheetEdit.ts) |
| 112 | "In Production" column, bulk-editable, written to the production line on Save | **Deployed 2026-09-02, uncommitted** | Sheet column → `POST /production-update` ([`productionApi.ts:406`](../client/src/features/stages/productionApi.ts#L406)) |

**Next action on 102–106, 111–112:** commit the working tree. The code is live; the git history is not.

---

## Summary

| Cluster | Source | Open | Done | Parked |
|---|---|---|---|---|
| CR-001…016 | Item Master & Add Item form | 5 | 10 | 1 |
| CR-017…030 | Item detail stock, production Kanban, reports | 3 | 11 | 0 |
| CR-031…050 | SO stages, palletization, vehicle loading | 7 | 13 | 0 |
| CR-051…060 | Production Kanban partial-completion, notifications | 4 | 6 | 0 |
| CR-061…069 | Vehicle loading detail | 2 | 7 | 0 |
| CR-070…077 | Palletization flow | 0 | 8 | 0 |
| CR-078…096 | Quotes: BCY/FCY, approvals, convert-to-SO | 4 | 15 | 0 |
| CR-097…101 | Masters: country, currency, address, pallet dims | 2 | 3 | 0 |

---

## CR-001…016 · Item Master & Add Item form
*Raw: [`raw/Change- Item master.md`](change-requests/raw/Change-%20Item%20master.md) — the one
file already written in the template. Use it as the worked example.*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 001 | Size & Status filters DB-sourced, no static arrays | **Done** | Standing rule `pick-lists-db-sourced`; `sizesApi`/`mastersApi` feed the filters |
| 002 | Drop "Design Master" wording — page reads as Item | **Done** | Nav leaf is "Items" ([`App.tsx:113`](../client/src/App.tsx#L113)) |
| 003 | "New Design" → "New Item"; remove refresh button | **Done** | `DesignMaster.tsx` |
| 004 | Status defaults to Continue and is locked at creation | **Done** | Renamed Active/Inactive 2026-07-06 and migrated; create-form status is fixed |
| 005 | No negative values in any numeric field | **Done** | `form-ux-standard` — no negatives, retrofitted app-wide |
| 006 | Remove Associate Pallets from item creation | **Done** | Pallet association moved to the SO line item — see CR-044 |
| 007 | Remove Accounting Stock from item creation | **Superseded** | Renamed to **Opening Stock** and moved to its own locked form (CR-017) |
| 008 | Unique Name unique across items, including party brand | **Done** | `PartyBrand` table (live `69851000000060042`, added 2026-07-04); app-layer uniqueness (no compound indexes) |
| 008.3 | Party Master dropdown + master form under Settings, typable | **Done** | `PartyBrand` master + Combobox |
| 009 | Pick-list keyboard nav — arrows move, space/enter selects, everywhere | **Open** | One shared Combobox exists; keyboard behaviour not verified across all call sites |
| 010 | "Save Design" → "Save" | **Done** | `form-ux-standard` Save-only rule |
| 011 | Required `*` marker in red, all forms | **Open** | Marker is in-box with a legend (`form-ux-standard`); the red colour was not confirmed |
| 012 | Remove image upload from item creation | **Done** | Dedicated image manager shipped instead — `common/ImageManager.tsx`, commit `9656f22` |
| 012.2 | Inventory image-upload screen from a user reference | **Done** | `ImageManager.tsx` (`9656f22`) |
| 013 | Edit-mode redesign: grid click → left panel, edit/delete top-left, grid shrinks to Unique Name | **Parked** | Reversed by the [`grid-ux-standard`](SYSTEM.md#8--house-standards) decision of 2026-07-17: **whole row → detail page**, not a left panel. The Detailed-Grid pane design was built 2026-07-30 and reverted; wanted only as a portable prompt for other apps. |
| 013.2 | Zoho Books item reference | **Open** | Blocked — reference never supplied. Books integration was never built at all. |
| 014 | Item detail shows Unique Name + SKU | **Done** | `ItemDetail.tsx` |
| 014.3 | Item-details reference screenshot | **Open** | Blocked on the user's screenshot |
| 015 | SKU generated from master short codes; each master holds its code part | **Open** | `seq_code` columns exist on Brand/Grade (added 2026-07-04) and `seq_code` auto-generates, but the full readable-SKU rework is the deferred `sku-readable-plan` — decisions locked, not built |
| 016 | Multi-select filter screen on the Item grid | **Done** | Advanced-search modal, `grid-ux-standard` |

## CR-017…030 · Item detail stock, production Kanban, reports
*Raw: [`raw/Change Item master 2.md`](change-requests/raw/Change%20Item%20master%202.md)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 017 | Rename Accounting Stock → **Opening Stock**; allow manual update | **Done** | `OpeningStockForm.tsx`, `POST /opening-stock/:designId` |
| 018 | Item detail shows Opening / In Production / In Loading / Available below the image | **Done** | "Available stock" panel, [`ItemDetail.tsx:620`](../client/src/features/masters/ItemDetail.tsx#L620); derived via `designStock()` |
| 019 | Kanban view for Production | **Done** | `ProductionKanban.tsx` |
| 020 | Drop the production approval process — hide and comment the code | **Done** | `PRODUCTION_TRANSITIONS` kept for rollback only, no UI drives it ([`index.js:3326`](../functions/data-ops/index.js#L3326)) |
| 021 | Production stages: New Request → In Production → QC → Completed | **Done (amended)** | Shipped as `New → InProduction → Completed`; **QC parked** by CR-051 |
| 022 | Edit option in production master | **Done** | `ProductionEditForm.tsx`, `POST /production-update/:rowid` |
| 023 | Record production: Desired qty defaults to Remaining (ordered − available in hand) | **Done** | `Remaining/Desired = ordered − produced − inflight − stock` |
| 024 | Production Log tab beside Activity on the detail page, item-filtered, single table (not grouped) | **Done** | [`ProductionDetail.tsx:75,397`](../client/src/features/stages/ProductionDetail.tsx#L75) — `details \| prodlog \| activity` tabs, "Production log" |
| 025 | Record form must be the full master-entry form (date and other details) | **Done** | `RecordOutputForm.tsx` — multi-item modal, commit `0b21918` |
| 026 | **Bug:** Record button disappears after a partial record; should stay until all items produced | **Done** | Produced counter shows committed output only, commit `fa40145` |
| 027 | **Bug:** partial-conversion count wrong — 3000 total shows 2700 after recording 200 | **Done** | Counters are now recomputed by `recountOrderItems` from ground truth, never incremented inline ([`index.js:4289`](../functions/data-ops/index.js#L4289)) |
| 028 | Default grid filter = pending production orders | **Open** | The queued-filter invariant exists; the default-filter-by-view rule is CR-056 and was not confirmed |
| 029 | Move order progress next to the title, percentage only; strip "5 items · date" from the subtitle, keep customer + SO | **Open** | Not confirmed in `ProductionDetail.tsx` |
| 030 | Reports wanted: Live Stock, Customer-wise sales, Salesperson-wise sales, Size-wise orders | **Done** | All four in the `REPORTS` registry: `stock`, `customer-sales`, `salesperson-sales`, `size` ([`Reports.tsx`](../client/src/features/reports/Reports.tsx)) |

## CR-031…050 · SO stages, palletization, vehicle loading
*Raw: [`raw/Item Master Changes.md`](change-requests/raw/Item%20Master%20Changes.md)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 031 | Duplicate sizes still showing in Item master — eliminate | **Open** | Not confirmed |
| 032 | Apply button covers checkboxes **and** group order for Production | **Done** | ColumnPicker stages both, commits on Apply — and is **locked** (CR-039) |
| 033 | Production grouping order — in-progress orders on top | **Open** | Not confirmed |
| 034 | Show SO number in Customer details, not PO number | **Open** | Not confirmed |
| 035 | SO must always have at least one line | **Done** | [`OrderForm.tsx:552`](../client/src/features/orders/OrderForm.tsx#L552) — "Add at least one line with a design + quantity" |
| 036 | Deleting a line item disassociates its production; allow reshaping order parameters | **Done** | `POST /delete-order-item/:id` ([`index.js:4844`](../functions/data-ops/index.js#L4844)) |
| 037 | Notifications to the bottom-right corner, less transparent | **Done** | [`styles.css:2147-2151`](../client/src/styles/styles.css#L2147) — moved from top-right, user mandate 2026-07-20 |
| 038 | SO Rate mandatory; Qty defaults to 1 | **Done** | [`OrderForm.tsx:93`](../client/src/features/orders/OrderForm.tsx#L93) — `ordered_qty_boxes: "1"` |
| 039 | Newest-first ordering on every record list; **never alter the field-selection Apply behaviour** | **Done** | `useSortRows(..., "created", -1)` everywhere; ColumnPicker Apply is a locked standard — see [`SYSTEM.md` §8](SYSTEM.md#8--house-standards) |
| 040 | SO post-approval label: "Confirmed" → **"Approved"** | **Done** | [`ordersApi.ts:222-227`](../client/src/features/orders/ordersApi.ts#L222) — stored value stays `Confirmed`, reads as "Approved" |
| 041 | "Mark in progress" → **"Mark as sent"** (sales person acknowledged the customer) | **Open** | `InProgress` still labels as "In Progress" ([`ordersApi.ts:227`](../client/src/features/orders/ordersApi.ts#L227)); "Mark as sent" exists only on Quotes |
| 042 | "Send to palletization" → More menu, renamed "Palletization" | **Open** | Still reads "Send to Palletisation" ([`OrderDrawer.tsx:90`](../client/src/features/orders/OrderDrawer.tsx#L90)) |
| 043 | Show **In Production** on the SO instead of Produced | **Done** | Shipping-stage chip + recounted counters, commit `8d9b75c` |
| 044 | Move the pallet picker off the order header onto the **line item** | **Done** | [`OrderForm.tsx:186`](../client/src/features/orders/OrderForm.tsx#L186) — "required per-line pallet picker" |
| 045 | Line-item pallet picker shows only pallets matching the item's size | **Done** | Same — "size-filtered by design" |
| 046 | Palletization Tab on the SO, like Production | **Done** | Shared `DispatchTab` on SO/PalPlan/Quote, commit `0b21918` |
| 047 | Clicking In-Production shows customer, SO and SO qty in a popup | **Done** | `InProductionModal.tsx` |
| 048 | Palletization columns: Ordered / Need Palletization / Palletised, defaulting to order qty, operator-editable regardless of SO qty | **Done** | `PalPlanForm` order-qty column, commit `2abed9b` |
| 049 | "Delivery date" → **"Palletization Date"** | **Done** | [`PalPlanForm.tsx:262`](../client/src/features/stages/PalPlanForm.tsx#L262) |
| 050 | New palletization form: remove Fill available / Clear / Close pallet / title / subtitle | **Done** | Instructional modal subtitles dropped (`73113ec`); legacy Close-pallet entry point retired 2026-08-29 |

## CR-051…060 · Production Kanban partial completion, notifications
*Raw: [`raw/Notification Changes`](change-requests/raw/Notification%20Changes)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 051 | Hide the QC stage from production for now | **Done** | QC dropped from board, tabs and flow ([`productionApi.ts:432`](../client/src/features/stages/productionApi.ts#L432)) |
| 052 | Partial completion — a job stays in the In Production lane until 100% produced, shown as pending | **Done** | Auto-step reaches `Completed` only once records cover `qty_requested`, commit `0b00bdd` |
| 053 | Grouped buttons for view and grouping: Customer, order, size, item | **Done** | Group-by + filters + columns on the boards, commit `0b21918` |
| 054 | Item-wise production requests | **Done** | Per-line auto-enqueue seeds one job per order item |
| 055 | `+` button on the Kanban card to log output | **Done** | Per-row Record button, commit `a8e30f7` |
| 056 | Default filter = pending in Grid view, all in Kanban view | **Open** | Not confirmed |
| 057 | Partial recording moves the card onward | **Superseded** | Replaced by CR-052 — partial output keeps the card in In Production |
| 058 | "In production" figure = stock currently in production, on item detail | **Done** | `designStock()` / `ItemDetail` stock panel |
| 059 | **Bug:** raising an SO inflates in-production stock | **Done** | Auto-queued `so-…` jobs count only once **touched**; an untouched auto job is superseded by a manual request |
| 060 | Line-item display identical across all transactions: Unique Name in the dropdown, plus Qty / In Production / Available / In Loading, colour-coded green-yellow-red | **Open** | Lines store `unique_name` (commit `8d9b75c`), but the four-figure colour-coded line display was not confirmed |

## CR-061…069 · Vehicle loading
*Raw: [`raw/1. Remove selection and`](change-requests/raw/1.%20Remove%20selection%20and)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 061 | Remove selection | **Done** | Superseded by checkbox multi-select on the board, commit `b600df5` |
| 062 | Show the **unique design name** during palletization | **Done** | Lines carry `unique_name` |
| 063 | Vehicles labelled 1, 2, 3 in sequence rather than "truck" | **Done** | `VehicleFillBar.tsx` |
| 064 | Vehicle load starts **empty**; fills only after pallet selection | **Done** | [`VehicleFillBar.tsx:64`](../client/src/features/stages/VehicleFillBar.tsx#L64) |
| 065 | A full vehicle auto-spills into the next; never cram everything into one; vehicle count grows automatically, operator can still add one | **Done** | [`VehicleFillBar.tsx:7,76`](../client/src/features/stages/VehicleFillBar.tsx#L7) — "auto first-fit: split each line across vehicles, spilling to the next" |
| 066 | Work to 100% capacity only — remove the overload scenario entirely | **Done** | Same — "vehicle count grows so nothing exceeds one vehicle's capacity" |
| 067 | Colour the fill: green at 100%, red over; distinct items in distinct colours | **Done** | `fillColor` + `DESIGN_PALETTE` ([`VehicleFillBar.tsx:262`](../client/src/features/stages/VehicleFillBar.tsx#L262)) |
| 068 | `✕` to remove a vehicle, `⋯` to clear its allocated items | **Open** | Not confirmed |
| 069 | Clear / None option on **every** dropdown | **Open** | **Known outstanding.** Reverses the None-removal in `b9a47f2`; applies to all Combobox pick lists app-wide |

## CR-070…077 · Palletization flow
*Raw: [`raw/Pallets_1.txt`](change-requests/raw/Pallets_1.txt)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 070 | Palletise the same quantity that was recorded in production | **Done** | Every production record tops up the item's planning queue by `produced − palletized`, `autoEnqueuePalletization` ([`index.js:2106`](../functions/data-ops/index.js#L2106)) |
| 071 | Show Ordered and Need columns | **Done** | See CR-048 |
| 072 | Choose pallets at SO creation | **Done** | Per-line pallet picker, CR-044 |
| 073 | Kanban for palletization | **Done** | `/packing` board, commit `c650e72` → redesigned `b600df5` |
| 074 | Completed production transfers to palletisation automatically | **Done** | SO-confirm + per-record auto-enqueue |
| 075 | Palletization **and** loading together, with palletisation stages | **Done** | `/packing` titled "Palletization and Loading", 3 line stages |
| 076 | Completing palletisation opens the vehicle-loading screen | **Done** | `/loading` board + `LoadContainerModal`, commit `0b21918` |
| 077 | Capture driver details, driver number and vehicle number at loading | **Done** | Vehicle + seals captured at **Confirm Load, before dispatch** |

## CR-078…096 · Quotes: BCY/FCY, approvals, convert-to-SO
*Raw: [`raw/BCY.md`](change-requests/raw/BCY.md)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 078 | BCY/FCY on quotes with table changes; **exclude from the printed quote** — the customer sees only their own currency | **Done** | `Currency` master (live `69851000000065195`, 2026-07-13) + frozen `exchangeRate`; base currency shown on screen only ([`QuoteDetail.tsx:549-551`](../client/src/features/quotes/QuoteDetail.tsx#L549)) |
| 079 | Show Qty total on the quote **and** the printed quote | **Open** | Not confirmed in the print/PDF renderers |
| 080 | Approval process for draft quotes | **Done** | `QUOTE_TRANSITIONS` ([`index.js:1029`](../functions/data-ops/index.js#L1029)) |
| 081 | Admin approval inbox — approve, then send to customer, then accept/reject | **Done** | `/approvals` (`Approvals.tsx`), role-gated by `Role.matrix.approve` |
| 082 | Rejection captures a reason, returns to draft, notifies the sales person | **Done** | `Notification` table + `notifyUser` ([`index.js:1092`](../functions/data-ops/index.js#L1092)) |
| 083 | Rejection still possible **after** acceptance (customer may pull out pre-conversion) | **Done** | `Accepted → Rejected` is in `QUOTE_TRANSITIONS` |
| 084 | Status-transition aging report, Jira-style — where is a transaction stuck, and how long between two states | **Done** | `StatusTransition` table (live `69851000000066173`) + `aging` report ("Quote Aging — where quotes are stuck") |
| 085 | Quote activity should read in plain language, not "inserted"/"updated" | **Done** | `Activity` carries a human-readable detail on every mutation |
| 086 | Show base currency below the quote number | **Done** | [`QuoteDetail.tsx:549-551`](../client/src/features/quotes/QuoteDetail.tsx#L549) |
| 087 | Show discounts on the quote detail | **Done** | `discount` on the line model ([`OrderForm.tsx:93`](../client/src/features/orders/OrderForm.tsx#L93)); gross/net totals on QuoteDetail |
| 088 | Long remarks/terms collapse behind "view more" so the page doesn't stretch | **Open** | Not confirmed |
| 089 | Partially Converted must not allow the whole qty to be converted twice | **Done** | Convert enabled only for `Accepted`/`PartiallyConverted`; the balance is what converts |
| 090 | Remove box-branding from convert-to-SO | **Done** | Convert modal titled "Sales Order", button "Save" |
| 091 | After conversion, land on the **new master order's detail**, not the list | **Done** | Standing rule: after create or clone, navigate to the created record using the id the API returned |
| 092 | Underline the SO link; clicking it opens the detail; right-click → open in new tab must work everywhere | **Open** | Whole-row → detail is the standard ([`grid-ux-standard`](SYSTEM.md#8--house-standards)); real `<a href>` semantics for new-tab were not confirmed |
| 093 | Convert shows the **New Order form** (reuse it — don't clone the quote modal); lock Customer and Currency, allow date/payment-terms/line edits | **Done** | `OrderForm` is reused; transactions inherit customer fields |
| 094 | Remove Status and Port of Discharge from the convert form; all line categories as dropdowns; ≥1 line; sales person from the customer master | **Done** | Port of Discharge removed 2026-07-13 ([`QuoteForm.tsx:296`](../client/src/features/quotes/QuoteForm.tsx#L296)); Sales Person defaults from the logged-in user / customer |
| 095 | Rename the "Master Order" menu to **Sales Order**, with Kanban / detail view options on top | **Done** | Nav leaf "Sales Orders" with `ViewToggle` → `/byorder` \| `/kanban` ([`App.tsx:142`](../client/src/App.tsx#L142)) |
| 096 | Show "0 boxes · INR 0" in the calculation section | **Done** | Totals block on QuoteDetail |

## CR-097…101 · Masters: country, currency, address, pallet dimensions
*Raw: [`raw/QC Checks.md`](change-requests/raw/QC%20Checks.md)*

| CR | Change | Status | Evidence |
|---|---|---|---|
| 097 | Standard country set | **Done** | ISO country list via `isoInfo` ([`PartyForm.tsx:52`](../client/src/features/masters/PartyForm.tsx#L52)) |
| 098 | Standard currency set, selected automatically from the country | **Done** | `country_code` derived from the billing-address country, feeds the grid flag and currency ([`PartyForm.tsx:55-56`](../client/src/features/masters/PartyForm.tsx#L55)) |
| 099 | Port of Discharge — add instantly if missing from the master | **Superseded** | Port of Discharge was **removed from quotes** on 2026-07-13 ([`QuoteForm.tsx:296`](../client/src/features/quotes/QuoteForm.tsx#L296)); the stored column remains |
| 100 | Billing and shipping address on the customer | **Done** | `billing_*` / `shipping_*` columns on `Customer`, `PartyForm.tsx` |
| 101 | New Pallet — pallet size should be length and width | **Open** | Not confirmed against `PalletForm.tsx` |


## CR-108…110 · Multi-select palletise & loading, Container rename (2026-08-31)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 108 | Palletise acts on ALL checked items, whichever card's button is clicked | **Deployed 2026-08-31, uncommitted** | `palletiseTargets` — selection ∪ clicked line ([`DispatchBoard.tsx:238`](../client/src/features/stages/DispatchBoard.tsx#L238)) |
| 109 | Loading shows all checked items in the modal; save loads them all into the chosen container | **Deployed 2026-08-31, uncommitted** | Multi-line `LoadContainerModal` + all-or-nothing `POST /pal-lines-box` ([`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx), [`index.js:3085`](../functions/data-ops/index.js#L3085)) |
| 110 | Rename container labels "Box N" → "Container N" | **Deployed 2026-08-31, uncommitted** | `boxLabel` ([`palPlansApi.ts:108`](../client/src/features/stages/palPlansApi.ts#L108)) + toasts, QR slip, Dispatch Copy, server errors |


## CR-111…112 · Production sheet edit mode (2026-09-02)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 111 | Sheet view gets an edit mode — qty and status stay editable until Save, and the qty becomes the recorded production output | **Deployed 2026-09-02, uncommitted** | `editMode` + `draft` staged edits, `saveDraft` ([`ProductionTable.tsx`](../client/src/features/stages/ProductionTable.tsx)), caps in [`productionSheetEdit.ts`](../client/src/features/stages/productionSheetEdit.ts) |
| 112 | "In Production" column, bulk-editable; Save writes it to the production line | **Deployed 2026-09-02, uncommitted** | Sheet's `Requested` column renamed and made editable → `POST /production-update` ([`productionApi.ts:406`](../client/src/features/stages/productionApi.ts#L406)) |


## CR-113…114 · Sheet-first default view (2026-09-02)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 113 | Every board listing page opens on Sheet/Grid, not Kanban | **Built 2026-09-02, not deployed** | `useViewState` seeds the view from the org preference ([`usePersistedState.ts`](../client/src/lib/usePersistedState.ts)); adopted by [`PalPlans.tsx`](../client/src/features/stages/PalPlans.tsx), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx), [`PanelOrders.tsx`](../client/src/features/panels/PanelOrders.tsx), [`ProductionTable.tsx`](../client/src/features/stages/ProductionTable.tsx) |
| 114 | The default view is settable in Settings | **Built 2026-09-02, not deployed** | `default_view` AppSetting key + "Default view" select in Preferences ([`settingsApi.ts`](../client/src/features/settings/settingsApi.ts), [`SettingsHome.tsx`](../client/src/features/settings/SettingsHome.tsx)) |

## CR-115…119 · Loading & Dispatch revamp + SO planner fix (2026-09-04)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 115 | SO Plan Containerisation shows the item in the combobox (was empty "Search item…") | **DEPLOYED LIVE 2026-09-04, uncommitted** | SO wrapper seeds `item: o.design \|\| o.designName` (unique-name-first, matching `itemOptions`) — [`PlanContainerisation.tsx:1150`](../client/src/features/quotes/PlanContainerisation.tsx#L1150). Also fixes the SO planner opening dirty (plan JSON now regenerates unique-name-keyed). Bonus: quote planner reopens on the saved pallet (was reset to the first option); "Ready Pallets" column header corrected to "Pallets". *Residual:* plans saved before the fix open dirty once until re-saved. |
| 116 | Sidebar "Loading" renamed **"Loading and Dispatch"** | **DEPLOYED LIVE 2026-09-04, uncommitted** | [`App.tsx:132`](../client/src/App.tsx#L132) |
| 117 | Two-step palletise: **Palletise** → *In Palletization*, then **Mark Palletised** → *Ready for Loading* (reverses CR-era 2026-08-27 one-hop) | **DEPLOYED LIVE 2026-09-04, uncommitted** | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx); middle label "In Palletization" (`PAL_LINE_STATUS_LABEL`). No server change — `PAL_LINE_TRANSITIONS` already allows it. *Safety audit:* auto-enqueue counts queued = Planning+Palletizing (no double-enqueue); `palletized_qty_boxes`/batch stock still move at `ReadyToLoad` (timing shifts to Mark Palletised — same as the old drag path); `/pal-lines-box` still requires `ReadyToLoad`, so an In-Palletization line cannot be loaded. |
| 118 | Load moves to `/packing`: Ready-for-Loading cards get the **Load** button (+ multi-select); the "Ready for Loading" section is removed from `/loading` | **DEPLOYED LIVE 2026-09-04, uncommitted** | Shared [`useLoadFlow.ts`](../client/src/features/stages/useLoadFlow.ts) hook (extracted from LoadingBay: confirm + plan hint + picker); `DispatchBoard` mounts `LoadContainerModal`; `LoadingBay.stageOf` returns `null` for un-boxed lines, board collapsed to In Loading → Ready for Dispatch → Dispatched. |
| 119 | Per-loading plan screen: items + **batch** from multiple SOs/customers, fulfillment from palletised stock, "planned earlier" hint per line | **DEPLOYED LIVE 2026-09-04 (column + functions + client), uncommitted** | [`LoadingPlan.tsx`](../client/src/features/stages/LoadingPlan.tsx) at `/loading/:id/plan` ("Plan Loading" on the detail); `LoadBox.load_plan` text(10000) + whitelists in `/load-box` and `/load-box-update`; `parseLoadPlan` in [`data.ts`](../client/src/data.ts). *Deferred:* `LoadContainerModal.planHint` preferring the box's own load_plan over the SO hint (`planHintFor` is the seam). Deploy order: column (done) → functions → client. |

## CR-120…124 · Multi-container loading plan, LOAD series, batch format (2026-09-04)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 120 | Loading plan reuses the SO container plan + goes **multi-container**: an empty plan seeds from the box's own lines + the SO plan's remainder; "Send as Single / Multiple containers" auto-packs item-wise (overflow spawns extra containers, shared math with the SO planner) and Save creates/updates one sibling LoadBox per extra container | **DEPLOYED LIVE 2026-09-08, uncommitted** | [`LoadingPlan.tsx`](../client/src/features/stages/LoadingPlan.tsx) rework; pure pack math extracted to [`containerPack.ts`](../client/src/features/quotes/containerPack.ts) (+ self-check test) and reused by [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx); seeding in [`loadingPlanSeed.ts`](../client/src/features/stages/loadingPlanSeed.ts) (+ test); `LoadPlan.group {id,no,of}` in [`data.ts`](../client/src/data.ts) (JSON key, no new column — server never reads load_plan); sibling `C n/of` chip on the Loadings grid + sibling strip on the detail. Reverses CR-119's one-loading-one-container note. Physical stock still moves only via the load modal flows — Save is idempotent planning; a shrunk plan leaves surplus siblings for manual delete. |
| 121 | Multi-select **Load** from `/packing` lands on the Plan Loading screen (the batch just added is visible in one place) | **DEPLOYED LIVE 2026-09-08, uncommitted** | `useLoadFlow.confirmLoad` navigates to `/loading/:id/plan` after assigning lines ([`useLoadFlow.ts`](../client/src/features/stages/useLoadFlow.ts)) |
| 122 | Loadings get their own **LOAD series** `LOAD/FY/NNN` (was PAL-flavoured/"Container N" identity) | **DEPLOYED LIVE 2026-09-08, uncommitted** | `nextLoadNumber` + mint in `/load-box` ([`functions/data-ops/index.js`](../functions/data-ops/index.js)); `boxLabel` prefers it ([`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts)); server dispatch notes/labels prefer it; old boxes stay numberless (fallback label, no backfill). PAL-NNN item codes on `/packing` unchanged. |
| 123 | Auto batch numbers become **`B/YYYY-MM/NNN` per item per calendar month** (was global `B/FY/NNN`) | **DEPLOYED LIVE 2026-09-08, uncommitted** | `nextBatchNumber(catalyst, designId)` with a design+month-scoped scan — also fixes the silent 300-row ZCQL truncation in the old unscoped MAX-scan; all 4 mint sites pass the design ([`functions/data-ops/index.js`](../functions/data-ops/index.js)). Typed batches unchanged (`assertBatchesAllowed` still guards). |
| 124 | Container Planning on a loading is **edited inline** (was a link out to `/orders/:id/containerise`) | **DEPLOYED LIVE 2026-09-08, uncommitted** | `PlanSoContainerisation` accepts `{soId, embedded}`; LoadingDetail's tab embeds the full planner with an SO chip selector for multi-SO loadings ([`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx)). Save still writes `SalesOrder.container_plan`. |

| 125 | Settings → Preferences gains a **Batch series** setting: admin sets prefix, separator and start number for the auto-minted batch format `<prefix><sep>YYYY-MM<sep>NNN` (live preview + Save) | **DEPLOYED LIVE 2026-09-08, uncommitted** | AppSetting keys `batch_series_prefix`/`batch_series_separator`/`batch_series_start` ([`settingsApi.ts`](../client/src/features/settings/settingsApi.ts), [`SettingsHome.tsx`](../client/src/features/settings/SettingsHome.tsx)); server reads them in `nextBatchNumber` (`batchSeriesSettings`, [`functions/data-ops/index.js`](../functions/data-ops/index.js)); values ZCQL-cleaned (quotes/wildcards stripped). Changing prefix/separator starts a fresh series; existing batches keep their format. |

Deployed 2026-09-08: `LoadBox.load_number` varchar(50) created → data-ops → client, in that order.

CR-119's layout follows the Claude Design project "Loading and Dispatch" (`.dc.html`,
imported after `/design-login` the same day): top action bar · info-card row with the
color-coded SO chip card · mono items table with per-SO/per-item colors · container graphic
(one cell per pallet position, solid = palletised-covered, faded = not yet palletised,
dashed = free) + "inside this loading" legend. The design's blue/warm-gray palette is
mapped onto the app theme tokens. The project's second file, `Plan Containerisation.dc.html`,
was not applied (out of scope for this CR).

## CR-126 · SO-first New Loading — plan before the loading exists (2026-09-09)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 126 | **New Loading inverted**: pick just the Sales Order → the load planner opens at `/loading/new/plan?so=…` (seeded from the SO's container plan when one exists, empty otherwise) → the first **Save mints the LoadBox(es)** (LOAD series) → a skippable container/vehicle details modal pops right after. Abandoning the planner leaves no record. | **DEPLOYED LIVE 2026-09-09, uncommitted** | [`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx) (SO-only mode + new `LoadingDetailsModal` reusing `ContainerPicker`/`draftToCreateInput`); [`LoadingPlan.tsx`](../client/src/features/stages/LoadingPlan.tsx) (`new` sentinel, create-plain → group-update → siblings save sequence); dead container-only branch removed from [`useLoadFlow.ts`](../client/src/features/stages/useLoadFlow.ts). No server change — `/load-box` already accepts `{container_size, load_plan}` alone. Details modal covers the primary container only; siblings get theirs via Confirm Load. |

## CR-127 · Plan-only loadings visible on every /loading view (2026-09-09)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 127 | **Bug (CR-126 follow-up): a loading minted from the SO-first New Loading never appeared in the lists** — it has a plan but no boxed lines, and the default Sheet/Kanban render boxed lines only, while the Loadings grid row was blank (Customers/Orders derived from lines) so any persisted search text hid it. Fix: Loadings-grid aggregates fall back to the `load_plan` JSON (SO ROWIDs resolved via pal-plan lines, then the orders cache); Sheet gets one **Planned** summary row per plan-only box at the top; Kanban's dashed stub now shows Planned + plan summary and renders in grouped mode too (strip above the lanes). Search matches LOAD number/SOs/customers on the stubs. Planned stays a presentation state — the 3 derived stages are untouched. | **DEPLOYED LIVE 2026-09-09 (client-only), uncommitted** | [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`planSummary`, `stubBoxes`, `boxRows` fallback, stub card/row/strip). |

## CR-128 · Loading detail catches up with plan-only loadings; Activity filtered server-side (2026-09-09)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 128 | **Bug (CR-126 follow-up): `/loading/:id` was blank everywhere for a plan-only loading** (e.g. LOAD/2026-27/001) — every section derived from boxed `PalPlanLine.load_box` rows, of which a plan-only box has none. Fixes: **Loaded Items** renders the `load_plan` lines as **Planned** rows (design/batch/boxes/order/customer via the orders cache) with plan-based header counts and subtitle; **Container Planning** resolves SOs from the plan JSON too (same fallback as CR-127's grid); **Details** gains Order(s)/Customer/Planned Boxes rows; the multi-container sibling strip also matches boxes whose `group.id` points at this one (the primary's own slice can lack the key). **Edit Load Details no longer requires a vehicle** — the client-side gate dropped (server already treats `vehicle` as optional on `/load-box-update`; dispatch still requires one), so seals/transporter/LR save on their own; PalPlanDetail's assign-vehicle use keeps its own guard. **Activity/Status tabs app-wide**: `ActivityLog`/`StatusTimeline` fetched the newest 200/300 rows *globally* and filtered client-side, so older records' history fell out of the window — now filtered server-side via `?where=` (`entity_rowid`, else `table_name`). | **DEPLOYED LIVE 2026-09-09 (client-only), uncommitted** | [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx) (`planLines` fallback, planned rows, sibling match); [`RecordDetail.tsx`](../client/src/features/common/RecordDetail.tsx) (`where` on OperationLog/StatusTransition); [`VehicleLoadModal.tsx`](../client/src/features/stages/VehicleLoadModal.tsx) (gate dropped); [`PalPlanDetail.tsx`](../client/src/features/stages/PalPlanDetail.tsx) (guard). |

---

## CR-129…139 · 2026-09-10 batch — plan stickiness, partial palletise, approvals & access

| CR | Change | Status | Evidence |
|---|---|---|---|
| 129 | **Bug (SO 27/032): palletization plan edits didn't stick.** Four root causes fixed: (a) `autoEnqueuePalletization` merged produced boxes back into a user-reduced Planning line — new `manual_edit` column (stamped by `/pal-plan` + `/update-pal-plan`, carried through every split) now PINS an item once its plan line is user-authored: no auto top-up, the remainder waits in the work list; (b) `/update-pal-plan` soft-deleted ALL lines and re-inserted them as `Planning`, resetting advanced lines and stripping `load_box`/`pallet_group` — it now replaces **Planning lines only**; (c) `PalPlanForm` edit mode sourced rows from the available-only work list (fully-palletised lines silently vanished on save) and clamped typing to produced-available ("type 450, get 400") — plan lines now merge back in, non-Planning boxes show as locked "+N palletised", and the clamp is the **SO ordered qty across all lines/plans** (user rule: split freely, never exceed the order; `assertPlanWithinOrdered` mirrors it server-side); (d) `PalletiseModal` let the container-plan prefill override a line's saved pallet — the saved pallet now wins. | **Built 2026-09-10** | `functions/data-ops/index.js` (`normalizePlanLines`, `assertPlanWithinOrdered`, `/update-pal-plan`, `autoEnqueuePalletization`); [`PalPlanForm.tsx`](../client/src/features/stages/PalPlanForm.tsx); [`PalletiseModal.tsx`](../client/src/features/stages/PalletiseModal.tsx); new `PalletizationPlanLine.manual_edit` column. |
| 130 | **Quote keeps ONE combined line per item** — planning 400+100 across pallets/containers no longer splits the quote line; the split lives only in the `container_plan` JSON. The quote planner's save now merges draft lines by item (qty summed, first rate kept) before `updateQuoteWithItems`. | **Built 2026-09-10** | [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx) quote `onSave`. |
| 131 | **Log production regardless of existing qty** — the Desired-qty clamp, covered-line read-only text, fully-covered SO picker filter and the hidden "Record New Production" menu item are gone (hint columns + signal dot unchanged); the server 409 cap (`pending+requested > ordered`) removed. | **Built 2026-09-10** | [`ProductionForm.tsx`](../client/src/features/stages/ProductionForm.tsx); [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx); `index.js` `/production-record-lines` cap. |
| 132 | **Partial palletisation** — PalletiseModal takes a per-line Boxes qty (default full); `/pal-line-status` accepts `boxes` and SPLITS the line (slice transitions, remainder keeps its stage), so palletising part of a line never flips the rest to Ready for Loading. Same split pattern as `/pal-topup`. | **Built 2026-09-10** | [`PalletiseModal.tsx`](../client/src/features/stages/PalletiseModal.tsx); [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) `setPalLineStatus`; `index.js` `/pal-line-status`. |
| 133 | **Manual box weight** — Box Weight is editable on the Pallet form (Size value is the prefill; explicit size pick re-fills) and stays editable on the Item form; `propagateSizeSnapshots` overwrites a row's weight only when it still equals the OLD size value (or is blank), so a manual override survives Size edits. `/resync-size-snapshots` keeps full overwrite. | **Built 2026-09-10** | [`PalletForm.tsx`](../client/src/features/masters/PalletForm.tsx); `index.js` `propagateSizeSnapshots` + Size PATCH. |
| 134 | **Size Master moved to Settings** — sidebar leaf removed from Inventory; Settings ▸ Product Masters ▸ Size Master (admin-only, per user decision). `/sizes` routes untouched. | **Built 2026-09-10** | [`App.tsx`](../client/src/App.tsx); [`SettingsHome.tsx`](../client/src/features/settings/SettingsHome.tsx). |
| 135 | **Customer Overseas indicator** — checkbox in the Customer form (Business/Individual already existed), shown on the customer detail; new `Customer.overseas` column ("true"/""). `customer_type` + `company_name` + `additional_addresses` were live-but-undocumented — now in DATASTORE-SCHEMA.md. | **Built 2026-09-10 (column live)** | [`PartyForm.tsx`](../client/src/features/masters/PartyForm.tsx); [`customersApi.ts`](../client/src/features/masters/customersApi.ts); [`CustomerDetail.tsx`](../client/src/features/masters/CustomerDetail.tsx). |
| 136 | **Panel Craft as a permission module** — `panel_craft` added to MODULE_NAV/TABLE_MODULE/ROUTE_PERM (panel routes now gated), client `PermModule` + Roles matrix (friendlier labels: Item / Sales / Production / Panel Craft); Panel pages check `can("panel_craft", …)`. Existing Manager/Sales Person role matrices seeded live with their `items` grants so nobody lost access. The dead "Production Requests" approvable (stripped server-side since approval retirement) removed from the Roles screen. | **Built 2026-09-10 (roles seeded live)** | `functions/data-ops/lib/appauth.js`; [`auth.ts`](../client/src/lib/auth.ts); [`Roles.tsx`](../client/src/features/admin/Roles.tsx); `client/src/features/panels/*`. |
| 137 | **Rate column removed from the container planner** — UI only; `rate` still flows through draft state and the quote save (dropping it would zero pricing). | **Built 2026-09-10** | [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx). |
| 138 | **Quote line rate accepts decimals** — QuoteForm stored numerics per keystroke via `Number()`, erasing the decimal point ("12.50" was untypable); line drafts now hold raw strings (OrderForm's pattern), converted at compute/submit. | **Built 2026-09-10** | [`QuoteForm.tsx`](../client/src/features/quotes/QuoteForm.tsx). |
| 139 | **No approval loop for approvers** — a user who can approve (Admin, or role-approver of that doc type) creates quotes born `Approved` and SOs born `Confirmed` (convert included; production auto-enqueue runs via shared `enqueueSoProduction`); their edits keep the approved status instead of resetting to Draft. Non-approvers keep the full Draft → PendingApproval flow. | **Built 2026-09-10** | `index.js` quote/SO create + convert + edit-reset sites, `canApprove`, `enqueueSoProduction`. |

---

## CR-140 · Customer Sheet on /loading + Box Brand master (2026-09-10)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 140 | **Customer Sheet** (DEPLOYED LIVE 2026-09-10 with CR-141) — 4th `/loading` view: pick a customer, all their SOs' loaded lines as the export-style loading sheet, grouped by container with merged Sr/L.R./Truck/Container/E-seal/Line-seal cells (rowSpan), P.O. merged per SO run, Design/Size/Finish/Batch per line, **auto-computed pallet ranges** ("1 TO 16" from `ceil(boxes/boxesPerPallet)`, running per container), Pallet 1/2 = the Pallet master's A/B arrangements, Total footer. **Edit mode** (ProductionTable draft idiom): L.R./truck/container/seals → `/load-box-update`, P.O. → `SalesOrder.po_number` (order-level, shared across that SO's loadings by design), per-line **Box Brand** override → new `PalletizationPlanLine.box_brand`. New **BoxBrand master** (Settings ▸ Product Masters ▸ Box Brand) + `Customer.box_brand` default (PartyForm "Default Box Brand", shown on the customer detail); line cell shows the override, grey = inherited default. Container-level edits touch the whole box (same semantics as Confirm Load) even if it also holds other customers' lines. No pager/column picker on this view (fixed document-style sheet); brand overrides are not carried through `/pal-line-box` partial splits (set post-boxing). | **DEPLOYED LIVE 2026-09-10** | [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx); [`customerSheetEdit.ts`](../client/src/features/stages/customerSheetEdit.ts) (+ `.test.ts`); [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (view wiring); [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (finish/PO/brand fields); [`Masters.tsx`](../client/src/features/masters/Masters.tsx), [`PartyForm.tsx`](../client/src/features/masters/PartyForm.tsx), [`customersApi.ts`](../client/src/features/masters/customersApi.ts), [`CustomerDetail.tsx`](../client/src/features/masters/CustomerDetail.tsx), [`SettingsHome.tsx`](../client/src/features/settings/SettingsHome.tsx); `index.js` ALLOWED + new BoxBrand table (69851000000265385) and `box_brand` FKs live. |

---

## CR-141 · Loading-first sheet + Customer-only grouping + dispatch data reset (2026-09-10)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 141 | **/loading Sheet is Loading-first** — the pinned first column is now **Loading** (`boxLabel`: LOAD/FY/NNN → vehicle → "Container N") instead of the display-only PAL-NNN sequence; the duplicate Container column dropped from the column set; the advanced-filter facet relabelled "Loading" (key `container` kept so saved filters survive). **Group by = Customer only** for now (`GROUP_DIMS` shrunk; Order/Container/Batch/Item dims removed from board + sheet; stale persisted `loading.groups` self-filter on read). **LIVE dispatch data reset** for the loading retest, run directly on the Data Store: all 13 LoadBoxes soft-deleted, 16 boxed plan lines un-boxed (back to Ready for Loading on /packing), 11 plans reverted to ReadyToLoad + 1 stale Loading plan to Planning (dispatch dates cleared), 8 legacy PalletisedBatch rows loaded/dispatched → closed, 17 OrderItems loaded/dispatched zeroed + stage → packing, history purged (25 OrderItemEvents, 56 StatusTransitions, 16 OperationLog `dispatched` fan-outs). New loadings continue the LOAD number sequence (soft-deleted rows still count in the LIKE scan). | **DEPLOYED LIVE 2026-09-10** | [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (pinned col, `loadColumns`, `loadSortVal`, `GROUP_DIMS`, filter label); data reset via ZCQL, verified zero-count queries. |
| 142 | **Container sizes 28ft/30ft, always auto-multi** — `CONTAINER_TYPES` = 28ft/30ft (was 20ft/40ft/40HQ), default 28ft (LoadContainerModal draft, workspace); the Send-as Single/Multiple toggle removed — packing is automatic (fits in one → one container, overflow chunks into sibling boxes). Legacy stored sizes display as-is; only the pickers shrunk. | **DEPLOYED LIVE 2026-09-10**, uncommitted | [`containersApi.ts`](../client/src/features/masters/containersApi.ts), [`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx), [`LoadingPlan.tsx`](../client/src/features/stages/LoadingPlan.tsx); schema doc rows updated. |
| 143 | **Loading redesign per the Claude Design "Container Loading" spec** (layout + features, house skin) — `/loading` gets a default **queue board** (active-loading cards + ready work grouped by SO, Start loading →) and a 4-tab **StartLoadingModal** (SO / Customer / Container / Free pick → workspace scoped by `?so=`/`?customer=`/`?free=1`); `/loading/:id/plan` rebuilt **pallet-first**: virtual pallet cards ([`virtualPallets.ts`](../client/src/features/stages/virtualPallets.ts) — derived, no pallet records), scan input (pallet code / batch / LOAD no), Container gauges + Order requirement, floor map + ordered plan, **Suggest fill**, **Compose mixed pallet** (plan-level, multi-batch), **Save plan** (advisory JSON only, `plt`/`mix` keys added to `LoadPlanLine`) vs **Send for loading** (allocates via `/pal-lines-box`, partial takes split server-side). Old items-table planner + `loadingPlanSeed.ts` retired. Zero server changes. | **DEPLOYED LIVE 2026-09-10**, uncommitted | [`LoadingQueueBoard.tsx`](../client/src/features/stages/LoadingQueueBoard.tsx), [`StartLoadingModal.tsx`](../client/src/features/stages/StartLoadingModal.tsx), [`LoadingPlan.tsx`](../client/src/features/stages/LoadingPlan.tsx), [`virtualPallets.ts`](../client/src/features/stages/virtualPallets.ts) (+ `.test.ts`), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (board view, New Loading), [`data.ts`](../client/src/data.ts) (`LoadPlanLine.plt/mix`). |

---

## CR-144 · Undo the loading workspace — New Loading is a modal form (2026-09-10)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 144 | **CR-143 undone** (queue board, `StartLoadingModal`, pallet-first `/loading/:id/plan` workspace, `virtualPallets` all deleted; the `/loading/:id/plan` route removed; CR-142's 28ft/30ft sizes kept). **"New Loading" is now `NewLoadingModal`**: pick the SO (Customer filter optional; options from Ready-for-Loading stock) + container size. The SO's containerisation plan **propagates** — containers render with `planProgress` chips and the first unsent container's quantities prefill against ready stock (FIFO, capped at availability, editable); an SO without a plan shows a flat checkbox+qty list of its palletised lines. **One submit = one loading**: `POST /load-box` with a single-slice `load_plan` (no `group`; CR-127/128 Planned fallbacks intact), then `allocateFifo` maps quantities onto plan lines and `POST /pal-lines-box` allocates all-or-nothing → land on `/loading/:id`. The detail's "Plan Loading" button became **Add Pallets** (same modal scoped to the box); `/packing`'s Load confirm now lands on the loading **detail** (was the workspace). `/loading` opens on Sheet; a persisted "board" view falls back to kanban. Zero server changes. | **DEPLOYED LIVE 2026-09-10**, uncommitted | [`NewLoadingModal.tsx`](../client/src/features/stages/NewLoadingModal.tsx), [`allocateFifo.ts`](../client/src/features/stages/allocateFifo.ts) (+ `.test.ts`), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx), [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx), [`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx) (SO-only mode + `LoadingDetailsModal` removed), [`useLoadFlow.ts`](../client/src/features/stages/useLoadFlow.ts), [`App.tsx`](../client/src/App.tsx). |

---

## CR-145 · Loading Workspace — SO-centric default view on /loading (2026-09-11)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 145 | **Loading Workspace** per the Claude Design "Loading Sheet" spec (structure/UX from the design, house skin) — new default 5th `/loading` view; kanban/sheet/Loadings/Customer Sheet stay. Customer + SO Comboboxes (orders cache, newest-first) → SO summary strip (ordered/planned/palletised/balance boxes, planned %) + three tabs. **Items**: *Ready for Loading* table (multi-select, select-all, target-container picker, In-Containers chips) → **Assign to Loading** modal — per-item load qty clamped to ready stock, fill estimate vs pallet capacity (advisory warn), optional capture (container no/size, vehicle, transporter, LR, seals, destination), `allocateFifo` → existing Open box (`/load-box-update` if fields changed) or new `/load-box` with single-slice `load_plan` snapshot, then all-or-nothing `/pal-lines-box`, landing on the Container Plan tab; *In Palletisation* table (progress from `palletizedQty/orderQty`, batches, "Palletise" → `/packing` — no palletising here). **Container Plan**: the SO's LoadBoxes as cards (boxFill bar, status chip, delete-when-empty), one row per pallet line with whole-line **Move…** (other box / new / remove via `/pal-line-box` — no free-form ctn edits, lines are physical pallets), amber "Ready, not in any container" strip with per-item Add-to, Add-container card (28ft/30ft). **Loading Sheet**: `LoadingCustomerSheet` gains an `soFilter` prop (SO-scoped rows, customer picker hidden) and is now **always editable in place** (same-day follow-up): the Edit toggle is gone — capture cells render as inputs whenever the user can edit, Save/Cancel appear only once dirty, and sheet rows no longer navigate to `/loading/:id` (applies to the standalone Customer Sheet view too). Direct loading (no SO) and the design's Palletisation mode deliberately skipped. Zero server changes. | **DEPLOYED LIVE 2026-09-11**, uncommitted | [`LoadingWorkspace.tsx`](../client/src/features/stages/LoadingWorkspace.tsx); [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (view wiring, workspace default); [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx) (`soFilter`). |

---

| CR | Change | Status | Evidence |
|---|---|---|---|
| 146 | **Plan-scoped line codes + pallet never empty + partial-palletise status.** (a) The display-only line `itemCode` is now plan-scoped `<pal_number>-<n>` (e.g. `PAL/2026-27/008-1`, n = 1-based position ordinal within the plan) instead of the global `PAL-NNN` index that collided with the plan series. (b) Plan lines can no longer be born pallet-less: `/pal-plan` + `/update-pal-plan` reject lines without a pallet; `autoEnqueuePalletization` and `/send-to-loading` fall back to the design's size-default pallet (`defaultPalletForDesign()` — Pallet whose size matches, lowest ROWID) when the SO item has none; new admin `POST /backfill-line-pallets` fills legacy nulls (OrderItem.pallet else size default, idempotent, reports `unresolved` sizes lacking a Pallet row). (c) PalPlanDetail's Associated Sales Orders table gains a **Status** column — per-line stage chip; a split (partial-palletise) remainder row reads "Partially palletised — N of M left" (per-orderItemId roll-up). | **DEPLOYED LIVE 2026-09-11**, uncommitted; backfill run on LIVE (`{scanned:7, updated:7, unresolved:0}`, re-run `{scanned:0}`) | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (itemCode); [`PalPlanDetail.tsx`](../client/src/features/stages/PalPlanDetail.tsx) (Status column); [`functions/data-ops/index.js`](../functions/data-ops/index.js) (`defaultPalletForDesign`, `normalizePlanLines`, `/backfill-line-pallets`). |

---

## CR-147 · Merge Box Brand into Brand (2026-09-11)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 147 | **BoxBrand master folded into Brand** — "Box and Box Brands are same." The separate BoxBrand master (CR-140) is gone: its Settings card and Masters entry are deleted, and the existing Brand master is relabeled **"Box Brand"** (same `/masters?m=brand` route, table `Brand`, `internal_or_external` field kept). All CR-140 consumers now pick from Brand: PartyForm "Default Box Brand", customersApi label lookup, Customer Sheet override picker. **LIVE schema**: `Customer.box_brand` + `PalletizationPlanLine.box_brand` FKs re-created pointing at `Brand` (SET-NULL, both columns were empty — verified before the drop), BoxBrand table (69851000000265385, one throwaway row) deleted, `"BoxBrand"` removed from data-ops ALLOWED. Item-level field labels on Design/Order screens still read "Brand" (same master). | **DEPLOYED LIVE 2026-09-11**, uncommitted | [`Masters.tsx`](../client/src/features/masters/Masters.tsx), [`SettingsHome.tsx`](../client/src/features/settings/SettingsHome.tsx), [`customersApi.ts`](../client/src/features/masters/customersApi.ts), [`PartyForm.tsx`](../client/src/features/masters/PartyForm.tsx), [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx), [`functions/data-ops/index.js`](../functions/data-ops/index.js) (ALLOWED). |

---

## Open items, collected

Twenty-seven rows above are **Open**. Grouped by what they need:

**Blocked on a reference from the user** — CR-013.2 (Zoho Books item reference), CR-014.3
(item-details screenshot).

**Known and already tracked** — CR-069 (Clear/None on every pick list), CR-015 (readable-SKU
rework, decisions locked).

**Needs a decision** — CR-041 ("Mark as sent" on SO), CR-042 (Send-to-Palletization into More),
CR-013 (left-panel edit mode, currently parked against the grid standard).

**Needs a look at the screen** — CR-009, CR-011, CR-028, CR-029, CR-031, CR-033, CR-034,
CR-056, CR-060, CR-068, CR-079, CR-088, CR-092, CR-101.

None of these were built as part of seeding this register — logging is not doing. Deciding
which to pick up is a separate call.
