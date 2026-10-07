# BOFFO Order OS — Phase 1: what has been built

**Period:** 8 June 2026 → 1 October 2026 · **Change requests:** CR-001 … CR-260 · **Status:** live and in daily use

This is the plain-language inventory of Phase 1. It says what each part of the system is, what it
contains, and how the work is done in it. The technical reference is `SYSTEM.md`; the request-by-request
history is `CHANGE-REQUESTS.md`. Anything requested from 1 October 2026 onward is **Phase 2** and is
listed separately in `PHASE-2-FEATURES.md`.

---

## The system in one line

```
Quote → Approval → Sales Order → Production → Palletization → Loading → Dispatch → Invoice
```

- **Boxes are the unit everywhere.** Pieces → boxes → pallets → containers; every screen converts for you.
- **The golden rule:** a box cannot be palletized before it is produced, loaded before it is palletized,
  or dispatched before it is loaded. Every downstream number is derived from what was recorded upstream,
  so the figures on orders, reports and sheets always agree.
- **Who uses it:** sales staff (quotes, orders), production coordinators (output), warehouse and logistics
  staff (palletization, loading, dispatch), and an administrator (masters, users, settings).

---

## Summary

| # | Module | What it does | Effort recorded (h) | Conventional build (h) |
|---|---|---|---|---|
| 1 | Foundation & workspace | Sign-in, roles, shell, settings, the shared UI standard, security, tours | 60 | 200 |
| 2 | Masters (Inventory) | Items, Size Master, Pallet Master, Stock Details, lookups, import | 50 | 150 |
| 3 | Customers | Customer master with addresses, terms, defaults | 15 | 50 |
| 4 | Quotes & Approvals | Quote form, approval flow, PDF/share, container planning | 55 | 180 |
| 5 | Sales Orders | Convert, allocate stock, status roll-up, edit after work | 45 | 150 |
| 6 | Production | Start / Log / Complete jobs, bulk Record Production sheet, To Produce | 60 | 180 |
| 7 | Palletization | Two-page board, plan form, + menu, partial and mixed pallets, prints | 65 | 200 |
| 8 | Loading & Dispatch | New Loading page, pallet picker, loading sheet, dispatch, invoice | 80 | 260 |
| 9 | Stock & batch ledger | The accounting spine: FIFO stock, allocation, batch trail, repairs | 25 | 90 |
| 10 | Reports & audit | 14 reports, pivots, CSV, audit log, activity on every record | 25 | 80 |
| 11 | Panel Craft | Cut stock, showcase panels, panel orders | 20 | 70 |
| 12 | Documentation & process | System reference, CR register, change log, manuals, seed scripts | 15 | 40 |
| | **Total** | | **≈ 515** | **≈ 1,650** |

How the two columns were estimated is explained at the end.

---

## 1 · Foundation & workspace

**What it is.** Everything every other module stands on: who may do what, how the app looks and behaves,
and how a new user learns it.

**What it contains**

- **Sign-in and sessions.** Email + password, sessions last 7 days, sign-out from the user menu.
- **Roles and permissions.** A role says, per module, whether its users can view, create, edit, delete
  and export, and which document types they may approve. The Admin role is the superuser. Roles and
  users are managed under Settings. Permissions are enforced by the server, not just hidden in the menu.
- **Security hardening.** Image uploads accept real raster images only; query injection closed; secure
  cookies; CORS allow-list; state columns (statuses) cannot be set through generic saves. Two review
  passes (July and September 2026).
- **App shell.** Sidebar grouped Dashboard · Inventory · Sales · Reports, filtered by role; global
  search; header user menu; settings gear for admins.
- **Settings workspace.** Two-pane page: Preferences (including the org-wide default view, Sheet or
  Kanban), Masters, Users, Roles, Currencies, Data operations (admin repair tools).
