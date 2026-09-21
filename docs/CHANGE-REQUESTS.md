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

## CR-148 · "+" Record Palletised + per-pallet batch slips (2026-09-11)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 148 | **Palletisation recorded incrementally, like Production's "+" Record Output** — produced 1000 → record 700 palletised today, 300 tomorrow; each recording prints **one Pallet Slip per physical pallet** with its batch number (batch-sequential; a `pallet_group` mixed pallet prints one slip listing every batch). Batches stay production-minted (queue lines are already batch-pure). UI: /packing **"+" on both stages** — beside Palletise on *Ready for Palletization* (straight to Ready for Loading), and **"Record Palletised"** replacing Mark Palletised on *In Palletization* (always via `PalletiseModal`, pallet + full qty prefilled, partial now possible). Zero server change — the CR-132 partial split (`/pal-line-status` `boxes`) does the recording. Auto-print triggers (Palletise-dialog confirm to Ready, drag-drop onto Ready) switched from the tabular Packing Report to slips; every on-demand Packing Report button stays tabular. | **DEPLOYED LIVE 2026-09-11** (client-only deploy), uncommitted; manual drive pending | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) ("+" buttons, Record Palletised, trigger swaps); [`packingReportPdf.ts`](../client/src/features/stages/packingReportPdf.ts) (`downloadPalletSlipsForEntries`/`ForLines`, `slipPage`). |

---

## CR-149 · Mix Batch top-up restored (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 149 | **Recording a pallet mixing the same item's different batches.** The `/pal-topup` endpoint survived the board redesigns but its button had been retired — the Mix Batch chip rendered data nothing in the UI could create. Restored as **"Top up"** on *In Palletization* cards/rows (shown only when the line has a pallet and a same-item queue line exists): new `TopUpModal` picks the donor Ready-for-Palletization line (radio, batch chips, qty defaulting to the space left on the open pallet from `boxes_per_pallet`) → `POST /pal-topup` stamps `pallet_group` on both ends. **Record Palletised on a grouped line now pulls its `pallet_group` siblings into the dialog** (`recordTargets`), so the mixed pallet is recorded together and the CR-148 slip prints it as ONE page listing every batch. Zero server change. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`TopUpModal.tsx`](../client/src/features/stages/TopUpModal.tsx); [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`topUpDonors`, `confirmTopUp`, `recordTargets`); [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (`palTopUp`). |

---

## CR-150 · One "+" menu for palletisation actions (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 150 | **The four per-card/row palletisation buttons collapse into ONE compact "+" menu** on /packing (both kanban cards and sheet rows, *Ready for Palletization* + *In Palletization* stages). The menu always lists three options, inapplicable ones greyed with a reason tooltip: **Start Palletisation** (Planning → In Palletization, the old Palletise button, selection-aware), **Top Up Batch** (the CR-149 Mix Batch flow; enabled only on an In-Palletization line with a pallet and a same-design donor), **Complete Palletisation** (→ Ready for Loading via the dialog; on a Planning line it keeps the old "+" skip-a-stage shortcut, on a grouped line it still pulls `pallet_group` siblings). Bulk selection bar and Ready-stage Load button unchanged. Shared `MoreMenu` gained backward-compatible `icon` + per-item `disabled`/`title` props. Also: `topUpDonors` now guards blank `designId` so two design-less lines can't offer each other as donors (donor list is same-design only, as before). Follow-up same day: the Sheet's per-row **Stage column removed** — the stage band rows already name each section, so the chips were pure repetition; "Partially palletised" became a compact **Partial** chip in the Batch cell beside Mix Batch. Zero server change. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`plusMenuItems`, button collapse, `topUpDonors` guard); [`DetailBits.tsx`](../client/src/features/common/DetailBits.tsx) (`MoreMenu` `icon`/`disabled`). |
| 151 | **⚠ REVERSED by CR-248 (2026-09-21).** **A partially palletised batch never becomes loadable.** The CR-132/148 partial split left the recorded `ReadyToLoad` slice instantly loadable while its batch remainder was still queued. Now a slice is *loadable* only when its whole batch group (order item + batch number; blank batch = whole order item, legacy) is fully palletised (`ReadyToLoad` or boxed). Held-back slices stay in the *In Palletization* column ("Partial" chip as before, Complete Palletisation greyed as already recorded) and are excluded from every loading pool: /packing Load + `LoadContainerModal`, LoadingWorkspace Items tab, New Loading modal. New pure `loadableLineIds` (`palLoadGate.ts`, re-exported from `palPlansApi`; `oiProgressOf` now delegates to a keyed `groupProgressOf`); server backstop `assertBatchesComplete` 409s `/pal-lines-box` + `/pal-line-box` for incomplete groups. Self-checks appended to `batchLedger.check.ts`. | **DEPLOYED LIVE 2026-09-12**, uncommitted; manual drive pending | [`palLoadGate.ts`](../client/src/features/stages/palLoadGate.ts); [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`stageOf`, `availableLines`); [`LoadingWorkspace.tsx`](../client/src/features/stages/LoadingWorkspace.tsx); [`NewLoadingModal.tsx`](../client/src/features/stages/NewLoadingModal.tsx); [`index.js`](../functions/data-ops/index.js) (`assertBatchesComplete`). |
| 152 | **Status columns show short codes, full name on hover — all grids.** Every grid Status cell renders `codeOf(label)` (e.g. RFP, INP, RFL, DSP, PA, CMP) with `title` = full label, shrinking the column; unknown labels fall back to auto-initials. One dictionary in `ui/statusCode.ts`. Swept ~27 sites: Quotes, Orders (Status + Shipping Stage), Production, Loading Bay lines + loadings, Palletizations, PalPlan/Order/Quote/Production detail line tables, Invoices, Containers, Design Master, Users, Operations Log, QC, Panels (`Chip` gained a `title` prop), Load Planner, Reports (quote aging, stock movement, pallet status, loading & dispatch). Rejected quotes/orders keep the `Rejected: <reason>` tooltip. Detail-page HEADER chips, kanban lane headers and stage band rows keep full labels; StageBadge grids were already short. Follow-up same day: swept the 4 stragglers — Panel Orders sheet Status, /prod sheet read-only Status cell (was bare text), and two raw-enum feeds fixed to display labels so codes match their sibling grids (Quote detail's Linked SOs via `soStatusLabel`, Pal-plan status report via `PAL_STATUS_LABEL` — `Planning` now RFP not PLA, `Loading` now IND not LDG). | **DEPLOYED LIVE 2026-09-12**, uncommitted; manual drive pending | [`statusCode.ts`](../client/src/ui/statusCode.ts); e.g. [`QuotesTable.tsx`](../client/src/features/quotes/QuotesTable.tsx), [`OrdersTable.tsx`](../client/src/features/orders/OrdersTable.tsx), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx). |

---

## CR-153 · Packing sheet edit mode + Loading detail rail (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 153 | **/packing Sheet gains an inline edit mode** (same pattern as the /prod sheet edit mode): an always-on **Boxes** column, then **Edit** adds two staged columns — **Palletise** (NumberInput: boxes recorded as palletised now; a partial qty splits the line via the same `/pal-line-status` call the dialog makes; ReadyToLoad rows show "—" as already recorded) and **Top Up From** (Combobox of same-design Planning batches; donor + qty = the CR-149 Mix Batch top-up via `/pal-topup`; only offered on an In-Palletization line with a pallet). Nothing writes until **Save (n)**; per-row pre-flight in pure `palSheetEdit.ts` (`resolvePalSheetEdit` — caps at line/donor boxes, pallet + stage gates, self-checked by `palSheetEdit.test.ts` via `npx tsx`), a bad cell red-borders and disables Save. Save is sequential per row, failures stay drafted + toast. Per-row semantics: a Mix Batch row does **not** pull `pallet_group` siblings (the "+" menu's Complete still records the whole physical pallet). "+" menu, checkboxes, drag and the batch gate (CR-151) unchanged; zero server change. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`palSheetEdit.ts`](../client/src/features/stages/palSheetEdit.ts) + [`palSheetEdit.test.ts`](../client/src/features/stages/palSheetEdit.test.ts); [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (edit state, toolbar, Boxes/Palletise/Top Up From columns). |
| 154 | **Loading detail gains the left sibling rail; customer name sits under the PAL/LOAD code.** The copy-pasted detail-rail block is extracted as shared `DetailRail` (search + mono code + dim subtitle, sticky/resizable card) — only PalPlanDetail and LoadingDetail migrate for now, the other inline copies stay. `/loading/:id` now renders the rail (all loadings newest-first; subtitle = customers · vehicle · stage, customers derived from in-box lines with the plan-JSON → orders fallback, same rule as the Loadings grid) beside the existing `RecordDetail`, mirroring OrderDetail's layout. `/packing/:id`'s rail subtitle now leads with the plan's customers (from `customerNames`) before vehicle + status; SO-number search preserved via the rail's `searchText`. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`DetailRail.tsx`](../client/src/features/common/DetailRail.tsx); [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx) (`railItems`); [`PalPlanDetail.tsx`](../client/src/features/stages/PalPlanDetail.tsx). |

---

## CR-155 · One "+" menu for loading actions (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 155 | **Loading actions collapse into ONE "+" menu everywhere, mirroring CR-150's palletisation "+".** /loading rows: the kanban card's full-width Assign Vehicle / Dispatch buttons and the sheet row's inline pair are deleted; the existing kebab becomes `icon="plus"` titled "Loading actions", and `menuFor` gains a **Dispatch** item (Open + sealed). The Loadings grid kebab gets the same "+" trigger (items unchanged). `/loading/:id`: the four header buttons (Add Pallets, Add Items, Assign Vehicle/Edit Load Details, Dispatch) + the "More ▾" menu merge into one "+" menu (Dispatch greys with "Load at least one item first" when empty); the footer's duplicate Print QR / Dispatch Copy buttons are removed. Workspace: the container-card ✕ becomes a "+" menu (Loading details + Delete loading, greyed "Empty the container first" when it holds lines); the Items-tab **Assign to Loading (n)** and the In-Palletisation **Palletise →** buttons each become a "+" menu item (target Combobox stays). Form controls (Add container, Move…, Clear filters) stay as-is. Client-only. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`menuFor`, card, sheet, Loadings grid); [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx) (header actions); [`LoadingWorkspace.tsx`](../client/src/features/stages/LoadingWorkspace.tsx). |

---

## CR-156 · Row "+" menu never clips; /loading fills the viewport (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 156 | **The row/header "+" MoreMenu is portaled to `document.body`** (`position:fixed`, right-aligned to its trigger, viewport-clamped, repositioned on scroll/resize, flips above the trigger when the bottom is tight) — mirrors the Combobox popup pattern. Root-cause fix for the menu being clipped/scrolled inside `overflow:auto` table wrappers; one component change covers every MoreMenu call site (loading, packing, workspace, detail headers). ColumnPicker keeps its inline menu, so the `.card:has(.hdr-menu)` CSS escape stays. Also **/loading's Loadings grid and Sheet cards get `minHeight: calc(100vh − 172px)`** so short lists stretch to the viewport bottom. Client-only. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`DetailBits.tsx`](../client/src/features/common/DetailBits.tsx) (`MoreMenu`); [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (grid/sheet cards). |

---

## CR-157 · Ordered / Completed / Remaining columns on the Palletization sheet (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 157 | **/packing Sheet gains three right-aligned columns beside Boxes**: Ordered (total boxes sent to palletization for the order item — per-item sum of pal-plan lines, the same derivation as the Partial chip; explicitly *not* the SO's `ordered_qty_boxes`), Completed (palletised = ReadyToLoad or boxed, green), Remaining (ordered − completed). Reuses the existing `oiProgress` map — zero new fetches. Split-line sibling rows repeat the same item-level figures by design. Band-row `nCols` bumped 7→10 / 9→12. Kanban cards unchanged. Client-only. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (sheet thead/cells, `nCols`). |

---

## CR-158 · First-time-user onboarding tour (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 158 | **Built-in educator for new users**: a welcome modal on first login (per user per browser, `localStorage["tour.seen.v1.<rowid>"]`) offering a guided tour; the tour walks the business flow (Dashboard → Items → Customers → Quotes → Sales Orders → Production → Palletization → Loading → Reports → search/settings/user menu) with Next/Back/Skip coach marks that **navigate to each page** while spotlighting its sidebar item (single box-shadow-cutout spotlight, `pointer-events:none` so the app stays clickable). Role-hidden pages auto-skip. Replay anytime via "Take a tour" in the user menu. Anchors are `data-tour` attributes (generic `nav-<id>` on every sidebar NavLink); per-page mini-tours later = a new `TOURS` entry + `startTour(id)`, no rework. No new dependencies — ConfirmHost pub/sub, MoreMenu positioning, `useModalA11y` reused. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`Tour.tsx`](../client/src/features/tour/Tour.tsx) (all logic + step copy); anchors/mount in [`App.tsx`](../client/src/App.tsx), [`HeaderMenus.tsx`](../client/src/features/shell/HeaderMenus.tsx), [`GlobalSearch.tsx`](../client/src/features/search/GlobalSearch.tsx); CSS at the tail of [`styles.css`](../client/src/styles/styles.css). |

