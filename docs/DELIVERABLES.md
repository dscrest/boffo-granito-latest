# BOFFO Order OS — Deliverables

Feature-wise list of what has been delivered, what is being built and what is planned. The working copy is
`BOFFO-DELIVERABLES.xlsx` (same rows); regenerate both with `node scripts/build-deliverables.mjs`.

| Status | Count |
|---|---|
| Completed | 161 |
| In progress | 19 |
| Future | 26 |
| **Total** | **206** |

## Foundation & workspace

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Sign-in and sessions | Email + password sign-in; sessions last 7 days; sign-out from the user menu. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Roles and permissions | A role says, per module, who can view, create, edit, delete and export, and which document types they may approve. Admin is the superuser. Enforced on the server, not just hidden in the menu. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Organization profile | Settings ▸ Organization: upload the company logo and enter the company name (both required), legal name, GSTIN / PAN / IEC, address, phone, email, website and bank details. Used on the sidebar, login, browser tab, every PDF / print (quotes, dispatch and load copies, packing report, pallet and batch slips, invoices) and the shared pages. Change it any time. | Completed | 2026-10-25 | CR-445 |
| Security hardening | Image uploads accept real images only; query injection closed; secure cookies; allowed-origin list; statuses cannot be changed through generic saves. Two review passes (Jul and Sep 2026). | Completed | Phase 1 (by 01-Oct-2026) | CR-205…207 |
| App shell | Sidebar grouped Dashboard · Inventory · Sales · Reports, filtered by role; global search; user menu; settings gear for admins. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Settings workspace | Two-pane page: Preferences, Masters, Users, Roles, Currencies, Data operations (admin repair tools). | Completed | Phase 1 (by 01-Oct-2026) |  |
| House grid standard | Every list: one-line rows, page footer, show / hide and reorder columns (applied on Apply), advanced search, newest first, click anywhere on a row to open it. | Completed | Phase 1 (by 01-Oct-2026) |  |
| House form standard | Required fields marked; grey = calculated, white = you type; every pick list comes from the live masters; dates default to today; Sales Person defaults to the signed-in user; no negative numbers. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Detail page standard + Clone | One detail design everywhere; Edit and More top-right; every record can be cloned; after create / clone you land on the new record. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Create / edit forms are full pages | Quote, Sales Order, Item, Pallet, Customer, Production, Palletization, Loading — pages, not pop-ups. | Completed | Phase 1 (by 01-Oct-2026) | CR-219…222 |
| One visual language | Indigo / slate theme, one input skin, one button family, one font scale on every screen. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Onboarding tours | Welcome tour on first sign-in walks the business flow; Palletization and Loading have page guides; replayable from the user menu. | Completed | Phase 1 (by 01-Oct-2026) | CR-158/159 |
| Public pages | Pallet QR scan page, batch QR slip page and item images open without sign-in via unguessable links. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Grids lead with Customer → Design | Every list opens with Customer and Design (or item / name) first; system numbers (SO, Quote, PNL, PRD, TRF, CUS, SKU) hidden until ticked; customer PO stays visible; whole-row click everywhere. | Completed | 2026-10-19 | CR-355 |
| Staff default role | New role Staff: view + create everything, never edit, delete or approve. Default for every new user. Server now enforces no-edit / no-delete on every route; maintenance routes Admin-only. | Completed | 2026-10-13 | CR-336 |
| Zoho-linked accounts | Settings ▸ Users shows how each account signs in (Zoho / Password / Both / None); password-less Zoho-only users; company email domains self-provision a Staff account on first Zoho sign-in. | Completed | 2026-10-13 | CR-337 |
| Discard changes? Yes / No | Leaving a form or edit mode with unsaved changes asks a plain Yes / No question on every screen (no more 'Delete' wording). | Completed | 2026-10-03 | CR-268 |
| Delete asks why | Every delete asks for a reason first (Admin exempt); the reason is kept on the record's activity log and the server refuses a reason-less delete. | Completed | 2026-10-03 | CR-270 |
| Zoho Books-style form layout | Every create / edit form page puts the label on the left and the control on the right, two fields per row; Customer on its own row with Billing | Shipping under it; tightened label gap, one-control-wide rows, three-line notes boxes. | Completed | 2026-10-06 | CR-275, CR-277 |
| Clear / None option on every pick list | A way to clear a chosen value on every dropdown in the app. | Future |  | CR-069 |
| Pick-list keyboard navigation | Arrow keys move, Enter / Space selects, on every dropdown — to be verified and completed across all screens. | Future |  | CR-009 |
| Hosting platform upgrade | Move the app to the newer hosting platform (same app, same data; faster page loads). Planned, not started. | Future |  |  |
| Settings groups: Item Master and Panel Master | Item reference lists under Item Master, panel ones (Cut Piece Size, MDF) under Panel Master; Adjustment Reason and Warehouses under Setup & Configuration. Superseded by the Masters page (CR-436). | Completed | 2026-10-24 | CR-428 |
| One Masters page | Single Masters entry in the sidebar with Export Master · Item Master · Panel Master sub-tabs; every master (Pallets, Containers, Sizes, Items, Panel Items, Panels, lookups, Currencies, Warehouses) opens in place; old menu entries and links redirect into it; roles with Items or Panel Craft view see it. | Completed | 2026-10-24 | CR-436 |
| Masters menu inside Settings with horizontal tabs | The Settings page's left menu has Masters ▸ Item / Panel / Export; the chosen group shows its title and its masters as horizontal tabs that open each list in place. The sidebar Masters entry opens the same page. | Completed | 2026-10-24 | CR-439 |
| Masters only under Settings, clearer tabs | The sidebar no longer lists Masters; the menu is Settings ▸ Masters ▸ Item / Panel / Export and the selected master tab is a highlighted pill. Old links and search still open it. | Completed | 2026-10-24 | CR-440 |
| Names save as Title Case | Item, customer, contact, driver, transporter, supervisor, user and master names are stored as "Dhiraj Shah Of ABC Exports LLP" however typed — on every form, import and Zoho sync; short acronyms and LLP / LTD / PVT keep their capitals. | In progress |  | CR-429 |
| Settings search everywhere | The header search (⌘K) finds settings pages and preferences for admins; the Settings search matches every typed word plus synonyms (godown, truck, login) and the Preferences rows. | Completed | 2026-10-24 | CR-408 |
| Title Case for the remaining name fields | Collection Name on the Item form, a container's vessel name, extra-address attention names and role names save as Title Case like every other name. | Completed | 2026-10-25 | CR-447 |
| No long helper notes | Thirteen how-to paragraphs removed from under tables and cards; what blocks a row is said in its Status cell and tooltips. Standing rule: no multi-sentence instructions in the app. | Completed | 2026-10-24 | CR-416 |
| Kanban hidden app-wide | Packing, Panel Orders, Sales Orders and Production show the Sheet only; the Default view setting is hidden with it. | Completed | 2026-10-24 | CR-418 |
| Notifications read / unread | Bell rows stay bold until Mark all read; the marker survives new tabs. Sidebar logo centred; Settings sub-pages open with a small Back link above the title. | Completed | 2026-10-24 | CR-419…421 |