- **The house UI standard, applied on every screen.**
  - Grids: one-line rows, page footer, show/hide and reorder columns (changes apply on **Apply**),
    advanced search, newest first, click anywhere on a row to open it, Columns/Group/Status buttons
    light up when they are in effect.
  - Forms: required fields marked with a red asterisk and a legend; grey = calculated for you, white =
    you type; ƒx marks a formula; every pick list comes from the live masters; dates default to today;
    Sales Person defaults to the signed-in user; no negative numbers anywhere.
  - Detail pages: one design everywhere; **Edit** and **More** top-right; every record can be
    **Cloned**; after creating or cloning you land on the new record.
  - Create and edit forms are full pages, not pop-ups (Quote, Sales Order, Item, Pallet, Customer,
    Production, Palletization, Loading).
  - One visual language (indigo/slate theme, one input skin, one button family, one font scale).
- **Onboarding.** A welcome tour on first sign-in walks the business flow page by page; Palletization
  and Loading each have a page guide; both can be replayed from the user menu.
- **Public pages.** Pallet QR scan page, batch QR slip page and item images open without sign-in via
  unguessable links.

---

## 2 · Masters (Inventory)

**What it is.** The reference data every transaction is built from.

**What it contains**

- **Items (Design Master).** One record per sellable tile: name, SKU, size, finish, category, glaze,
  grade, brand, images (gallery with lightbox), per-box weight (editable, with per-piece and per-m²
  helpers), batch-tracked flag, Active / Inactive status. Item detail shows stock, production and
  orders for that item.
  - **Opening stock** is entered once per item (per batch for batch-tracked items) and locks after the
    first save; an admin can re-open it with a reason that is written to the audit log.
  - **Excel import** of production from the factory's sheet.
- **Size Master.** Dimensions, pieces per box, coverage in m² and ft², box weight. Items and pallet
  formats take a snapshot of the size so the operator is never asked twice; editing a size fans the new
  packing data out to them (a typed weight on the item is kept).
- **Pallet Master.** Pallet *formats*: boxes per pallet, dimensions, which size they fit. Pick lists
  offer the formats that match the item's size.
- **Stock Details.** Batch-wise on-hand per item.
- **Lookups.** Brand / Box Brand (with a logo shown on forms), Grade, Finish, Category, Glaze, Payment
  terms, Currency with exchange rate, Vehicle (kept in sync automatically from typed vehicle numbers),
  Container sizes (20 ft, 40 ft, 28 ft, 30 ft), Organization, document number series.

---

## 3 · Customers

**What it is.** The customer master and the single place to see everything about a customer.

**What it contains**

- Customer form (full page): code, name, contacts, **billing and shipping addresses side by side**,
  country, currency, payment terms, default Box Brand, sales person, brand.
- Customer detail: quotes, sales orders and dispatches for that customer in one place.
- Every quote and order **inherits all customer fields** on pick (currency, terms, addresses, brand,
  box brand), so nothing is retyped.

---

## 4 · Quotes & Approvals

**What it is.** The commercial start of every order.

**What it contains**

- **Quote form** (create / edit / clone as a page): customer, currency (INR by default, any currency with
  the rate captured on the day), payment terms, box brand, lines with item · size · boxes · rate;
  totals in both the document currency and INR.
- **Grouped by design** on screen, in print and in the PDF, with per-design subtotals.
- **PDF and public share link** for the customer.
- **Container planning** on the quote: plan the quoted boxes into containers in **Box Fitting** or
  **Weight Fitting** mode; move boxes between containers; mixed containers show a fractional fill; the
  optimiser respects pallet slots, area, weight and box caps at the same time.
- **Approvals page** (only for roles that may approve): approve or reject with a reason; the sales
  person is notified. A user who can approve creates quotes that are born Approved.
- **Quote aging** report shows where quotes are stuck.

**Process**

```
Draft → Pending approval → Approved → Sent → Accepted → Converted (or Partially converted)
```

Rejected goes back to Pending approval. Only an **Accepted** (or Partially converted) quote can become
a sales order.

---

## 5 · Sales Orders

**What it is.** The confirmed commitment that production, palletization and loading all work against.

**What it contains**

- **Convert to Sales Order** from an accepted quote: full or partial (the quote becomes Partially
  converted and can be converted again). The quote's container plan is copied onto the order, which
  then owns its own editable copy.
- **Sales Order form** (page): same layout family as the quote; PO number; editable **after work has
  started** (a line that already has pallets or loads keeps its item and cannot drop below what was
  done).
- **Allocate Stock**: hand free boxes of chosen batches to an order line (one flat table, item → batch
  rows, with search). Allocation is a claim on stock, not a movement.
