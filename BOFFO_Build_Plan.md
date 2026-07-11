# BOFFO Order OS — Build Plan & Claude Code Prompt

> **Project:** Tiles manufacturing order-tracking system (Quote → Order → Production → Pallet Packing → Container Loading → Dispatch)
> **Hosting:** Zoho Catalyst (Functions + Data Store)
> **Existing artifact:** Working React HTML prototype (`BOFFO_Order_OS.html` and its `.jsx` modules)

> **⚠️ Historical (pre-build) document — 2026-07-11.** The caveats in §0 were resolved in
> `BOFFO_Technical_Plan.md` §0; the live schema is `DATASTORE-SCHEMA.md` (source of truth);
> build divergences (single `data-ops` function, app-level auth, live Catalyst project) are
> listed in `BOFFO_Architecture.md` → "Status vs. reality".

---

## 0. Honest Caveats (read before acting)

Per your preference to flag uncertainty:

1. **Zoho Catalyst specifics** — I am working from general knowledge of Catalyst's Functions and Data Store, but I am **not certain** about:
   - Current Data Store query capabilities (it uses ZCQL — a SQL-like language; I am ~80% confident but **verify against** `https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/zcql/`).
   - Whether Catalyst Data Store supports transactions across multiple rows / multiple tables (critical for "convert quote to order" and "loaded boxes vs container capacity"). **You must verify this before locking in the architecture.**
   - Catalyst Advanced I/O Functions vs Basic I/O Functions limits (request size, execution time).
   - Whether Catalyst's hosted client app supports React + Vite build output cleanly.
2. **Database schema** — You said you'd attach a schema "in DB", but I only see `BoffoExport_Tracker.md`. I have derived the schema from that document. **Please confirm or share the actual schema file** so I can refine.
3. **Multi-tenancy** — I am assuming this is a **single-organization** install (one BOFFO instance, possibly with multiple users/roles). If you need multi-tenant (multiple manufacturing companies on one deployment), the schema and auth model both change. Confirm.
4. **Zoho Books integration** — The tracker mentions "Sync with Zoho Books" for customers. I have placed this in Phase 5 (later). Confirm that's acceptable, or move it earlier.
5. **Currency / pricing** — Quotes mention INR/USD/EUR with a "rate per sqmt → box rate" calculation engine. I have included this but **the exact formula** (does box-rate already include packaging? does it differ per finish?) needs your confirmation.

If any of the above is wrong, the plan needs adjustment before you hand it to Claude Code.

---

## 1. Recommended Technology Stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend framework** | React 18 + Vite + TypeScript | Your prototype is already React; Vite gives a fast dev loop and produces static assets Catalyst can host. TypeScript catches model-mismatch bugs early (worth it for a domain this finicky). If you'd rather stay in JS, that's fine — the prototype is JS. |
| **Styling** | Keep your existing `styles.css` + CSS custom properties | Your prototype already has a polished design system (tokens, dark theme, density toggle). Don't throw it out — port it as-is. |
| **State management** | Zustand (or React Context for v1) | Lightweight, no boilerplate. Avoid Redux for this scope. |
| **Data fetching** | TanStack Query (React Query) | Handles caching, optimistic updates, retries — essential when production-floor users update line items rapidly. |
| **Routing** | React Router v6 | Standard. |
| **Forms** | React Hook Form + Zod | Zod schemas double as runtime validation **and** TypeScript types. |
| **Tables** | TanStack Table (headless) | Your existing table markup works; TanStack adds sorting/filtering/virtualization without restyling. |
| **Backend** | Zoho Catalyst Advanced I/O Functions (Node.js 18+) | One function per resource (`/api/quotes`, `/api/orders`, `/api/pallets`, …) or one router function — see Phase 1. |
| **Database** | Zoho Catalyst Data Store (ZCQL) | Per your hosting constraint. *Verify transaction support before relying on it.* |
| **Authentication** | Catalyst Embedded Auth | Built-in; supports email/password, OAuth. Use Catalyst roles for "Admin / Sales / Production / Packing / Dispatch" RBAC. |
| **File storage** | Catalyst File Store | For design images, signed quotes, PI PDFs, packing photos. |
| **PDF generation** | `pdfmake` or `puppeteer-core` in a Catalyst Function | For quote print templates and invoices. **Verify Catalyst Function memory limits support Puppeteer** — if not, use `pdfmake` (lighter, no headless Chrome). |
| **Date/time** | `date-fns` | Tree-shakable, no timezone surprises. |