---

## CR-159 · Page tours for Palletization and Loading (2026-09-12)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 159 | **Per-page process guides on the two hardest screens**, auto-starting on a user's first visit (per-user localStorage `tour.seen.<id>.v1.<rowid>`) and replayable via **user menu → Page guide** (item appears only on a page that has one). `/packing` (6 steps): where the stage sits in the flow, Kanban/Sheet views + 3 stages, how recording production feeds the queue, the "+" palletise actions (Start / Top Up Batch / Complete) + partial palletise, prints (Today's Report, Packing Report, Pallet Slips), and the Ready-for-Loading → Load handoff incl. the full-batch gate. `/loading` (6 steps): boxed-lines-only scope, the four views, New Loading (SO plan prefill, one submit = one container), **partial loading** (Assign to Loading qty edit / "N of M — rest stays in Ready"), Assign Vehicle → Dispatch (IL → RFD → DSP), prints (QR label, Dispatch Copy, Dispatch Entry). Engine gains: optional `anchor` (anchor-less step = centered explainer card), `waitMs` retry so anchors behind lazy chunks/data aren't skipped, per-tour seen keys, `AUTO_TOURS` route map. 5 `data-tour` anchors added to stable toolbar controls. | **DEPLOYED LIVE 2026-09-12** (client-only deploy), uncommitted; manual drive pending | [`Tour.tsx`](../client/src/features/tour/Tour.tsx) (engine + both step sets); anchors in [`PalPlans.tsx`](../client/src/features/stages/PalPlans.tsx), [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx); Page guide in [`HeaderMenus.tsx`](../client/src/features/shell/HeaderMenus.tsx). |

---

## CR-160 · Palletization is two pages (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 160 | **Palletization splits into two sidebar pages over the same board**: `/packing` = **Ready for Palletization** (the Planning queue only, no Sections picker) and `/palletizing` = **In Palletization** (the Palletizing stage + Ready for Loading, both visible by default, Sections picker to hide either). `PalPlans` takes `stages` + `sectionsKey` props; the board's existing `visibleStages` scoping does the rest. Both nav leaves keep feature id `packing` (one role permission), anchors derive from the path (`nav-packing` / `nav-palletizing`; the Sales Orders anchor became `nav-orders`). Workspace "Palletise →" lands on `/palletizing`; the packing page tour covers both pages and its last step runs on `/palletizing`. Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8; manual drive pending | [`PalPlans.tsx`](../client/src/features/stages/PalPlans.tsx) (props, stage defs); [`App.tsx`](../client/src/App.tsx) (nav + routes); [`Tour.tsx`](../client/src/features/tour/Tour.tsx); [`LoadingWorkspace.tsx`](../client/src/features/stages/LoadingWorkspace.tsx). |

---

## CR-161 · Column pickers on the palletization sheet; ID columns hideable and last; Customer → Design first (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 161 | **/packing Sheet becomes ColumnDef-driven** (`packingSheetColumns`, ColumnPicker in the board toolbar): Customer, Item, Order, Batch, Boxes, Ordered, Completed, Remaining, Age, **PAL** (the line code, last, hideable). Checkbox, edit-mode inputs and the "+" cell stay fixed outside the picker. **/loading Sheet** (`loadingColumns.v2`): Customer, Design lead; the LOAD code is now a normal last column ("Loading") — its pinned header is gone. **Loadings grid** (`loadingBoxColumns.v2`): "Loading" (code + C n/of chip) last, hideable. **/prod grid** (`productionGroupColumns.v2`): Customer, Design lead; "Production ID" last, hideable. Storage keys bumped so the new default order applies in every browser. The /prod Sheet thead stays hard-coded (edit-mode columns). Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8; manual drive pending | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`SHEET_COLS`, `sheetCols`); [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`loadColumns`, `boxColumns`); [`ProductionTable.tsx`](../client/src/features/stages/ProductionTable.tsx) (`productionColumns`). |

---

## CR-162 · Box Brand on Quote and Sales Order from the Box Brand master (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 162 | **Quote and SO get a Box Brand pick list** (Combobox, DB-sourced from the Brand master exactly like the customer's Default Box Brand): new FK columns `Quote.box_brand` and `SalesOrder.box_brand` → Brand (SET-NULL, created on LIVE 2026-09-14). Picking a customer prefills it from `Customer.box_brand` (transactions-inherit-customer-fields); `/convert-quote` carries the quote's brand onto the SO unless the convert form overrides it. The free-text **Box Branding** input is gone (the varchar column stays read-only for old orders; detail pages show the label, falling back to the legacy text). Downstream the Customer Sheet's brand precedence is now **line override → SO brand → customer default** (`PalPlanLine.soBoxBrandId`). Server + client. | **DEPLOYED LIVE 2026-09-14** (data-ops + client), committed 3e672e8; manual drive pending | [`index.js`](../functions/data-ops/index.js) (quote/SO insert + update, `/convert-quote`); [`QuoteForm.tsx`](../client/src/features/quotes/QuoteForm.tsx), [`OrderForm.tsx`](../client/src/features/orders/OrderForm.tsx); [`quotesApi.ts`](../client/src/features/quotes/quotesApi.ts), [`ordersApi.ts`](../client/src/features/orders/ordersApi.ts); [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) + [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx); [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md). |

---

## CR-163 · Begin Dispatch removed from the palletization plan detail (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 163 | **The legacy plan-level Begin Dispatch / Mark Dispatched / Assign Vehicle buttons are deleted** from `/packing/:id` — loading and dispatch happen per LoadBox on /loading and the plan status follows. Header = Edit + More + ✕ (Edit stays visible on Completed plans, disabled with a reason). The Dispatch tab stays. Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8 | [`PalPlanDetail.tsx`](../client/src/features/stages/PalPlanDetail.tsx). |

---

## CR-164 · SO Details: In Production and Available columns removed (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 164 | **The SO Items table is Design · Size · Finish · Ordered · Palletized.** The In Production drill-down and the design-wide Available figure are gone from this page (they live on the Item master); the two stock fetches the page made only for them are gone too. "N boxes to palletise" in the card header stays. Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8 | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) (Items table). |

---

## CR-165 · SO Palletization tab shows pallets, not the pallet name (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 165 | **SO → Palletization tab = Design · Palletization Date · Pallets · Boxes · Status + a Total row.** Pallets = boxes ÷ the pallet format's `boxes_per_pallet`, fractional to one decimal (30 boxes at 60/pallet reads 0.5; user's pick); "—" when the format is unknown (legacy rows). The PAL column is gone — the plan code + pallet name sit in the row tooltip and the row opens the plan. `PalPlanLine.boxesPerPallet` is read from the Pallet fetch the API already makes. Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8 | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) (`SoPalletisation`); [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (`boxesPerPallet`). |

---

## CR-166 · Dispatch always reachable; blank load details warn, never block (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 166 | **Root cause of "how do I complete the loading?"**: Dispatch was only *added* to the menu once a container no. or line seal existed, so an In Loading container showed no way out. Now **Dispatch is always listed for an Open loading** and greys with the reason from one shared `dispatchGate` (Already dispatched / Assign a vehicle first / Load at least one item first — exactly the server's rule; seals are no longer a gate). Dispatching with blank load details (container no., seals, transporter, LR, destination, supervisor) **warns in the confirm** (`dispatchConfirmMessage` lists what's blank) and `/loading/:id` shows a **standing amber note** naming the still-blank details while the loading is open. Applied in all three menu builders (loading detail header, /loading row menu, Loadings grid menu). Client-only; server unchanged. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8; manual drive pending | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (`dispatchGate`, `missingLoadDetails`, `dispatchConfirmMessage`); [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx); [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`menuFor`, `boxMenuFor`, `dispatchBox`); `.confirm-msg` pre-line in [`styles.css`](../client/src/styles/styles.css). |

---

## CR-167 · Every detail page: a visible Edit button beside More (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 167 | **Detail-page header standard re-affirmed: `Edit` hbtn + `More` menu (+ ✕), on every page, Edit never hidden — disabled with a reason when locked.** Loading detail: the header `+` kebab is replaced by **Edit** (vehicle + load details) + **More** (Add Pallets, Add Items, Dispatch, prints, Delete). Production detail: Edit moves out of the More menu into the header (greyed "Output already recorded" once locked). Plan detail: Edit stays on Completed plans, greyed. Order/Quote/Customer/Item/Pallet/Size/Panel already conformed. Purchase Order detail (`/po/:id`, unrouted from the sidebar) has no edit form — flagged, not built. Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8 | [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx); [`ProductionDetail.tsx`](../client/src/features/stages/ProductionDetail.tsx); [`PalPlanDetail.tsx`](../client/src/features/stages/PalPlanDetail.tsx). |

---

## CR-168 · Grid row actions are one "+" menu everywhere (2026-09-14)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 168 | **The last loose row buttons fold into the "+" menu**: on /packing (kanban card + sheet row) the Ready-for-Loading "Load" button becomes the "+" menu's only item ("Load (n)"), so every stage row has the same trigger. Together with CR-167 the rule is: **grid rows = "+" kebab menu, detail headers = Edit + More.** Client-only. | **DEPLOYED LIVE 2026-09-14**, committed 3e672e8 | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`plusMenuItems`). |

---

## CR-169…176 · Palletization + loading batch (2026-09-14, afternoon)

Filed from one test drive of SO/2026-27/147 → 148. All client-only; no server change.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 169 | **Sheet edit mode gets per-row ✓ / ✗** on the palletization sheets (/packing, /palletizing) and the /loading Sheet: once a row has a draft, ✓ commits that row alone (`commitRow`, the same call the header Save makes) and ✗ discards its draft; the header Edit / Cancel / Save (N) stay for committing every drafted row at once. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`saveRow`), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`saveRow`). |
| 170 | **Ready for Loading leaves In Palletization and lands on /loading.** `/palletizing` renders the Palletizing stage only (no Sections picker); a `ReadyToLoad` line whose whole batch is palletised (`loadableLineIds`) is now the **Ready for Loading** stage on the /loading Sheet (first section, `+ → Load` opens `LoadContainerModal` via `useLoadFlow`), and the New Loading modal (on /loading and the SO) is the other handoff. **Reverses the 2026-09-04 "only boxed lines live on /loading" rule.** Gated slices (batch still open) stay on /palletizing. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`App.tsx`](../client/src/App.tsx) (`/palletizing`), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`STAGES`, `stageOf`, `menuFor`). |
| 171 | **Grand totals below every board grid; the stage band goes.** The palletization Sheet, the /loading Sheet and the Loadings grid end in a `TotalsRow` — "Total · N pallets" (`palletsOf` = Σ ceil(boxes / boxes-per-pallet)) in the first column, Σ boxes under Boxes (Loadings also Σ items). The "In Palletization · 8 items · 2,710 bx" stage band row on the palletization sheets is removed (each page is one stage); Group bands keep their per-group counts. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (`palletsOf`), `DispatchBoard.tsx`, `LoadingBay.tsx`. |
| 172 | **/loading Workspace view hidden** (button removed; a persisted "workspace" view opens the Sheet). `LoadingWorkspace.tsx` and its branch are kept, like the disabled Kanban. Three views remain: Sheet, Loadings, Customer Sheet. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`viewBtn`, view normaliser). |
| 173 | **/loading Sheet Edit mode** (same shape as the palletization sheet's): per Open-box line a **Loaded** qty (fewer than the line holds → the rest returns to Ready for Loading) and a **Container** Combobox (any Open loading, or **Unload**); Ready / Dispatched rows show —. Pure resolver `resolveLoadSheetEdit` + self-check; commits through the existing `/pal-line-box` (move between Open boxes, partial split, "" = unload). | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`loadSheetEdit.ts`](../client/src/features/stages/loadSheetEdit.ts), [`loadSheetEdit.test.ts`](../client/src/features/stages/loadSheetEdit.test.ts), `LoadingBay.tsx`. |
| 174 | **Loadings grid Customers/Orders never blank**: per-field fallback loaded lines → plan JSON (via the SO's pal lines, else live order heads from `useOrders`, no longer the cold `cachedOrders()` read), so a loading whose lines can't name a customer still shows the planned one, like `/loading/:id` already did. Reported on LOAD/2026-27/001 (SO/2026-27/148); every SO/customer involved resolves in the DB, so the blank was the cold-cache path. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx) (`boxRows`, `planSummary`). |
| 175 | **New Loading from the Sales Order**: header More → **New Loading** and a sibling Items-card button beside Send to Loading (same gate: past approval + stages edit) open `NewLoadingModal` with `presetSalesOrderId` (SO/customer pickers hidden, SO number · customer under the title; "No palletised stock ready" when nothing is loadable). Lands on the new `/loading/:id`. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx), [`NewLoadingModal.tsx`](../client/src/features/stages/NewLoadingModal.tsx). |
| 176 | **"Partial" is per row now.** Bug report: SO/2026-27/147 — "540 all completed, still Partial, not in the loading bay". DB: 480 + 50 `ReadyToLoad`, **2 + 8 still `Palletizing`** (remainders of two partial records) → 530 / 10 and both batches gated — counters and gate were right, but every row of a partially palletised item wore the same "Partial" chip. Now a recorded slice held by the batch gate reads **Recorded** (p-ready, "waiting for the rest of this batch") and only the unrecorded rows read **Partial** ("Complete Palletisation records it") — the rule PalPlanDetail's Status column already used. The 2 and 8 still need Complete Palletisation (or the sheet ✓) by the user. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`SHEET_COLS` batch cell). |

