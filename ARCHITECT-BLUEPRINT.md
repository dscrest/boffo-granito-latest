# Senior Architect's Blueprint — "Build me a BOFFO-class operations app"

> Copy this whole file into a fresh project as `ARCHITECT-BLUEPRINT.md` and hand it to
> your AI pair (or a new dev). It is written as an **instruction prompt**: read it top to
> bottom, then build. It encodes every decision we already paid for on BOFFO so the next
> app starts at friction-zero. Swap the domain nouns (tiles, pallets, containers) for your
> own; keep the skeleton, the conventions, and the "what NOT to do" list intact.

---

## 0. How to use this document

You are building a **single-tenant internal operations system** — a "system of record" that
replaces spreadsheets and WhatsApp for a physical business pipeline. The reference
implementation (BOFFO) tracks tile-export orders: `Quote → Sales Order → Production → QC →
Palletisation → Container Loading → Dispatch → Invoice`. Your domain will differ; the
architecture will not.

**Golden rule:** every visual, every grid, every form, every detail page is ONE system.
Build the shared primitives first (Section 6), then every feature reuses them. Never build a
bespoke one-off control when a shared one exists. Consistency is the product.

Build in the **phase order** in Section 10. Do not scaffold ahead. Ship each phase to a live
URL before starting the next.

---

## 1. Tech stack (locked — do not substitute)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React 18 + TypeScript** | NOT Next.js. Static-hosted. Hash routing. |
| Router | `react-router-dom` v6, **HashRouter** | Route path === logical view id. Every page `lazy()`-loaded → own chunk. |
| Styling | **One hand-written `styles.css`** + CSS custom properties | No Tailwind, no CSS-in-JS, no component library. ~2000 lines, design tokens at `:root`. |
| PDF | `pdfmake` (client-side) | Quote / invoice templates. |
| Backend | **Zoho Catalyst** — Advanced I/O Functions (Node 18+), Data Store (ZCQL), File Store | Serverless. Single router function, not per-resource. |
| Auth | **App-level** (custom tables + bearer tokens), NOT Catalyst Embedded Auth | scrypt password hashing, 64-hex tokens, 7-day TTL. |
| State | Plain React hooks + a tiny module-level cache (`lib/cache.ts`) with pub/sub | No Redux, no React Query, no Zustand. |
| Validation | Server-side, hand-rolled in the router (Zod optional) | Never trust the client. |

**Dependency discipline:** the entire client runs on **4 runtime deps** (`react`, `react-dom`,
`react-router-dom`, `pdfmake`). Add a fifth only when a few lines genuinely can't do it. This is
a feature, not a limitation — it kept the app fast, legible, and un-bloated.

**Repo shape (Catalyst monorepo):**
```
<app>/
├── client/                      # Vite + React 18 + TS → Catalyst static hosting
│   └── src/{App.tsx, AuthGate.tsx, data.ts,
│            features/<domain>/*, ui/*, lib/*, styles/*, types/*}
├── functions/
│   ├── data-ops/                # SINGLE router function — all business + generic CRUD
│   │   ├── index.js             # ~2700 lines: route table + sagas
│   │   └── lib/{appauth.js, <domain-calc>.js, *.test.js}
│   └── api-health/              # trivial health check
├── catalyst.json, .catalystrc
├── DATASTORE-SCHEMA.md          # LIVE schema snapshot — source of truth, keep current
├── ARCHITECT-BLUEPRINT.md       # this file
└── <plan / product / architecture docs>.md
```

---

## 2. Users & product framing