**What I am intentionally NOT recommending:**
- Next.js — overkill for a Catalyst static-hosted SPA and SSR adds friction with Catalyst's hosting model.
- Prisma — does not target Catalyst Data Store. You'll write a thin ZCQL data-access layer instead.
- A separate microservices split — single Catalyst project, multiple functions, one Data Store. Keep it simple until you have load.

---

## 2. Database Schema (derived from `BoffoExport_Tracker.md`)

> This is a **proposed** schema. Each table maps to a Catalyst Data Store table. ZCQL roughly follows SQL but **does not** support all SQL features (verify joins, foreign keys, indexes on the docs link you shared).

### 2.1 Master tables

```text
Organization
  org_id (PK), name, books_org_id, default_currency, address, created_at

User
  user_id (PK, Catalyst auth ID), email, name, role, org_id (FK), active

Role               -- if you need custom roles beyond Catalyst's built-in
  role_id (PK), name, permissions_json

Customer           -- "Party" in the tracker
  customer_id (PK), code, name, country, flag_emoji, currency,
  payment_terms_id (FK), books_contact_id, address_json,
  port_of_discharge, created_at, active

PaymentTerm
  term_id (PK), name           -- Advance, Net 15, Net 30, Net 45, Net 60, Credit

Size               -- 600x1200, 200x1200, etc.
  size_id (PK), code, width_mm, length_mm

Finish             -- Glossy, Matt, Carving, …
  finish_id (PK), name

Category           -- PL value
  category_id (PK), name

Glaze              -- PL value
  glaze_id (PK), name

Brand
  brand_id (PK), name, internal_or_external

Grade
  grade_id (PK), name          -- "1st", etc.

NumberMaster       -- For SKU auto-generation: per Size/Finish/Category/Glaze
  num_id (PK), entity_type, entity_id, sequence_number

TransactionSeries  -- Quote/SO/Invoice number prefixes
  series_id (PK), doc_type, prefix, current_number, fy_token  -- "2026-27"
```

### 2.2 Product / Design

```text
Design             -- a tile design at a specific size+finish
  design_id (PK), unique_name,            -- "Design Name - Size - Finish"
  design_name, base_design_name,
  sku,                                    -- auto: NN-NN-NN-NN
  size_id (FK), finish_id (FK), category_id (FK), glaze_id (FK),
  brand_id (FK), grade_id (FK),
  party_brand_name,
  pcs_per_box, box_weight_kg,
  coverage_sqm,                           -- computed (W/1000 * L/1000) * pcs
  coverage_sqft,                          -- computed coverage_sqm * 10.763915
  random_faces, status,                   -- Continue / Discontinued
  collection_name,
  rate_per_sqft, rate_per_sqmt,
  image_url, created_at

DesignPallet       -- many-to-many: Design ↔ Pallet (allowed pallets)
  design_id (FK), pallet_id (FK)
```

### 2.3 Pallet Master

```text
Pallet
  pallet_id (PK), size_id (FK),
  pallet_type, pallet_size_label,
  boxes_per_pallet, pallets_per_container,
  empty_pallet_weight_kg,
  -- computed/derived fields can stay computed at query time:
  --   total_pallet_weight, total_boxes_per_container,
  --   total_sqm_per_container, total_sqft_per_container,
  --   total_box_weight_per_container
  remarks, created_at
```

### 2.4 Transactions: Quote → Order → Dispatch