---

## CR-177…182 · SO tabs, totals bar, rail order, batch on SO Palletization, Box Brand image (2026-09-14, evening)

Filed from the second drive of SO/2026-27/147 → 148. Client-only except CR-181 (one LIVE column, no server code).

| CR | Change | Status | Evidence |
|---|---|---|---|
| 177 | **SO Production tab drops the Remaining column** (Requested and Produced stay) — sibling of CR-164's column trims on the same page. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) (`SoProduction`). |
| 178 | **Totals bar on /packing and /palletizing.** The bar under the grid no longer says "Tick items to palletise or load several together"; idle it reads **Total · N pallets · N boxes** for what is on screen, in Kanban and Sheet alike, and is shown to every viewer (selection still needs stages-edit). The Sheet's tfoot Total row from CR-171 is removed on these two pages (one place for totals); /loading keeps its footers. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`pal-selbar`). |
| 179 | **Palletization + loading rails: customer · status above, code below.** The shared `DetailRail` renders the dim subtitle first and the mono PAL/LOAD code second; tooltip unchanged. Only its two consumers (`/packing/:id`, `/loading/:id`) change — Order/Quote/Production rails keep code-first. | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`DetailRail.tsx`](../client/src/features/common/DetailRail.tsx). |
| 180 | **SO Palletization tab shows the batch**: a Batch column (mono chip, same as the Production tab) after Design, from `PalletizationPlanLine.batch_number` (legacy PalletisedBatch rows show theirs). | **DEPLOYED LIVE 2026-09-14** (client-only), committed c1d6400 | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) (`SoPalletisation`, `SoPalRow.batch`). |
| 181 | **Box Brand image.** New LIVE column `Brand.logo` varchar(255) (column 69851000000278304) holding a File Store file id in the existing `design_images` folder — no base64 in the DB, no server change (generic master CRUD + the public `design-image` route). The Box Brand master form gets an **Image** field (`ImageUploader`, one image; removing it and saving clears the column via `null`), the master table shows a thumbnail. The shared `Combobox` gained `ComboOption.icon` (20 px thumbnail before the label in the popup), and the Quote, Sales Order and Customer (Default Box Brand) forms use one `useBoxBrands()` hook — options with logos plus a 40 px preview beside the field. The Customer form's native `<select>` became a Combobox (form-ux-standard). Customer Sheet per-line override stays text-only (user's pick). | **DEPLOYED LIVE 2026-09-14** (LIVE column + client), committed c1d6400 | [`Masters.tsx`](../client/src/features/masters/Masters.tsx), [`mastersApi.ts`](../client/src/features/masters/mastersApi.ts) (`NULLABLE`), [`boxBrands.tsx`](../client/src/features/masters/boxBrands.tsx), [`Combobox.tsx`](../client/src/ui/Combobox.tsx), [`QuoteForm.tsx`](../client/src/features/quotes/QuoteForm.tsx), [`OrderForm.tsx`](../client/src/features/orders/OrderForm.tsx), [`PartyForm.tsx`](../client/src/features/masters/PartyForm.tsx), [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md). |
| 182 | **SO Palletization tab: Completed / Remaining boxes** (per row or on the Total row). Asked, then **held by the user the same day** ("hold this for now"). When resumed: `oiProgressOf(...)` per `orderItemId` (the CR-157 map), needs `orderItemId` on `SoPalRow`. | Open — held 2026-09-14 | — |

---

## CR-183…186 · Loading Sheet: design name on prints, manual Pallet No., free-text vehicle, sheet look (2026-09-14, night)

Filed from the user's drive of the **Loading Sheet** tab on `/loading/:id` (three asks + two screenshots). Client-only except CR-184's one LIVE column (no server code).

| CR | Change | Status | Evidence |
|---|---|---|---|
| 183 | **Design name only on the print/dispatch sheets.** The item cell of the Dispatch Entry (post-dispatch print), the Dispatch Copy PDF and the pallet QR label showed `Design.unique_name` ("Design - Size - Finish[ - Brand]") plus the PAL/FY/NNN-n code (and the QR label appended the size a second time). Now they print `PalPlanLine.designName` (= `Design.design_name`) alone; the PAL code line/column is gone, the Dispatch Copy keeps its dim Batch sub-line (it has no Batch column). The Loading Sheet's own Design cell prints the design name too — it already has Size and Finish columns. Untouched: `/loading` grid, Loaded Items table, the QR share page, packing report / pallet slip. | **DEPLOYED LIVE 2026-09-14** (client-only), committed db60015 | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) (`designName`), [`dispatchCopyPdf.ts`](../client/src/features/stages/dispatchCopyPdf.ts), [`DispatchEntryOverlay.tsx`](../client/src/features/stages/DispatchEntryOverlay.tsx), [`palletQrPdf.ts`](../client/src/features/stages/palletQrPdf.ts), [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx). |
| 184 | **Manual Pallet No. on the Loading Sheet.** New LIVE column `PalletizationPlanLine.pallet_no` varchar(60) (column 69851000000277499); written through the generic line PATCH like `box_brand`. The sheet's Pallet No. cell is a typable input (placeholder = the auto range "1 TO 16"); a typed value wins, blank = auto (grey). Pure rule `palletNumbers()` beside `palletRanges()`; the Dispatch Entry and Dispatch Copy "Pallet No." columns print the same value (the Copy showed the pallet *format* name before). Not carried through `/pal-line-box` partial splits (remainder returns to Ready), same as `box_brand`. | **DEPLOYED LIVE 2026-09-14** (LIVE column + client), committed db60015 | [`customerSheetEdit.ts`](../client/src/features/stages/customerSheetEdit.ts) (+ test), [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx), [`DATASTORE-SCHEMA.md`](../DATASTORE-SCHEMA.md). |
| 185 | **Vehicle is free text everywhere on loading — the master is maintained silently.** Assign Vehicle / Edit Load Details lost the Vehicle Combobox + inline "New vehicle" form: three plain inputs (Vehicle Number auto-formatted, Driver Name, Mobile — none required), prefilled from the box. The Loading Sheet's Truck No. `<select>` became a typable cell. One resolver, `resolveVehicle()` in `vehiclesApi.ts`: match by formatted number on a fresh list → update driver/mobile if typed and different (LoadBox displays come from the master join) → else create; `LoadContainerModal.draftToCreateInput` (Load / Send to Loading / Add Items) routes through it too. `LoadBox.vehicle` stays an FK, so reports, the QR share page and the dispatch gate are untouched. Vehicle master remains a reference list under Settings. Hidden Workspace view left as-is. | **DEPLOYED LIVE 2026-09-14** (client-only), committed db60015 | [`vehiclesApi.ts`](../client/src/features/masters/vehiclesApi.ts) (`resolveVehicle`), [`VehicleLoadModal.tsx`](../client/src/features/stages/VehicleLoadModal.tsx), [`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx), [`SendToLoadingModal.tsx`](../client/src/features/stages/SendToLoadingModal.tsx), [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx), [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx). |
| 186 | **Loading Sheet look: house grid, "Pallet type".** The sheet dropped its one-off `tbl ruled` variant (full black cell borders, square grid — the only user) for the standard `.tbl` look inside the rounded card; the orphaned CSS is deleted. Header "Pallet 1" → **"Pallet type"** ("Pallet 2" unchanged — not asked). | **DEPLOYED LIVE 2026-09-14** (client-only), committed db60015 | [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx), [`styles.css`](../client/src/styles/styles.css). |

---

## CR-187…189 · Sheet totals aligned to columns · Container merging · Single-image tile (2026-09-14, night)

