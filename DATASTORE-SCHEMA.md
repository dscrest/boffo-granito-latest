# BOFFO — Catalyst Data Store Schema (Live Reference)

> Snapshot pulled directly from Zoho Catalyst on **2026-06-12** via `List_All_Tables` + `List_All_Columns`.
> This is the source of truth for table/column names and IDs — prefer this over plan docs.

**Project (LIVE since 2026-07-04):** `boffo-granito-export-tracker` · projectId `69851000000043001` · org OCTFIS `925638796` · env `Development`
**Endpoint:** `https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/server/data-ops/`

> ⚠️ 2026-07-04: `boffo-latest-project` (org 926227227) was deleted. All `76673…` table_ids
> below are from that dead project and kept only as schema reference — the live table ids
> are in [catalyst-migration/new-table-ids.json](catalyst-migration/new-table-ids.json)
> (schema/columns are identical; FK columns are plain bigint in the live project).

## Conventions

- Every table has system columns (omitted below): `ROWID` (bigint, PK), `CREATORID` (bigint), `CREATEDTIME` (datetime), `MODIFIEDTIME` (datetime).
- A table's **ROWID column_id = table_id + 1** (system cols occupy table_id+1..+4). FKs always point at parent's ROWID column.
- FK constraint types in use: `ON-DELETE-CASCADE` (child dies with parent) and `ON-DELETE-SET-NULL`.
- `date` columns reject empty string — omit the key when blank. `datetime` wants `yyyy-MM-dd HH:mm:ss` (NOT ISO-8601).
- ZCQL `LIMIT` hard-caps at 300 rows/query.
- Reserved keywords avoided: `order` → `sales_order`, `priority` → `priority_level`.
- **Soft delete (added 2026-06-12):** every table except OperationLog has `deleted_at` (datetime, nullable; null = active). data-ops generic `DELETE /:table/:rowid` sets `deleted_at` instead of removing the row (`?hard=1` forces real delete; OperationLog always hard-deletes). `POST /:table/:rowid/restore` clears it. Generic list excludes soft-deleted rows unless `?include_deleted=1`. FK CASCADE/SET-NULL no longer fires on user deletes. Internal hard deletes remain: quote line replacement, saga compensation.

## Table Index (35 tables)

| Table | table_id | Purpose |
|---|---|---|
| Organization | 76673000000047001 | Own org profile |
| Brand | 76673000000047360 | Lookup |
| Invoice | 76673000000047747 | Invoices (per container/SO) |
| Grade | 76673000000048008 | Lookup |
| Customer | 76673000000048382 | Customers (Books-sync target) |
| DesignPallet | 76673000000048747 | Design↔Pallet join |
| PaymentTerm | 76673000000049001 | Lookup |
| NumberMaster | 76673000000049360 | SKU sequence per entity |
| Pallet | 76673000000049723 | Pallet packing master |
| Size | 76673000000050001 | Lookup (keys on `code`) |
| QuoteItem | 76673000000050364 | Quote line items |
| Finish | 76673000000051001 | Lookup |
| SalesOrder | 76673000000051371 | Sales Orders (UI label) |
| OrderItem | 76673000000051730 | SO line items + stage qty |
| Category | 76673000000052001 | Lookup |
| TransactionSeries | 76673000000052360 | Quote#/SO# numbering |
| Design | 76673000000052723 | Product/design master |
| Glaze | 76673000000053001 | Lookup |
| OrderItemEvent | 76673000000053367 | Qty-stage audit events |
| PalletisedBatchLine | 76673000000053726 | Batch↔OrderItem allocation |
| Quote | 76673000000054021 | Quotes |
| Activity | 76673000000054380 | Generic activity feed |
| PalletisedBatch | 76673000000055018 | Packed pallet batches |
| Container | 76673000000055377 | Shipping containers |
| OperationLog | 76673000000056094 | Mutation op log (data-ops) |
| ContainerLoading | 76673000000058115 | Container↔Batch loading |
| Role | 76673000000092001 | App auth: role + permissions |
| AppUser | 76673000000094001 | App auth: sign-in accounts |
| AuthSession | 76673000000095001 | App auth: bearer tokens |
| SalesPerson | 76673000000115495 | Sales reps on quotes/SO (links AppUser) |
| PartyBrand | 69851000000060042 (live) | Lookup — party brands (feeds unique_name) |
| Currency | 69851000000065195 (live) | Currency master + INR exchange rates |
| StatusTransition | 69851000000066173 (live) | Status/stage flip audit (Quote/SO/OrderItem) — added 2026-07-13 |
| Notification | 69851000000062554 (live) | Per-user in-app notifications — added 2026-07-13 |
| ProductionLog | 69851000000068024 (live) | Production entries (order jobs + independent stock) — added 2026-07-15 |