```text
Quote
  quote_id (PK), quote_number (unique, auto via TransactionSeries),
  customer_id (FK), quote_date,
  payment_terms_id (FK), port_of_discharge,
  status,                                  -- Draft / Shared / Accepted / Rejected / Converted
  currency, remarks,
  public_link_token,                       -- for "Share via Public Link"
  conversion_flag,                         -- None / Full / Partial
  total_amount, created_by, created_at

QuoteItem
  quote_item_id (PK), quote_id (FK),
  design_id (FK), quantity_boxes,
  rate, rate_basis,                        -- 'per_sqft' | 'per_sqmt' | 'per_box'
  discount_pct, sub_total, final_total

SalesOrder         -- "Order" in your spec
  order_id (PK), order_number (auto), quote_id (FK nullable),
  customer_id (FK), po_number, order_date,
  payment_terms_id (FK), port_of_discharge,
  status,                                  -- Confirmed / In Progress / Cancelled
  currency, remarks, created_at

OrderItem          -- line items you track stage-wise
  order_item_id (PK), order_id (FK),
  design_id (FK),
  ordered_qty_boxes,
  produced_qty_boxes,
  qc_passed_qty_boxes,
  palletized_qty_boxes,
  loaded_qty_boxes,
  dispatched_qty_boxes,
  stage,                                   -- po | prod | qc | packing | loading | final
  priority, due_date,
  created_at, updated_at

OrderItemEvent     -- audit trail per line item
  event_id (PK), order_item_id (FK),
  event_type,                              -- production_update | qc_pass | packed | loaded | dispatched
  qty_delta, performed_by, performed_at, note
```

### 2.5 Pallet Packing (Palletisation)

```text
PalletisedBatch    -- a closed pallet on the floor
  batch_id (PK), order_id (FK),
  pallet_id (FK, from Pallet master),
  design_id (FK),
  boxes_packed, packed_at, packed_by,
  status,                                  -- open | closed | loaded
  delivery_date, remarks

PalletisedBatchLine  -- if a pallet mixes line items (usually 1:1, but allow many)
  batch_id (FK), order_item_id (FK), boxes
```

### 2.6 Container & Loading

```text
Container
  container_id (PK), container_number,
  container_type,                          -- 20ft, 40ft, 40HQ
  capacity_boxes,                          -- e.g. 1096
  capacity_pallets,
  vessel_name, etd, eta,
  port_of_loading, port_of_discharge,
  status                                   -- planned | loading | sealed | dispatched

ContainerLoading   -- which pallets go into which container
  loading_id (PK), container_id (FK),
  batch_id (FK, PalletisedBatch),
  loaded_at, loaded_by,
  position                                 -- optional: 1..N for floor layout

Invoice            -- "EX-NN/YYYY-YY" export invoice
  invoice_id (PK), invoice_number (auto),
  container_id (FK), order_id (FK),
  invoice_date, total_amount, currency,
  status                                   -- draft | issued
```

### 2.7 Activity log (for the feed you already render)

```text
Activity
  activity_id (PK), occurred_at, actor_user_id,
  entity_type, entity_id,
  action, detail_text, tag
```

**Computed / not stored:**
- Container fill percentage = `SUM(boxes in ContainerLoading) / Container.capacity_boxes`
- Container weight = `SUM(boxes * Design.box_weight + Pallet.empty_pallet_weight)` per loaded pallet
- "Fixable boxes after palletisation" = `Container.capacity_boxes - boxes_already_loaded` (used in the container-fit suggester)

---

## 3. Container Fit Logic (your point 4 — make sure Claude Code gets this right)

This is the **most domain-specific** part of the app, and the prompt below tells Claude Code to build it as a dedicated module.

**Inputs:**
- A set of palletised batches ready to ship (each: `design_id`, `boxes_packed`, `pallet_id` → `boxes_per_pallet`, `box_weight`, `empty_pallet_weight`).
- A pool of available containers (each: `capacity_boxes`, `capacity_pallets`, max weight if you track it).

**Goal:** "My containers shall not go empty." Pack pallets into containers so each container is **as full as possible** before being sealed.

**Suggested algorithm (v1 — greedy, good enough):**
1. Sort pending pallets by design (so same-design pallets ship together when possible).
2. For each container in priority order (earliest ETD first):
   - While there's room (`capacity_boxes - loaded > min_pallet_size`):
     - Pick the next pallet that fits (`boxes <= remaining_capacity` AND `pallet_count < capacity_pallets`).
     - If no whole pallet fits, suggest a **partial pallet** (split a batch).
3. Show the user the suggestion with "Accept / Adjust manually" (per your tracker doc).
4. Allow **swap** between containers if a container becomes underfilled — the user can drag a pallet from container A to container B.

**v2 (later):** Bin-packing optimisation (First-Fit-Decreasing) accounting for weight limits, mixed designs, customer constraints.

---

## 4. Phase-Wise Implementation Plan