## Masters (Inventory)

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Items (Design Master) | One record per sellable tile: name, SKU, size, finish, category, glaze, grade, brand, images (gallery + lightbox), per-box weight with per-piece / per-m² helpers, batch-tracked flag, Active / Inactive. Item detail shows stock, production and orders. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Design Master to the new spec | Item form in five sections (Main Information · Calculations · Design Data · Working Data · Marketing Data) with the image on the form; Pcs Per Packing typed per item and coverage from the item's own numbers (a Size edit no longer rewrites them); Design Owner and Custom Design Buyer as customers (default owner in Settings); the buyer's brands offered as Customer Brand; Base Design picked from existing items; new lookups Surface Application, Punch Type (with image), Series, Catalogue. | Completed | 2026-10-23 | CR-391…396 |
| Opening stock with lock | Entered once per item (per batch for batch-tracked items); locks after first save; Admin can re-open with a reason written to the audit log. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Size Master with packing defaults | Dimensions, pieces per box, coverage m² / ft², box weight. Pallet formats snapshot the size; items take the dimensions and start their own pieces per box and box weight from it. Editing a size fans the defaults out (typed item values are kept). | Completed | Phase 1 (by 01-Oct-2026) | CR-391 |
| Pallet Master | Pallet formats: boxes per pallet, empty and loaded pallet weight, which size they fit. Pick lists offer the formats matching the item's size. Boxes-only since Phase 2 (container capacity moved to Container Master). | Completed | Phase 1 (by 01-Oct-2026) | CR-261 |
| Stock Details | Batch-wise on-hand per item. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Lookups | Brand (with logo on forms), Grade, Finish, Category, Glaze, Payment terms, Currency with exchange rate, Vehicle (kept in sync from typed numbers), Container sizes, Organization, document number series. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Container Master | New master: what one container of a size holds — pallet formats as lines (format × how many), totals follow; several containers per size; auto-name shows the pallet maths, e.g. 800x1600 - GVT - 2 · [(48*10) + (10*6)] = 540 boxes. Grid, form page, detail with Clone / Delete, activity. | Completed | 2026-10-07 | CR-261, 269, 273, 292 |
| Capacity comes from the Container Master | Fill % on loading and palletization and the planner's box fitting use the size's container; a size with no container shows no fill % and says so. | Completed | 2026-10-03 | CR-261 |
| Warehouse master | Settings ▸ Warehouses: name, Primary ★, purposes (Production · Palletization · Loading Bay · Raw Material · Sample Cut Panels), note. Primary and any warehouse with history cannot be deleted. | Completed | 2026-10-12 | CR-329 |
| Add a new container from where it is needed | Create a Container Master record without leaving the loading / planning screen. Scope to be confirmed. | Future |  | Panel Craft list #10 |
| Container master naming | Naming / login rule for container records. Requirement to be clarified. | Future |  | Panel Craft list #11 |
| Pallet size as length × width | New Pallet form takes length and width instead of one size field. | Future |  | CR-101 |
| Readable SKU | Acronym-based SKU built from each master's short code (decisions agreed, not built). | Future |  | CR-015 |
| Box Weight in Bulk edit, frozen per order | Search the Items list, select every match, set Box Weight once; each quote / sales-order line keeps the weight it was created with, so Container Planning on older orders does not move. | In progress |  | CR-427 |
| Brand off the Item form | The Item form no longer asks for Brand; the Items grid, search, bulk edit and item page still show it. | In progress |  | CR-430 |
| Locations inside a warehouse | A warehouse holds locations like A1 … F12 (generate the whole grid in one go). Stock is recorded at a location and stays there until a Transfer Order moves it; every label reads Warehouse ▸ Location; old stock shows as Unassigned until moved. | Completed | 2026-10-24 | CR-409 |
| Location per item / per row when recording | Log Production asks the Location per item, Production Completion per line; the bulk Record Production, cut-stock Add / Adjust and Stock Adjustments sheets have a per-row Location column (blank = the bar's default; paste by label or bay code); the Excel import takes a Location column. | Completed | 2026-10-24 | CR-438 |
| Location at every stage | Every production screen records a location (default = the bay of the warehouse marked Production); a pallet carries its location from palletization until it is loaded — asked once in the Palletize dialog (Palletization bay on Start, Loading Bay on Complete), changed with Set Location on the boards, shown as a Location column, on the item's Locations tab and as a Pallets view on Stock Locations; panel orders take a location on the form. | Completed | 2026-10-24 | CR-411…413 |

## Customers

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Customer master (full page) | Code, name, contacts, billing and shipping addresses side by side, country, currency, payment terms, default Box Brand, sales person, brand. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Customer Brands | Several brand names per customer on the Customer detail (add / delete); the Item form offers them as the buyer's Customer Brand. | Completed | 2026-10-23 | CR-393 |
| Customer detail | Quotes, sales orders and dispatches for that customer in one place; Showcase Panels and Customer Samples sections. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Transactions inherit customer fields | Every quote and order fills currency, terms, addresses, brand and box brand from the customer on pick — nothing retyped. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Sign in with Zoho | Login page leads with a Zoho button; password form stays as fallback; only existing active app users get in; roles stay Admin-controlled. | Completed | 2026-10-12 | CR-324 |
| Zoho CRM Accounts as the customer source | Changes arrive via webhook / scheduled pull; Import all once; Create in / Push to Zoho CRM from the customer; From Zoho CRM on the Customers page; Map / Re-pull / Unmap by hand. Contact persons from CRM Contacts; GSTIN, PAN, GST treatment, Place of Supply, Credit Limit, Payment Term picked up automatically. | Completed | 2026-10-21 | CR-359 |
| Zoho Books customer sync (built, switched off) | Two-way customer sync with Zoho Books (event-driven pull, Import all, Push) and the Books tax / credit / notes fields on the customer. Hidden since the switch to CRM at the customer's request; data kept. | Completed | 2026-10-21 | CR-325, 356, 358 |
| Zoho link status per customer | Customers grid column Zoho: CRM & Books / CRM only / Books only; customer page spells it out with both ids; advanced filter takes the states; token handling fixed so the status fills for every synced customer. | Completed | 2026-10-21 | CR-362, 363 |
| Sync never creates a twin; duplicate names are an error | The existing-customer lookup reads every customer; a CRM account whose name already belongs to another linked customer is reported as a duplicate and not created; CRM comes first. | Completed | 2026-10-22 | CR-372 |
| Duplicate customers card | Settings ▸ Zoho CRM ▸ Duplicate customers: Find duplicates → Merge N duplicates (quotes, orders, panel and sample orders move to the surviving customer; reused codes renewed). Import all refuses to run while duplicates exist. | Completed | 2026-10-22 | CR-373 |
| Zoho item reference | Link items to the Zoho item master. Blocked — reference layout never supplied. | Future |  | CR-013.2 |

## Quotes & Approvals

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Quote form (create / edit / clone) | Customer, currency (INR default, any currency with the day's rate), payment terms, box brand, lines item · size · boxes · rate; totals in document currency and INR. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Grouped by design | On screen, in print and in the PDF, with per-design subtotals. | Completed | Phase 1 (by 01-Oct-2026) |  |
| PDF and public share link | Customer-facing PDF and an unguessable share link. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Container planning on the quote | Plan quoted boxes into containers in Box Fitting or Weight Fitting mode; move boxes between containers; fractional fill for mixed containers; optimiser respects pallet slots, area, weight and box caps. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Approvals page | Approve or reject with a reason; sales person notified; an approver's own quotes are born Approved. Lifecycle Draft → Pending approval → Approved → Sent → Accepted → Converted. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Quote aging report | Shows where quotes are stuck. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Suitable Containers panel | Per size on the quote: the container it fits, boxes quoted, containers needed and how full the last one is (on screen). | Completed | 2026-10-03 | CR-262 |
| Planner picks the container per item row | A Container column on every planner row lists the containers of that size built from the chosen pallet; default the largest; saved with the plan; a loading made from the plan starts on it. | Completed | 2026-10-07 | CR-274, 300 |
| Customer search modal | Magnifier beside the Customer field on Quote, Sales Order and New Palletization opens a searchable customer table; dropdown shows code · country. | Completed | 2026-10-06 | CR-276 |
| Suitable Containers on print / PDF / share link | Carry the on-screen Suitable Containers panel onto the printed quote, PDF and share link. | Future |  | CR-262 follow-up |
| Weight fitting from the container's max weight | Planner uses the container's own weight limit instead of a typed tonnage. | Future |  |  |
| Qty total on screen and on the printed quote | Box total shown on the quote and in print / PDF. | Future |  | CR-079 |
| Collapse long remarks / terms | Long remarks and terms fold behind 'view more' so the page does not stretch. | Future |  | CR-088 |

## Sales Orders

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Location mandatory on a Sales Order | The SO form asks where the order's stock will sit (Warehouse ▸ Bay); no SO is created, edited or converted from a quote without it; shown on the order page. | Completed | 2026-10-26 | CR-453 |
| Convert to Sales Order | From an Accepted quote, full or partial (quote becomes Partially converted and can be converted again); the quote's container plan is copied and the order owns its editable copy. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Sales Order form (page) | Same layout family as the quote; PO number; editable after work has started (a line with pallets or loads keeps its item and cannot drop below what was done). | Completed | Phase 1 (by 01-Oct-2026) |  |
| Allocate Stock | Hand free boxes of chosen batches to an order line (one flat table item → batch rows, with search). Allocation is a claim, not a movement. | Completed | Phase 1 (by 01-Oct-2026) | CR-194…200 |
| Status = order lifecycle; Palletization / Loading progress separate | Draft → Pending approval → Confirmed → In progress → Partially completed → Completed, rolled up from dispatched vs ordered. Palletization and Loading progress are their own columns / fields. Admin override with reason. | Completed | Phase 1 (by 01-Oct-2026) | CR-230…233 |
| Order detail tabs and actions | Items (ordered · allocated · palletized · loaded · dispatched per line), Palletization, Dispatch, Activity; Send to Palletization, New Loading, Allocate Stock, Containerise, Clone. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Orders grid, By-order view, Kanban pipeline | Three views over the same data. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Remaining, totals and Deallocate Stock | Items table shows Remaining = Ordered − Allocated and a totals row; ✕ per allocated line returns boxes to free stock unless already palletized; partial deallocate ('5 of 520'); Allocate / Deallocate buttons always visible with the reason when greyed. | Completed | 2026-10-07 | CR-263, 297 |
| Item STOCK card itemises on-hand | Awaiting palletization row between In production and In loading, each with per-order drill-down, so Available adds up on screen. | Completed | 2026-10-07 | CR-298 |
| A worked order cannot be deleted | Once any line is allocated, palletized, loaded, dispatched or on a plan, Delete is greyed and refused ('Cancel it instead'). | Completed | 2026-10-03 | CR-271 |
| Customer PO first, SO number small | Sales Order page titled by the customer's PO with SO/FY/NNN small beneath; Orders grid first column PO Number; drawer and By-Order cards follow. | Completed | 2026-10-19 | CR-353 |
| Cancel Order clears the palletization board | Cancelling a sales order (reason required) removes its boxes from open containers, every palletization line and every allocation; a dispatched container blocks the cancel. | Completed | 2026-10-24 | CR-371 |
| 'Mark in progress' → 'Mark as sent' | Rename the status action to what it means: the sales person acknowledged the customer. | Future |  | CR-041 |
| 'Send to Palletization' in the More menu | Move the action into More and name it 'Palletization'. | Future |  | CR-042 |
| Sales Order page without Panel Orders tab | Production, Palletization and Container Planning tabs only; Request Panels stays in the More menu. | Completed | 2026-10-24 | CR-422 |

## Production

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Production page — Sheet / Kanban / Grid | Three views of the same rows (Sheet default); one row per logged batch; Group by Item / Customer / Order / Size; status filter with All. | Completed | Phase 1 (by 01-Oct-2026) |  |
| To Produce view | Per item: open demand, free stock, in production and what still needs producing, with the Box Brand wanted; tick rows to start a job. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Start / Log / Complete Production | Start creates the job (Item · Quantity); Log adds batch rows from the row's + menu (first log → In Production, full coverage → Completed automatically); Complete closes the job. | Completed | Phase 1 (by 01-Oct-2026) | CR-234…237 |
| Record Production sheet (bulk, make-to-stock) | One ruled sheet, one row per item: Size · Design · Batch (blank = automatic) · Box Brand · Qty · Remark; paste from Excel; one Save records every row into stock; retry-safe. | Completed | Phase 1 (by 01-Oct-2026) | CR-244, 264 |
| Sheet edit mode | Edit makes plan qty, Produced and Status editable across rows; nothing written until Save; invalid cells block Save. | Completed | Phase 1 (by 01-Oct-2026) | CR-111 |
| Excel import of the factory file | Import production from the factory's spreadsheet. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Batch numbering and rules | Batches auto-numbered B/YYYY-MM/NNN (restarts monthly per item) or typed; never repeats on one item; Box Brand on every batch row; over-production blocked. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Production detail page | Lines, batches logged, activity. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Date-first production | Grid opens grouped by date with the Production ID hidden; page titled by its date with the PRD number small; Bulk Record Production is the default button. | Completed | 2026-10-03 | CR-265, 267 |
| Quality Control stage on the board | QC exists in the data model; putting it on the board is parked. | Future |  | CR-051 |
| Duplicate detection on Excel re-import | Warn / skip when the same production file is imported twice. | Future |  |  |
| Production toolbar: Table + Sheet | Two views only; Kanban, To Produce and Import hidden. Filter, search, Group, Fields, Edit, Start New Production and Bulk Record Production stay. | Completed | 2026-10-24 | CR-417 |

## Palletization

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Palletization board and plan numbers | Sheet and Kanban views, Group, Today's Report, New Palletization; plans numbered PAL/FY/NNN; a plan may span several orders of one customer; each line is one item × one batch. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Columns, totals footer and selection bar | Customer · Item · Order · Batch · Boxes · Remaining · Age · Ready Pallets (N (boxes)) · Pallet type; totals footer; selection bar when rows are ticked. | Completed | Phase 1 (by 01-Oct-2026) | CR-279 |
| Plan detail page | Lines with status, batches, pallets; Edit + More; activity. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Prints on demand | Pallet Packing Report; Pallet Slips (one per physical pallet, mixed pallet lists every batch); pallet QR labels; batch QR slips. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Board rules | Planned boxes never exceed the order; batches attributed oldest-first; a hand-edited plan is pinned; the palletized part of a batch can be loaded while the rest is in progress. | Completed | Phase 1 (by 01-Oct-2026) | CR-129, 248 |
| Three ways onto the queue | Automatic from every production record; New Palletization (customer-first page); Send to Palletization from a sales order. | Completed | Phase 1 (by 01-Oct-2026) | CR-223/224 |
| '+' menu: Start / Top Up Batch / Complete | Start confirms the pallet format; Top Up (Mix Batch) moves boxes of another batch onto the open pallet; Complete records finished boxes to Ready for Loading, partial is normal and the rest is re-queued. | Completed | Phase 1 (by 01-Oct-2026) | CR-148…150, 281 |
| Sheet edit mode and multi-select | Edit adds Palletise qty and Top Up From cells on every row (✓ / ✗ per row, Save all); multi-select rows → palletize together, print slips, or Load. | Completed | Phase 1 (by 01-Oct-2026) | CR-153 |
| Date column, PAL code hidden | Grids show the date a line entered palletization; PAL code available in the column picker. | Completed | 2026-10-03 | CR-266 |
| Complete dialog shows progress | Per item: ready pallets (boxes) already palletized and boxes still remaining. | Completed | 2026-10-06 | CR-280 |
| Plan edit keeps Box Brand and batches | Editing a plan carries carton brand and batch of each line; a Completed plan is refused. | Completed | 2026-10-13 | CR-340 |
| Three pages, one stage each | Ready for Palletization, In Palletization, Palletization Completed (waiting to load); no status filter — each page lists its own rows. | Completed | 2026-10-21 | CR-360, 364 |
| Release palletized boxes | From the + menu on Palletization Completed and Loading: boxes + reason. Loaded boxes return to Ready for Loading; palletized boxes return to free stock with the allocation; partial or whole; dispatched refused. | Completed | 2026-10-21 | CR-361 |
| Discard the current palletization task | + menu on Ready for / In Palletization: boxes + reason; boxes return to free stock and the allocation is returned. Reason required for every role. | Completed | 2026-10-24 | CR-369 |
| Delete a plan returns its boxes | Deleting a palletization returns every line to free stock first; refused while any box sits in a container. | In progress |  | CR-370 |
| Partial Start Palletization | Start only part of a Ready row (today Start takes the whole line; partial is on Complete). | Future |  | Panel Craft list #9 |
| Ready pallets — type and pallet count | Show pallet type and count per ready row / print. To be confirmed against what CR-279 already shows. | Future |  | Panel Craft list #7 |
| Remove 'Ordered / Completed' where not needed | Screen to be confirmed. | Future |  | Panel Craft list #8 |

## Loading & Dispatch

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| A loading = one container | Numbered LOAD/FY/NNN; a multi-container plan groups its containers. | Completed | Phase 1 (by 01-Oct-2026) | CR-120…124 |
| Loading and Dispatch page | Sheet with derived stages Ready for Loading → In Loading → Ready for Dispatch → Dispatched; Loadings grid (one row per container); Customer Sheet (every loaded line of one customer, export style). | Completed | Phase 1 (by 01-Oct-2026) | CR-140, 141 |
| Loading detail | Loaded Items (Mix Batch pallets as a tree), Loading Sheet tab (export-style ruled sheet, editable in place), Container Planning tab, Activity. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Vehicle and shipment details | Vehicle number (auto-formatted), driver, mobile, transporter, LR number, destination, supervisor, container size / number, seals; Vehicle master updates itself. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Dispatch with gates and warnings | Dispatch always on the menu, greyed with the reason when it cannot run; blank seals / LR / transporter warn; duplicate seal or container numbers warn; dispatch events show on the order and the plan. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Invoice and dispatch prints | Invoice per container (PDF); Dispatch Entry and Dispatch Copy with design names and pallet numbers. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Four ways to fill a container | New Loading page (batch picker chooses pallets + loose boxes, Fill from plan); Load from the palletization board; New Loading from a sales order; Send to Loading from an order. | Completed | Phase 1 (by 01-Oct-2026) | CR-126…128, 201/202 |
| Editing a loading | Reduce loaded quantities (rest returns to Ready for Loading), remove lines, add pallets, complete details; Sheet edit mode for loaded qty / move / unload. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Date column, LOAD code hidden | Sheet and Loadings grid show the loading date; LOAD code in the column picker. | Completed | 2026-10-03 | CR-266 |
| Several containers in one New Loading | One section per container, each with its own Container Master pick, item rows and vehicle; stock shared across sections; one Save creates the linked loadings. | Completed | 2026-10-07 | CR-301 |
| Loading Workspace — a tab per container | New Loading and Edit are one page: each container a tab with a plain sheet and its own vehicle & seals rail; Dispatch and documents per tab; Tabs | Sheet toggle shows every container on one grid. | Completed | 2026-10-12 | CR-326, 334, 335 |
| Every customer listed, with search | Loading and Palletization list all active customers (stock-bearing first) with the search modal. | Completed | 2026-10-12 | CR-327 |
| 'What to do first' reasons | A customer or order that cannot be loaded / palletized shows why and the next step; Sales Order detail shows a Next: line. | Completed | 2026-10-12 | CR-328 |
| Pick the planned container at loading | Each container tab's plan row is a picker over the order's planned containers (format, pallets, boxes, Planned / Sent / Claimed by); the claim is saved. | Completed | 2026-10-13 | CR-338 |
| Two steps per container; C1 / C2 naming | Designs & pallets first, then Container & vehicle (container pick, number, vehicle, driver, seals) under the rows; party and customer PO lead the header, SO numbers small. | Completed | 2026-10-19 | CR-350, 354 |
| Mix Batch at loading | Top up a pallet with another batch at loading time, not only at palletization. | Future |  | CR-260 follow-up |

## Stock & batch ledger

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| One stock rule everywhere | Opening + produced − loaded, oldest batch first — used by Stock Details, reports, pickers and the server alike. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Counters recomputed, never incremented | Order-line counters are recalculated from the records, so a failed save can never leave a wrong total. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Allocation and batch ledger | Allocation = a claim on free stock, visible on the order line; the ledger shows where every batch went (produced → queued → palletized → loaded → dispatched). | Completed | Phase 1 (by 01-Oct-2026) |  |
| Admin repair operations | Settings ▸ Data operations: recount order lines, resync size snapshots, backfill line pallets, renumber loadings, re-attribute blank batch lines. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Inventory adjustments | Inventory ▸ Stock Adjustments: every ± correction with reason (Adjustment Reason master); bulk New Adjustment sheet; never below on hand; warns when it eats reserved boxes; every stock reader includes adjustments. | Completed | 2026-10-07 | CR-308 |
| Stock per warehouse | Every stock entry records its warehouse (default primary); loads take from the warehouse holding the batch, Loading Bay first; global figures unchanged. | Completed | 2026-10-12 | CR-329 |
| Transfer Orders | Inventory ▸ Transfer Orders: dated TRF/FY/NNN moving boxes or cut pieces between warehouses with a reason; a line cannot exceed what the From warehouse holds. | Completed | 2026-10-12 | CR-330 |
| Locations on items | Item detail ▸ Locations tab (warehouse → batches, on hand · committed · available); Panel Item detail ▸ Locations card. | Completed | 2026-10-12 | CR-332 |
| Stock keyed by the item | Live stock, opening / adjustment / allocation sums and To Produce demand key on the item, not its shared design name; Item detail agrees with Allocate Stock. | Completed | 2026-10-13 | CR-341 |
| Stock adjustment as a line form | Adjust Stock (Panel Craft) and New Stock Adjustment (Inventory) open with one line and '+ Add line' like Zoho Books; each line shows the current stock at its location and carries its own Location, Add / Remove, Qty, Date, Reason and Remark; Add Stock and Transfers keep the bulk sheet. | Completed | 2026-10-25 | CR-446 |

## Reports & audit

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Sales reports | By Item, By PO, Customer Sales, Salesperson Sales, Size-wise, Quote Aging — date range, filters, CSV, day / week / month buckets. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Inventory reports | Live Stock, Batch-wise Stock (over-consumed flagged), Production Batches (list or item × date matrix), Batch Movement (pivot), Ready Pallets. | Completed | Phase 1 (by 01-Oct-2026) | CR-104 |
| Dispatch reports | Palletization Status, Loading & Dispatch (per container with vehicle, seals, transporter, LR, destination, fill %), Dispatch Register. | Completed | Phase 1 (by 01-Oct-2026) | CR-104 |
| Audit log and activity | Every change logged with who and what; every status move recorded; admin overrides carry their reason; Audit Log page plus Activity tab and Status history on every record. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Dashboard | Headline numbers. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Warehouse Stock report | Boxes or cut pieces, list or Item × Warehouse matrix, a tile per warehouse, filters, CSV. | Completed | 2026-10-12 | CR-331 |

## Panel Craft

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Add many items to Panel Craft at once | Search and tick items from the Item master, one Add; each gets its full-size cut piece. | Completed | 2026-10-26 | CR-452 |
| Location mandatory on a Panel Order | A panel order cannot be saved without saying where its panels will sit. | Completed | 2026-10-26 | CR-453 |
| Panel Master | Showcase panel master with one image, PANEL-001 numbering by the server, full-page New / Edit form; grid opens as photo tiles with a toggle to the column grid; row / tile click opens the panel. | Completed | 2026-10-08 | CR-283…285, 291, 319 |
| Remarks on a panel | Free-text Remarks on New / Edit Panel for the old reference ID; shown on the panel page and searchable in the panel list. | In progress |  | CR-425 |
| Cut Piece Size master under Panel Items | The cut piece size list is maintained from the Panel Items page (Cut Piece Sizes button) instead of Settings ▸ Masters. | In progress |  | CR-426 |
| Panel Items with weighed cut pieces | Designs picked from the Item master into Panel Craft, each with its cut pieces (add, weigh, remove); the Panel form offers only these. | Completed | 2026-10-07 | CR-306 |
| Cut Piece stock as items + bulk sheets + ledger | One row per cut piece (image, size, weight, on hand, stock weight); Add Stock and Adjust Stock are dated bulk sheets; every movement in a ledger shown as Stock History. Menu reads 'Cut Piece'. | Completed | 2026-10-15 | CR-282, 307, 308, 343 |
| MDF master | Settings ▸ Masters ▸ MDF: Size · Thickness · Weight rows; the Panel master states its MDF size; the order line picks a thickness; weight = cut pieces + MDF, × qty. | Completed | 2026-10-15 | CR-309, 320, 344 |
| Panel Order = header + lines | One customer order holds several panels (PNL/FY/NNN); SO-shape form (Pick from showcase with Design · Panel Size · Cut Piece Size · In-stock filters) and detail; loose cut-piece lines ('10 panels + 20 cut pieces'); blank cut piece size = full size. | Completed | 2026-10-21 | CR-302, 304, 310, 346, 289, 357 |
| Panel Order page is the only place status changes | Status chip, next-step buttons (Accept / Start Cutting / Ready / Dispatch), Edit, More ▸ Clone / Delete, Overview | Activity; every order is born 'New'. | Completed | 2026-10-07 | CR-287, 294 |
| Request Panels / Samples from a Quote or Sales Order | More ▸ Request Panels / Request Samples opens the new order with the customer locked and the sale's designs picked; the Quote / SO gains a Panel Orders tab. | Completed | 2026-10-08 | CR-286, 317 |
| Requirements checklist with booking | Per design × cut size: Need, In Stock, Allocated · Short, the panels it serves; one Allocate Stock modal; Dispatch needs every piece booked; Ready books its own output. Replaces the godown print slip. | Completed | 2026-10-07 | CR-288, 303, 305, 312 |
| Production checkpoints | MDF · Vinyl Printing · Cut Pieces · Vinyl Pasted on MDF, marked independently with who / when; readiness on the page, sheet, cards and dashboard. | Completed | 2026-10-09 | CR-313, 323 |
| Pending Cut Piece page | Per cut piece: Required · On Hand · Booked · Free · Shortage · Orders (each order linked with its quantity). | Completed | 2026-10-09 | CR-314, 322 |
| Sample Orders | Separate order type (SMP/FY/NNN) for customer samples — full tile or cut piece; per-line partial supply with a date; cut pieces come off cut stock; Customer page lists every sample line. | Completed | 2026-10-08 | CR-315…317 |
| One Orders register | Panel + Sample orders in one grid with a Type column and filter; New Order asks the type first. | Completed | 2026-10-15 | CR-345 |
| Loading entries and Panel Craft ▸ Loading page | Record Load per order (date, vehicle, driver, photos, qty per line × material — Panel / MDF / cut piece); several orders per trip; Dispatched is derived from the loads; Loading page lists everything pending with multi-select → one trip. | Completed | 2026-10-15 | CR-347, 348 |
| Weight split and frozen at load | Pieces kg · MDF kg · Total kg; shipped kg stamped at load time; pending kg follow the master. | Completed | 2026-10-15 | CR-349 |
| Load Copy print | Branded Load Copy PDF per trip (vehicle block, lines, kg, signatures) from the Loads table; vehicle details kept on the Vehicle master. | Completed | 2026-10-19 | CR-351 |
| Load Copy from the Actions tab | The panel order Actions tab lists every vehicle trip under Load Copy, newest first; each copy shows only what left on that trip. | Completed | 2026-10-24 | CR-433 |
| Panel Craft dashboard | Open / in-cutting / ready / short counts, cut stock pcs + kg, pipeline strip, panels by status, orders per week, shortages, most-ordered panels, latest orders, Pending to Load. | Completed | 2026-10-07 | CR-311 |
| Small UX items | Upload shows the BOFFO processing state; Stock column Available / Unavailable; Panels column opens a card list; filter × clears; (i) card per line; notes under the content they explain. | Completed | 2026-10-19 | CR-293, 295, 318, 321, 352 |
| Actions tab on the Panel Order | Per line × material: Ordered · Loaded · Pending · Ready or what is missing · Load Now; Dispatch opens Record Load with those quantities. | In progress |  | CR-365 |
| Vinyl Pasted waits for MDF + Vinyl | The pasted checkpoint is greyed and refused until both MDF and Vinyl Printing are Ready. | In progress |  | CR-366 |
| One Status column | Pending · Not Started · In Progress · Ready · Completed · Cancelled replaces the four checkpoint columns + Readiness on the grid, kanban, dashboard and detail chip; lifecycle stage shown as a Stage field. | In progress |  | CR-367 |
| Cancel Order (panel and sample) | Reason required for everyone; blocked once a load exists; bookings return to free stock. | In progress |  | CR-368 |
| Panel Order page: customer heading | The customer's name is the page title; the PNL number sits small under it. | In progress |  | CR-399 |
| One four-state order status | New → Ready (every panel pasted) → Completed (pieces booked too) → Dispatched, derived automatically; no Accept / Start Cutting buttons. | In progress |  | CR-400 |
| Vinyl print waits for MDF | The Vinyl Printing mark opens only once that panel's MDF is Ready. | In progress |  | CR-401 |
| Marks on the Actions tab | MDF · Vinyl · Pasted are set per panel on the Actions tab beside the loading rows. | In progress |  | CR-402 |
| Load pieces, boards or both | Cut pieces load once booked; the MDF board once pasted; one row alone or everything ready together. | In progress |  | CR-403 |
| Load part of a panel | Each panel lists its cut pieces one kind per row; any count can leave on a trip, the rest later. Stock and booking move per piece kind. | In progress |  | CR-405 |
| MDF row on every panel | Every panel line has an MDF board row, thickness picked or not; it loads once the vinyl is pasted. | In progress |  | CR-406 |
| Load whole panel in one click | A panel's + menu loads all its ready pieces and its pasted board on one vehicle; Allocate Stock sits on the Actions tab. | In progress |  | CR-407 |
| Stock list: items with their cut pieces beneath | Panel Craft ▸ Stock (was 'Cut Piece'): one row per item with totals, its cut pieces listed beneath; fold an item, search by item, size or cut size. | Completed | 2026-10-25 | CR-448 |
| Panel Item page: read-only weight, Actions tab | The item's Details tab shows cut pieces read-only; adding a cut piece, removing one and the Add Stock / Adjust / Transfer buttons sit on an Actions tab; the weight per piece is the formula value, never typed. | Completed | 2026-10-25 | CR-449 |
| Panel Order page: Details informative, Requirements on Actions | The Requirements card (need, in stock, allocated, short, Available tick, Allocate Stock) lives on the Actions tab; Details shows the order's fields and items only. | Completed | 2026-10-25 | CR-450 |
| Panel location | Set where a panel order's panels sit (More ▸ Set Location); shown on the order, as a grid column and in the Stock Locations report's Panels view. | Completed | 2026-10-24 | CR-410 |
| Actions tab: panels on top, cut pieces below | One row per panel with its marks, its MDF board and a status; click a panel to see its cut pieces underneath with their own Load boxes. Pending counts amber, loaded ones say Loaded; no empty spanning cells. | Completed | 2026-10-24 | CR-419 |
| Actions tab reads at a glance | Material cell = cut size (150x150) or MDF — the design sits behind the Line ⓘ; Status on one line; Vinyl / Pasted dropdowns visibly greyed until their gate is met, with the reason on hover. | Completed | 2026-10-24 | CR-415 |
| Readiness tab on every Panel / Sample order | Per-order dashboard: ring of panels ready to load, next stage headline, Panels · Pieces · Ready · Pending tiles, one ring per stage (MDF · Vinyl · Pasted · Cut pieces · Weighed · Loaded) and a stage-cell table per panel — all read from the marks, booking, weight and loads already recorded. Sample orders show the one stage Supplied. | Completed | 2026-10-23 | CR-404 |
| 'Full size — 800x1600' placeholder on the form | The form half of the full-size default: keep lines without a cut piece size and show the design's size as the placeholder. | In progress |  | CR-289 follow-up |
| Status change from within the Panel Orders form | Change the stage while editing the order, not only on the order page. | Future |  | Panel Craft list #3 |
| Panel request from Quote / SO — refinements | Follow-ups to the New Request flow. Scope to be confirmed. | Future |  | Panel Craft list #2 |
| Panel auto-sequence | PANEL-NNN is already automatic; what 'sequence' should add is to be clarified. | Future |  | Panel Craft list #4 |
| Godown print — issue / request | A printed issue / request slip for the godown. | Future |  | Panel Craft list #5 |
| Missing items to fulfil an order | A view of what is missing per order (Pending Cut Piece + requirements exist; the extra needed is to be clarified). | Future |  | Panel Craft list #6 |
| Bill / expense | Record expenses or bills against panel work. New area, scope to be defined. | Future |  | Panel Craft list #12 |

## Items

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| Bulk Upload items from Excel | Download a sample template, fill it, upload: columns matched, every row checked (unknown Size / Finish, duplicates, items that already exist), valid rows created with SKUs and unique names as the form would. | Completed | 2026-10-26 | CR-451 |
| Base Design Name defaults to the Design Name | Leave Base Design Name blank and the item is saved with its Design Name as the base; the field stays clearable while editing. | Completed | 2026-10-24 | CR-437 |

## Documentation & process

| Feature | What it does | Status | Delivered on | Ref |
|---|---|---|---|---|
| System reference and change-request register | The system as built, kept true with every change; every request numbered with Change · Where · Why · Apply to · Like · Done when, status, date and proof. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Change log, user flow, user manual | Dated change log, user flow guide, user manual, formula reference. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Seed and teardown scripts | Create a full customer-to-dispatch test flow and remove it. | Completed | Phase 1 (by 01-Oct-2026) |  |
| Data Flow reference | For every record type, every screen and server action that can create, change, delete or re-status it, and the one place each rule lives. | Completed | 2026-10-03 | CR-272 |
| Phase 2 inventory | Running plain-language inventory of Phase 2, updated as each request ships. | Completed | 2026-10-03 |  |
| Locations guide | User-manual chapter: what to set up before using locations (warehouses, primary, bays, purposes), every screen where a location is picked or shown for boxes, pallets and panels, and the two rules for the floor. | Completed | 2026-10-24 | CR-411…413 |
| Deliverables list (this workbook) | Feature-wise list of Completed / In progress / Future deliverables, maintained in Excel from here on. | Completed | 2026-10-22 |  |
| Demo / test environment | A second, fully separate copy of the system (own database with the same 60 tables, own server functions, public web address) filled with dummy data for demos and testing; live data is never touched. Runbook: docs/DEMO-ENVIRONMENT.md. | Completed | 2026-10-25 | CR-441 |