Write your own `PRODUCT.md` first, following this template (BOFFO's, distilled):

- **Users:** non-technical operations staff (sales, production/QC, logistics, admin).
  Desktop-first, used all day, some on warehouse laptops. Design for *speed and accuracy*,
  not delight.
- **Purpose:** one sentence — "replaces spreadsheets + scattered chat with one live pipeline,
  so anyone can answer 'where is this order?' in seconds."
- **Brand personality:** *Efficient, calm, trustworthy.* Data first, low visual noise, nothing
  fights for attention.
- **Anti-references** (name what you refuse to look like):
  1. Cluttered legacy ERP (Tally-style walls of fields, popup mazes).
  2. Flashy marketing SaaS (gradients, oversized heroes, decorative dashboards).
  3. Generic AI-generated look (interchangeable card grids, purple gradients, uniform
     spacing with no hierarchy).
- **Design principles** (these are load-bearing — enforce them):
  1. **The grid is the product.** List pages are where work happens.
  2. **One source of truth per fact.** A count/total appears in exactly one place per screen.
  3. **Real numbers only.** Never fake a KPI; an honest "—" beats a placeholder.
  4. **Masters feed processes.** Pick-list values ALWAYS come from DB masters, never hardcoded.
  5. **Every action confirms.** Writes show progress + land in an audit log.
- **Accessibility:** WCAG AA basics — ≥4.5:1 contrast, keyboard-operable primary flows,
  visible focus. Modals trap focus (`useModalA11y`).

---

## 3. Design system — color, type, layout

All tokens live at `:root` in `styles.css`. This is the exact BOFFO palette; retune `--accent`
to your brand and keep the rest — it's a warm, low-noise, paper-like neutral system that reads
as "calm operational tool."

```css
:root {
  /* Surfaces — warm off-white "paper", not cold grey */
  --bg:        #f7f5f2;   --panel:   #ffffff;  --panel-2: #f4f1ec;
  --elevated:  #ece7e0;   --border:  #e9e4dc;  --border-2:#dcd4c8;
  --hover:     #f3efe9;

  /* Sidebar — warm near-black (own family, not pure #000) */
  --sidebar-bg:#171110;   --sb-fg:#f5f1ec; --sb-muted:#b3a89e; --sb-dim:#8a7d70;
  --sb-hover:  rgba(255,255,255,.06);  --sb-active:#2a211a;  --sb-border:rgba(255,255,255,.09);

  /* Ink */
  --fg:#17110c; --fg-2:#463d33; --muted:#695d50; --dim:#86796a; --faint:#d4cbbe;

  /* Stage / status colors — OKLCH for perceptual evenness. Map each to a pipeline stage. */
  --c-amber: oklch(0.62 0.16 70);   /* PO         */
  --c-blue:  oklch(0.55 0.16 245);  /* Production */
  --c-violet:oklch(0.55 0.20 295);  /* Packing    */
  --c-cyan:  oklch(0.55 0.13 210);  /* Loading    */
  --c-green: oklch(0.55 0.16 150);  /* Final / OK */
  --c-red:   oklch(0.58 0.20 25);   /* Danger     */

  /* Accent (primary) — RETUNE THIS to your brand. BOFFO = orange #EF7F1A */
  --accent:    oklch(0.71 0.17 55);  --accent-fg:#170f0b;
  --accent-soft:oklch(0.71 0.17 55 / 0.12);  --accent-ink:oklch(0.56 0.15 55);

  /* Layout */
  --sidebar-w:232px;  --header-h:52px;

  /* Type — self-host the font (Puvi here); DON'T hotlink Google Fonts */
  --font-sans:'Zoho Puvi', system-ui, sans-serif;
  --font-mono:'Zoho Puvi', ui-monospace, monospace;
  --t-xs:10.5px; --t-sm:11.5px; --t-md:12.5px; --t-lg:13.5px; --t-xl:16px;
}
```

**Type scale is deliberately small (10.5–16px).** This is a dense data tool for all-day use, not
a landing page. Resist the urge to make everything bigger.

**Layout shell:** fixed dark left sidebar (232px) with grouped nav + a 52px top header
(global search, notification bell, user menu). Content area is the working surface. One shell,
every page lives inside it.

---

## 4. Data model — the schema pattern

The full BOFFO schema is in `DATASTORE-SCHEMA.md` (33 tables). Don't copy the tile-specific
tables; copy the **patterns**. Keep a live `DATASTORE-SCHEMA.md` as your single source of
truth and update it on every schema change.

**Universal table conventions (every table gets these):**
- System columns (auto): `ROWID` (bigint PK), `CREATORID`, `CREATEDTIME`, `MODIFIEDTIME`.
- **Soft delete:** every table (except the op-log) has `deleted_at` (datetime, null = active).
  The generic `DELETE /:table/:rowid` sets `deleted_at`; `?hard=1` forces real delete;
  `POST /:table/:rowid/restore` clears it. Generic list excludes soft-deleted unless
  `?include_deleted=1`.
- **Natural keys** enforced at the app layer (Catalyst has no compound unique indexes):
  e.g. Customer keys on `name`, Size on `code`, Design on `unique_name` → data-ops returns 409
  on collision.
- **Money:** store as numbers; capture per-document `currency` + `exchange_rate` at creation.
  Base currency INR (retune). A `Currency` master holds rates; a daily FX cron refreshes them
  (rows with `manual_override` are skipped).
- **Dates:** `date` columns reject empty string — omit the key when blank. `datetime` wants
  `yyyy-MM-dd HH:mm:ss` (NOT ISO-8601). Every date field in every form defaults to **today**.
- **Reserved words:** ZCQL rejects `order`, `priority` etc. → use `sales_order`, `priority_level`.
- **`LIMIT` hard-caps at 300 rows/query** — paginate server-side.
- **FKs:** `ON-DELETE-CASCADE` (line items die with parent) or `SET-NULL` (references).
  Where the schema API can't round-trip 17-digit parent ids (>2^53), use a **logical FK**
  (plain bigint, joined in app code) and document it as such.

**Table archetypes (build these categories):**

1. **Lookups / masters** — small pick-list tables (Size, Finish, Category, Brand, Grade,
   PaymentTerm, Currency, PartyBrand…). Each has a `name`/`code` natural key and a `seq_code`
   (short code) if it feeds a composite SKU. **All UI pick-lists read from these — never hardcode.**
2. **Entity masters** — the rich records (Customer, Design/Item, Pallet). Snapshot-fill derived
   fields from the lookup they reference (e.g. coverage/weight copied from the picked Size,
   never hand-typed) so a master edit doesn't silently rewrite history.
3. **Documents** — header + line-item pairs with CASCADE (Quote/QuoteItem,
   SalesOrder/OrderItem). Header carries currency, totals, status; lines carry qty/rate.
4. **Pipeline / stage tables** — the physical process (ProductionLog, PalletisedBatch +
   Line, Container + Loading). Carry stage counters and a `status` lifecycle.
5. **System/audit** — `Activity` (human-readable feed), `OperationLog` (every mutation with
   actor/duration/status), `StatusTransition` (every status/stage flip), `Notification`
   (per-user in-app). **Every mutation writes to the op-log and, where relevant, a transition row.**
6. **Auth** — `Role` (permission matrix JSON), `AppUser` (scrypt hash), `AuthSession` (token).

**Composite SKU pattern:** SKU = ordered concatenation of per-attribute `seq_code`s
(`DesignShortCode-Size-Finish-Category-Glaze-Brand-Grade`). Generated server-side from stored
short codes; never hand-entered. (BOFFO has a deferred "readable acronym SKU" rework — design
the SKU generator so segments are swappable.)

---

## 5. Backend — the single-router pattern

**One Catalyst Advanced I/O function `data-ops`** owns everything (~2700 lines is fine — it's a
flat route table, not a monolith of tangled logic). Structure:

- **Public routes registered BEFORE the auth guard** (e.g. `GET /public/design-image/:id`,
  `GET /public/quote/:token`) so `<img>` tags and share links work tokenless.
- **Auth guard** (`lib/appauth.js`): validates bearer token → session → user → role. Maps each
  table/route to a **module** (`quotes/orders/customers/items/stages/invoices/reports/settings`)
  and each HTTP method to an **action** (`view/create/edit/delete`). Checks `Role.matrix` JSON.
  Role named **Admin** bypasses everything and is locked against edit/delete server-side.
- **Generic CRUD:** `GET/POST /:table`, `PATCH/DELETE /:table/:rowid`, `/restore`. An ALLOWED
  set gates which tables are exposed. Auth tables are deliberately NOT in it.
- **Business routes / sagas** for anything multi-row (Catalyst has **no multi-row transactions**):
  use **compensating-action sagas**. Examples: `/convert-quote` (quote→SO full/partial),
  `/update-quote-with-items` (header + wholesale line replace), `/quote-status` & `/so-status`
  (validated state machines — generic PATCH *rejects* status writes so they can't bypass the
  machine), `/production-log` + `/production-status` + `/production-record` (request → approve →
  record lifecycle), `/close-pallet`, `/load-container`, `/dispatch`, `/fit-suggest`.
- **Numbering:** document numbers (`SO/{FY}/NNN`) assigned server-side via MAX-scan or a
  `TransactionSeries` counter. Never client-editable.
- **Every mutation** → `OperationLog` row (actor, duration_ms, success/error, payload summary)
  + `StatusTransition` on status flips + `Notification` for approval verdicts.
- **Cron:** daily FX refresh via a Webhook job pool hitting `GET /cron/fx-refresh?key=$SECRET`.

**Rules baked in from day one:** validate every input server-side; RBAC enforced server-side
(not just hidden in UI); list endpoints paginate + support a `?fields` selector; PDFs via pdfmake.

---

## 6. Frontend — shared primitives (BUILD THESE FIRST)

Everything else composes from `ui/` and `lib/`. This is the highest-leverage work; do it before
any feature.

**`ui/` component kit** (all sharing one aesthetic — reuse, never re-style):
- `Icon.tsx` — single icon set.
- `Combobox.tsx` — the ONLY pick-list control. DB-sourced options, creatable, Enter commits
  typed text (create-new or top match). Every pick list in every form uses this.
- `GridFooter.tsx` — pagination footer. Every list grid has one.
- `ColumnPicker.tsx` — icon-only show/hide + reorder columns. Drives both grids and
  detail-page "Fields" pickers.
- `AdvancedFilter.tsx` — advanced-search modal. Every grid has one.
- `DateInput.tsx` — native `<input type=date>` wrapper, defaults to today.
- `NumberInput.tsx` — no negatives, formatted.
- `ImageUploader.tsx` — File Store upload (base64 → server → File Store id; max 5).
- `Toast.tsx` / `ConfirmDialog.tsx` — `ToastHost` + `ConfirmHost` mounted once in `App.tsx`;
  imperative `toast()` / `confirm()` calls anywhere.
- `States.tsx` — `SkeletonRows`, empty/error states.
- `ErrorBoundary.tsx`, `primitives.tsx` (Button/Card/Pill/etc.), `useModalA11y.ts` (focus trap).

**`lib/` utilities:**
- `api.ts` — fetch wrapper + auth header + File Store helpers.
- `dataOps.ts` — typed calls to the data-ops router.
- `auth.ts` — `checkSession`, `hasFeature`, `canApprove`, `SessionUser`.
- `cache.ts` — module-level cache with `subscribe`/`cached<Entity>` pub-sub (this IS the state
  layer; pages subscribe to live entity lists).
- `format.ts` — money/number/date formatting (one place, used everywhere).
- `dates.ts` — `todayISO` etc.
- `seq.ts` — SKU/short-code generation.
- `csv.ts` — client-side export.
- `stock.ts`, `pdf.ts` — domain calc + PDF glue.

**`useColumns` / `useMasters` / `useOrders` hooks** — per-feature data + column-state hooks
that wrap the cache + ColumnPicker so grids stay uniform.

---

## 7. Page structures (the three page archetypes)

Every screen is one of three shapes. Build them once, clone the shape everywhere.

### A. List / Grid page (the workhorse — `QuotesTable`, `OrdersTable`, `DesignMaster`, `Pallets`…)
- Page head: **title + one-line subtitle** (names the master/module). **No breadcrumbs, ever.**
- Toolbar: primary action (Create/New), global-ish filters, ColumnPicker (icon-only),
  Advanced-search button, CSV export.
- Grid: **data-driven ColumnDefs** with show/hide + reorder; `Created`/`Modified` columns
  present but default-hidden; **no `#` row-number column**. **Whole row click → detail page.**
- Footer: `GridFooter` pager (always). Row counts appear once, in the footer.
- Header actions are **right-aligned**, always.

### B. Detail page (`QuoteDetail`, `OrderDetail`, `ItemDetail`, `CustomerDetail`, `PalletDetail`…)
- **One shared design** (`common/RecordDetail.tsx` + `DetailBits.tsx`). Copy the Quote/Item
  detail layout and apply everywhere — do not invent a second detail design.
- Header: title + status pill + **right-aligned action row**; a `More` menu with **Clone**
  (seeds the create form from this record, saves as NEW — never copies auto-gen identity fields).
- Body: field groups (Fields picker uses the same ColumnPicker), line-items table, a
  **Status Timeline** (from `StatusTransition`), and an activity/audit strip.
- After create/clone → **navigate to the newly created record** (id from the API response),
  never to a random or previously-selected one.

### C. Form page (`QuoteForm`, `OrderForm`, `DesignForm`, `PartyForm`, stage forms…)
- **No negative numbers.** Pick lists are **Combobox-only**, DB-sourced.
- Required marker rendered **in-box** + a legend explaining it.
- **Grey field = auto/derived**, white = typable. Derived fields carry a `ƒx` calc marker.
- **Inputs before derived** in layout order.
- **Save-only buttons** (no Save-and-new clutter unless asked).
- `seq_code` / short codes are **auto-generated** — no "Short Code" inputs in the UI.
- **Sales Person** field defaults to the logged-in user; **customer fields prefill** all
  inherited fields onto quotes/orders; **every date defaults to today**; **currency defaults
  to base (INR)**.

---

## 8. Feature map (BOFFO's — mirror the categories, swap the domain)

| Module | Pages | Purpose |
|---|---|---|
| Dashboard | `Dashboard` | Live KPIs (real numbers only). |
| Quotes | `QuotesTable`, `QuoteDetail`, `QuoteForm`, `Approvals`, `SharedQuote`, PDF | Quote lifecycle + public share link + approval workflow. |
| Orders | `OrdersTable`, `ByOrderView`, `OrderDetail`, `OrderForm`, `OrderDrawer` | Sales orders; convert-from-quote (full/partial). |
| Pipeline | `Kanban`, `QuickView` | Stage board across the pipeline. |
| Stages | `PurchaseOrders`, `Production*`, `QC`, `PalletPacking`, `Loading`, `LoadPlanner`, `FinalLoading`, `Dispatch`, `FitSuggest` | Each physical stage with request→approve→record lifecycles. |
| Masters | `DesignMaster`/items, `Parties`/customers, `Pallets`, `Sizes`, `Containers` + forms/details | The reference data. |
| Admin | `Users`, `Roles`, `SalesPersons`, `Currencies` | RBAC + rates. |
| Invoices | `Invoices` + PDF | Per-container/SO invoices. |
| Reports | `ReportsHome`, `ReportShell`, `Reports` | Item-wise / PO-wise / aging reports. |
| Ops | `OperationsLog` | The mutation audit log surfaced in-app. |
| Settings | `SettingsHome`, `DataOperations` | Masters management + data ops. |
| Search | `GlobalSearch` | Header-level cross-entity search. |
| Shell | `HeaderMenus` (`NotificationBell`, `UserMenu`), `AuthGate` | The frame. |

**Change-request discipline:** every change comes in through a 6-field template — CHANGE /
WHERE / WHY / APPLY TO / LIKE / DONE WHEN — with standing rules: do a **consistency sweep**
(apply the pattern everywhere it exists, not just where asked), **reuse** before building, and
verify against a **DONE WHEN** acceptance check.

---

## 9. DO / DON'T (the expensive lessons — obey these)

### DO
- **DO** build the shared `ui/` + `lib/` primitives first; make every feature compose them.
- **DO** source every pick list from a DB master; add a creatable Combobox where users need new values.
- **DO** enforce RBAC, natural keys, and validation **server-side** — the UI is not a security boundary.
- **DO** log every mutation (OperationLog) and every status flip (StatusTransition).
- **DO** default dates to today, salesperson to the logged-in user, currency to base, and
  prefill inherited customer fields.
- **DO** snapshot derived master data onto documents (coverage, weight, rate) so later master
  edits don't rewrite history.
- **DO** navigate to the freshly-created record after create/clone.
- **DO** keep `DATASTORE-SCHEMA.md` current — it is the source of truth over plan docs.
- **DO** make whole rows clickable → detail; keep header actions right-aligned; keep the type scale small.
- **DO** use soft delete everywhere; use compensating-action sagas for multi-row work.

### DON'T
- **DON'T** use Next.js — the Catalyst static-hosting model wants a plain Vite SPA.
- **DON'T** add dependencies for what a few lines do; don't reach for Tailwind / a UI kit /
  Redux / React Query. The stack is deliberately tiny.
- **DON'T** hardcode pick-list values, statuses, or rates — they come from masters/DB.
- **DON'T** show placeholder/fake KPIs; an honest "—" wins.
- **DON'T** show a fact twice on one screen (header vs toolbar vs footer) — one source of truth.
- **DON'T** add breadcrumb nav; the sidebar is the map. Page head = title + subtitle only.
- **DON'T** add a `#` row-number column, negative-number inputs, or "Short Code" text inputs.
- **DON'T** surface backend/infra wording (Catalyst / Data Store) anywhere in the UI.
- **DON'T** invent a second detail-page or form design — clone the one that exists.
- **DON'T** allow status writes through the generic PATCH — force them through the state-machine route.
- **DON'T** assume multi-row transactions or compound unique indexes exist — they don't; use
  sagas + app-layer enforcement.
- **DON'T** hotlink web fonts — self-host.

---

## 10. Phase order (ship each to a live URL before the next)

0. **Bootstrap** → deployed URL: Vite client + `api-health` + the auth tables + `AuthGate` +
   the shell (sidebar/header) + the `ui/`/`lib/` primitives.
1. **Masters CRUD** — lookups + entity masters, SKU/short-code generator, image upload, seed data.
2. **Documents** — Quotes (calc engine, public share link, PDF, approval workflow,
   convert→order full/partial).
3. **Orders & pipeline** — Kanban/ByOrder/detail, stage transitions, activity feed, notifications.
4. **Stage processing** — production request→approve→record, QC, palletisation, container
   loading + fit-suggester.
5. **Dispatch & reports** — invoice per container/SO, item/PO-wise + aging reports.
6. **Integrations & RBAC polish** — accounting sync (e.g. Zoho Books one-way pull), role-matrix
   refinement.

---

## 11. Definition of done (per screen)

- Uses the shared shell, grid, detail, or form archetype — no bespoke layout.
- Every pick list is DB-sourced via Combobox; every date defaults to today.
- RBAC checked server-side; unauthorized actions hidden AND refused.
- Every write shows progress, lands in OperationLog, and (if status changes) StatusTransition.
- Whole-row → detail; create/clone → the new record; header actions right-aligned.
- No fake numbers, no duplicate facts, no breadcrumbs, no infra wording, WCAG AA basics pass.
- `DATASTORE-SCHEMA.md` updated if the schema changed.
```