Each phase is meant to be **independently deployable and usable**.

### Phase 0 — Project Bootstrap (Day 1)
- Create Catalyst project; init Node.js function project per `https://docs.catalyst.zoho.com/en/tutorials/task-manager/nodejs/init-project/`.
- Vite + React + TS scaffold for the client app.
- Wire Catalyst Embedded Auth.
- Port existing `styles.css` and `Icon` component from the prototype.
- Deploy a "hello world" to Catalyst hosted client + one ping function. **Deliverable: live URL.**

### Phase 1 — Masters (Week 1)
Build CRUD + seed data for:
- Customer (Party), Design, Pallet, Size, Finish, Category, Glaze, Brand, PaymentTerm.
- Re-skin your `DesignMaster` and `PartiesView` from the prototype to call real APIs.
- SKU auto-generation via NumberMaster.
- Image upload to Catalyst File Store.

**Why first:** every transaction depends on these. Get them right before adding flow.

### Phase 2 — Quotes → Orders (Week 2)
- Quote create / edit / share-via-public-link (token-protected read-only page).
- Print template (PDF via `pdfmake`).
- Calculation engine: `rate_per_sqmt` → box rate using `Design.coverage_sqm`.
- Accept / Convert: full or partial conversion to SalesOrder (sets `conversion_flag` on the quote, creates the order with copied line items).
- SalesOrder list view + detail.

**Acceptance criteria:** A salesperson can create a quote in INR/USD/EUR, share a public link, mark it accepted, and convert it (full or partial) into an order with line items that match the tracker doc.

### Phase 3 — Pipeline & Line-Item Tracking (Week 3)
- Port the existing **Kanban / Pipeline view**, **By Order** view, **Order Detail drawer**, and **Quick View** (you already have the UI — wire to real data).
- Stage transitions per line item: `po → prod → qc → packing → loading → final`.
- Production update form: "add X boxes produced for line item Y" (writes to `OrderItem.produced_qty_boxes` AND appends `OrderItemEvent`).
- QC pass form.
- Activity feed (real, from `Activity` table).

**Acceptance criteria:** Production team can update progress per line item from a phone; managers see the kanban move in near real-time.

### Phase 4 — Palletisation & Container Loading (Week 4)
- Pallet packing screen: pick line item → pick pallet master → close batch.
- Auto-suggest pallet from Design's allowed pallets.
- Container view: create container, see capacity vs filled, fit-suggester.
- Drag-and-drop swap of pallets between containers.
- "Ready to Dispatch" view.

**Acceptance criteria:** A packing supervisor can close a pallet in 3 clicks; a dispatch manager can fill a 1096-box container with ≤ 5% empty space using the suggester.

### Phase 5 — Dispatch, Invoicing, Reports (Week 5)
- Invoice generation (one per container, links to SalesOrder).
- "Item-wise / PO-wise: ordered qty, produced qty, remaining qty" report.
- "Ready pallets" report.
- Mark container dispatched → cascade `dispatched_qty_boxes` on each `OrderItem`.

### Phase 6 — Integrations & Polish (Week 6+)
- Zoho Books customer sync (one-way: Books → BOFFO).
- Multi-org books connection.
- Role-based access (Sales can't edit production qty; Production can't see margins; etc.).
- Public-link quote acceptance webhook.

### Phase 7 — Out of scope for v1 (per your tracker)
- Production module (detailed shop-floor scheduling).
- Multi-currency revaluation.

---

## 5. The Claude Code Prompt

Below is the prompt to hand to Claude Code. It assumes you'll run it from an empty directory and that you've set up a Catalyst account separately.

> **Copy everything between the `===` markers.**