## SalesPerson (76673000000115495) — added 2026-06-23

Master list of sales reps shown on Quotations / Sales Orders. In the generic-CRUD
ALLOWED set; natural key = `name`. **Auto-managed since 2026-07-13:** every AppUser
gets a SalesPerson row, synced (name/email/active) on each successful login
(`syncSalesPersons` in functions/data-ops/lib/appauth.js). The admin page
(`/salespersons`) only edits the rep-specific phone/region fields; create/delete
were removed.

| Column | Type | Notes |
|---|---|---|
| name | varchar(160) | unique, mandatory (natural key, shown on documents) |
| email | varchar(160) | |
| phone | varchar(40) | mobile |
| region | varchar(120) | territory/market |
| active | boolean | inactive → hidden from form pickers |
| app_user | bigint | **logical FK** → AppUser ROWID (required by app convention). NOT a DB foreign key — the Create_Column MCP tool can't set int64 parent IDs (>2^53 precision loss), so the link is a plain bigint resolved in app code. |
| deleted_at | datetime | soft delete |

**Quote / SalesOrder change (2026-06-23):** the freeform `salesperson` varchar was
**dropped** and replaced by `sales_person` (bigint, logical FK → SalesPerson ROWID).
data-ops resolves the picker's name → ROWID on write (`salesPersonMap` + `resolveOptional`);
client read paths (ordersApi/quotesApi/SharedQuote) join ROWID → name and still expose
the field as `salesperson` (name string), so the UI contract is unchanged. Legacy text
values ("Dhiraj"→existing user, "Ravi"→new disabled user `ravi@legacy.boffo.local`) were
migrated to SalesPerson rows and backfilled.

## Design images (#12, added 2026-06-23)

- **File Store folder** `design_images` (id `76673000000124054`) holds uploaded design images.
- **Design.image_urls** (text, col `76673000000118082`) — JSON array of File Store file ids (max 5, capped client + server). Legacy `image_url` kept (now = first image).
- data-ops routes: `POST /upload/design-image` (auth, body `{name, data:<base64>}` → `{id}`; writes /tmp → streams to File Store) and **PUBLIC** `GET /public/design-image/:fileId` (registered BEFORE the auth guard so `<img>` works tokenless; streams bytes, infers mime from file ext). Client: `uploadDesignImage()` + `designImageUrl()` in [api.ts](client/src/lib/api.ts); `ImageUploader` in [ui/ImageUploader.tsx](client/src/ui/ImageUploader.tsx).

## Auth tables (added 2026-06-12)

App-level login (NOT Catalyst user management). Managed exclusively via data-ops `/auth/*`
endpoints — these 3 tables are deliberately NOT in the generic-CRUD ALLOWED set.
Every other data-ops route requires a valid session token. Permissions are per-module
(`Role.matrix`, 2026-07-13): the guard (appauth.js) maps each table/business route to a
module (quotes / orders / customers / items / stages / invoices / reports / settings) and
each HTTP method to an action (view / create / edit / delete; export is client-side).
Unmapped side tables (Currency, SalesPerson, Notification, logs…) keep the legacy rules:
GET = any authed user, POST/PATCH = `can_update`, DELETE = `can_delete`
(`POST /fit-suggest` exempt, read-only). The role named **Admin** bypasses everything and
is locked against edit/delete server-side.

### Role (76673000000092001) — matrix col added 2026-07-13 (live col `69851000000066545`)
| Column | Type | Notes |
|---|---|---|
| name | varchar(50) | unique, mandatory ("Admin" reserved) |
| matrix | text(10000) | JSON `{"modules":{"quotes":["view","create","edit","delete","export"],…},"approve":["Quote","SalesOrder"]}`; null = legacy role, synthesized from the 3 columns below |
| features | text | LEGACY/derived — JSON nav-id array; kept in sync with matrix on role writes |
| can_update | boolean | LEGACY/derived rollup: any module has create\|edit |
| can_delete | boolean | LEGACY/derived rollup: any module has delete |