- **Status is the order lifecycle only**:

  ```
  Draft → Pending approval → Confirmed → In progress → Partially completed (n left) → Completed
  ```

  Partially completed / Completed roll up automatically from dispatched vs ordered boxes. Palletization
  progress and Loading progress are their own columns on the grid and fields on the detail. An admin can
  set any status by hand with a mandatory reason.
- **Order detail tabs:** Items (ordered · allocated · palletized · loaded · dispatched per line),
  Palletization (pallets and batches), Dispatch, Activity. Actions: Send to Palletization, New Loading,
  Allocate Stock, Containerise (edit the plan), Clone.
- Orders grid, By-order view and a Kanban pipeline over the same data.

---

## 6 · Production

**What it is.** Recording what the factory made. The factory produces **to stock**; stock is then
allocated to sales orders. Production no longer has to be tied to an order.

**What it contains**

- **Production page** with three views of the same rows: **Sheet** (grid, the default), **Kanban**
  (New · In Production · Completed) and **Grid**, one row per logged batch, Group by Item / Customer /
  Order / Size, status filter with All.
- **To Produce** view: per item, open demand, free stock, in production and what still needs producing,
  with the Box Brand wanted; tick rows to start a job for them.
- **Production detail** page: lines, batches logged, activity.
- **Batches.** Numbered automatically as B/YYYY-MM/NNN (restarts each month per item), or typed; the
  same batch number can never repeat on one item. Box Brand is captured on every batch row.
- Over-production is blocked; a job cannot record more than it asked for.
- Quality Control stage exists in the data model but is parked (not on the board).

**Processes — the same output can be recorded four ways**

1. **Start New Production → Log Production → Complete Production** (individual job).
   - *Start New Production* creates the job only (Item · Quantity, details below). It lands in In
     Production with nothing produced yet.
   - *Log Production* is the row's **+** menu: one or more batch rows (Batch No. · Boxes · Date · Box
     Brand) against the job. The first log moves the job to In Production; when logs cover the
     requested quantity it moves to Completed on its own.
   - *Complete Production* closes the job, with a final batch number if needed.
2. **Record Production sheet** (bulk, make-to-stock). One ruled sheet, one row per item: Design · Batch
   No. (blank = automatic) · Date · Qty, plus optional Size / Box Brand / Remark. Twenty rows to start,
   grows as you type; Enter and arrows walk a column; paste a block from Excel. One **Save** records every
   row straight into stock. If the save is interrupted, saving again records only what is missing.
3. **Sheet edit mode.** On the Sheet view, **Edit** makes In Production (plan qty), Produced and Status
   editable across every row; nothing is written until **Save**; invalid cells block Save.
4. **Excel import** of the factory's production file.

---

## 7 · Palletization

**What it is.** Turning produced boxes into pallets ready to load, batch by batch, customer by customer.

**What it contains**

- **Two pages over one board.** *Ready for Palletization* (the queue, grouped by sales order) and *In
  Palletization*. Each has Sheet and Kanban views, Group, a status filter with **All** (finished rows
  read-only), Today's Report and New Palletization.
- **Plan numbers** PAL/FY/NNN; a plan may span several orders of one customer; each line is one item ×
  one batch.
- **Columns** Customer · Item · Order · Batch · Boxes · Ordered · Completed · Remaining · Age; a totals
  footer (pallets and boxes) and a selection bar when rows are ticked.
- **Plan detail** page: lines with status, batches, pallets; Edit + More; activity.
- **Prints, on demand only:** Pallet Packing Report; Pallet Slips (one per physical pallet; a mixed
  pallet lists every batch on one slip); pallet QR labels; batch QR slips.
- **Rules.** Planned boxes never exceed the order; batches are attributed oldest-first from production;
  a plan edited by hand is pinned (the automatic queue stops touching it); the palletized part of a
  batch can be loaded while the rest is still in progress (the row says "300 of 400 palletized").

**Processes**

- **Getting boxes onto the queue — three ways.**
  1. **Automatic.** Every production record tops up the item's queue on one open plan per order.
  2. **New Palletization** (customer-first page): pick the customer → their open orders appear → one
     row per design with produced boxes and batches read-only → Save. Batches are attributed from
     production automatically and taken from the waiting queue, so nothing is queued twice.
  3. **Send to Palletization** from a sales order.