```
=== BEGIN CLAUDE CODE PROMPT ===

You are building BOFFO Order OS, a tiles manufacturing order-tracking webapp,
to be deployed on Zoho Catalyst.

## Context files
Read these from the repo root BEFORE writing any code:
- BoffoExport_Tracker.md — the business process and data model spec
- BOFFO_Build_Plan.md — the phase plan and database schema (THIS document)
- prototype/ — the existing React HTML prototype:
    BOFFO_Order_OS.html, app.jsx, ui.jsx, views.jsx, views2.jsx,
    by-order.jsx, quick-view.jsx, order-detail.jsx, data.jsx,
    tweaks-panel.jsx, styles.css
  The prototype's VISUAL DESIGN is final. Reuse styles.css and the Icon
  component verbatim. Reuse the layout of Dashboard, Kanban, ByOrderView,
  OrderDrawer, QuickView. The prototype's data.jsx is mock data — do not
  ship it, but use its shape as a reference for the API responses.

## Hard constraints
- Hosting: Zoho Catalyst ONLY. Backend = Catalyst Advanced I/O Functions
  (Node.js 18+). Database = Catalyst Data Store (ZCQL). Auth = Catalyst
  Embedded Auth. File uploads = Catalyst File Store.
- Frontend: React 18 + Vite + TypeScript. Build output deploys to Catalyst
  client (hosted static).
- Styling: keep prototype/styles.css. Do not introduce Tailwind or any other
  CSS framework. CSS custom properties only.
- State: Zustand for global state, TanStack Query for server state.
- Forms: React Hook Form + Zod.
- No Prisma, no ORMs that don't target Catalyst. Write a thin ZCQL data
  access layer in functions/lib/db.ts.
- Do not invent Catalyst API methods. Use the official Catalyst Node SDK
  (zcatalyst-sdk-node). If unsure of an API signature, stop and ask me to
  verify the docs at:
    https://docs.catalyst.zoho.com/en/serverless/help/functions/introduction/
    https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/introduction/
    https://docs.catalyst.zoho.com/en/tutorials/task-manager/nodejs/init-project/

## Repository layout to create
.
├── client/                       # Vite + React + TS
│   ├── src/
│   │   ├── app/                  # routing, providers
│   │   ├── features/
│   │   │   ├── customers/
│   │   │   ├── designs/
│   │   │   ├── pallets/
│   │   │   ├── quotes/
│   │   │   ├── orders/
│   │   │   ├── production/
│   │   │   ├── palletisation/
│   │   │   ├── containers/
│   │   │   └── dispatch/
│   │   ├── ui/                   # ported from prototype/ui.jsx (Icon, ProgressBar, SplitBar, StageBadge, Spark)
│   │   ├── lib/                  # api client, zod schemas, utils
│   │   └── styles/               # prototype/styles.css ported here
│   └── vite.config.ts
├── functions/                    # one Catalyst Advanced I/O Function per resource
│   ├── api-customers/
│   ├── api-designs/
│   ├── api-pallets/
│   ├── api-quotes/
│   ├── api-orders/
│   ├── api-orderitems/
│   ├── api-palletisation/
│   ├── api-containers/
│   ├── api-invoices/
│   └── lib/                      # shared: db.ts, auth.ts, errors.ts, ids.ts
├── catalyst.json
├── BOFFO_Build_Plan.md
├── BoffoExport_Tracker.md
└── prototype/                    # untouched reference

## Database tables to create in Catalyst Data Store
Use the schema in BOFFO_Build_Plan.md section 2. Create them in this order
so foreign-key references resolve:
  1. Masters: Organization, User, Role, PaymentTerm, Size, Finish, Category,
     Glaze, Brand, Grade, NumberMaster, TransactionSeries, Customer
  2. Pallet, Design, DesignPallet
  3. Quote, QuoteItem
  4. SalesOrder, OrderItem, OrderItemEvent
  5. PalletisedBatch, PalletisedBatchLine
  6. Container, ContainerLoading, Invoice
  7. Activity

Before writing the table-creation script, CONFIRM with me whether Catalyst
Data Store supports compound unique indexes (needed for Design.unique_name
and SKU). If not, enforce at the application layer.

## Build phases — implement in this order, stop for review after each

PHASE 0 — Bootstrap (must end with a deployed URL)
- Initialize Catalyst project; create client app + first function "api-health"
  that returns { status: "ok" }.
- Vite client with a single page that calls api-health and renders prototype/
  styles.css with the sidebar shell from prototype/app.jsx.
- Catalyst Embedded Auth login/logout working.
- Deploy to Catalyst. Stop and show me the URL.

PHASE 1 — Masters CRUD
- Implement Customer, Design, Pallet, Size, Finish, Category, Glaze, Brand,
  PaymentTerm.
- SKU auto-generation via NumberMaster (size-finish-category-glaze, e.g.
  "03-02-01-01"). One Catalyst function for the SKU generator.
- Image upload for Design via Catalyst File Store.
- UI: port DesignMaster and PartiesView from prototype/views2.jsx, wire to
  real APIs.
- Seed script with the sizes (75x600, 98x600, ..., 1200x2780), finishes,
  and payment terms from BoffoExport_Tracker.md.

PHASE 2 — Quotes
- Quote create / edit / list / share-public-link.
- QuoteItem rows with design picker, qty, rate (per_sqft / per_sqmt / per_box),
  discount, sub-total, final total. Calc engine in client AND server
  (server is source of truth on save).
- Status transitions: Draft → Shared → Accepted → Converted.
- Convert to SalesOrder: full or partial. Partial copies a subset of
  QuoteItems with adjusted qty. Set Quote.conversion_flag.
- PDF print template using pdfmake (Catalyst function returns the PDF).

PHASE 3 — Orders & Pipeline
- SalesOrder list + detail.
- Port Kanban (prototype/views.jsx), ByOrderView (prototype/by-order.jsx),
  OrderDrawer + QuickView (prototype/order-detail.jsx, quick-view.jsx).
- OrderItem stage transitions: po → prod → qc → packing → loading → final.
- Production update form: increment produced_qty_boxes; append OrderItemEvent.
- Activity feed reads from Activity table.

PHASE 4 — Palletisation & Container Loading
- Pallet packing screen: pick OrderItem → pick Pallet (filtered by
  Design.allowed_pallets) → enter boxes → close batch.
- Container CRUD with capacity_boxes (e.g. 1096), capacity_pallets, ETD.
- Container fit suggester (see BOFFO_Build_Plan.md section 3):
    Greedy v1 — sort pallets by design, fill earliest-ETD containers first,
    flag underfilled (<95%) containers in red.
  Allow drag-and-drop swap of PalletisedBatch between containers.
- Show "fixable boxes remaining" = capacity_boxes - SUM(loaded).

PHASE 5 — Dispatch & Reports
- Invoice generation per container (EX-NN/FY).
- Mark container Dispatched → set OrderItem.dispatched_qty_boxes, append
  events.
- Reports:
    1. Item-wise / PO-wise: ordered, produced, remaining (CSV + on-screen).
    2. Ready pallets: pallets with status=closed and no ContainerLoading.

## Engineering rules
1. NEVER invent a Zoho Catalyst SDK method. If you're not sure a method
   exists, stop and ask me to verify in the live docs.
2. Every API endpoint validates input with a Zod schema before touching
   the Data Store.
3. Every list endpoint supports pagination (?cursor, ?limit) and a `?fields`
   selector to avoid over-fetching.
4. Every mutation that affects > 1 row (e.g. convert quote → order +
   orderitems + activity) must use a Catalyst Data Store transaction if
   supported. If transactions are NOT supported, document the compensating-
   action strategy in code comments and STOP to confirm with me.
5. All money fields use integer minor units (paise / cents) in storage;
   format on display.
6. All dates store as ISO 8601 strings in UTC; format on display.
7. RBAC: enforce in the function (not just UI). Roles: Admin, Sales,
   Production, Packing, Dispatch.
8. Log every mutation to the Activity table with actor_user_id and a
   human-readable detail.

## What I want you to do FIRST, before writing any code
1. Read BoffoExport_Tracker.md and BOFFO_Build_Plan.md fully.
2. Skim every file in prototype/.
3. Produce a brief written plan (~150 lines max) that includes:
   a. The exact Catalyst Data Store table list with column types per ZCQL.
   b. Any open questions about Catalyst APIs you need me to verify
      (transactions, compound unique indexes, file size limits, etc.).
   c. A list of any places where the schema in BOFFO_Build_Plan.md doesn't
      match the prototype's mock data shape — and what you propose to do.
4. STOP and wait for my approval before starting Phase 0.

After each phase: run the build, deploy if I ask, then STOP and summarize:
- What was implemented
- What was deferred and why
- Any new open questions

Don't move to the next phase without my "go".

=== END CLAUDE CODE PROMPT ===
```