`matrix.approve` lists the doc types the role may approve/reject (PendingApproval verdicts
in `/quote-status` and `/so-status`). Role CRUD: `GET/POST /auth/roles`,
`PATCH/DELETE /auth/roles/:rowid` (Admin only; delete refused while users are assigned).

Seeded: Admin (superuser, matrix null), Editor / Viewer (legacy, matrix null — reassign
users then delete via the Roles page), Manager (all modules all actions, approves both),
Sales Person (quotes/orders view-create-edit-export, customers view-create-edit,
items view, reports view+export, no delete, no approve). Live seeds: `catalyst-migration/data/Role.json`.

### AppUser (76673000000094001)
| Column | Type | Notes |
|---|---|---|
| email | varchar(100) | unique, mandatory, stored lowercase |
| name | varchar(100) | |
| password_hash | varchar(255) | `scrypt$<salt-hex>$<hash-hex>` (scryptSync, 64-byte key) |
| active | boolean | default true; false = cannot sign in |
| deleted_at | datetime | soft delete |
| role | FK → Role | ON-DELETE-SET-NULL; no role = no permissions |

### AuthSession (76673000000095001)
| Column | Type | Notes |
|---|---|---|
| token | varchar(100) | unique, mandatory; 64-hex random bearer token |
| expires_at | datetime | IST string; lexicographic compare vs now (7-day TTL) |
| app_user | FK → AppUser | ON-DELETE-CASCADE |

---

## Lookup tables

### Organization (76673000000047001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | |
| books_org_id | varchar(255) | Zoho Books org link |
| default_currency | varchar(10) | |
| address | text(10000) | |

### Brand (76673000000047360) — `seq_code` varchar(10) added 2026-07-04 (SKU segment, live project)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| internal_or_external | varchar(50) | |

### Grade (76673000000048008) — `seq_code` varchar(10) added 2026-07-04 (SKU segment, live project)
| Column | Type | Notes |
|---|---|---|
| name | varchar(50) | key column |

### Size (76673000000050001 · **live id 69851000000041006**) — keys on `code`, NOT name
| Column | Type | Notes |
|---|---|---|
| code | varchar(50) | key column · auto = `{width_mm}x{length_mm}` |
| width_mm | int | |
| length_mm | int | |
| seq_code | varchar(10) | SKU segment |
| tile_type | varchar(50) | added 2026-07-09 · e.g. GVT |
| thickness_mm | double(2) | added 2026-07-09 · optional |
| pcs_per_packing | int | added 2026-07-09 · pieces per box |
| box_weight_kg | double(2) | added 2026-07-09 · manual |
| sqm_per_box | double(4) | added 2026-07-09 · **computed on save** = `(width_mm/1000)*(length_mm/1000)*pcs_per_packing` |
| sqft_per_box | double(4) | added 2026-07-09 · **computed on save** = `sqm_per_box * 10.7639` |
| remark | varchar(255) | added 2026-07-09 (requested 1000, Catalyst capped at 255) |

Size is the single source of truth for per-box packing data. `Pallet.coverage_sqm/coverage_sqft/box_weight_kg` and `Design.width_mm/length_mm/pcs_per_box/box_weight_kg` are **auto-filled snapshots** of the picked Size — never hand-entered.

Values (`code` → width×length mm): 75x600, 98x600, 98x1200, 198x1200, 200x1200, 300x600, 400x1200, 600x600, 600x900, 600x1200, 800x800, 800x1600, 1200x1200, 1200x2780, 400x400.

### Finish (76673000000051001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| seq_code | varchar(10) | SKU segment |

Values: Glossy, Hard Matt, Carving, Matt, Elevation, High Glossy, Carving + Punch, DG Matt, GHR, Glossy Endless, Glossy Granula, Granula, Granula + Lapato.

### Category (76673000000052001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| seq_code | varchar(10) | SKU segment |

### Glaze (76673000000053001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| seq_code | varchar(10) | SKU segment |

### PartyBrand (live id 69851000000060042) — added 2026-07-04
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column (app-enforced unique via NATURAL_KEY) |
| seq_code | varchar(10) | SKU segment (provisioned; not yet used in SKU) |
| deleted_at | datetime | soft delete |

Party brand master (Settings → Masters → Party Brand). The Design column
`party_brand_name` stays free-text varchar; the item form offers these names
via a creatable Combobox and appends the value to `unique_name`.

### PaymentTerm (76673000000049001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| term_type | varchar(50) | |