CR-187 filed from the user's read of the /packing Sheet's "Total · 119 pallets · 3,936 boxes" bar; CR-188 from "I might see that specific items are going into a single container — I want an option to move qty from one container to another from planning."; CR-189 from "the image upload is not decent — make it look better, only single image." All client-only.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 189 | **Single-image upload tile.** `ImageUploader` (only user: the Box Brand master's Image field, CR-181) dropped the bare native `<input type="file">` + "0/1" counter for a 120 px tile: empty = dashed click-or-drop target with an upload icon, filled = cover preview with **Replace** / **Remove** buttons and the file name beside it; drag-over highlights with the accent ring. The component is single-image by contract now (`value: DesignImage | null`) — the `max`/multi-file surface is gone. Multi-image `ImageManager` on Item/Panel detail untouched. | Built 2026-09-14, deploy pending | [`ImageUploader.tsx`](../client/src/ui/ImageUploader.tsx), [`Masters.tsx`](../client/src/features/masters/Masters.tsx). |
| 188 | **Container merging in Plan Containerisation — move boxes between containers, persistently.** Every item inside the selected container gets a **⇄ Move** button (Inside C*n* panel) opening the move prompt with a target-container pick list ("C3 · can take 240 boxes") and a quantity (defaults to the most that fits — one click merges the whole part-load); drag-a-card and the Adjust panel's "Move here" suggestions route through the same action. A move is now a **row operation**: the moved boxes become their own row sharing a `group` with the target container's rows, and `packItemWise` packs grouped rows into ONE container (fractional fill; a grouped qty beyond the free space spills item-wise). A saved multi-line container reseeds as grouped rows (`planRowGroups`), so the merge survives Save + reopen on the SO, Quote and Loading-tab planners — previously moves were session-only and reopening re-packed them away. No schema change: the plan JSON already expresses mixed containers. The old position-based `moves` layer is deleted; a mode switch no longer resets moves. | **DEPLOYED LIVE 2026-09-14** (client-only), committed db60015 | [`containerPack.ts`](../client/src/features/quotes/containerPack.ts) (`group`, + test), [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx) (`moveBoxes`, `openMove`, `planRowGroups`). |
| 187 | **/packing + /palletizing Sheet: totals under their own columns.** The Sheet gets a `TotalsRow` tfoot (same shape as /loading's CR-171 footer): "Total · N pallets" in the first visible column, then the Boxes / Ordered / Completed / Remaining sums right-aligned under their headers (Ordered/Completed deduped per order item). Hidden or reordered columns carry their total with them; edit mode's three extra cells are padded. The CR-178 bar under the grid stays for selection and still reads *Total · N pallets · N boxes* in **Kanban** (no columns there); on the Sheet it is blank until rows are ticked — partially reverses CR-178's "one place for totals". | Built 2026-09-14, deploy pending | [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx) (`TotalsRow`, `totalOrdered`). |

---

## CR-190…191 · Weight on the Item form · Item form regroup (2026-09-15)

Filed from the New Item modal screenshot: "Add weight options in the item as well… even though calculated through pallet, user can edit. Move the status to below section. Add Weight in the dimension section." Client-only — no schema, no server code (the CR-133 fan-out guard already keeps a manual Item weight).

| CR | Change | Status | Evidence |
|---|---|---|---|
| 190 | **Weight group on the Item.** Dimensions & Coverage gains **Box Weight (kg)** — typable, the picked Size's weight is the prefill/placeholder, a typed value is the item's own (survives Size edits per CR-133) — plus two ƒx fields **Weight / piece** (box ÷ pcs/box) and **Weight / m²** (box ÷ coverage m²), blank while any input is 0. Footer carries the ƒx legend like Size/Pallet. Item detail Overview shows a **Box weight** row (`28.8 kg · 14.4 kg/pc · 20 kg/m²`). **Precedence flip:** Plan Containerisation (Weight Fitting) now reads the Item's weight first and the Pallet format's only as fallback — the same order the server loading-capacity check already used, so the two no longer disagree. | **DEPLOYED LIVE 2026-09-15** (client-only), committed db60015 | [`DesignForm.tsx:99-110`](../client/src/features/masters/DesignForm.tsx#L99-L110) sections, [`:222`](../client/src/features/masters/DesignForm.tsx#L222) `computeWeights`, [`:378`](../client/src/features/masters/DesignForm.tsx#L378) ƒx branch, [`:452`](../client/src/features/masters/DesignForm.tsx#L452) size-default input; [`PlanContainerisation.tsx:282`](../client/src/features/quotes/PlanContainerisation.tsx#L282); [`ItemDetail.tsx:545`](../client/src/features/masters/ItemDetail.tsx#L545) |
| 191 | **Item form regroup.** Status leaves Classification; Rates & Stock is gone. Sections read Identity → Classification (Size, Finish, Category, Glaze, Brand, Grade) → **Dimensions & Coverage** (Width, Length, Rate / ft², Rate / m², Box Weight, Weight / piece, Weight / m²) → **Misc** (Random Faces, Status read-only, Batch-tracked item, Opening Stock on edit only). Numeric inputs on this form switched to the house `NumberInput` (the last raw `type=number` holdout). | **DEPLOYED LIVE 2026-09-15** (client-only), committed db60015 | [`DesignForm.tsx:68-118`](../client/src/features/masters/DesignForm.tsx#L68-L118) `SECTIONS` |

---

## CR-192…193 · Panel images at every sales touchpoint · several panels per sale (2026-09-15)

Filed from: "Sales person must be able to see the panel images that are present in the showcase (C01-F11-S01-1). When the sales person searches the panel they can see the panel as well — refer some e-commerce style item display." and "currently I am able to add only one item when doing panel sales to customer." Client-only — `Panel.image_urls` and the public image endpoint already existed; `listPanels()` already returned `images`; PanelOrder rows stay one-panel-each.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 192 | **Panel images wherever a rep meets a panel.** The New Panel Order picker is now an **e-commerce tile grid** (front-view image on top, code, sizes, designs; selected tile = accent ring; same search box). After picking, the form shows a 35 px thumb beside the trigger plus a **Panel** section with every image at 110 px — click any to open the lightbox (‹ › across all). Front-view thumbs also on the Panel Orders **board cards + Sheet** Panel cell, a new first **Image** column on `/panels` (column picker aware; users with a saved order see it appended last), and on both Showcase Panels tables (Item detail Panels tab, Customer detail). Every thumb zooms without triggering the row/card click; a panel with no image shows a dashed placeholder of the same size. Mechanism: the lightbox was **extracted from `ImageManager`** into shared `ImageLightbox` + `ImageThumb`; Item/Panel detail keep using it through the manager. No thumbnail resizing — full images, `loading="lazy"`, the endpoint's 1-day cache. | **DEPLOYED LIVE 2026-09-15** (client-only), committed db60015; browser drive pending | [`ImageLightbox.tsx`](../client/src/features/common/ImageLightbox.tsx); [`PanelPickerModal.tsx`](../client/src/features/panels/PanelPickerModal.tsx) tiles + `.panel-card` in [`styles.css`](../client/src/styles/styles.css); [`PanelOrderForm.tsx`](../client/src/features/panels/PanelOrderForm.tsx) Panel section; [`PanelOrders.tsx`](../client/src/features/panels/PanelOrders.tsx), [`Panels.tsx`](../client/src/features/panels/Panels.tsx), [`PanelsPanel.tsx`](../client/src/features/panels/PanelsPanel.tsx) |
| 193 | **Several panels in one panel sale.** The picker tiles are **multi-select** (click toggles, ✓ on the tile, "N panels selected" + Done in the footer). The form's Panel field becomes **Panels**; a **Panels** section lists each pick with its thumb (zoom), code, sizes/designs, its own **Qty** and a remove ✕. The Cut Piece Stock Check now aggregates need per (design, cut size) across every picked panel. **Save creates one PanelOrder row per panel** (same customer, date, sales person), written sequentially; partial failure reports "n of m saved". No schema change — the rows stay independent so each panel still dispatches on its own against stock. Chosen over a header + lines model (user, 2026-09-15); a shared sale reference column is the next step if the sale must be seen as one unit. | **DEPLOYED LIVE 2026-09-15** (client-only), committed db60015; browser drive pending | [`PanelPickerModal.tsx`](../client/src/features/panels/PanelPickerModal.tsx) `selectedIds`/`onToggle`; [`PanelOrderForm.tsx`](../client/src/features/panels/PanelOrderForm.tsx) `picks`, aggregated `preview`; [`PanelOrders.tsx`](../client/src/features/panels/PanelOrders.tsx) `onCreate(inputs[])` |

---

## CR-194…200 · Production first, then SO allocation · container override · customer-wide loading (2026-09-18)

Filed from: "Production Record first, then SO allocation — remove Record Production from the SO. Box Brand and Batch recorded at production time; redesign the production record screen, order-independent only. Manual override for a 100%-full container; multi-design mix-up in loading. Loading for multiple SOs of a single customer: select the customer, see all the design orders, initiate the loading — same container, same truck." Decisions (user, 2026-09-18): allocation is an action **on the SO**; SO confirm **stops** creating production jobs and a derived status says what to produce; Box Brand is **one per item section**; the override covers **loading and the planner**; Box Brand is **shared automatically from the orders' status** (mid-build addition).

| CR | Change | Status | Evidence |
|---|---|---|---|
| 194 | **Customer-wide New Loading.** Customer is the required subject; Sales Order is an optional "All orders" filter. Every Ready-for-Loading line of the customer shows, one band per SO (band tick = whole order), and any mix of orders/designs goes into ONE container — each `load_plan` line carries its own SO. Plan propagation survives when exactly one SO is in scope. An advisory "% of a container" reads red past 100. Server untouched — LoadBox, `/pal-lines-box`, dispatch, PDFs and the Customer Sheet were already cross-SO. | **DEPLOYED LIVE 2026-09-18**, committed db60015; browser drive pending | [`NewLoadingModal.tsx`](../client/src/features/stages/NewLoadingModal.tsx) `hasScope`, `planSoId`, SO bands, `pickedFill` |
| 195 | **Load past 100%.** "Override — load beyond 100%" tick in the Load Container modal lifts the greedy fit clamp (the only fullness wall in the loading path; the server never checked). Red "~N% — loading anyway" note. | **DEPLOYED LIVE 2026-09-18**, committed db60015 | [`LoadContainerModal.tsx`](../client/src/features/stages/LoadContainerModal.tsx) `override` |
| 196 | **Plan past 100%.** A ⇄ Move / drag into a container with no room no longer refuses: the prompt opens with "Override — fill beyond 100%" pre-ticked. The flag is **group-level** (`over` on every row of the target group — packing is line-ordered, a row flag would spill the owner), persisted as `over` on the plan container (a rounded `fillPct` would lose 100.4%) and reseeded on reopen. `fillPct` is no longer clamped; cards show the real % in red + "Override". | **DEPLOYED LIVE 2026-09-18**, committed db60015; `containerPack.test.ts` passes | [`containerPack.ts`](../client/src/features/quotes/containerPack.ts) `over`; [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx) `openMove`, `moveBoxes`, `planRowGroups`; [`data.ts`](../client/src/data.ts) `ContainerPlanContainer.over` |
| 197 | **Production is order-independent; Box Brand captured at production.** Record New Production lost its "Against Order" mode and (user redesign, same day) became the **one-step recording**: lines first — Item · Batch No. · Box Brand · Qty — with Note / Recorded by / Production date below; Save = create job + record output (`recordNewProduction`), `presetLines` prefill. Record Output gains one **Box Brand** pick per item section, stored on each record row (`ProductionLog.box_brand`, **new column**); shown on the production detail; optional "Box Brand" column in the Excel import (unknown name = row error). | **DEPLOYED LIVE 2026-09-18** (`box_brand` column created same day), committed db60015 | [`ProductionForm.tsx`](../client/src/features/stages/ProductionForm.tsx); [`RecordOutputForm.tsx`](../client/src/features/stages/RecordOutputForm.tsx) `brandById`; server `brandOrNull`, `/production-record`, `/production-record-lines` |
| 198 | **SO confirm no longer creates production jobs; "Record New Production" removed from the SO.** `enqueueSoProduction` early-returns (body + call sites kept for rollback). Existing open `so-…` jobs keep recording order-linked. | **DEPLOYED LIVE 2026-09-18**, committed db60015 | server `enqueueSoProduction`; [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) |
| 199 | **Allocate Stock on the SO.** More ▸ Allocate Stock: per order line, the item's batches with **free** boxes (oldest first, carton brand shown, amber when it differs from the SO's), qty per batch, "Auto — oldest first". An allocation is an `entry_type="alloc"` ProductionLog row — a **claim, never supply** — that bumps `produced_qty_boxes` and feeds Ready for Palletization through the unchanged `autoEnqueuePalletization`. Free = on hand − boxes order lines own but have not loaded (`reservedByBatch`/`freeOf`). De-allocate ✕ on the SO Production tab (409 once palletised; trims auto Planning cards; a manual card blocks). Cancelling an SO releases its allocations. Deleting stock output that orders hold is refused. `/send-to-loading` now caps at min(ordered, produced) − palletized. The produced Box Brand rides onto the plan line. | **DEPLOYED LIVE 2026-09-18**, committed db60015; `batchStockDerive.check.ts` + `stock.invariant.check.ts` pass | server `/allocate-stock`, `/deallocate-stock/:rowid`, `serverFreeStock`, `deallocateCore`, `unqueuedBatches`; [`AllocateStockModal.tsx`](../client/src/features/orders/AllocateStockModal.tsx); [`batchStockDerive.ts`](../client/src/features/stages/batchStockDerive.ts); [`stock.ts`](../client/src/lib/stock.ts) `allocated`, `free` |
| 200 | **Need production / Stock ready.** Derived, no column: each open order line reads Allocated / Stock ready / Partial stock — N short / In production / Need production — N short, sharing an item's free stock first-come by SO. SO Items card gets Allocated + Supply columns; the SO header reads by supply until work starts. `/prod` gains a **To Produce** view (open demand, free stock, in production, need production, and the **Box Brand the waiting orders want**) → tick rows → Record New Production prefilled. Record Output **prefills Box Brand** from the SO (order-linked) or the brand most in demand for that item. | **DEPLOYED LIVE 2026-09-18**, committed db60015; `needProduction.check.ts` passes | [`needProduction.ts`](../client/src/lib/needProduction.ts); [`ToProduce.tsx`](../client/src/features/stages/ToProduce.tsx); [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) `supplyById` |

Deviations from the approved plan, on purpose: the SO's ProductionForm mount/handler were **removed**, not kept hidden (the form no longer has an SO mode — a kept mount would silently produce to stock); `/production-complete` and `/opening-stock` do **not** take a Box Brand yet (no form sends one); the planner override is a **tick in the move prompt**, matching CR-195, instead of a confirm dialog.

## CR-201…202 · New Loading — customer rail, one pick list, batch pick (2026-09-18)

Filed from: "Current UX is confusing. 5.1 Allow all orders and design to be selected. 5.2 Multi Design – same container – same truck." Flow as the user described it: pick the customer from a left panel → right side shows their orders with designs, Box Brand, qty → add qty → select batch for each → Save → Assign Vehicle adds container + vehicle details. "Utilise the container planning if needed, but not fix it to that only." One customer per container.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 201 | **Customer rail + one pick list.** New Loading is a two-pane modal (Settings rail skin): customers with Ready-for-Loading stock on the left (badge = boxes loadable now, single-select — one customer per container), every order of theirs on the right as SO bands → design rows (Design · Box Brand · Batch · Ready · Load). The Customer/Sales Order comboboxes, the **Container Size** field (now captured in Assign Vehicle) and the separate plan-view/flat-view split are gone — one list, one state (`qty` per line). Partly palletised batches no longer vanish: they list greyed with "N/M palletised — not loadable yet". Buttons Cancel / Save. | **DEPLOYED LIVE 2026-09-18** (client-only), committed db60015 | [`NewLoadingModal.tsx`](../client/src/features/stages/NewLoadingModal.tsx), [`newLoadingRows.ts`](../client/src/features/stages/newLoadingRows.ts) + self-check |
| 202 | **Batch pick; plan is a helper.** A design with several batches gets a design-level Load qty that spreads FIFO over its batch sub-rows (`spreadQty` → `allocateFifo`); each batch qty stays editable, so the user chooses the batches. Several designs / orders of the customer mix freely into the ONE container (= one truck). The SO's containerisation plan no longer drives the screen: a per-SO **Fill from plan** button prefills the next unsent container's quantities, and designs outside the plan stay loadable. `load_plan` lines always carry the batch. No multi-container truck grouping (`load_plan.group` still unwritten). | **DEPLOYED LIVE 2026-09-18** (client-only), committed db60015 | same files; `containerPlanPrefill.nextPlanContainer` reused |

## CR-203 · Loading Session — full-page three-step loading (2026-09-18)

Filed from: the user's "Container Loading Screen" design canvas (https://claude.ai/artifact/NWTsaYz35PWSsXGN8Bfpo9 — 1 Select items · 2 Vehicle & loading · 3 Seals & vehicle sheet): "redesign the loading … this is not single modal but entire new page". Locked: canvas layout, Boffo skin; existing fields only (no scan, licence, booking/CRO, stuffing point, gate-in, tare, seal photos); replace the modal everywhere.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 203 | **New Loading is a page, not a modal.** `/loading/new` (and `?so=` from the SO detail) → step 1 pick list (CR-201/202 unchanged, now with a customer header, container-fill meter and a lines · boxes · pallets footer) → Save mints the LoadBox and moves to `/loading/:id/session?step=2` (vehicle + load details, the container's lines and fill bar alongside) → step 3, the editable Loading Sheet fixed to that customer's open containers with a checks card and a **warn-only duplicate container-no. / seal check**. Add Pallets on the loading detail opens step 1 of the same page. One field set (`LoadDetailsFields`) now serves both the page and the Assign Vehicle modal. Client-only, zero server change. `NewLoadingModal.tsx` deleted. | **DEPLOYED LIVE 2026-09-18** (client-only), browser drive + committed db60015; `tsc` + `npm run build` clean, `sealChecks` / `newLoadingRows` / `customerSheetEdit` self-checks pass | [`LoadingSession.tsx`](../client/src/features/stages/LoadingSession.tsx), [`SessionItemsStep.tsx`](../client/src/features/stages/SessionItemsStep.tsx), [`LoadDetailsFields.tsx`](../client/src/features/stages/LoadDetailsFields.tsx), [`sealChecks.ts`](../client/src/features/stages/sealChecks.ts) + self-check; routes in [`App.tsx`](../client/src/App.tsx) |

## CR-204 · New Loading step 1 — search, full height, per-panel scroll (2026-09-19)

Filed from: the user's screenshot of `/loading/new` — "2 batches remove from the row, move bottom rows up · no empty space at bottom · customer search in the left panel · design search in the design panel · individual scrolls".

| CR | Change | Status | Evidence |
|---|---|---|---|
| 204 | **Step 1 tidy-up.** The "N batches" summary row (and its design-level Load box) is gone — one row per batch, the first carrying Design + Box Brand. Customer search in the rail, design search (design name or SO number) in the pane; search only narrows what is shown, typed quantities on hidden rows still count and save. Rail + pane fill the viewport down to the sticky footer and scroll independently; the page itself no longer scrolls (stacked mobile layout keeps page scroll). Client-only. | **DEPLOYED LIVE 2026-09-19** (client-only), browser look + committed db60015; `tsc` clean, `newLoadingRows` self-check passes | [`SessionItemsStep.tsx`](../client/src/features/stages/SessionItemsStep.tsx), `.session-fill` in [`styles.css`](../client/src/styles/styles.css) |

## CR-205…207 · Security review fixes (2026-09-19)

Filed from: the `/security-review` of `feature/master-order-forms` — three validated findings, "fix these one by one, make no mistakes". Server-only; no screen changes.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 205 | **Image upload is raster-only, and the public image route cannot run script.** `/upload/design-image` judges the file by its magic bytes (JPG, PNG, GIF, WebP, BMP, AVIF) — the client-sent name and type are not trusted; an SVG/HTML payload is refused with a 400, and the stored extension is corrected to match the bytes. `/public/design-image/:fileId` now answers with `nosniff` and a sandboxing CSP, so an SVG stored before this change still renders inside `<img>` but runs no script when opened as a page on the app origin. | **Done — NOT deployed**; `node --test functions/data-ops/lib/*.test.js` passes (11) | [`lib/sniffImage.js`](../functions/data-ops/lib/sniffImage.js) + test, `index.js:588` (headers), `index.js:821` (allowlist) |
| 206 | **Permission lookup ignores path case.** Express matches routes case-insensitively, the guard looked the first path segment up exact-case — `/DISPATCH/1` missed `ROUTE_PERM`, fell to the legacy `can_update` rule and still reached the handler. The lookup is now lower-cased. Table names stay exact-case (`assertTable` rejects any other spelling). | **Done — NOT deployed** | `lib/appauth.js:316` |
| 207 | **No state on a generic insert.** The generic `POST /:table` now refuses Quote and SalesOrder outright (they are born through `/quote-with-items`, `/so-with-items`, `/convert-quote`, where born status follows `canApprove`), and the status columns the generic PATCH already protected are protected on insert too — one shared list, `STATE_COLUMNS`, for both verbs. The only state an insert may carry is a Panel Order's initial `Received`. | **Done — NOT deployed**; guard self-check run | `index.js:5383` (`STATE_COLUMNS`, `assertNoStateWrite`), `index.js:5410` |

Not fixed here (review findings below the reporting bar, still worth a CR): raw `:rowid` in ZCQL on 14 business routes (`rowidParam` exists, those routes skip it); mutating routes missing from `ROUTE_PERM` (`update-so-with-items`, `production-*`, `allocate-stock`, …) and generic writes to `OperationLog` / `AppSetting`; the session token copy in `localStorage`.

---


## CR-208 · Loading Sheet — Design first, typed Pallet type, Pallet 2 gone, Box Brand auto (2026-09-19)

Filed from: the user's screenshot of the Loading Sheet tab — "remove Pallet type 2 · Pallet type is a text input, user enters manually · Design name first · Box Brand auto from the Sales Order / quote / production recording".

| CR | Change | Status | Evidence |
|---|---|---|---|
| 208 | **Loading Sheet columns.** Line columns now read Design, Size, Finish, Batch, Box Brand, Pallet No., Boxes, Pallet type. **Pallet 2 is gone**; **Pallet type is typed** (new `PalletizationPlanLine.pallet_type`, blank stays blank — the Pallet master arrangement is no longer shown). **Box Brand is read-only**: production record's brand on the line → the order's (inherited from the quote) → the customer default; the per-line dropdown is removed, existing overrides keep displaying. Client-only + one LIVE column. | **Built 2026-09-19, NOT deployed**; LIVE column created (69851000000293012); `tsc` + `npm run build` clean, `customerSheetEdit` self-check passes; browser look pending | [`LoadingCustomerSheet.tsx`](../client/src/features/stages/LoadingCustomerSheet.tsx), [`customerSheetEdit.ts`](../client/src/features/stages/customerSheetEdit.ts) + self-check, [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts) |

## CR-209…218 · Walkthrough fixes — numbering, blockers, stale caches, polish (2026-09-19)

Filed from: [`docs/plans/walkthrough-fixes-2026-09-19.md`](plans/walkthrough-fixes-2026-09-19.md) (live end-to-end drive). Decisions by the user: renumber the 16 duplicate loadings by created time · blank batch = auto-number · rate is per box, label only · spelling Palletization · pallets match full size · SO actions follow the order's real state.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 209 | **Loading + batch numbers — ZCQL wildcard.** `nextLoadNumber` and `nextBatchNumber` scanned with `LIKE 'prefix%'`; ZCQL's wildcard is `*`, so the scan matched nothing and every loading minted `LOAD/FY/001` (16 LIVE rows) and every blank batch would mint `…/001`. Both now use `*`; `batchSeriesSettings.clean` strips `*` too. New admin-only one-off **`POST /renumber-loads`**: any `LOAD/FY/` series holding duplicates is renumbered by CREATEDTIME (oldest = 001), idempotent, OperationLog'd. Verified read-only on LIVE: `LIKE 'LOAD/2026-27/*'` returns the 16 rows. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done; `/renumber-loads` run once — 16 loadings now 001…016 | [`index.js`](../functions/data-ops/index.js) `nextLoadNumber`, `nextBatchNumber`, `/renumber-loads` |
| 210 | **Quote — visible Convert.** Accepted / PartiallyConverted quotes show a primary **Convert to Sales Order** header button (More entry kept). `changeStatus` ignores a second click while busy (no more 409 "Sent to Sent"). | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`QuoteDetail.tsx`](../client/src/features/quotes/QuoteDetail.tsx) |
| 211 | **Blank batch = auto-number.** Record New Production and Record Output no longer require a Batch No. on batched items — blank lets the server mint `B/YYYY-MM/NNN` (needs CR-209). Duplicate checks stay. Opening stock still requires the real batch. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`ProductionForm.tsx`](../client/src/features/stages/ProductionForm.tsx), [`RecordOutputForm.tsx`](../client/src/features/stages/RecordOutputForm.tsx) |
| 212 | **SO actions follow the order's state.** Send to Palletization / Send to Loading are greyed **with the reason** ("Allocate stock to this order first" / "Nothing left to palletize"); Send to Loading now gates on produced-and-unpalletized boxes (what the server accepts). New Loading greys with "Nothing ready for loading" when `groupReady` finds 0 boxes for the SO. A visible **Allocate Stock** button appears on the Items card while the chip reads "Stock ready — allocate". **Mark as Sent** shows only before any work has started. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) |
| 213 | **Orders cache stays true after pal/loading mutations.** `palPlansApi.bust` now also invalidates the orders cache (10 of its 14 routes recount OrderItems — SO chip read "In Loading" after Dispatch until reload). `useOrders` refetches when the cache is invalidated, so mounted screens repaint. `createListCache` gained a generation guard: a fetch started before `invalidate()` can no longer repopulate the cache with pre-mutation data. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts), [`useOrders.ts`](../client/src/features/orders/useOrders.ts), [`cache.ts`](../client/src/lib/cache.ts) |
| 214 | **Loading detail — Order(s) / Customer never blank.** The Details card resolves through the new shared `soHeadOf` (pal-plan line's own joined SO number + customer → orders cache), the same CR-174 order the Loadings grid uses; `LoadingBay.planSummary` now calls the same helper. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`LoadingDetail.tsx`](../client/src/features/stages/LoadingDetail.tsx), [`LoadingBay.tsx`](../client/src/features/stages/LoadingBay.tsx), `soHeadOf` in `palPlansApi.ts` |
| 215 | **To Produce — brand name from the orders join.** `demandByDesign` carries `boxBrandLabel`; the view no longer depends on its own (retry-less) Brand fetch, which read a branded order as "No brand". "No brand" now means the order really has none. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`needProduction.ts`](../client/src/lib/needProduction.ts) + check, [`ToProduce.tsx`](../client/src/features/stages/ToProduce.tsx) |
| 216 | **To Produce toggle is labelled** on /prod (Grid/Sheet/Kanban keep the app-wide standard icons). | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`ProductionTable.tsx`](../client/src/features/stages/ProductionTable.tsx) |
| 217 | **Pallet pick lists match the full size.** Shared `palletsForSize` (moved to pure `palletSize.ts`) matches `WxH` (600x1200 ≠ 600x600); width fallback only when a side has no height; size-less pallets always match. OrderForm and PalletPackForm dropped their private width-only copies; OrderForm keeps an already-saved pallet selectable. Container planner: own size → same WxH → width fallback only when the size has no pallet at all. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | [`palletSize.ts`](../client/src/features/masters/palletSize.ts) + `palletSize.check.ts`, [`OrderForm.tsx`](../client/src/features/orders/OrderForm.tsx), [`PalletPackForm.tsx`](../client/src/features/stages/PalletPackForm.tsx), [`PlanContainerisation.tsx`](../client/src/features/quotes/PlanContainerisation.tsx) |
| 218 | **Walkthrough polish.** Quote/SO line headers read `Qty (boxes)` / `Rate / box` (label only — rate is per box). SO Details card adds Payment Term, Currency, Total Boxes, Net Total. Quote detail drops Port of Discharge (field left the form 2026-07-13). Item form: Rate / m² ↔ Rate / ft² fill each other. All user-visible copy spells **Palletization / palletized** (identifiers, routes, storage keys untouched; `BatchStage` value is now `"Palletized"`). Start toast reads "N items moved to In Palletization". PalletiseModal / ProductionEditForm footer summaries are neutral, not red (`.df-req-note.info`). New Loading step 1: **Load all ready** per SO band. Combobox gained `disabled`; customer form Shipping Country truly locks under "same as billing"; Currency / Payment Term / Sales Person are Comboboxes. Item detail: the stub `Unit` row is gone. | **LIVE 2026-09-19** (committed db60015); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass; read-only browser drive on LIVE done | QuoteForm, OrderForm, OrderDetail, QuoteDetail, DesignForm, DispatchBoard, PalletiseModal, SessionItemsStep, [`Combobox.tsx`](../client/src/ui/Combobox.tsx), PartyForm, ItemDetail |

**Looked at, no code change:** status codes on the /loading Sheet already carry the full label as `title` (C6). OrderForm already renders "PO Number is required" inline + the footer note (B7a) — recheck in the browser drive. Item Activity: the ZZT item's `insert` row exists in OperationLog and the component reads it correctly (C12) — the empty list in the drive was a one-off failed fetch; recheck. Zero-ready customers stay in the New Loading rail on purpose (the pane explains the block). **Not done:** PO Number on the SO Details card — the 2026-07-20 mandate says the card carries the SO number, not the PO number; needs the user's call.

## CR-219…220 · Allocate Stock — flat item/batch list + button survives a partial allocation (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 219 | **Allocate Stock modal decluttered.** One flat table: item row, then its batch rows (Batch · Available · Allocate). Ordered/Allocated stats, Mfg date, Box Brand and "Auto — oldest first" removed; item search on top; "Free" reads **Available**. | Built 2026-09-19, `tsc` clean; **not deployed** | [`AllocateStockModal.tsx`](../client/src/features/orders/AllocateStockModal.tsx) |
| 220 | **Bug: Allocate Stock button vanished after allocating one line.** The Items-card button was gated on the SO header label ("Stock ready…"), which moves on as soon as any line is allocated. Now gated per line — shown while any line is Stock ready / Partial stock. | Built 2026-09-19, `tsc` clean; **not deployed** | [`OrderDetail.tsx`](../client/src/features/orders/OrderDetail.tsx) (Items card) |

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

## CR-219 · Sales Order + Quote forms are full pages (2026-09-19)

The New Order modal capped the line grid at ~750px, so the Design picker was ~200px and item names
truncated. Both transaction forms now open as pages (the CR-203 Loading Session precedent), one page
per form for every mode.

| CR | Change | Status | Evidence |
|---|---|---|---|
| 219 | **Sales Order and Quote forms are pages, not modals.** `/orders/new` (`?quote=<id>` = Convert-to-SO), `/orders/:id/edit`, `/orders/:id/clone`; `/quotes/new` (`?customer=` prefill), `/quotes/:id/edit`, `/quotes/:id/clone`. `OrderForm` / `QuoteForm` keep their fields and validation but render `.form-page` = `.page-head` + sections + sticky `.session-foot` (legend, Cancel, Save); Design column `3fr`, notes three-up. Save awaits the write (busy = no double create), a failed save keeps everything typed, Cancel confirms only after a user edit, success lands on the saved record (`replace`). Every caller navigates instead of mounting a modal; `/byorder?new=1` and `/quotes?new=` deep links replaced. Not guarded: sidebar navigation away from a dirty form (HashRouter has no `useBlocker`). | **LIVE 2026-09-19** (committed db60015; browser drive pending); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass | [`OrderFormPage.tsx`](../client/src/features/orders/OrderFormPage.tsx), [`QuoteFormPage.tsx`](../client/src/features/quotes/QuoteFormPage.tsx), [`OrderForm.tsx`](../client/src/features/orders/OrderForm.tsx), [`QuoteForm.tsx`](../client/src/features/quotes/QuoteForm.tsx), routes in `App.tsx`, `.form-page` in `styles.css` |

## CR-220…221 · Every create/edit form is a page · Billing | Shipping side by side (2026-09-19)

Follow-up to CR-219: the remaining create/edit modals (Item, Production, Pallet master, Customer) become
pages on ONE shared shell, and the Quote + Sales Order forms show Billing and Shipping address side by side
(the SO form gains the two fields — it had none).

| CR | Change | Status | Evidence |
|---|---|---|---|
| 220 | **Item, Production, Pallet and Customer forms are pages.** New shared shell `ui/FormPage.tsx` (`FormPage` = `.page-head` + sections + sticky `.session-foot`; `useFormSave` = awaited Save with a busy guard + Cancel that confirms only after an edit) — `OrderForm`/`QuoteForm` retrofitted onto it, so all six forms share one shell. Routes: `/design/new·:id/edit·:id/clone` (`DesignEdit` is now the one Item form; the `DesignForm` modal wrapper is deleted, duplicate-name pre-check moved in, `can("items")` gate added); `/pallets/new[?size=<id>]·:id/edit·:id/clone` (`?size=` = the Size detail's Create Pallet: size locked, returns to the Size); `/parties/new·:id/edit·:id/clone` (tabs kept); `/prod/new` (To Produce shortfalls arrive as router state), `/prod/:id/clone`, `/prod/:id/edit` (narrow page, refused once output is recorded). Create/clone land on the saved record — Record New Production now lands on the new production instead of staying on the list. Record Output / Import / Complete / QC / Size / Panel modals untouched. | **LIVE 2026-09-19** (committed db60015; browser drive pending); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass | [`FormPage.tsx`](../client/src/ui/FormPage.tsx), [`DesignEdit.tsx`](../client/src/features/masters/DesignEdit.tsx), [`PalletFormPage.tsx`](../client/src/features/masters/PalletFormPage.tsx), [`PartyFormPage.tsx`](../client/src/features/masters/PartyFormPage.tsx), [`ProductionFormPage.tsx`](../client/src/features/stages/ProductionFormPage.tsx), routes in `App.tsx` |
| 221 | **Billing + Shipping address side by side on the Quote and Sales Order forms** (shared `AddressPair`, `.addr-pair`, stacks under 900px). The SO form now edits both: picking a customer fills them, Convert-to-SO seeds them from the quote, edit seeds from the order; the SO print uses the order's own addresses (older orders fall back to the customer master). Needs new column **`SalesOrder.shipping_address` text(10000)**; `/so-with-items`, `/update-so-with-items`, `/convert-quote` carry it. | **LIVE 2026-09-19** (committed db60015; browser drive pending); column created (id 69851000000291143), functions + client deployed | [`AddressPair.tsx`](../client/src/features/common/AddressPair.tsx), [`OrderForm.tsx`](../client/src/features/orders/OrderForm.tsx), [`QuoteForm.tsx`](../client/src/features/quotes/QuoteForm.tsx), [`ordersApi.ts`](../client/src/features/orders/ordersApi.ts), `functions/data-ops/index.js` |

## CR-222 · Palletization form is a page (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 222 | **New / Edit / Clone Palletization open as a page** on the shared `FormPage` shell (CR-220): `/packing/new`, `/packing/new?fromOrder=<soId>` (Send to Palletization — every entry point now links here; an old `/packing?fromOrder=` link redirects), `/packing/:id/edit` (refused for a Completed plan, same lock as the Edit button), `/packing/:id/clone`. Both entry points still share the one `PalPlanForm`. Save lands on the plan's detail. | **LIVE 2026-09-19** (committed db60015; browser drive pending); `tsc` + `vite build` clean, all `*.check.ts` / `*.test.ts` pass | [`PalPlanFormPage.tsx`](../client/src/features/stages/PalPlanFormPage.tsx), [`PalPlanForm.tsx`](../client/src/features/stages/PalPlanForm.tsx), routes in `App.tsx` |

## CR-223 · Customer-first New Palletization (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 223 | **New Palletization starts from the customer.** `/packing/new` (the New button only) shows the New Loading rail: search a customer → all their orders with palletizable stock as sections → per design Order Qty · Produced · Available · **Batches** (read-only, produced/allocated boxes not yet on a plan line) · Palletize Boxes · Pallet. One customer per plan, many SOs in one PAL. Qty is typed per design; **the server assigns batches FIFO on save** (`attributeBatches` in `createPalPlan`, reusing `unqueuedBatches`; boxes beyond production stay one blank-batch line; Box Brand rides along) — this also fixes blank batches on Send to Palletization creates. Ordered-qty cap unchanged. Send to Palletization (`?fromOrder=`), Edit and Clone keep the previous layout by user choice. Same-day polish: item rows are one-line (design + "in PAL" chip never wrap), the items table scrolls sideways inside its card instead of clipping the Pallet column (Pallet min-width 320 → 240; the Combobox popup is portaled so it is unaffected), empty Batches shows "—" — applies to every mode of the form. | **LIVE 2026-09-19** (functions + client deployed; committed db60015); `tsc` clean, `palletizeBatches.test.ts` passes; browser drive pending | [`PalPlanForm.tsx`](../client/src/features/stages/PalPlanForm.tsx), [`palletizeBatches.ts`](../client/src/features/stages/palletizeBatches.ts), [`palletisationApi.ts`](../client/src/features/stages/palletisationApi.ts), `functions/data-ops/index.js` |

## CR-224 · New Palletization: customer on top, in-progress chip (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 224 | **Customer pick list at the top, items below.** `/packing/new` drops the CR-223 left rail: **Customer** (required Combobox, customers with palletizable stock) is the first field of the Plan section; that customer's orders/designs list underneath with the same order/design search. Switching customer still resets boxes; one customer per plan. The order-level "⚠ This order already has an open palletization (PAL/…) — avoid raising a duplicate" banner is **removed**, and the per-row "in PAL/…" chip becomes an amber **Palletization in progress** chip with no PAL number (every mode of the form). | **LIVE 2026-09-19** (client deployed; committed db60015); `tsc` clean; browser drive pending | [`PalPlanForm.tsx`](../client/src/features/stages/PalPlanForm.tsx) |

## CR-225 · Loading Session: vehicle merged into the seals sheet step (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 225 | **New Loading is two steps: Select items → Seals, sheet & vehicle.** The user assigns the vehicle by design and boxes, which only the sheet shows, and the sheet already edits Truck / Container / E-Seal / Line Seal / L.R. — so the separate "Vehicle & loading" step (a second editor of the same fields) is removed. The merged step shows the Loading Sheet first, then a **Vehicle & loading details** card for this container with only the fields the sheet lacks (Driver, Mobile, Size, Transporter, Destination / Port, Loading Supervisor — `LoadDetailsFields` with new `sheetOwned` prop) beside the Checks card. Save = sheet save, then changed details → `/load-box-update`, driver/mobile → `resolveVehicle` on the typed truck. `?step=3` links clamp to step 2. Assign Vehicle modal unchanged. **Same day: the details card is hidden for now at user request** (`SHOW_DETAILS = false` in `LoadingSession.tsx`) — step 2 shows the sheet + Checks only; those six fields stay editable from the detail page's Edit (Assign Vehicle modal). | **LIVE 2026-09-19** (client deployed; committed db60015); `tsc` clean; browser drive pending | [`LoadingSession.tsx`](../client/src/features/stages/LoadingSession.tsx), [`LoadDetailsFields.tsx`](../client/src/features/stages/LoadDetailsFields.tsx), [`Tour.tsx`](../client/src/features/tour/Tour.tsx) |

## CR-226 · Loading Session step 1: Sheet view (trial, switchable) (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 226 | **Step 1 "Select items" gains a Customer view / Sheet view toggle.** Sheet view (from the design canvas's "Unified sheet" board): Customer Combobox on top, then every open order of that customer in ONE grid — a band row per Sales Order (Fill from plan / Load all ready + subtotals), one row per batch, **Qty to load** the only typed cell (Enter/↑/↓ walk the column), Pallets and Container % recalculating per row, totals footer, design search, fill meter. The customer-rail view is untouched and stays the default; the choice is remembered per browser (`localStorage` `boffo.loadingSession.view`). Render-only — selection state, one-customer-per-container and Save are the existing SessionItemsStep logic. **Not built:** the canvas's per-row Container column / merge rows (multi-container in one save), batch re-pick, fx bar, Fill down / Export. | **LIVE 2026-09-19** (client deployed; committed db60015); `tsc` + build clean; browser drive pending | [`SessionSheetView.tsx`](../client/src/features/stages/SessionSheetView.tsx), [`SessionItemsStep.tsx`](../client/src/features/stages/SessionItemsStep.tsx) |

## CR-227 · Loading Plan page: spreadsheet-style New Loading (trial, beside the session) (2026-09-19)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 227 | **A separate trial page for New Loading, laid out from the `Plan.dc.html` mock in the app's own colours.** `/loading/plan[?so=<id>]` → `/loading/:id/plan?step=1|2`, opened by a secondary **New Loading (sheet)** button on `/loading`; `/loading/new` (the CR-203 session) is untouched until this is approved. **Only two steps.** **1 Item selection** — toolbar (Customer Combobox, search over design / batch / SO / size, *Only picked* toggle) → cell bar (active cell ref such as `H4`, its value, key hints) → **container strip** (the one container's fill bar, pallets · boxes, and the **vehicle details typed right on the sheet**: Vehicle No. free text, Driver, Mobile, Size) → ruled sheet with column letters: collapsible band per Sales Order (subtotal, Fill from plan / Load all ready), one row per batch — `# · Design · Customer ‖ SO No. · Size · Box Brand · Batch · Pallet type · Ready · Qty to load · Pallets · Status` (Not planned / Partial / Full / Not loadable), **Qty to load** the only typed cell (Enter/↑/↓ walk it), sticky totals row, footer stats Lines · Boxes · Pallets · Fill. **2 Vehicle assignment** — the mock's "Vehicle & loading" and "Seals & documents" on ONE form (full `LoadDetailsFields`: vehicle, driver, mobile, container no., size, seals, transporter, LR, destination, supervisor) beside the loaded-items table and a live checks card with the warn-only duplicate container-no./seal check. Rules unchanged: one customer, one container per save; fill advisory (CR-195); nothing required. Selection state + Save were lifted out of `SessionItemsStep` into the shared hook `useSessionPick` (new `afterBox` callback persists the strip via `resolveVehicle` → `/load-box-update` once the container exists) — the session page renders exactly as before. **Same-day feedback:** the container chip / fill bar, the Container % column and the Fill stat are **removed** (the loader knows how the container fills — no indicators on this page), and the sheet leads with **Design, then Customer** (frozen edge after Customer), SO No. third; search also matches customer. Second round: the **vehicle strip is removed from step 1 too** (vehicle lives only on step 2; the `afterBox` hook callback is gone), and the toolbar gains an **All customers | Selected customer** toggle (default All: every customer's ready stock in one sheet, customer name on each SO band; typing on a row makes that customer the container's, and other customers' rows lock until the picks are cleared — one customer per container holds). Third round: the **cell bar (`H4` · fx · value) and the A–K column-letter row are removed** — decorative only. Client-only, no schema change. **Not built (mock-only):** multi-container strip / merge rows / mixed customers, Weight + Sqm columns (lines carry no weight/coverage), Avail / Ordered / Pending, batch re-pick, Ready-by / Freeze / Columns / Export / Fill down. | **LIVE 2026-09-19** (client deployed; committed db60015); `tsc` + build clean, `newLoadingRows` self-check passes; browser drive pending | [`LoadingPlanPage.tsx`](../client/src/features/stages/LoadingPlanPage.tsx), [`PlanSheetStep.tsx`](../client/src/features/stages/PlanSheetStep.tsx), [`SessionItemsStep.tsx`](../client/src/features/stages/SessionItemsStep.tsx) (`useSessionPick`), `.psheet-*` in [`styles.css`](../client/src/styles/styles.css) |

## CR-228 · Loading Plan sheet: customer-first, plain sheet (2026-09-21)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 228 | **The `/loading/plan` step-1 sheet is grouped by customer and stripped to a plain sheet.** Bands are now per **Customer** (was per Sales Order; view-only regroup — `groupReady` untouched), band header = fold · customer name · lines · boxes ready. Column order: `# · Customer · (gap) · Design · SO No. · Size · Box Brand · Batch · Pallet type · Ready · Qty to load · Pallets · Status`. **Removed from the bands:** the Subtotal / "N box · N pal" label and the **Fill from plan** / **Load all ready** buttons — the sheet only shows what palletization has made ready and the user types Qty by hand. **Show/hide fields:** the standard `ColumnPicker` (`loadingPlanSheetColumns`) over the text columns Design … Pallet type, **Size hidden by default**; Customer, Ready / Qty / Pallets and Status are fixed. **Same day:** the Customer column is pinned left and the customer band pins under the header, so the customer stays visible while scrolling either way (`.psheet-tbl .cust`, sticky band). Totals row, footer stats, one-customer-per-container lock and Save unchanged. CR-226 `SessionSheetView` untouched. Client-only. | **LIVE 2026-09-21** (client deployed; committed db60015); `tsc` + build clean; browser drive pending | [`PlanSheetStep.tsx`](../client/src/features/stages/PlanSheetStep.tsx), `.psheet-tbl .gapc` in [`styles.css`](../client/src/styles/styles.css) |

## CR-229 · Palletization boards: no silent empty board, gates read every line (2026-09-21)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 229 | **`/packing` + `/palletizing` can no longer render a silently empty board.** `fetchPalPlans` failed only when the `PalletizationPlan` read failed; a failed `PalletizationPlanLine` (or any lookup) read became zero lines with `ok: true` → "Nothing here", no error, on every filter value. Now ANY failed read fails the load and the existing error path shows. Also: `DispatchBoard` fed the status-tab-FILTERED plans into `loadableLineIds` / `oiProgressOf`, breaking the `palLoadGate` "feed ALL lines" contract, so changing the filter could reclassify rows between In Palletization and Ready for Loading; new optional `allPlans` prop carries the unfiltered set. Client-only. | Built 2026-09-21, **not deployed**; `tsc` clean; live-data diagnosis of the reported 0 rows pending (needs a session) | [`palPlansApi.ts`](../client/src/features/stages/palPlansApi.ts), [`DispatchBoard.tsx`](../client/src/features/stages/DispatchBoard.tsx), [`PalPlans.tsx`](../client/src/features/stages/PalPlans.tsx) |

## CR-230…232 · Sales Order follows its latest stage; Partially Completed / Completed; editable after work (2026-09-21)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 230 | ⚠ *Narrowed same day by CR-233: the roll-up now writes only Partially Completed / Completed; In Palletization / In Loading are no longer SO statuses.* **The SO status follows its boxes.** New stored `SalesOrder.status` values `InPalletization → InLoading → PartiallyCompleted / Completed`, written by `rollupSoStatus` at the tail of every `recountOrderItems` (so every palletise / load / dispatch route feeds it). Dispatched vs ordered over ALL the SO's lines: 400 of 1000 ⇒ "Partially Completed — 600 left", all ⇒ "Completed". Promote-only (mirror of `OrderItem.stage`); never touches Draft / PendingApproval / Rejected / Cancelled. Pure rule + self-check in `lib/soStatus.js`. The old client-only "Partially Dispatched / Dispatched" labels are renamed to match; `Completed` closes production demand (`needProduction`). `/recount-order-items` backfills existing orders. | DEPLOYED LIVE 2026-09-21, drive + committed db60015 | `functions/data-ops/lib/soStatus.js`, `index.js` `rollupSoStatus`, `ordersApi.ts` `SO_STATUSES` |
| 231 | **Manual status change — any status, reason mandatory.** `/so-status` accepts `manual: true`: skips `SO_TRANSITIONS`, requires a reason (logged as `manual — …` in StatusTransition), still needs approval rights to jump an unapproved order past approval. UI: SO detail More → **Change Status** modal; Orders grid bulk "Change status…" lists every status and prompts once for the reason. A manual Completed on a partial order survives later recounts (promote-only). | DEPLOYED LIVE 2026-09-21, drive + committed db60015 | `ChangeStatusModal.tsx`, `OrdersTable.tsx` |
| 232 | **An SO stays editable after work is recorded.** `/update-so-with-items` edits lines IN PLACE (`lines[].id`; no id = new line; missing id = removed) instead of delete-all/insert-all, so the "Work already recorded" 409 is gone. A line with work keeps its item, can't go below its palletised / loaded / dispatched boxes, and can't be removed (nor can a line on a palletization plan). Approval reset to Draft only applies before any work. After the save the status is re-derived with demotion allowed: 1000→400 on a 400-dispatched SO ⇒ Completed; back to 1000 ⇒ Partially Completed. Form: item locked, qty floor hint, remove disabled on worked lines. Cancelled / Rejected stay locked. | DEPLOYED LIVE 2026-09-21, drive + committed db60015 | `index.js` `/update-so-with-items`, `OrderForm.tsx`, `OrderDetail.tsx` |

## CR-233 · SO grid: Palletization Status + Loading Status columns; SO Status = order lifecycle only (2026-09-21)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 233 | **The walk-through is split into columns instead of folded into one status.** Found live: the SO detail said "In Loading" while the grid said "Approved" (grid read the stored status, detail derived from counters, existing orders never backfilled). Now: **SO Status = lifecycle only** — Draft / Pending Approval / Approved / In Progress / Cancelled / Rejected, then `Partially Completed — n left` / `Completed` once boxes are dispatched — computed by ONE function `soLiveStatus` used by the grid chip, the grid status filter + sort, and the detail header, so they cannot disagree (dispatched counters win over a stale stored value; a stored value ahead of the counters = manual override, kept). Two new grid columns + detail fields from pure helpers `palStatus` / `loadStatus`: `Not Started` · `Partial — 400 of 1000` · `Completed`, and for loading `Loaded` / `Dispatched`. Chips are full words (no codes) on this grid. Replaces the old "Shipping Stage" column and `shippingStage`; the detail header no longer shows supply / "Ready for Palletization" text (`soDisplayStatus` deleted — supply stays per line in the Items table). Server `deriveSoStatus` trimmed to dispatch only; `InPalletization` / `InLoading` dropped from the manual pick list (kept in `SO_RANK` so a CR-230-window row still closes). | DEPLOYED LIVE 2026-09-21, drive + committed db60015 | `ordersApi.ts` `soLiveStatus` / `palStatus` / `loadStatus`, `OrdersTable.tsx`, `OrderDetail.tsx`, `lib/soStatus.js` |

## CR-234…237 · Production: Start New Production, "+" menu, batch rows (2026-09-21)

| CR | Change | Status | Evidence |
|---|---|---|---|
| 234 | **"Record New Production" → "Start New Production"; Save creates the job only.** ⚠ Supersedes the one-step Save of CR-197: jobs used to be created AND fully recorded in one go, so they landed straight in Completed and never used the In Production queue. Now `/production-log` takes an optional `stage` (literal `New` \| `InProduction`, anything else 400) and the form sends `InProduction`; the job lands at 0 produced and follows the cycle. Batch No. + Box Brand removed from the start form (a `plan` row stores neither — both are captured when output is logged). `recordNewProduction` deleted; Excel import unchanged (still records output). | DEPLOYED LIVE 2026-09-21 (API + browser driven), committed db60015 | `functions/data-ops/index.js` `/production-log`, `ProductionForm.tsx`, `ProductionFormPage.tsx`, `productionApi.ts` |
| 235 | **One "+" menu on every production row/card** (same idiom as CR-150 palletization): Start Production · Log Production · Complete Production, inapplicable items greyed with a reason. Complete routes through the capped `RecordOutputForm` (NOT `/production-complete`, which is per-group and uncapped) — over-production stays blocked by user decision. Sheet row, new Grid trailing cell, Kanban card. | DEPLOYED LIVE 2026-09-21 (API + browser driven), committed db60015 | `ProductionTable.tsx` `plusMenuItems`, `ProductionKanban.tsx`, `DetailBits.tsx` `MoreMenu` |
| 236 | **Grid + Sheet flat, one row per batch; Group on the Grid.** `batchRows(e)` expands a job into its record rows (none yet → one blank-batch row). New Batch + Mfg Date columns (`productionGroupColumns.v3`); Produced = that batch's qty; line-level cells on the first row only; paging / sort / selection / band totals stay keyed by job so nothing double-counts. Group picker (Item · Customer · Order · Size) now shows on Grid as well as Sheet + Board; band row shared (`bandRow`). Per-row ✓/✗ sheet editing like the Loading sheet = future. | DEPLOYED LIVE 2026-09-21 (API + browser driven), committed db60015 | `ProductionTable.tsx`, `productionSheetEdit.ts` + `.test.ts` |
| 237 | **Batch number shown wherever output is recorded.** "Already logged" batch · date · qty list in the Log Production dialog; batch line on the Kanban card + Batches in its popup; Batch column on the production detail Items table; optional Batch No. per line on Production Completion, now duplicate-guarded server-side (`assertBatchesAllowed`). | DEPLOYED LIVE 2026-09-21 (API + browser driven), committed db60015 | `RecordOutputForm.tsx`, `ProductionKanban.tsx`, `ProductionDetail.tsx`, `ProductionCompleteForm.tsx`, `/production-complete` |
| 238 | **Auto-numbered batches were all `…/001`.** Found on the CR-234 drive: `nextBatchNumber` interpolated `Number(designId)`; ROWIDs (~7e16) exceed `Number.MAX_SAFE_INTEGER`, so `…157119` became `…157120`, the design+month scan matched nothing and every blank batch minted `001` — silent duplicates (the mint path skips `assertBatchesAllowed`). Now a digits-only string. Verified live: 002 → 003. Existing duplicate `001` rows are NOT renumbered. | DEPLOYED LIVE 2026-09-21, committed db60015 | `functions/data-ops/index.js` `nextBatchNumber` |
| 239 | **Grid card always reaches the pager bar**, however few rows it has (was: a one-row grid ended mid-screen). One place for all 22 grids: `GridFooter` sets its `.card`'s `min-height` from the card's top to the viewport bottom minus the 64px `.main` reserves for the fixed bar — so a short grid fills the page and still never scrolls. Re-fits on every render + window resize. | BUILT 2026-09-21 (measured on /prod, /orders, /quotes: card bottom 756 / bar 776, no scroll), not deployed | `client/src/ui/GridFooter.tsx` |

## CR-240…243 · Loading: one Edit page, single-page New Loading, sheet column order (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 240 | **One Edit for a loading, as a page.** `/loading/:id` Edit was a vehicle-details modal; adding pallets, adding items and removing / re-quantifying loaded lines lived in three other places. Edit now opens `/loading/:id/session` — ONE scrolling page, no steps, one Save: Loaded items (typed Boxes; fewer = rest back to Ready for Loading; 0 / ✕ = remove) → Add pallets → Add items → Vehicle & load details (full `LoadDetailsFields`). **New Loading uses the same page** (`/loading/new`), so the CR-203/225 stepper, step 2 "Seals, sheet & vehicle" and its checks card are gone; the ruled sheet stays on the detail's Loading Sheet tab. Save runs sequentially and stops at the first failure (saved parts stay; a freshly minted loading re-opens as its edit page). Dispatched loading = details only. More menu lost Add Pallets / Add Items. No server change. | BUILT 2026-09-21 (tsc on touched files + build + self-checks pass), not deployed, not browser-driven | `LoadingSession.tsx`, `SessionItemsStep.tsx` (`saveAdds` / `loadPlan`, render-only step), `LoadingDetail.tsx` |
| 241 | **Add Items inline.** The direct (no-palletization) send is a section of the page: the customer's (or `?so=`'s) order items with boxes left, one Boxes input each, `/send-to-loading` once per SO. `remainingOf` / `soSendable` exported from `SendToLoadingModal.tsx` (modal kept for Order detail's Send to Loading); `Order.customerId` added on hydrate. | BUILT 2026-09-21 | `LoadingSession.tsx`, `SendToLoadingModal.tsx`, `data.ts`, `ordersApi.ts` |
| 242 | **Fields button hidden on the loading detail** ("for now") via RecordDetail's existing `hideFields`. | BUILT 2026-09-21 | `LoadingDetail.tsx` |
| 243 | **Loading sheet leads with Design, Batch.** Column order: Sr · Design · Batch · P.O. No. · L.R. · Truck · Container · E-Seal · Line Seal · Size · Finish · Box Brand · Pallet No. · Boxes · Pallet type — all four consumers. P.O. No. stays (the user first asked to drop it, then reversed). | BUILT 2026-09-21 | `LoadingCustomerSheet.tsx` |

## CR-244 · Bulk Record Production sheet (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 244 | **Bulk Record Production (renamed from "Record Production" same day) — many items on one sheet, one Save, straight to stock.** Production that runs regardless of orders had to go through the cycle per item (Start New Production → + → Log → Complete); 20 items ≈ 60 clicks. New page `/prod/record` (button **Bulk Record Production** on `/prod`), in the Loading Plan sheet skin (`.psheet`): row per item — Design · Batch No. (blank = auto) · Date (blank = sheet's Production date, default today) · Qty, optional Size / Box Brand / Remark via ColumnPicker. 20 blank rows, auto-grows; Enter/↑/↓ walk a column; **paste a block from Excel**; inactive items not offered. Validation inline before any request (missing item / qty, same item + batch twice). Each row ends as a **Completed** production with its output in stock. Save = 2 requests for any N (`/production-log` then `/production-complete`) — Import needs N+2. `/production-complete` lines now accept `production_date`, `box_brand` (`brandOrNull`), `note`; existing callers unchanged. Retry-safe: rows keep their minted job id, a re-Save only re-sends the completion and the server records the missing delta. Item matcher + date parser moved out of `ProductionImport.tsx` into the shared pure module. Not built: fill-down, ←/→ cell nav, page tour. | BUILT 2026-09-21 (tsc + build + self-check pass; browser-driven against a mocked server: paste, validation, 409 retry, grow), **DEPLOYED LIVE 2026-09-21**, live drive + committed db60015 | `ProductionLogSheet.tsx`, `productionLogSheetEdit.ts` + `.test.ts`, `ProductionTable.tsx`, `ProductionImport.tsx`, `productionApi.ts`, `App.tsx`, `styles.css`, `functions/data-ops/index.js` `/production-complete` |

## CR-245 · Columns / Group buttons show when they are active (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 245 | **A customised view is visible on the toolbar.** Nothing told the user that columns were hidden/reordered or that a grouping was applied. The Columns / Fields / Sections / Group buttons now take the same indigo `.btn.active` look the Search button already uses for applied filters (no new CSS). `useColumns` returns `customised` (order ≠ code order, or hidden set ≠ `defaultHidden`, compared over current defs only — default-hidden Created/Modified never light it); `ColumnPicker` gets an `active` prop + "— customised" title suffix. Group pickers: `active={groupBy.length > 0}` (so `/loading` Sheet, grouped by Customer by default, shows lit). Apply-only untouched. Not built: count badge, Reset to default. | BUILT 2026-09-21 (tsc + build pass; not browser-driven), **DEPLOYED LIVE 2026-09-21**, commit pending | `ui/ColumnPicker.tsx` + every `<ColumnPicker>` call site (28) |

## CR-246 · Status filter defaults to All, and lights up when applied (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 246 | **Every grid's status filter opens on "All".** The two exceptions are gone: `/prod` (was Pending on grid/sheet, and snapped back on every view switch — that snap is removed) and `/packing` + `/palletizing` (was the page's own stage; persist key bumped to `.show.v2` so the new default reaches existing browsers). **A non-All status filter is highlighted** with the same indigo as Search / Columns / Group (CR-245): the toolbar `<select>` takes the existing `.fbar select.on` class (already used by Panel Craft's `FilterSelect`), whose rule now carries the accent fill. | BUILT 2026-09-21 (tsc + build pass; not browser-driven), **DEPLOYED LIVE 2026-09-21**, commit pending | `ProductionTable.tsx`, `PalPlans.tsx`, `OrdersTable.tsx`, `QuotesTable.tsx`, `Invoices.tsx`, `Palletizations.tsx`, `theme.css` |

## CR-247 · New Loading page laid out like a Sales Order form (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 247 | **New Loading / Edit Loading reads like a Sales Order form: Customer on top → Loading Details → Item Table → Vehicle & Container Seal Details.** The customer rail + 460px pick list are replaced by an Item Table over palletized Ready-for-Loading stock only: pick the Item (design · SO), then its Batch, then Boxes (defaults to the batch's full qty); a partly palletized batch is listed with its n/m note but cannot be picked, and a batch used by one row leaves the other rows' lists. **Add New Row** and **Add Items in Bulk** (list of every ready batch on the left, selection with a boxes stepper on the right). In Edit the already-loaded lines are the table's first rows (fewer boxes = rest back to Ready for Loading, ✕ = unload) — the separate Loaded-items card is gone. `LoadDetailsFields` gained `part` so the ONE field set renders in two places. Save order and every endpoint unchanged; the direct "Add items" card (CR-241) stays below the table by user choice. Not built: Loading Date (no column), deleting the `/loading/plan` trial or the old pick-list files (user did not ask). | BUILT 2026-09-21 (tsc + build + `newLoadingRows` self-check pass; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client only), commit pending | `LoadingSession.tsx`, `BulkLoadItemsModal.tsx`, `LoadDetailsFields.tsx`, `newLoadingRows.ts`, `styles.css` |

## CR-248 · The palletized part of a batch can be loaded (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 248 | **300 palletized boxes of a 400-box batch can be loaded now; the other 100 follow when they are palletized.** Reverses CR-151's whole-batch gate everywhere (user decision): fixed at the source — `loadableLineIds` = every un-boxed Ready-for-Loading line, so the Item Table row, Add Items in Bulk, the `/loading` sheet, the Dispatch board and the trial plan sheet all follow; the server no longer 409s (`assertBatchesComplete` deleted from `/pal-lines-box` + `/pal-line-box`). Such a batch keeps a non-blocking "300 of 400 palletized" note (`PickLine.partial`, was `blocked`). Not touched: palletization recording, `dispatchGate`, SO status roll-up. | BUILT 2026-09-21 (tsc + build + `newLoadingRows` / `batchLedger` self-checks pass, `node --check` ok; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client + data-ops), commit pending | `palLoadGate.ts`, `newLoadingRows.ts`, `LoadingSession.tsx`, `BulkLoadItemsModal.tsx`, `PlanSheetStep.tsx`, `SessionItemsStep.tsx`, `SessionSheetView.tsx`, `functions/data-ops/index.js` |

## CR-249 · New Palletization takes its boxes from the waiting queue (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 249 | **A New Palletization for an item whose produced boxes already wait in the palletization queue now MOVES those boxes (batch + Box Brand carried) instead of creating a second, batch-less, brand-less line.** Found on New Loading: BATCH TESTING ITEM 1 showed Batch "No batch" and no Box Brand — its batches (460 + 60) were on the auto-queue plan, a second plan of 400 found no un-queued batch and fell to the blank residue line, queuing the item twice (920). Root-cause fix in `attributeBatches`: un-queued batches first, then `claimQueuedBatches` (batched, un-boxed Planning lines, oldest first), donors shrunk after the new lines are in and restored on failure; claimed boxes netted off the ordered-qty cap. One-off admin `/reattribute-blank-lines` repairs existing lines. Blank batch reads "Unbatched stock" on the loading Item Table / bulk list (was "No batch", which looked like an empty control). Not fixed here: `/update-pal-plan` and clone/edit re-saves still drop `box_brand`. Next CR (own plan): independent Record Palletization without a Sales Order — impossible today (`normalizePlanLines` requires `order_item`). | BUILT 2026-09-21 (`node --check`, claim self-check, tsc + build pass; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client + data-ops), Item 1 repaired on LIVE (2 lines, total back to 520), commit pending | `functions/data-ops/index.js`, `scripts/claim-queued-batches.check.mjs`, `newLoadingRows.ts`, `BulkLoadItemsModal.tsx` |

## CR-250…251 · Loading page: no direct order items; vehicle can wait (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 250 | **The "Add items — order items straight into this loading, no palletization" section is removed from New / Edit Loading (for now, user decision).** The page loads palletized Ready-for-Loading stock only (Item Table). Deleted with it: the `direct` state, the orders fetch and the `/send-to-loading` step of the page's Save. Not touched: the server route, `SendToLoadingModal`, the SO detail's Send to Loading. | BUILT 2026-09-21 (tsc + build pass; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client only), commit pending | `LoadingSession.tsx` |
| 251 | **A loading saves without vehicle details; they are added on the next Edit or in the Loading Sheet's edit mode.** Checked end to end — already true, no code change: blank vehicle resolves to nothing, `/load-box` only stores a vehicle when given, Edit Loading / Loading Sheet Truck No. / Assign Vehicle all set it later. Only Dispatch requires a vehicle (kept). | VERIFIED in code 2026-09-21, live drive pending | — |

## CR-252…255 · Loading page: all-customer items, aligned totals, details tabs, container-plan hint (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 252 | **Items show regardless of customer — Customer is an optional filter, and one container may mix customers** (user decision; reverses "one customer per container" of CR-201/247 on this page). Blank Customer = every customer's Ready-for-Loading stock in the Item dropdown and Add Items in Bulk; picking one only narrows the lists, picks already on rows stay. Item labels read `design · SO · customer`. Hook option `useSessionPick({ anyCustomer })` — the `/loading/plan` trial keeps its old behaviour. Client-only: the server never enforced one customer. | BUILT 2026-09-21 (tsc + build + `newLoadingRows` self-check pass; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client only), commit pending | `LoadingSession.tsx`, `SessionItemsStep.tsx`, `newLoadingRows.ts`, `BulkLoadItemsModal.tsx` |
| 253 | **Totals sit under the Boxes / Pallets columns** — a last row on the same `.load-line` grid (loaded lines after their typed edits + new picks) with "n% of a container" (amber past 100%, advisory). The floating "n lines · boxes · pallets" text and the footer's "Adding … boxes · pallets" are removed; the footer shows only a blocking error + Cancel / Save. | same | `LoadingSession.tsx` |
| 254 | **Loading Details and Vehicle Details are tabs below the Item Table** (RecordDetail's `tabStyle`). Both field sets stay mounted, so typed values survive a tab switch and the one Save is unchanged. | same | `LoadingSession.tsx` |
| 255 | **Container Planning hint** — under the Item Table, one line per listed order that has a container plan with an unsent container: "SO · customer · container plan: Container 2 of 3 · 300 boxes" + **Fill from plan** (existing `fillFromPlan`, now returning the lines it filled so they appear as table rows). Helper only, never blocks Save. | same | `LoadingSession.tsx`, `SessionItemsStep.tsx` |

## CR-256 · Loading Item Table: one row per item, batches combined (2026-09-21)

| CR | Change | Status | Where |
|---|---|---|---|
| 256 | **The Item Table shows ONE row per item (design · SO), not one per batch** (user: multi-batch items ate the table). The Batches cell opens the **batch picker** — the Add Items in Bulk modal scoped to that item (`BulkLoadItemsModal` with `bands` narrowed + `initial` = current picks): click batches, set boxes per batch, Apply (first cut was a tick-box popover — rejected same day: it forced the batch split). Boxes typed on the row drain the chosen batches oldest first (`spreadQty(lines, want, skip)` → existing `allocateFifo`). Picking an item prefills all its ready boxes; an item already on a row leaves the other rows' lists (`itemOptions(bands, takenRows)`). Pallets = Σ per-batch ceil, Pallet = distinct pallet names. **Edit:** loaded lines group the same way — a smaller total sends the newest batch back first (per-line drafts underneath, so the unload/shrink save loop is unchanged); ✕ unloads all its batches. Add Items in Bulk is the same modal over every batch; it opens on the current picks and Apply rewrites its whole scope. Batch detail stays on the loading's Loading Sheet. **No server change** — the payload is still `{lineId, boxes?}` per single-batch line; `/pal-lines-box` 409s a line that already has `load_box`, so the same boxes never reach two loadings, and a part-loaded batch's remainder stays loadable (user decision). Removed: `batchOptions`, `pickable`. Trial (option 1) — awaiting user verdict. | BUILT 2026-09-21 (tsc + build + `newLoadingRows` self-check pass; not browser-driven), **DEPLOYED LIVE 2026-09-21** (client only; batch-picker rework included), commit pending | `LoadingSession.tsx`, `newLoadingRows.ts`, `SessionItemsStep.tsx`, `BulkLoadItemsModal.tsx`, `styles.css` |