- **Working a row — the "+" menu, three steps.**
  1. **Start Palletization** confirms the pallet format (pallet prefilled from the order's container
     plan) and moves the line to In Palletization.
  2. **Top Up Batch** (Mix Batch) moves boxes of another batch of the same design onto the open pallet;
     the pallet then prints as one slip listing every batch.
  3. **Complete Palletization** records the finished boxes to Ready for Loading. **Partial is normal:**
     700 today, 300 tomorrow; the remainder stays where it was.
- **Sheet edit mode** (bulk): **Edit** adds a Palletise quantity cell and a Top Up From cell on every
  row; ✓ / ✗ commit or discard one row, **Save** commits all.
- **Multi-select** rows → palletize together, print slips, or **Load** (opens the loading flow).

---

## 8 · Loading & Dispatch

**What it is.** Putting palletized stock into a container, capturing vehicle and seals, and dispatching.

**What it contains**

- **A loading = one container**, numbered LOAD/FY/NNN; a multi-container plan groups its containers.
- **Loading and Dispatch page:** a **Sheet** whose stages are derived, never typed —
  *Ready for Loading* → *In Loading* → *Ready for Dispatch* (container number or seal captured) →
  *Dispatched* — plus a **Loadings grid** (one row per container with customers, orders, pallets, boxes,
  vehicle, seals, totals) and a **Customer Sheet** (every loaded line of one customer across all their
  orders, export style).