Values: Credit 30, Advance, Net 15, Net 30, Net 45, Net 60, plus the Party List
terms added 2026-07-02: Against Full TT · 10% Advance & 90% Against B/L ·
20% Advance & 80% Against B/L · 20% Advance & 80% 40 Days from B/L ·
20% Advance & 80% 60 Days from B/L · 30% Advance & 70% Against B/L ·
30% Advance & 70% Before Loading · 90 Days from B/L Date · 100 Days from B/L Date ·
120 Days from B/L Date.

### NumberMaster (76673000000049360)
| Column | Type | Notes |
|---|---|---|
| entity_type | varchar(50) | |
| entity_rowid | varchar(50) | |
| sequence_number | int | |

### TransactionSeries (76673000000052360)
| Column | Type | Notes |
|---|---|---|
| doc_type | varchar(50) | Quote / SO / Invoice |
| prefix | varchar(20) | |
| current_number | int | |
| fy_token | varchar(20) | |

### Currency (live id 69851000000065195) — added 2026-07-13
Currency master + exchange rates (base INR; `exchange_rate` = INR per 1 unit, INR row = 1).
In the generic-CRUD ALLOWED set; natural key = `code`. Rates auto-refresh daily via the
`fx_refresh_daily` Catalyst cron (Webhook job pool) hitting
`GET data-ops/cron/fx-refresh?key=$FX_CRON_KEY` (frankfurter.dev); rows with
`manual_override` keep their hand-entered rate. Admin page `/currencies` (admin-only)
has a "Refresh rates now" button (authed `POST data-ops/fx-refresh`). All currency pick
lists (customer / quote / order forms) are DB-sourced from this table.

| Column | Type | Notes |
|---|---|---|
| code | varchar(10) | unique, mandatory (natural key: INR/USD/EUR/…) |
| name | varchar(100) | "Indian Rupee" |
| symbol | varchar(10) | "₹" |
| exchange_rate | double(4dp) | INR per 1 unit; INR = 1 |
| manual_override | boolean | true → daily FX cron skips this row |
| rate_updated_at | datetime | last rate write |
| deleted_at | datetime | soft delete |

---

## Masters

### Customer (76673000000048382) — keys on `name` (also has `code`)
| Column | Type | Notes |
|---|---|---|
| code | varchar(50) | |
| name | varchar(255) | key column |
| country_code | varchar(5) | ISO ("PL"), no emoji |
| currency | varchar(10) | |
| books_contact_id | varchar(100) | Zoho Books sync key |
| address | text(10000) | |
| port_of_discharge | varchar(255) | |
| active | boolean | |
| payment_term | FK → PaymentTerm | SET-NULL |
| contact_salutation | varchar(12) | |
| contact_first_name | varchar(60) | |
| contact_last_name | varchar(60) | |
| contact_email | varchar(120) | |
| contact_work_phone | varchar(30) | |
| contact_mobile | varchar(30) | |
| contact_persons | text(10000) | JSON array of additional contact persons (2026-07-10) |
| billing_attention | varchar(100) | |
| billing_country | varchar(60) | |
| billing_street1 | varchar(150) | |
| billing_street2 | varchar(150) | |
| billing_city | varchar(80) | |
| billing_state | varchar(80) | |
| billing_pincode | varchar(20) | |
| billing_phone | varchar(30) | |
| shipping_attention | varchar(100) | |
| shipping_country | varchar(60) | |
| shipping_street1 | varchar(150) | |
| shipping_street2 | varchar(150) | |
| shipping_city | varchar(80) | |
| shipping_state | varchar(80) | |
| shipping_pincode | varchar(20) | |
| shipping_phone | varchar(30) | |
| main_party_name | varchar(255) | parent/group party (Party List master, 2026-07-02) |
| working_status | varchar(100) | Party List master, 2026-07-02 |
| handling_person | bigint | **logical FK** → SalesPerson ROWID (2026-07-02; plain bigint, same MCP int64 limitation as SalesPerson.app_user) |