---

## 6. What to do next

1. **Verify the Catalyst items I flagged** in Section 0 — especially transactions in Data Store. This is the one decision that could force a schema redesign.
2. **Share the actual database schema file** if you have one separately. The schema in Section 2 is my best inference from your tracker doc.
3. **Decide on TypeScript vs JS** for the client. I recommended TS; the prototype is JS. Tell Claude Code which one.
4. **Confirm or adjust the phase order.** If you need Zoho Books sync earlier, move it from Phase 6 to Phase 2.
5. Drop `BoffoExport_Tracker.md`, this file (`BOFFO_Build_Plan.md`), and the `prototype/` folder containing your existing `.jsx` and `.html` files into the same directory, then run Claude Code from that directory with the prompt above.

If you want me to also produce: (a) the Zod schemas as actual code, (b) the seed-data SQL/ZCQL, or (c) a more detailed container-fit algorithm spec, say which and I'll do it.

---

## 7. ADDENDUM — Container Optimization v2 (3-Constraint Fit)

> **Why this addendum:** Sections 3 and Phase 4 above already describe a **single-constraint greedy** fit (boxes/pallet slots only), and that version is **already built** (see "Already built" below). This addendum captures **only the net-new work** that the original v1 plan deferred to "v2 later": weight and area as **hard, co-equal constraints**, mixed pallet types, cross-order fill suggestions, and 3-dimension utilization reporting. Nothing here restates §3/Phase 4 — it extends them.

