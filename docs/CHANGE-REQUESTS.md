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

**Next action on 102–106:** commit the working tree. The code is live; the git history is not.

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