### Design (76673000000052723) — keys on `unique_name` / `design_name`
| Column | Type | Notes |
|---|---|---|
| unique_name | varchar(255) | unique (app + data-ops 409); = Design - Size - Finish[ - PartyBrand] |
| design_name | varchar(255) | |
| seq_code | varchar(10) | design Short Code — first SKU segment (added 2026-07-04, live project) |
| base_design_name | varchar(255) | |
| sku | varchar(100) | auto: `DesignShortCode-Size-Finish-Category-Glaze-Brand-Grade[-PartyBrand]` from stored `seq_code`s (PB segment only when set); uniqueness enforced once short codes are filled |
| party_brand_name | varchar(255) | free text; picked from PartyBrand master (creatable) |
| pcs_per_box | int | |
| box_weight_kg | double | nullable → uncalibrated for fit |
| coverage_sqm | double | |
| coverage_sqft | double | |
| random_faces | int | |
| width_mm | double | tile width (mm); auto-filled from Size, drives coverage calc |
| length_mm | double | tile length (mm); auto-filled from Size, drives coverage calc |
| status | varchar(50) | |
| collection_name | varchar(255) | |
| rate_per_sqft | double | keep BOTH rates, convert in app |
| rate_per_sqmt | double | |
| image_url | text(10000) | |
| books_item_id | varchar(100) | future Books sync key |
| size | FK → Size | SET-NULL |
| finish | FK → Finish | SET-NULL |
| category | FK → Category | SET-NULL |
| glaze | FK → Glaze | SET-NULL |
| brand | FK → Brand | SET-NULL |
| grade | FK → Grade | SET-NULL |
| product_owner | varchar(255) | |
| accounting_stock | double | |

### Pallet (76673000000049723)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | |
| pallet_type | varchar(100) | |
| pallet_size_label | varchar(100) | |
| boxes_per_pallet | int | |
| pallets_per_container | int | |
| empty_pallet_weight_kg | double | |
| remarks | text(10000) | |
| size | FK → Size | SET-NULL |
| packing_details | varchar(255) | |
| coverage_sqm | double | |
| coverage_sqft | double | |
| box_weight_kg | double | |
| b_boxes_per_pallet | int | B-variant packing |
| b_pallets_per_container | int | B-variant packing |
| b_pallet_weight | double | B-variant packing |

### DesignPallet (76673000000048747) — join table
| Column | Type | Notes |
|---|---|---|
| design | FK → Design | CASCADE |
| pallet | FK → Pallet | CASCADE |

---

## Documents

### Quote (76673000000054021)
| Column | Type | Notes |
|---|---|---|
| quote_number | varchar(50) | via TransactionSeries |
| quote_date | date | |
| port_of_discharge | varchar(255) | |
| status | varchar(50) | |
| currency | varchar(10) | |
| exchange_rate | double(4dp) | INR per 1 unit of `currency` (added 2026-07-13); SO/Invoice get one when conversion needs it |
| remarks | text(10000) | |
| public_link_token | varchar(100) | legacy/unused? see share_token |
| conversion_flag | varchar(20) | Full / Partial |
| total_amount | double | net total |
| customer | FK → Customer | SET-NULL |
| payment_term | FK → PaymentTerm | SET-NULL |
| address | text(10000) | |
| expiry_date | date | |
| salesperson | varchar(160) | |
| reference_no | varchar(60) | |
| customer_notes | text(10000) | |
| terms | text(10000) | |
| discount | double | doc-level |
| adjustment | double | |
| tax_pct | double | |
| tax_amount | double | stored positive; sign in total |
| tax_type | varchar(10) | TDS subtracts / TCS adds |
| share_token | varchar(64), UNIQUE | public read-only quote link |
| reject_reason | text(10000) | reason written on reject (status→Rejected); shown on the status hover |

### QuoteItem (76673000000050364)
| Column | Type | Notes |
|---|---|---|
| quantity_boxes | int | |
| converted_qty_boxes | int | boxes already converted to SOs (added 2026-07-13; server-enforced cap, carried across line replaces by design) |
| rate | double | |
| rate_basis | varchar(20) | |
| discount_pct | double | |
| sub_total | double | |
| final_total | double | |
| quote | FK → Quote | **CASCADE** |
| design | FK → Design | SET-NULL |