### 7.1 What is already built (do not re-do)
- `Container` master: `capacity_boxes`, `capacity_pallets`, type/ETD/ports/status. **(no area, no max weight)**
- `Pallet` master: `boxes_per_pallet`, `pallets_per_container`, `empty_pallet_weight_kg`, computed `boxes_per_container`. **(no per-box weight, no area)**
- `fitSuggest()` in `functions/data-ops/index.js` — greedy, **slots only** (boxes + pallet count), earliest-ETD first, flags `<95%` underfilled, returns `{ suggestions, unassigned }`. Read-only (no persist).
- `FitSuggest.tsx` UI — per-container cards, box fill %, underfill warning, recompute button.
- Sagas: `/close-pallet`, `/load-container` (validates boxes + pallet count only), `/dispatch/:rowid`.

### 7.2 Net-new schema changes
1. **Design master — add `box_weight_kg`** (per-box weight). *Note:* §2.2 already lists `box_weight_kg`, but the built Design form/API does not expose it. Surface it in the form and persist it. This is the single source for weight; do **not** store weight on the pallet line.
2. **Pallet master — add area fields:**
   - `area_sqm_per_pallet`, `area_sqft_per_pallet` — either entered, or derived from `boxes_per_pallet × design coverage`. Decide per the open question below (pallet area is design-dependent when heterogeneous, so prefer **derive at fit time** from the actual design on each batch rather than storing a flat per-pallet area).
3. **Container master — add two hard-limit columns:**
   - `capacity_area_sqm` (total area limit)
   - `max_weight_kg` (total load limit — **hard limit; tiles are heavy**)
4. **Demo/Sample pool** — a source of fill boxes not tied to a customer order. Either a flag on existing batches (`is_demo`) or a small `DemoStock` table (`design_id`, `boxes_available`, `area`, `weight`). Decide per open question.

### 7.3 Derived quantities (computed at fit time, not stored)
Per palletised batch `b` carrying design `d` on pallet `p`:
- `weight(b) = b.boxes_packed × d.box_weight_kg + p.empty_pallet_weight_kg`
- `area_sqm(b) = b.boxes_packed × d.coverage_sqm`
- `slots(b) = 1` pallet position

Per container `c` after loading set `S`:
- `used_slots = |S|`, `used_area = Σ area(b)`, `used_weight = Σ weight(b)`
- `remaining = { slots, area, weight }` against `capacity_pallets`, `capacity_area_sqm`, `max_weight_kg`
- **binding constraint** = the dimension with the lowest remaining ratio (the one that capped the container)
- **utilization** = `{ slots_pct, area_pct, weight_pct }` — report all three.

