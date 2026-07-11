# BOFFO Order OS — Architecture (agreed)

> Companion to `BOFFO_Build_Plan.md` (phase plan + DB schema) and `BoffoExport_Tracker.md`
> (business spec / source of truth). This file records the **architecture decisions** locked with
> the product owner. Next step after this: the **technical plan** (ZCQL column types, function
> contracts, Zod schemas, phase task breakdown), then development.

## Status vs. reality (2026-07-11)

The decisions below are the locked historical record; where the build diverged, reality wins:

- **Catalyst project** — `boffo-latest-project` was **deleted 2026-07-04**. Live project:
  `boffo-granito-export-tracker` (projectId `69851000000043001`, org OCTFIS `925638796`).
- **Functions layout** — shipped as a **single router function** `functions/data-ops`
  (plus `functions/api-health`), not the per-resource `api-*` functions sketched below.
- **Auth** — Catalyst Embedded Auth was **not** used. App-level auth instead: `Role` /
  `AppUser` / `AuthSession` tables managed via data-ops `/auth/*` (bearer tokens).
  Shipped roles: **Admin / Editor / Viewer** (feature-list + can_update/can_delete flags),
  not the five-role list below.
- **Schema source of truth** — `DATASTORE-SCHEMA.md` (live snapshot), not the plan docs.
- **Open questions (§ below) — all answered** in `BOFFO_Technical_Plan.md` §0: no
  multi-row transactions (→ compensating-action sagas), no compound unique indexes
  (→ app-layer enforcement), Advanced I/O timeout 30s.
- `BoffoExport_Tracker.md` is no longer in the repo; `PRODUCT.md` is the product reference.

## What BOFFO is
Order-tracking system for a ceramic/porcelain **tile exporter** (Plant Morbi). Tracks the physical
pipeline end to end:

```
Quote → (accept) → Sales Order → Production → QC → Pallet Packing → Container Loading → Dispatch → Invoice
```

Unit-heavy domain: pieces → boxes → pallets → containers, with sqm/sqft coverage math and box/pallet
weights. Core business goal: **"containers shall not go empty"** (the container-fit suggester).

## Locked decisions
1. **Frontend = Vite + React 18 + TypeScript.** The Next.js 16 scaffold currently in this repo is to
   be **removed** and replaced with a Vite client. (Next.js was explicitly rejected in the build plan
   for the Catalyst static-hosting model.)
2. **Prototype handling = port visuals, keep the look identical.**
   - `prototype/` folder is copied in **verbatim and never edited** — canonical reference.
   - Shipped UI reuses `styles.css` **byte-for-byte** and reuses component markup/layouts
     (`Icon`, `ProgressBar`, `SplitBar`, `StageBadge`, Dashboard, Kanban, ByOrder, DesignMaster,
     OrderDrawer, QuickView) **exactly** — only adding `import/export` + TS types and swapping
     `window.*` mock data for real API calls. The look does not change.
3. **Tenancy = single-tenant** (one BOFFO org, multiple users/roles). No tenant-isolation layer.
4. **Multi-currency = INR, USD, EUR.** Per-document currency + FX rate captured at creation. Money
   stored as integer minor units. No live revaluation (out of scope per tracker).
5. **Zoho Books = one-way pull (Books → BOFFO)** for Customers, Vendors, Items. Multi-org Books
   connection per `Organization.books_org_id`. **Item-sync behavior (create Designs vs link to
   existing) is deferred to the Books integration phase (Phase 6).**
6. **Backend = Zoho Catalyst** — Advanced I/O Functions (Node 18+), Data Store (ZCQL), Embedded Auth,
   File Store. Catalyst project already exists: `boffo-latest-project` (see `.catalystrc`).

## Repository shape (Catalyst monorepo)
```
boffo-granito-latest/
├── client/                 # Vite + React 18 + TS  → Catalyst hosted (static)
│   └── src/{app, features/*, ui, lib, styles}
├── functions/              # Catalyst Advanced I/O Functions (Node 18+)
│   ├── api-{customers,designs,pallets,quotes,orders,orderitems,
│   │        palletisation,containers,invoices}
│   ├── api-books-sync/     # Zoho Books integration
│   └── lib/{db.ts (ZCQL DAL), auth.ts, currency.ts, ids.ts, errors.ts}
├── prototype/              # copied in VERBATIM, never edited (reference)
├── catalyst.json
├── BOFFO_Build_Plan.md
├── BoffoExport_Tracker.md
└── BOFFO_Architecture.md   # this file
```

## Data-model insight (prototype ↔ schema reconciliation)
- The prototype's `ORDER` object is really a **line item** (one design + qty + stage + produced/
  palletized/loaded counters). Mapping:
  - prototype "order row" → **`OrderItem`**
  - `poNumber` group → **`SalesOrder`**
  - `producedQty / palletizedQty / loadedQty / stage` → `OrderItem` stage-counter columns.
- SKU = `Size-Finish-Category-Glaze` (e.g. `01-02-03-01`) via per-attribute NumberMasters.
- Coverage: `Sq.M = (W/1000 × L/1000) × pcs/box`; `Sq.Ft = Sq.M × 10.763915`.
- Pallet computed fields: total pallet weight, boxes/container, sqm-per-container, etc.

## Backend rules (baked in from day one)
- Zod-validate every input before touching Data Store.
- Money in integer minor units; dates ISO-8601 UTC; format on display.
- RBAC enforced server-side (Admin / Sales / Production / Packing / Dispatch), not just UI.
- Every mutation logged to `Activity` with actor + human-readable detail.
- List endpoints: pagination (`?cursor`, `?limit`) + `?fields` selector.
- PDF via `pdfmake` (quote/invoice templates).

## Open questions to verify before locking the schema (Catalyst specifics)
1. **Data Store multi-row/multi-table transactions** — needed for convert-quote→order and
   loaded-boxes-vs-capacity. If unsupported → compensating-action strategy. **(Highest risk.)**
2. **Compound unique indexes** — for `Design.unique_name` and SKU. If unsupported → enforce at app layer.
3. **Function limits** — request size / execution time (affects PDF + bulk Books sync).
4. **Books sync depth** — customer + vendor both one-way pull; item create-vs-link (deferred to Phase 6).

## Phase order (from build plan, unchanged)
0. Bootstrap → deployed URL (Vite client + `api-health` + Embedded Auth).
1. Masters CRUD (+ SKU generator, design image upload, seed data).
2. Quotes (calc engine, public link, PDF, convert→SO full/partial).
3. Orders & Pipeline (Kanban/ByOrder/OrderDrawer ported, stage transitions, activity feed).
4. Palletisation & Container Loading (fit-suggester, drag-swap).
5. Dispatch & Reports (invoice per container, item/PO-wise reports).
6. Zoho Books integration & RBAC polish (item create-vs-link decided here).