### SalesOrder (76673000000051371) — UI label: "Sales Order"
| Column | Type | Notes |
|---|---|---|
| order_number | varchar(50) | server-assigned `SO/{FY}/NNN` (`nextOrderNumber` MAX-scan); never editable |
| po_number | varchar(100) | |
| order_date | date | |
| port_of_discharge | varchar(255) | |
| status | varchar(50) | born "Draft" on create AND convert (server ignores client status) |
| currency | varchar(10) | |
| exchange_rate | double(4dp) | INR per 1 unit; copied from the source quote on convert (added 2026-07-13) |
| remarks | text(10000) | |
| quote | FK → Quote | SET-NULL (source quote) |
| customer | FK → Customer | SET-NULL |
| payment_term | FK → PaymentTerm | SET-NULL |
| address | text(10000) | |
| manual_so_number | varchar(50) | blank→copy auto, set→never overwrite |
| shipment_date | date | |
| salesperson | varchar(160) | |
| customer_notes | text(10000) | |
| terms | text(10000) | |
| total_amount | double | |
| discount | double | doc-level |
| adjustment | double | |
| tax_pct | double | |
| tax_amount | double | |
| tax_type | varchar(10) | |
| box_branding | varchar(120) | customer-selectable box print |
| reject_reason | text(10000) | reason written on reject (status→Rejected); shown on the status hover |

### OrderItem (76673000000051730)
| Column | Type | Notes |
|---|---|---|
| ordered_qty_boxes | int | |
| produced_qty_boxes | int | |
| purchased_qty_boxes | int | |
| qc_passed_qty_boxes | int | |
| palletized_qty_boxes | int | |
| loaded_qty_boxes | int | |
| dispatched_qty_boxes | int | |
| stage | varchar(30) | |
| due_date | date | |
| sales_order | FK → SalesOrder | **CASCADE** (col named `sales_order`, NOT `order`) |
| design | FK → Design | SET-NULL |
| priority_level | varchar(20) | NOT `priority` (reserved) |
| rate | double | |
| discount_pct | double | |
| sub_total | double | |
| final_total | double | |

### OrderItemEvent (76673000000053367)
| Column | Type | Notes |
|---|---|---|
| event_type | varchar(50) | |
| qty_delta | int | |
| performed_by | varchar(100) | |
| note | text(10000) | |
| order_item | FK → OrderItem | **CASCADE** |

### ProductionLog (live id 69851000000068024) — added 2026-07-15, lifecycle 2026-07-15
Request-first production entry. Lifecycle (`status`): **PendingApproval → Approved
→ Produced**, or **Rejected**. Written by three sagas:
`/production-log` creates a request (one row per line, shared `request_group`,
`qty_requested` set, **no counter touched**); `/production-status/:group`
approves/rejects a whole request group (approver-gated via `canApprove("Production")`);
`/production-record/:rowid` records actual output on an Approved line — sets
`qty_boxes`, bumps `OrderItem.produced_qty_boxes` (order-linked, capped at ordered),
steps stage po→prod, marks Produced. SO-linked lines set order_item; independent
(order_item null) is make-to-stock. Source of truth for the Production grid/detail
+ the Approvals inbox (Production module). FK refs are plain **bigint** (logical FKs
joined client-side — no DB cascade), because the schema-API can't round-trip
17-digit parent-column ids as JSON numbers; a log doesn't need referential cascade.
Legacy pre-lifecycle rows backfilled to `status=Produced`, `qty_requested=qty_boxes`.
| Column | Type | Notes |
|---|---|---|
| status | varchar(30) | PendingApproval / Approved / Produced / Rejected — added 2026-07-15 |
| qty_requested | int | desired boxes from the request — added 2026-07-15 |
| request_group | varchar(50) | shared token for all lines of one submission (approve/reject together) — added 2026-07-15 |
| qty_boxes | int | **actual** boxes produced (0 until output recorded) |
| production_date | varchar(20) | |
| shift | varchar(30) | |
| performed_by | varchar(100) | auto-stamped from the signed-in user (requester) |
| note | text(10000) | on reject, holds the rejection reason |
| design | bigint | Design ROWID (logical FK) |
| sales_order | bigint | SalesOrder ROWID — null on independent (logical FK) |
| order_item | bigint | OrderItem ROWID — null on independent (logical FK) |

### Invoice (76673000000047747)
| Column | Type | Notes |
|---|---|---|
| invoice_number | varchar(50) | |
| invoice_date | date | |
| total_amount | double | |
| currency | varchar(10) | |
| status | varchar(20) | |
| container | FK → Container | SET-NULL |
| sales_order | FK → SalesOrder | SET-NULL |

---

## Logistics

### PalletisedBatch (76673000000055018)
| Column | Type | Notes |
|---|---|---|
| boxes_packed | int | |
| delivery_date | date | |
| status | varchar(30) | "closed" → eligible for loading |
| remarks | text(10000) | |
| sales_order | FK → SalesOrder | SET-NULL |
| pallet | FK → Pallet | SET-NULL |
| design | FK → Design | SET-NULL |
| is_demo | boolean, default false | demo pool flag (fit tier 3) |