### 7.4 Fit algorithm v2 (extends §3 greedy)
Keep greedy (First-Fit-Decreasing) per the recommendation — **do not** jump to a full optimizer in v1. Changes vs the built version:
1. A batch **fits** only if it satisfies **all three** simultaneously: `used_slots+1 ≤ capacity_pallets` AND `used_area+area(b) ≤ capacity_area_sqm` AND `used_weight+weight(b) ≤ max_weight_kg`.
2. **Mixed/heterogeneous pallets:** the loop already treats batches individually — because weight/area are now computed per-batch from its own design, mixed pallet sizes/designs in one container fall out naturally. No special case needed beyond per-batch derivation.
3. **Surface the binding constraint** on each container result (`binding: 'slots'|'area'|'weight'`) and stop-reason for unassigned batches.
4. **Underfill** is now "no constraint near full" — flag only when **all three** dims are `<95%` (a container capped on weight at 70% slots is *full*, not underfilled). This corrects the current box-only `<95%` flag.

### 7.5 Cross-order fill suggestions (new capability)
When a container has room after the current Master Order's batches are placed, generate **actionable, non-auto-applied** suggestions in strict priority order:
1. **Same customer — confirmed Master Orders:** unfulfilled/remaining palletisable boxes from another confirmed order of the same customer.
2. **Same customer — new / estimate-stage orders:** remaining boxes from a draft/pending quote/order (user calls customer to confirm live).
3. **Demo / sample boxes:** from the demo pool (last resort).

Each suggestion shows what it adds across all 3 dims and the resulting utilization. **Never auto-commit** — render as "Suggest / Accept / Adjust"; the existing `/load-container` saga commits only on explicit accept.

### 7.6 Master Order context (this branch: `feature/master-order-forms`)
**RESOLVED:** "Master Order" is a **rename of the existing `SalesOrder`** (not a new entity). Mapping: **Estimate = `Quote`**, **Master Order = `SalesOrder`** (a Master Order is a `SalesOrder` with status Confirmed). Keep the DB table name `SalesOrder`; change the **UI label** to "Master Order". No schema migration needed for this rename.

Flow is **Estimate/Quote → Master Order (`SalesOrder`, on customer confirmation) → partial or complete fulfillment → Palletisation**. The fit suggester operates on a **Master Order's** palletised batches; the cross-order tiers (7.5) pull from **other confirmed `SalesOrder`s of the same customer**.

### 7.7 Isolate the packing logic (testable module)
Extract the bin-packing out of the `data-ops` request handler into a **pure module** `functions/lib/fit.js` (no Catalyst/DS calls inside): `computeFit(batches, containers, demoPool, opts) → { suggestions, unassigned, perContainer:{utilization, binding} }`. The endpoint loads rows, calls the pure function, returns JSON. Unit-test `fit.js` with the "Junglee" fixture and edge cases (weight-binding, area-binding, slot-binding, mixed designs) — **do not hardcode fixture values** in the module.

### 7.8 UI changes (extend `FitSuggest.tsx`)
- Per-container card shows **three** bars (slots %, area %, weight %) and a **"capped by: weight"** badge.
- Underfill warning keyed off all-three-dims rule (7.4).
- New **"Fill suggestions"** panel listing tiered recommendations (7.5) with Accept/Adjust actions.
- Container & Pallet master forms get the new fields (7.2); Design form gets `box_weight_kg`.

### 7.9 Open questions to resolve before building
1. **Weight calibration — STILL OPEN (deferred by decision):** per-box weight (Design) and container `max_weight_kg` not yet provided. **Build the fields nullable and the constraint code now, but enforce weight only when both values are populated** (a batch/container with null weight is treated as weight-unconstrained). No calibration until numbers arrive.
2. **"900 pallets" = 900 boxes (~21 pallets)?** Confirm this reading (26 pallets/container, 43 boxes/pallet ⇒ 900 boxes ≈ 21 pallets).
3. **Packing approach:** confirm **greedy extended to 3 constraints + tiered fill** for v1 (documented simplification), revisit FFD/optimizer only if pack quality is insufficient. *(Recommended.)*
4. **Pallet area:** derive per-batch from design coverage (preferred, handles heterogeneous), or store a flat `area_per_pallet` on the Pallet master?
5. **Demo pool:** `is_demo` flag on batches, or a dedicated `DemoStock` table?
6. **Master Order:** ~~rename of `SalesOrder`, or a new parent entity?~~ **RESOLVED — rename of `SalesOrder` (UI label only, no new table). See §7.6.**

**Wait for approval on §7 before implementing — same stop-gate as the rest of this plan.**