- **Loading detail:** header with Edit + More; **Loaded Items** (pallets and boxes per line, Mix Batch
  pallets shown as a tree with an MXBATCH chip); **Loading Sheet** tab (the export-style ruled sheet:
  Design · Batch · P.O. · Size · Finish · Box Brand · Pallet No. · Pallet type · Boxes, with merged
  truck / container / seal cells; editable in place, Truck No. typed, Pallet No. typed or auto
  "1 TO 16"); **Container Planning** tab (the order's plan, editable); **Activity**.
- **Vehicle is free text:** vehicle number (auto-formatted), driver, mobile; the Vehicle master updates
  itself silently. Transporter, LR number, destination, supervisor, container size and number, seals.
- **Dispatch** is always on the menu; it is greyed with the reason when it cannot run (no vehicle, or
  nothing loaded). Blank seals, LR or transporter only warn. Duplicate seal or container numbers across
  loadings warn. Dispatch events appear on the order and the plan as well.
- **Invoice per container** (PDF). Dispatch Entry and Dispatch Copy prints with design names and pallet
  numbers.
- **Loading Plan** page: a spreadsheet-style alternative skin for New Loading (trial, kept beside the
  main page).

**Processes — a container can be filled four ways**

1. **New Loading** (the main page, laid out like a Sales Order form):
   Customer (optional filter; a container may mix customers) → Loading details → **Item Table**: one
   row per item, the **batch picker** chooses **pallets** (plus a loose-box remainder) per batch, Mix
   Batch pallets move whole, Add New Row / Add Items in Bulk, live totals and container fill % →
   **Container planning hint** per order with **Fill from plan** → Loading Details | Vehicle Details
   tabs (optional until Dispatch) → **Save** → the loading's detail page.
2. **Load from the palletization board**: tick Ready-for-Loading rows → **Load** → pick an open container
   or create one → confirm (all-or-nothing).
3. **New Loading from a sales order** (that order only).
4. **Send to Loading** from an order, skipping palletization; the batch trail is still kept.

**Editing a loading** reopens the same page: loaded quantities can be reduced (the rest returns to
Ready for Loading), lines removed, pallets added, details completed. The Sheet also has an edit mode for
loaded qty / move to another container / unload, row by row or Save all.

**Dispatching:** Loading detail → More → Dispatch (or the row's + menu). Date planned first, actual on
dispatch. The plan's own status follows its containers automatically.

---

## 9 · Stock & batch ledger

**What it is.** The accounting spine under everything. Mostly invisible, but it is why the numbers agree.

**What it contains**

- One **stock rule** (opening + produced − loaded, oldest batch first) used by Stock Details, the
  reports, the pickers and the server alike.
- **Counters are recomputed from the records**, never incremented, so a failed save can never leave a
  wrong total.
- **Allocation** = a claim on free stock, visible on the order line (Allocated · Stock ready · Partial
  stock · In production · Need production).
- **Batch ledger**: where every batch went (produced → queued → palletized → loaded → dispatched).
- **Self-checks** on every piece of pure logic (stock, ledger, fit, packing, sheet edits).
- **Admin repair operations** under Settings → Data operations: recount order lines, resync size
  snapshots, backfill line pallets, renumber loadings, re-attribute blank batch lines.

---

## 10 · Reports & audit

**What it is.** The read-only side: what happened, where things stand.

**Reports** (14, grouped Sales · Customer · Item · Inventory · Dispatch), each with a date range, filters,
CSV export and day / week / month buckets:

- **Sales:** By Item (ordered vs produced vs remaining), By PO, Customer Sales, Salesperson Sales,
  Size-wise, Quote Aging.
- **Inventory:** Live Stock, Batch-wise Stock (over-consumed rows flagged), Production Batches (list or
  item × date matrix), Batch Movement (pivot by customer or by stage), Ready Pallets.
- **Dispatch:** Palletization Status (per plan, % dispatched), Loading & Dispatch (per container with
  vehicle, seals, transporter, LR, destination, fill %), Dispatch Register (one row per dispatched line).

**Audit**

- Every change is logged with who did it and what changed; every status move is recorded; admin
  overrides carry their reason.
- **Audit Log** page, plus an Activity tab and Status history on every quote, order, plan and loading.
- Dashboard with the headline numbers.

---

## 11 · Panel Craft

**What it is.** A side flow for showcase panels that sales reps show retailers, and the cut-piece jobs
that make them.

**What it contains**

- **Cut Stock:** the cut pieces on hand, with adjustments.
- **Panels:** the showcase panel master with images (gallery, lightbox, thumbnails everywhere).
- **Panel Orders:** board and sheet; one sale can contain several panels (one row each).

**Process**

```
Received → In cutting → Ready → Dispatched   (forward only)
```

Ready adds the panel's pieces to cut stock; Dispatched removes them. Creating or editing a panel never
touches stock, only orders do.

---

## 12 · Documentation & process

- **System reference** (as built), kept true with every change.
- **Change-request register**: every request numbered, with a six-field template (Change · Where · Why ·
  Apply to · Like · Done when), status, date and proof.
- **Dated change log**, **user flow** guide, **user manual**, formula reference.
- **Seed and teardown scripts** that create a full customer-to-dispatch test flow and remove it.
- **Standing rules** applied to every change: consistency sweep across sibling screens, reuse of existing
  components, rules retrofitted everywhere, verification by driving the real flow.

---

## Parked or not built in Phase 1

So nobody bills for it or expects it:

- Move to Slate hosting (planned, not executed).
- Quality Control stage (in the data model, not on the board).
- Zoho Books integration (never built; estimate grouping in Books is Books-native).
- Readable acronym-based SKU rework (decisions locked, not built).
- Clear / None option on every pick list.
- Duplicate detection when the same production Excel is imported twice.
- Legacy screens kept but hidden from the menu: Purchase Orders, QC, Containers, Fit Suggester,
  Load Planner, Invoices list.

---

## How the hours were estimated

- **Effort recorded.** Calibrated to the project record: 57 distinct working days between 8 June and
  1 October 2026 (from commit dates, the change log and the register), 260 change requests, about 9 hours
  per working day, split across modules in proportion to request count and depth. Total ≈ 515 h.
- **Conventional build equivalent.** What a two-to-three-person team would quote to specify, build, test
  and document the same scope from scratch. The system has 45 tables, 57 server operations, about 60
  screens, 14 reports and 8 printed documents. Roughly three times the recorded effort. Total ≈ 1,650 h.
- Both columns are rounded to the nearest 5 hours. Scale the recorded column uniformly if a different
  day length is agreed.

---

## Phase 2

Phase 2 starts **1 October 2026**. Every request from **CR-261** onward is Phase 2, is filed under the
Phase 2 heading in the change-request register, and is listed with its hours in `PHASE-2-FEATURES.md` when
it ships. The Phase 1 figures above are frozen.