### PalletisedBatchLine (76673000000053726)
| Column | Type | Notes |
|---|---|---|
| boxes | int | |
| batch | FK → PalletisedBatch | **CASCADE** |
| order_item | FK → OrderItem | SET-NULL |

### Container (76673000000055377)
| Column | Type | Notes |
|---|---|---|
| container_number | varchar(50) | |
| container_type | varchar(20) | 20/40/40HQ |
| capacity_boxes | int | |
| capacity_pallets | int | |
| vessel_name | varchar(255) | |
| etd | date | |
| eta | date | |
| port_of_loading | varchar(255) | |
| port_of_discharge | varchar(255) | |
| status | varchar(30) | loading / planned / ... |
| capacity_area_sqm | double | nullable cap (fit v2) |
| max_weight_kg | double | nullable cap (fit v2) |

### ContainerLoading (76673000000058115)
| Column | Type | Notes |
|---|---|---|
| position | int | |
| container | FK → Container | **CASCADE** |
| batch | FK → PalletisedBatch | SET-NULL |

### PalletizationPlan — added 2026-07-21 (vehicle-load plan; PAL/FY/NNN)
First-class, human-numbered record that groups OrderItems from **multiple** Sales Orders onto a vehicle. Lifecycle `Planning → ReadyToLoad → Loading → Completed` via `/pal-status` (generic PATCH rejects `status`). Number minted server-side (`nextPalNumber`, MAX-scan + assertUnique). Distinct from `PalletisedBatch` (per-pallet close-pallet artifact).
| Column | Type | Notes |
|---|---|---|
| pal_number | varchar(40) | `PAL/2026-27/001`; server-minted; NATURAL_KEY |
| status | varchar(30) | Planning / ReadyToLoad / Loading / Completed (default Planning) |
| vehicle_number | varchar(50) | truck reg (typable) |
| planned_date | date | defaults today; omit "" |
| dispatch_date | date | stamped when Completed |
| sales_person | FK → SalesPerson | SET-NULL; defaults to logged-in user |
| remarks | text(10000) | |
| deleted_at | datetime | soft delete |

### PalletizationPlanLine — added 2026-07-21
Order items pulled onto a plan (lines key on OrderItem — planned before packing).
| Column | Type | Notes |
|---|---|---|
| plan | FK → PalletizationPlan | **CASCADE** (app-enforced) |
| sales_order | FK → SalesOrder | SET-NULL (multi-SO grouping) |
| order_item | FK → OrderItem | SET-NULL (source line) |
| design | FK → Design | SET-NULL (denormalized for display/PDF) |
| pallet | FK → Pallet | SET-NULL (drives vehicle-fill capacity) |
| boxes | int | no-negative |
| position | int | vehicle ordering |
| palletised_batch | FK → PalletisedBatch | nullable; forward hook (Loading-stage link, deferred) |
| deleted_at | datetime | soft delete |

---

## System / Audit

### Activity (76673000000054380)
| Column | Type | Notes |
|---|---|---|
| occurred_at | datetime | |
| actor | varchar(100) | |
| entity_type | varchar(50) | |
| entity_rowid | varchar(50) | |
| action | varchar(100) | |
| detail_text | text(10000) | |
| tag | varchar(50) | |

### OperationLog (76673000000056094)
| Column | Type | Notes |
|---|---|---|
| occurred_at | datetime | |
| table_name | varchar(120) | |
| operation | varchar(20) | |
| entity_rowid | varchar(40) | |
| status | varchar(12) | success / error |
| error_text | text(10000) | |
| duration_ms | int | |
| actor | varchar(160) | |
| payload_summary | text(10000) | |

### StatusTransition (live id 69851000000066173) — added 2026-07-13
One row per status/stage flip on Quote (`status`), SalesOrder (`status`) and
OrderItem (`stage`). Written server-side only: `/quote-status`, `/so-status`,
generic PATCH (OrderItem stage only — Quote/SO status writes are rejected),
`/convert-quote`, and the saga routes (production-log, close-pallet,
load-container, dispatch). Powers the Status Timeline on detail pages and the
Reports ▸ Quote Aging tab. `note` carries the rejection reason for the
quote/SO approval workflows.
| Column | Type | Notes |
|---|---|---|
| occurred_at | datetime | |
| entity_type | varchar(30) | Quote / SalesOrder / OrderItem |
| entity_rowid | varchar(40) | logical FK (bigint id as text) |
| from_status | varchar(50) | |
| to_status | varchar(50) | |
| note | text(10000) | rejection reason etc. |
| actor | varchar(160) | |
| deleted_at | datetime | unused; present so generic list's soft-delete filter works |

