# BOFFO Order OS — User Manual

*The everyday guide to raising quotes, tracking orders, and shipping tile export containers.*

> ⚠️ **Sections 5.5 and 6 are stale (last updated 2026-07-23).** They describe "Loading" and
> "Final Loading" as separate stages and predate the Palletization board redesign,
> container-first loading, batch-wise stock and Panel Craft. For the current behaviour see
> [`SYSTEM.md` §5](SYSTEM.md#5--the-order-to-dispatch-flow). Sections 1–4, 7–8 and the §9
> formula reference are still accurate.

This manual is written for the people who use BOFFO every day — sales staff, production and QC coordinators, logistics and loading staff, and administrators. No technical knowledge is needed. Keep it open beside you while you learn the app.

---

## Contents

1. [The big picture — how an order flows](#1-the-big-picture)
2. [Getting around — menus, search, and the header](#2-getting-around)
3. [Common tricks that work everywhere](#3-common-tricks)
4. [Items (the Masters)](#4-items-the-masters)
5. [Sales — Customers, Quotes, Orders](#5-sales)
6. [Stages — Production to Dispatch](#6-stages)
7. [Reports & Audit Log](#7-reports--audit-log)
8. [Settings & Administration](#8-settings--administration)
9. [Formula reference — every number, explained](#9-formula-reference)
10. [Glossary](#10-glossary)

---

## 1. The big picture

BOFFO tracks a tile order from first enquiry to the final shipped container, so anyone can answer *"where is this order?"* in seconds. Everything moves through one chain:

```
Quote → Approval → Sales Order → Production → QC → Palletization → Loading → Dispatch → Invoice
```

- A **salesperson** raises a **Quote** for a customer.
- The quote is **approved**, sent to the customer, and **accepted**.
- The accepted quote becomes a **Sales Order**.
- The factory **produces** the boxes; **QC** inspects them.
- Boxes are **palletized** (packed onto pallets), then **loaded** into a container.
- The container is **dispatched** and an **Invoice** is generated.

**One golden rule runs through the whole app: quantities are conserved and gated.** A box can never be palletized before it is produced, loaded before it is palletized, or invoiced before it is loaded. The system simply refuses steps that would break this. This is why the numbers you see downstream are always trustworthy — they are calculated from what was actually recorded upstream.

> **Units:** everything is counted in **boxes**. **Pallets** are always boxes ÷ boxes-per-pallet, **rounded up**. Money is shown in the order's currency, with an approximate **₹ (INR)** equivalent where relevant.

---

## 2. Getting around

### The sidebar (left)

The menu is grouped into collapsible sections. Click a group to open it; the section you're in opens automatically. The little number badge next to an item is a **live count** (e.g. how many quotes exist). You can **collapse the whole sidebar** to an icon rail with the menu button by the logo — handy on smaller warehouse laptops.

| Group | What lives inside |
|---|---|
| **Dashboard** | The live home screen |
| **Items** | Items, Size Master, Pallet Master, Production |
| **Sales** | Customers, Quotes, Approvals, Sales Orders, Palletization |
| **Stages** | Purchase Orders, Quality Control, Container Master, Fit Suggester, Load Planner, Loading, Final Loading, Invoices |
| **Reports** | Reports, Audit Log |

You only see the items your **role** allows (see [Section 8](#8-settings--administration)).

### The header (top)

- **Global Search** — the big search box. Press **⌘K** (Mac) or **Ctrl-K** (Windows) from anywhere to jump to it. It instantly finds **Orders, Quotes, Customers, and Items** by number, name, code, SKU, or salesperson. Use **↑ ↓** to move, **Enter** to open, **Esc** to clear.
- **Gear icon** ⚙️ — Settings. *Only administrators see this.*
- **Notification bell** 🔔 — a red dot means something new happened. Inside you'll find **"For you"** (personal messages, like an approval result) and **"Recent activity"** (the latest changes across the app). Opening the bell clears the dot.
- **Your avatar** — shows your name, email, and role, and the **Sign out** button.

---

## 3. Common tricks

These work the same on almost every list and detail page, so learn them once:

- **Click a row to open it.** List rows have no buttons — the tick-boxes on the left are only for bulk actions.
- **Search box** filters the list as you type.
- **Columns button** lets *you* choose which columns show and in what order — your choice is remembered next time.
- **Advanced Filter** (the magnifier) opens a pop-up to filter by several fields at once — date ranges, status, number ranges, and so on.
- **Footer pager** moves through long lists; the page size is remembered.
- **Bulk actions** appear when you tick one or more rows (e.g. change status, delete).
- **Export** downloads the current, filtered list as a CSV spreadsheet (if your role allows it).
- **After you create a record, the app takes you straight to it** — no hunting for what you just made.
- **Clone** (in the **More ⋯** menu on detail pages) copies a record into a fresh new one — a fast way to make a similar item, quote, or customer. It never copies identity fields like auto-numbers.
- **Status is changed from a record's More menu**, never typed into a field.
- **Grey fields are automatic** (the app fills them). **White fields are yours to type.** A small **ƒx** mark means the value is calculated by a formula and cannot be edited.
- **Every save is recorded** in the Audit Log and each record's own **Activity** tab, so you never have to wonder whether a change went through.

---

## 4. Items (the Masters)

"Masters" are the reference lists the rest of the app draws from. Set these up well and everything downstream just works.

**Where data comes from:** the **Size Master is the single source of truth** for tile dimensions, coverage per box, and box weight. Items and Pallets *copy* those figures from the Size you pick and show them as read-only. To change a dimension, edit the **Size**, not the Item or Pallet.

### 4.1 Items (Design Master)

*The master list of every sellable tile.*

**Columns:** Name, Size, Finish, Brand, Category, Glaze, Status, SKU. (Created/Modified are hidden by default.)

**To create an item:** click **New Item**, then fill the form:

- **Required:** Design Name, Size, Finish, Brand.
- **Optional:** Base Design Name, Customer Brand (you can type a new one — it's saved for next time), Collection, Category, Glaze, Grade, Rate/ft², Rate/m².
- **Automatic:** Width & Length come from the chosen Size. **Status** starts as **Active**.

A live banner at the top shows three values that build themselves as you type:

- **Unique Name** = `Design Name – Size – Finish – Customer Brand` (only the parts you've filled). It must be unique — duplicates are rejected.
- **SKU** = a string of two-digit **short codes** for each classification: `ShortCode – Size – Finish – Category – Glaze – Brand – Grade [– Customer Brand]`. Any unset part shows as `00`.
- **Coverage per box** — see the [formula reference](#9-formula-reference).

You never type a short code — the app assigns the next number automatically.

**The Item detail page** is a split screen: a searchable item list on the left, the selected item on the right. It shows all the item's facts, up to 5 **images** (Front, Rear, then others — click **Add Image** to fill the next open slots), and a live **Stock** panel:

- **Opening stock** — edit it here with the pencil (can't go below 0).
- **In production** — boxes on open production orders not yet made.
- **In loading** — palletized boxes waiting to load.
- **Available stock** — green if positive, red if negative. *Available = Opening + Produced − Loaded.*

**More menu:** Clone, Mark Active/Inactive, Delete. **Bulk edit** (from the list) can change only Status, Brand, and Grade in one go.

### 4.2 Size Master

*The catalogue of tile sizes and their per-box packing data — the source of truth for coverage and weight.*

**To create a size:** click **New size**. The only required fields are **Width (mm)** and **Length (mm)**. Optionally add Type, Thickness, **Pcs per Packing**, Box Weight, and a Remark.

- The **Size code** (e.g. `600x600`) generates itself from Width × Length.
- **Total SQM/box** and **Total SQFT/box** are calculated automatically ([see formulas](#9-formula-reference)).
- The **Short Code** is assigned automatically.

The detail page also lists **Associated Pallets** (pallets built on this size) and offers a **Create Pallet** shortcut that pre-fills the packing data.

### 4.3 Pallet Master

*How many boxes go on a pallet, and how many pallets fit a container, for a given size.*

**To create a pallet:** click **New pallet**, pick a **Size** (required — coverage and weight fill in automatically), choose or type a **Pallet Type** (Junglee, Pine Euro, Wooden, Plastic, etc.), then enter **Boxes/Pallet** and **Pallets/Container**. Everything else calculates itself:

- **Packing Details** = `[Boxes/Pallet × Pallets/Container] = total` (e.g. `[30 × 18] = 540`).
- **Name** = `Size – Packing Detail – Type`.
- Per-container totals for boxes, pallets, weight, and coverage — [see formulas](#9-formula-reference).

The detail page lists **Associated Orders** and offers a **Palletize Order** shortcut.

### 4.4 Production

Covered under [Stages → Production](#62-production) because it is part of the production workflow. It appears under the **Items** group in the menu for convenience.

---

## 5. Sales

### 5.1 Customers

*The buyer master — laid out like a familiar accounting "New Customer" screen.*

**Columns:** Name, Code, Country, Currency, Payment Term, Open Orders, Loaded %.

**To create a customer:** click **New customer**. The only required field is **Company Name**. Fill in contact details, addresses (with a "Shipping same as billing" toggle), and extra contact persons as needed.

- **Customer Number** (`CUS-00001`…) is assigned automatically.
- **Currency** is auto-picked from the billing country (India → INR, Eurozone → EUR, otherwise USD) — and you can change it.
- **Sales Person** defaults to the logged-in user.
- New customers are always created **Active**.

The detail page shows all details, **Additional Addresses** (used on quotations), and the **10 most recent orders**. The **More menu** offers **Create Quotation**, Clone, Mark Active/Inactive, Delete.

### 5.2 Quotes

*Every sales quotation.* The badge next to "Quotes" in the sidebar is a live count.

**To raise a quote:** click **New Quote** and fill the form.

- **Pick a customer** (required). This auto-fills their billing & shipping address, payment term, currency, and salesperson.
- **Quote Date** defaults to **today**; **Expiry** to **today + 15 days**.
- **Currency** defaults to INR; the **Exchange Rate** (₹ per 1 unit) auto-fills from the Currency master and can be overridden for this quote.
- **Add line items:** Item (searched against your designs), Qty, Rate, Discount %, and an optional description.

You don't set a status — new quotes are always born as **Draft**.

**The quote's life** is driven by the status buttons on the detail page, one step at a time:

```
Draft → Submit for Approval → Approve → Mark As Sent → Accept → Convert to Sales Order
```

- **Submit for Approval** sends it to the Approvals inbox.
- An **approver** clicks **Approve** (or **Reject**, with a reason).
- **Mark As Sent** records that it went to the customer.
- **Accept** when the customer agrees (or **Reject** if they back out).
- **Convert to Sales Order** (in the More menu) — available once a quote is Sent, Accepted, or partly converted. Draft quotes cannot be converted.

**More menu:** Convert, Clone, Print, Download PDF, Copy Share Link (a public link for the customer), Delete. Tabs cover **Details** (with an inline PDF preview), **Orders** (sales orders made from this quote), and **Activity**.

**Line & total math** is in the [formula reference](#9-formula-reference) — in short: each line is `Qty × Rate` minus its discount, and the quote total is the sum of lines plus any manual adjustment.

### 5.3 Approvals

*One shared inbox of everything waiting for a decision.*

A single list (oldest first) of every **Quote** and **Sales Order** pending approval, with a **Module** column so you can tell them apart. Click **Approve** to release it (Quote → Approved, Sales Order → Confirmed) or **Reject** (a typed reason is required; the salesperson is notified).

**Who sees it:** only the document types your role may approve — Admins always qualify. If you can't approve anything, the page and its menu item don't appear.

### 5.4 Sales Orders

The **Sales Orders** menu item has a **List | Kanban** toggle at the top of the page:

**By Order (the default list)** groups the screen one block per Sales Order, showing Order Qty, line items, **Produced %**, **Loaded %**, a progress bar, the due date, and a **bottleneck badge** (the earliest stage any line is stuck at). Each line has an **Advance** button to push it to the next stage.

**Kanban** is a visual board with six columns — Purchase Order, In Production, Quality Control, Pallet Packing, Loading, Final Loading — one card per line item. Each card shows the design, customer, size/finish/brand chips, a progress bar, box quantity, and due date. Click a card to open the full order. (Stages advance via the order's own buttons, not by dragging.)

**Sales Orders grid** (the other tabular view) is one row per order, with columns for SO Number, Customer, PO Number, Total Qty, Total, Status, and Salesperson. A **"Ready for Palletisation"** badge appears when every line is fully produced with boxes still to pack.

**The Sales Order detail page** is where you manage one order:

- **Status buttons:** Submit for Approval → Approve → **Mark In Progress**; plus Cancel/Reopen.
- **Items table** shows Ordered, Produced, Palletized, and **Available** boxes per line, with the stage.
- **To palletize:** click **Send to Palletization** on the Items table, or the **More menu → Palletization** — both jump to the Palletization screen (`/packing`) with a new plan pre-scoped to this order, its items and available boxes already filled in (the same screen as *New Palletization* and Production's *Send to Palletization*).
- **More menu:** Palletization, Record New Production, Cancel, Clone, Delete.

> Editing locks once any work (production, palletize, or load) is recorded — the button tells you why.

### 5.5 Palletization

*Group produced boxes onto pallets and run them through the load lifecycle.* (Menu label: **Palletization and Loading**; route `/packing`.) Every palletization is tied to a Sales Order — there is no independent (make-to-stock) palletization.

**A Palletization Plan** is a first-class record with a server-minted **PAL/FY/NNN** number that groups a Sales Order's items onto a vehicle. Each item on the plan also carries its own sequential **`PAL-NNN`** code (like Production's `PROD-NNN`), so individual palletised items are traceable.

**Two views** (toggle in the filter bar):

- **Board (default)** — a Kanban with five stage columns: **In Palletization → Palletized → Ready for Loading → In Loading → Dispatched**. The board is **item-wise**: one card per palletised item (its `PAL-NNN`, design, boxes, SO and parent PAL number). **Drag a card** to the next stage to advance it — items of the same plan move together as a batch.
- **List** — one row per plan (PAL number, vehicle, associated SOs, boxes, status), with the usual column picker, filters and pager.

**To palletize:** click **New Palletization**, **pick a Sales Order** (only orders with produced-but-unpalletised stock appear), then enter **Load Boxes** and choose a **Pallet** for each line you want to palletise, and **Save**. Load Boxes start **blank** so you can palletise a subset — even a single item — and come back later for the rest; use the per-order **Fill available** button to fill them all at once. You land on the new plan. You can also arrive here pre-scoped from a **Sales Order → Send to Palletization** or from **Production → Send to Palletization**. No vehicle is captured here — it is assigned later, at the Loading step.

**Vehicle & dispatch:** moving a plan into **In Loading** no longer asks for a vehicle. While a plan is **In Loading**, use the **Assign Vehicle** action (truck button on the card, or the button on the plan detail) to attach the vehicle — pick from the Vehicle master or add one inline (number, driver, mobile). A vehicle is **required before Dispatch**: the **Mark Dispatched** button stays disabled until one is assigned.

**A plan's detail page** shows its items grouped by Sales Order (each with its `PAL-NNN` code), lifecycle transition buttons, **Assign Vehicle** (while In Loading), Edit, Clone, Print Palletization slip, and the activity timeline.

---

## 6. Stages

The production and logistics chain. Remember the golden rule: each stage can only move boxes that the previous stage produced.

### 6.1 Purchase Orders

*A read-only overview of customer POs* — one row per PO, showing Order Qty, SKUs (line count), and **Progress %** (produced ÷ ordered across the PO). Nothing is edited here; click a PO to see its line items. Docs pills (PI / PO / INV) show which documents exist.

### 6.2 Production

*The list of production jobs, each moving through New Request → In Production → Completed* (a job can also be Rejected). The default view hides completed jobs.

**To request production:** click **Record New Production**. Two modes:

- **Order** — pick a Sales Order and enter boxes per line (only lines still owing production appear, capped at what's left).
- **Independent** — make-to-stock: pick a design and quantity.

"Requested by" and the date stamp themselves.

**To record output** (the key step) — open a job's detail page:

- Each line shows Requested vs Produced with a chip: **To produce**, **Partial**, or **Done**.
- Click **Record** on a line (or **Record all output** from the More menu) and enter **boxes produced**. The entry is capped at what's still owed; going over shows a warning.
- Moving a job to **Completed** opens a per-line grid where Produced defaults to Requested but **can be edited up or down** — this is the one moment available stock actually changes.

Views toggle between a **grid** and a **Kanban board** (drag a card into a column to change its stage; dragging into Completed opens the output dialog).

### 6.3 Quality Control

*A two-pass inspection worksheet* between Production and Loading:

- **Pre-Pallet QC** — Shade Match, Size Calibration, Surface Defects, Thickness.
- **Post-Pallet QC** — Pallet Count, Strapping, Labeling, Moisture Wrap.

Click a cell to cycle its verdict **Pending → Pass (✓) → Fail (✕)**. A row is **Fail** if any check failed, **Pass** only if all passed. KPIs show Pass Rate, Pending, Failed, and In-Queue counts.

> **Important:** QC is currently a **worksheet only — verdicts are not saved** and refreshing clears them. Treat it as a live checklist for now; it does not yet block later stages.

### 6.4 Container Master

*The catalogue of shipping containers.* Columns: Container No., Type, Vessel, Capacity (boxes/pallets), ETD, Discharge port, and Status (**planned → loading → sealed → dispatched**).

**To create one:** click **New container**. Required: **Container No.** and **Capacity (boxes, > 0)**. Optionally add type, pallet/area/weight capacities, vessel, ports, and dates. (No formulas here — everything is entered.) *Row-click opens the edit form directly.*

### 6.5 Fit Suggester

*A read-only planner that suggests how to pack pending pallets into the earliest-departing containers* so they don't ship empty. It fills whole pallets (never split) under up to four caps at once — pallet slots, area, weight, and boxes.

- **Utilization bars** show used ÷ capacity for Slots, Weight, and Boxes.
- **"Capped by" badge** names the constraint that filled up first.
- **Underfilled flag** (amber) warns of containers shipping under 95% full.
- **Unassigned pallets** are listed with a "Blocked by" reason.

Click **Recompute** to re-run. Actual loading happens on the Loading page.

### 6.6 Load Planner

*A read-only snapshot of real container availability* and the boxes that could top them up:

- **Container Availability** — each container's Loaded boxes, **Space left (= Capacity − Loaded)**, and **Fill %**.
- **Ongoing Orders** — **Ready to load (= Palletized − Loaded)** and **Awaiting palletization (= Produced − Palletized)**, most-ready first.

Use it to decide what to palletize or load next; act on the Palletization / Loading pages.

### 6.7 Loading

*The queue of palletized orders ready to load, and the action to load one.*

**To load a container:** click **Schedule truck**, pick a container (only *planned* or *loading* ones appear, with capacity shown), tick the closed pallet batches to load, and click **Load container**. The footer tallies selected boxes; if they exceed capacity, saving is blocked. Loaded pallets move from palletized → loaded.

### 6.8 Final Loading

*Loaded orders grouped by invoice, and the action to dispatch a container.*

**KPI tiles:** Active Invoices, Line Items, Final Qty.

**To dispatch:** click **Dispatch**, select a loaded/sealed container, and confirm. This moves it loaded → dispatched and marks every pallet on it as shipped.

> **Dispatch is final and irreversible.**

### 6.9 Invoices

*Export invoices, one per container.*

**To generate an invoice:** click **Generate** and pick a loaded/sealed/dispatched container that hasn't been invoiced yet. The system numbers it automatically (format **EX-NN/FY**) and totals the loaded lines — **boxes × rate, less line discount**, summed across the container.

**Actions:** Download PDF, Delete. The header shows the grand total of all invoices.

---

## 7. Reports & Audit Log

### 7.1 Reports

Live, read-only rollups. Every report has the same frame: a title, an **Export** button, an optional **date range**, an **Advanced Filter**, a row of KPI tiles, and a sortable, paginated table with a bold **grand-total** footer.

| Report | What it shows |
|---|---|
| **By Item** | Ordered vs Produced vs Remaining, per design |
| **By PO** | The same, grouped by purchase order |
| **Customer Sales** | Revenue and volume per customer (one row per order) |
| **Salesperson Sales** | The same, grouped by salesperson |
| **Size-wise** | Ordered boxes grouped by tile size |
| **Live Stock** | Opening + Produced − Loaded, per design |
| **Ready Pallets** | Closed pallet batches not yet loaded |
| **Quote Aging** | Open quotes, longest-waiting first |

### 7.2 Audit Log

*A read-only record of every change the app makes.* Each row shows the time, the record, the operation, a green **success** or red **failed** chip, how long it took, **who did it**, and a plain-English summary of what changed. Search, filter by operation, and choose columns. The header keeps a running "N ok · N failed" tally. Available to any signed-in user.

---

## 8. Settings & Administration

> **Settings, Users, Roles, Sales Persons, Currencies, Data Operations, and the Masters hub are Admin-only.** Non-admins are redirected to the Dashboard, and the gear icon only appears for admins. (Reports and the Audit Log are *not* restricted.)

**Access control in plain terms:** your **Role** is the single lever. Each role carries a **permission matrix** (which modules you can View / Create / Edit / Delete / Export) and a list of **document types you may approve**. Admins can do everything. "No role" means no access. Role changes take effect on the user's next reload or sign-in.

- **Users** — sign-in accounts. Create with email + password (min 6 chars), a name, and a role. Setting status to **Disabled** blocks sign-in.
- **Roles** — the permission matrix. Rows are modules (Quotes, Sales Orders, Customers, Items & Masters, Production, Invoices, Reports); columns are actions. Ticking any action auto-ticks View; unticking View clears the row. **"Can approve"** checkboxes grant approval rights for Quotations, Sales Orders, and Production. The **Admin role is locked** to full access. A role can only be deleted when no users are assigned to it.
- **Sales Persons** — auto-managed: every user gets one, synced from their account on login. Only **Mobile** and **Region** are editable.
- **Currencies** — each currency has an exchange **rate in INR per 1 unit** (INR = 1). Rates **auto-refresh daily**; **Refresh rates now** fetches on demand. A rate you type by hand becomes a **manual** override that the daily job leaves alone. INR can't be deleted or rate-edited.
- **Masters hub** — one editor for the lookup lists: Finish, Category, Glaze, Brand, Customer Brand, Grade, Payment Term. Each is a Name plus an auto-assigned code.
- **Data Operations** — reserved for bulk import/export; currently marked "coming soon".

---

## 9. Formula reference

Every calculated number in the app, in plain terms. You never type these — the app fills them — but here's exactly how each one is worked out.

### Coverage & packing (Size Master)

| Value | Formula |
|---|---|
| **Size code** | `Width × Length` → e.g. `600x600` |
| **Coverage per box (SQM)** | `(Width ÷ 1000) × (Length ÷ 1000) × Pcs-per-Box` |
| **Coverage per box (SQFT)** | `SQM × 10.7639` |

### Item

| Value | Formula |
|---|---|
| **Unique Name** | `Design Name – Size – Finish – Customer Brand` (filled parts only) |
| **SKU** | Two-digit short codes: `ShortCode – Size – Finish – Category – Glaze – Brand – Grade [– Customer Brand]` (`00` for unset parts) |
| **Available stock** | `Opening stock + Produced − Loaded` |
| **In production** | Open production-order boxes not yet produced |
| **In loading** | Palletized boxes − Loaded boxes |

### Pallet Master

| Value | Formula |
|---|---|
| **Packing Details** | `[Boxes/Pallet × Pallets/Container] = product` |
| **Total Boxes / Container** | `Boxes/Pallet × Pallets/Container` |
| **Total Pallet Weight (kg)** | `(Box Weight × Boxes/Pallet) + Empty Pallet Weight` |
| **Total Sq.Ft / Container** | `Total Boxes × Coverage Sq.Ft` |
| **Total Sq.M / Container** | `Total Boxes × Coverage Sq.M` |
| **Total Box Weight / Container** | `Total Boxes × Box Weight` |

### Quote & Order lines

| Value | Formula |
|---|---|
| **Line gross** | `Qty × Rate` |
| **Line discount** | `Line gross × Disc% ÷ 100` |
| **Line sub-total** | `Line gross − Line discount` |
| **Quote Net Total** | `Sum of line sub-totals + Adjustment` |
| **Order Total** | `Sum of line sub-totals + Adjustment ± Tax` (TDS subtracts, TCS adds) |
| **≈ INR equivalent** | `Net Total × Exchange Rate` |

### Pallets, loading & progress

| Value | Formula |
|---|---|
| **Pallets needed** | `⌈Ordered boxes ÷ Boxes-per-Pallet⌉` (always rounds up) |
| **Boxes to palletize (per line)** | `Produced − Palletized` (never below 0) |
| **Available to pack** | `Produced − already-Palletized` |
| **Ready to load** | `Palletized − Loaded` |
| **Awaiting palletization** | `Produced − Palletized` |
| **Container space left** | `Capacity − Loaded` (floored at 0) |
| **Container fill %** | `Loaded ÷ Capacity × 100` |
| **Boxes per container** | `Boxes-per-Pallet × Pallets-per-Container` |
| **Containers needed** | `⌈Total boxes ÷ Boxes-per-container⌉` |
| **Produced %** | `Produced ÷ Ordered × 100` |
| **Loaded %** | `Loaded ÷ Ordered × 100` |
| **Remaining (a design/PO)** | `Ordered − Produced` |
| **QC Pass Rate** | `Passed rows ÷ Total rows × 100` |
| **Invoice total** | `Σ (Boxes × Rate − line discount)` across the container's loaded lines |

### Fit Suggester

| Value | Formula |
|---|---|
| **Utilization % (each dimension)** | `Used ÷ Capacity × 100` (Slots, Area, Weight, Boxes) |
| **Capped by** | The dimension that fills up first |
| **Underfilled** | A container under 95% full on every active constraint |

---

## 10. Glossary

- **Item / Design** — a sellable tile product, identified by its Unique Name and SKU.
- **SKU** — the coded product identifier built from short codes of the item's attributes.
- **Master** — a reference list (Sizes, Pallets, Customers, Finish, Brand…) the rest of the app draws from.
- **Quote** — a price offer to a customer, before it becomes a firm order.
- **Sales Order (SO)** — a confirmed order, created by converting an accepted quote.
- **PO Number** — the customer's own purchase-order reference.
- **Line item** — one design + quantity on a quote or order.
- **Palletize / Close pallet** — pack produced boxes onto pallets (a batch).
- **Batch** — one closed pallet load of boxes.
- **Stage** — where a line sits in the pipeline (Production → QC → Packing → Loading → Final).
- **Bottleneck** — the earliest stage an order is stuck at.
- **Opening stock** — boxes on hand before any production is counted.
- **Available stock** — sellable stock right now (`Opening + Produced − Loaded`).
- **Dispatch** — mark a loaded container as shipped (final, irreversible).
- **Role** — the permission set that decides what you can see and do.

---

*This manual reflects the app as built to date. Screens and formulas may evolve; when in doubt, the app's own live numbers and the Audit Log are the source of truth.*