### Notification (live id 69851000000062554) — added 2026-07-13
Per-user in-app notifications (approval verdicts). Written server-side by
`/quote-status`; read by the header bell (filtered to the signed-in AppUser).
No read-flags — the bell's sessionStorage last-seen stamp covers "unseen".
| Column | Type | Notes |
|---|---|---|
| occurred_at | datetime | |
| recipient | bigint | logical FK → AppUser ROWID |
| text | varchar(255) | server truncates to 240 |
| link | varchar(120) | in-app route, e.g. `#/quotes/<id>` |
| deleted_at | datetime | unused; soft-delete filter parity |

**Quote approval workflow (2026-07-13):** `Quote.status` gained
`PendingApproval` and `Approved`. All quote status changes go through
`POST /quote-status/:rowid` (validated state machine; generic PATCH rejects
Quote.status writes; create forces Draft; edit resets PendingApproval/Approved
→ Draft). Transitions: Draft→PendingApproval→(approver: Approved | Rejected);
Approved→Sent→Accepted⇄Rejected; Rejected→Draft (reopen); any change blocked once
conversion_flag ≠ None. Reject (PendingApproval→Rejected) requires a reason, which is
persisted to `Quote.reject_reason` (for the grid/detail status hover) as well as the
StatusTransition note. The PendingApproval verdict requires `Role.matrix.approve` to
include `"Quote"` (or Admin). (Updated 2026-07-15: reject now targets Rejected, not Draft.)

**SalesOrder approval workflow (2026-07-13):** `SalesOrder.status` gained
`Draft` and `PendingApproval` ahead of the legacy Confirmed / InProgress /
Cancelled. All SO status changes go through `POST /so-status/:rowid`
(generic PATCH now rejects SalesOrder.status writes). Transitions:
Draft→PendingApproval→(approver: Confirmed | Rejected); Confirmed→InProgress→Cancelled;
Cancelled→Confirmed; Rejected→Draft (reopen). Reject (PendingApproval→Rejected) requires a
reason, persisted to `SalesOrder.reject_reason` (status hover) plus the StatusTransition
note (updated 2026-07-15: reject targets Rejected, not Draft). The verdict requires
`Role.matrix.approve` to include `"SalesOrder"` (or Admin). Manual SOs are created
in Draft; `/convert-quote` also creates Draft — the SO earns its own approval
(full mirror of quotes; the quote's approval covered the quote, not the SO's
PO/quantities/dates, which the convert form can change). Verdicts notify the
SO's salesperson (Notification, link `#/orders/<id>`).

**SalesOrder edit (2026-07-13):** `POST /update-so-with-items/:rowid` — mirror
of `update-quote-with-items` (header update + wholesale OrderItem replace).
`order_number` is never editable; 409 once any work quantity (produced /
purchased / palletized / loaded / dispatched) > 0; editing a PendingApproval
or Confirmed order resets it to Draft with a logged StatusTransition.

---

## FK graph (children → parents)

```
QuoteItem ──CASCADE──▶ Quote ──SET-NULL──▶ Customer, PaymentTerm
QuoteItem ──SET-NULL─▶ Design
SalesOrder ─SET-NULL─▶ Quote, Customer, PaymentTerm
OrderItem ──CASCADE──▶ SalesOrder
OrderItem ──SET-NULL─▶ Design
OrderItemEvent ─CASCADE─▶ OrderItem
PalletisedBatch ─SET-NULL─▶ SalesOrder, Pallet, Design
PalletisedBatchLine ─CASCADE─▶ PalletisedBatch  ─SET-NULL─▶ OrderItem
ContainerLoading ─CASCADE─▶ Container  ─SET-NULL─▶ PalletisedBatch
Invoice ─SET-NULL─▶ Container, SalesOrder
Design ─SET-NULL─▶ Size, Finish, Category, Glaze, Brand, Grade
DesignPallet ─CASCADE─▶ Design, Pallet
Pallet ─SET-NULL─▶ Size
Customer ─SET-NULL─▶ PaymentTerm
```
