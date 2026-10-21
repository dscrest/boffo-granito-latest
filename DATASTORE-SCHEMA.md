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

## Table Index (47 tables)

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
| Pallet | 76673000000049723 | Pallet packing master (boxes only since CR-261) |
| ContainerFormat | 69851000000313445 (LIVE id) | Container Master — what one container of a Size holds; several per Size since CR-273 (CR-261) |
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
| PalletisedBatchLine | 69851000000041727 | Batch↔OrderItem allocation |
| Quote | 76673000000054021 | Quotes |
| Activity | 76673000000054380 | Generic activity feed |
| PalletisedBatch | 69851000000051080 | Packed pallet batches (incl. mixed pallets) |
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
| ProductionLog | 69851000000068024 (live) | Production entries (order jobs + independent stock + batch opening rows) — added 2026-07-15 |
| Vehicle | (live) | Truck master (number + driver + mobile) — added 2026-07-23 |
| PalletizationPlan | (live) | Vehicle-load plan header `PAL/FY/NNN` — added 2026-07-21 |
| PalletizationPlanLine | 69851000000077368 (live) | Order items pulled onto a plan — added 2026-07-21 |
| LoadBox | 69851000000089442 (live) | Cross-plan vehicle slots on the Loading board — added 2026-07-27 |
| AppSetting | (live) | Key/value app settings store — added 2026-08-11 |
| Panel | 69851000000189422 (live) | Panel Craft — showcase-panel master header — added 2026-08-26 |
| PanelLine | 69851000000194524 (live) | Panel Craft — design lines on a panel — added 2026-08-26 |
| PanelOrder | 69851000000193408 (live) | Panel Craft — customer panel orders, HEADER since CR-302 (cutting-job lifecycle) — added 2026-08-26 |
| PanelOrderLine | 69851000000315921 (live) | Panel Craft — one panel × qty (or a loose cut piece, CR-346) per panel order (CR-302) — added 2026-10-07 |
| PanelLoad | 69851000000351032 (live) | Panel Craft — one vehicle trip per panel / sample order (CR-347) — added 2026-10-15 |
| PanelLoadLine | 69851000000347033 (live) | Panel Craft — line × material × qty on a trip, kg stamped (CR-347/349) — added 2026-10-15 |
| CutPieceSize | 69851000000182460 (live) | Lookup — cut-piece sizes (Panel Craft) — added 2026-08-26 |
| CutPieceStock | 69851000000183280 (live) | Panel Craft — cut-piece on-hand per design + cut size — added 2026-08-26 |
| Warehouse | 69851000000335014 (live) | Stock locations (Settings ▸ Warehouses) — added 2026-10-12 (CR-329) |

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
items view, reports view+export, no delete, no approve), **Staff** (CR-336 — every module view + create +
export, no edit / delete / approve; self-seeded by `defaultRoleId()` on first use; the default role for new
accounts). Live seeds: `catalyst-migration/data/Role.json`.

### AppUser (76673000000094001)
| Column | Type | Notes |
|---|---|---|
| email | varchar(100) | unique, mandatory, stored lowercase |
| name | varchar(100) | |
| password_hash | varchar(255) | `scrypt$<salt-hex>$<hash-hex>` (scryptSync, 64-byte key); **null since CR-337 = Zoho sign-in only** |
| active | boolean | default true; false = cannot sign in |
| deleted_at | datetime | soft delete |
| role | FK → Role | ON-DELETE-SET-NULL; no role = no permissions; `POST /auth/users` defaults to **Staff** (CR-336) |
| zoho_zuid | varchar(30) | CR-337 (live col `69851000000341014`) — Zoho account id, stamped on the first Zoho sign-in; non-null = Zoho-linked |
| zoho_linked_at | datetime | CR-337 (live col `69851000000338175`) — IST, when `zoho_zuid` was stamped |

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
| logo | varchar(255) | File Store file id (`design_images` folder) — the Box Brand image; created on LIVE 2026-09-14 (CR-181), column 69851000000278304 |

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

Size is the single source of truth for per-box packing data. `Pallet.coverage_sqm/coverage_sqft` and `Design.width_mm/length_mm/pcs_per_box` are **auto-filled snapshots** of the picked Size — never hand-entered. `box_weight_kg` on both is the exception (CR-133 Pallet, CR-190 Item): the Size value is the default, a typed override is kept by the Size-edit fan-out; `/resync-size-snapshots` still overwrites it.

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
lists (customer / quote / order forms) are DB-sourced from this table. The second URL cron,
`crm_sync_30m` (every 30 min, Asia/Kolkata, CR-359; cron id 69851000000348238, `webhooks` pool, created 2026-10-21 via the Catalyst MCP) hits `GET data-ops/cron/crm-sync?key=$FX_CRON_KEY`,
the incremental Zoho CRM customer pull; the earlier `books_sync_30m` (CR-356, id 69851000000347464 → `/cron/books-sync`)
is answered `{disabled:true}` while CRM is active — disable it in the console (see Customer / AppSetting).

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
| books_contact_id | varchar(100) | ⚠ Books hidden since CR-359 (values kept); **CR-362: written again by the CRM sync when Books `GET /contacts?zcrm_account_id=` confirms Zoho's own CRM ⇄ Books link (never cleared)** — Zoho Books contact this customer is mapped to (CR-325 by hand from the Books search; since CR-356 also set by the sync / import / push, `""` = not mapped) |
| address | text(10000) | |
| port_of_discharge | varchar(255) | |
| active | boolean | |
| payment_term | FK → PaymentTerm | SET-NULL |
| box_brand | FK → Brand | SET-NULL · default carton brand for the Customer Sheet (per-line override on PalletizationPlanLine) — added 2026-09-10; repointed BoxBrand→Brand 2026-09-11 (BoxBrand table deleted, Brand master relabeled "Box Brand") |
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
| company_name | varchar(255) | Books-parity company name (was live but undocumented; doc'd 2026-09-10) |
| customer_type | varchar(20) | "business" \| "individual", lowercase (was live but undocumented; doc'd 2026-09-10) |
| overseas | varchar(10) | "true" \| "" — overseas customer indicator (checkbox on the form) — added 2026-09-10 |
| additional_addresses | text(10000) | JSON array of extra ExtraAddress entries |
| gst_no | varchar(20) | CR-356 — Books `gst_no` (GSTIN); Tax & Other block on the form — added 2026-10-21 via the Catalyst MCP, column 69851000000347446 |
| gst_treatment | varchar(20) | CR-356 — Books code `business_gst` \| `business_none` \| `consumer` \| `overseas` (`GST_TREATMENTS` in `customersApi.ts`) — added 2026-10-21, column 69851000000347447 |
| place_of_contact | varchar(10) | CR-356 — Place of Supply, GST state code (`GJ`) — added 2026-10-21, column 69851000000347448 |
| pan_no | varchar(20) | CR-356 — added 2026-10-21, column 69851000000347449 |
| website | varchar(255) | CR-356 — added 2026-10-21, column 69851000000347450 |
| credit_limit | varchar(30) | CR-356 — kept as text (nothing sorts / sums it); pushed to Books as a number — added 2026-10-21, column 69851000000347451 |
| notes | text(10000) | CR-356 — Books "Remarks" — added 2026-10-21, column 69851000000347452 |
| opening_balance | varchar(30) | CR-356 — pulled from Books (`opening_balance_amount`), **display-only**, never pushed — added 2026-10-21, column 69851000000347453 |
| crm_account_id | varchar(30) | CR-359 — Zoho CRM Account this customer is linked to (set by the CRM sync / import / push / hand mapping; `""` = not linked); `books_contact_id` kept as the hidden Books link — added 2026-10-21 via the Catalyst MCP, column 69851000000351602 |

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
| box_weight_kg | double | nullable → uncalibrated for fit; Size default, per-item override on the Item form (CR-190); read first by planning + loading (Pallet weight = fallback) |
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
| accounting_stock | double | opening stock for **singular** (non-batched) items; locked after first save (null = unlocked; admin re-edit needs `_reason` → OperationLog) |
| is_batched | boolean | batch-tracked item (added 2026-08-11). Batched items keep opening stock as ProductionLog `entry_type="opening"` rows, not `accounting_stock`. Server rejects flipping once the item carries stock (opening rows or accounting_stock). |

### Pallet (76673000000049723)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | |
| pallet_type | varchar(100) | |
| pallet_size_label | varchar(100) | |
| boxes_per_pallet | int | |
| pallets_per_container | int | **unused since CR-261** (not written; capacity = ContainerFormat) |
| empty_pallet_weight_kg | double | |
| remarks | text(10000) | |
| size | FK → Size | SET-NULL |
| packing_details | varchar(255) | |
| coverage_sqm | double | |
| coverage_sqft | double | |
| box_weight_kg | double | |
| b_boxes_per_pallet | int | B-variant packing — unused since CR-261 |
| b_pallets_per_container | int | B-variant packing — unused since CR-261 |
| b_pallet_weight | double | B-variant packing — unused since CR-261 |

### ContainerFormat (69851000000313445, LIVE) — Container Master, CR-261
What one container of a size holds. A Size may have several rows (CR-273 dropped `NATURAL_KEY = size`);
a loading points at the one it uses via `LoadBox.container_format`, readers with no pick take the size's
largest `total_boxes`.
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | auto: `<size> · N pallets = M boxes` |
| size | FK → Size | SET-NULL |
| pallets_json | text(10000) | `[{ "pallet": "<Pallet ROWID>", "count": n }]` — ponytail: no child table |
| total_pallets | int | Σ count (denormalised on save) |
| total_boxes | int | Σ count × Pallet.boxes_per_pallet — the per-container box capacity every reader projects |
| remarks | text(10000) | |
| deleted_at | datetime | soft delete |

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
| box_brand | FK → Brand | SET-NULL · Box Brand master pick on the quote form, prefilled from `Customer.box_brand`; `/convert-quote` carries it onto `SalesOrder.box_brand` — added 2026-09-14 (CR-162) |
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
| container_plan | text(10000) | Plan Containerisation JSON snapshot (`{v:1, mode, tonCapacity, containers:[{no, fillPct, pallets, boxes, lines:[…]}]}`, `parseContainerPlan` in `client/src/data.ts`); truncated at 10000 chars; only written when sent, so plain edits never wipe it. Convert snapshots the quote's copy onto the SO. Shipping progress is DERIVED (`planProgress`) — no per-container id and no link to LoadBox — documented 2026-08-25 |
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
| po_number | varchar(100) | customer's PO; since CR-353 (2026-10-19) it is the DISPLAY label of the order on the SO page / Orders grid / drawer / By-Order cards (`orderLabel`, falls back to `order_number`); `order_number` stays the identity |
| order_date | date | |
| port_of_discharge | varchar(255) | |
| status | varchar(50) | born "Draft" on create AND convert (server ignores client status). Values: Draft, PendingApproval, Confirmed, InProgress, Cancelled, Rejected + auto roll-up (CR-230/233) PartiallyCompleted, Completed (InPalletization / InLoading were valid only for a few hours on 2026-09-21 — display maps them to In Progress) |
| currency | varchar(10) | |
| exchange_rate | double(4dp) | INR per 1 unit; copied from the source quote on convert (added 2026-07-13) |
| remarks | text(10000) | |
| container_plan | text(10000) | Plan Containerisation JSON snapshot (`{v:1, mode, tonCapacity, containers:[{no, fillPct, pallets, boxes, lines:[…]}]}`, `parseContainerPlan` in `client/src/data.ts`); truncated at 10000 chars; only written when sent, so plain edits never wipe it. Convert snapshots the quote's copy onto the SO. Shipping progress is DERIVED (`planProgress`) — no per-container id and no link to LoadBox — documented 2026-08-25 |
| quote | FK → Quote | SET-NULL (source quote) |
| customer | FK → Customer | SET-NULL |
| payment_term | FK → PaymentTerm | SET-NULL |
| address | text(10000) | |
| shipping_address | text(10000) | CR-221 — edited on the SO form; carried from the quote on convert. Created 2026-09-19 (column id 69851000000291143). |
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
| box_branding | varchar(120) | LEGACY free-text box print — no longer written since 2026-09-14 (CR-162); shown read-only on old orders |
| box_brand | FK → Brand | SET-NULL · Box Brand master pick (replaces `box_branding`), prefilled from `Customer.box_brand` / carried from the quote; the Customer Sheet's brand fallback is line override → **SO** → customer default — added 2026-09-14 (CR-162) |
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
| pallet | FK → Pallet | pallet spec chosen on the SO line; the default for auto-enqueued PalletizationPlanLines and the Record Output pallet picker |
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
| batch_number | varchar(40) | production batch `<prefix><sep>YYYY-MM<sep>NNN` (defaults `B/YYYY-MM/NNN`; prefix/separator/start admin-set via AppSetting `batch_series_*`) — series per ITEM per calendar month, on `record` rows; blank on save → server auto-mints (`nextBatchNumber(catalyst, designId)`, design+month-scoped MAX-scan) — format changed 2026-09-04, configurable 2026-09-08; added 2026-08-07 |
| shade | varchar(60) | RETIRED 2026-08-29 (batch is the only tracked dimension; never populated in live data). Column kept, nothing reads or writes it — added 2026-08-07 |
| box_brand | bigint | **CR-197 — created on live 2026-09-18 (column id 69851000000293004, search-indexed).** Logical FK → Brand (the "Box Brand" master): the carton the boxes were packed in. Set on `record` rows by `/production-record` + `/production-record-lines` (one brand per item section of Record Output), copied onto `alloc` rows, and inherited by the `PalletizationPlanLine.box_brand` that `autoEnqueuePalletization` inserts. Nullable; every reader/writer tolerates its absence. |
| second_stage | boolean | **RETIRED 2026-08-25** — no longer read or written. Was: output is in the 2nd stage of palletization → auto-enqueue births its queue line `Palletizing` instead of `Planning`. Removed because it silently kept production output out of "Ready for Palletization" (the flag was sticky per batch). Column left in place; old rows keep their value. |
| reason | varchar(100) | **CR-308 — created on live 2026-10-07 (col 69851000000319671).** AdjustmentReason name on `entry_type="adjust"` rows; free-text reason on `transfer` rows (CR-330); null elsewhere. |
| warehouse | bigint | **CR-329 — created on live 2026-10-12 (col 69851000000338007).** Logical FK → Warehouse: where the boxes were counted. Set on `record` / `opening` / `adjust` rows from the form's Warehouse picker and on both `transfer` legs; **null = the primary warehouse** (`/warehouse-primary` stamps null rows onto the old primary before the flag moves). Never on `plan` / `alloc` rows. |

Not in the column table but used throughout the sagas: `entry_type` (`plan`|`record`|`opening`|`alloc`|`adjust`|`transfer`), `parent_log` (bigint → the plan row), `stage` (`New`/`InProduction`/`QC`/`Completed`), `deleted_at`, `mfg_date` (per-batch manufacture date on multi-batch record rows). **`alloc` rows (CR-199, 2026-09-18):** a stock allocation — `design`, `batch_number`, `order_item`, `sales_order`, `qty_boxes`, `status="Allocated"`, `stage="Completed"`, `qty_requested=0`, no `parent_log`. A **claim, never supply**: written by `POST /allocate-stock` (bumps `OrderItem.produced_qty_boxes`, then `autoEnqueuePalletization`), soft-deleted by `POST /deallocate-stock/:rowid`. Any reader summing supply must skip it; any reader listing production jobs must skip it (`productionApi` does both). **`adjust` rows (CR-308, 2026-10-07):** an inventory adjustment — `design`, `batch_number` (`""` for singular items), **SIGNED `qty_boxes`**, `reason`, `note`, `production_date` = adjustment date, `performed_by`, `request_group="adj-<stamp>"` (one per submission), `status="Adjusted"`, `stage="Completed"`, `qty_requested=0`, no `parent_log`. Written only by `POST /stock-adjust` (removal ≤ physical on-hand, verify-all-then-insert). Supply with a sign: every reader adds it (`deriveBatchStock.adjusted`, `designStock.adjusted`, `serverFreeStock`); never a plan line. **`transfer` rows (CR-330, 2026-10-12):** one Transfer Order line = a PAIR — `qty_boxes = −N` with `warehouse` = From and `+N` with `warehouse` = To, both `request_group = "TRF/<FY>/NNN"` (the document code; one series shared with `CutStockEntry.doc_number`), `reason` free text, `production_date` = transfer date, `status=""`, `stage="Completed"`, `qty_requested=0`, no order link. Written only by `POST /stock-transfer` (line ≤ From warehouse on-hand). Net zero per batch: **every global stock reader skips the type**; only the per-warehouse reducer (`client/src/lib/warehouseStock.ts` / server `warehouseReduce`) uses it. `/production-delete` refuses a leg. **Auto-enqueue RETIRED by CR-198:** confirming a SalesOrder used to insert one `plan` row per order item (`request_group="so-{soId}"`); `enqueueSoProduction` now early-returns. Rows created before 2026-09-18 remain and still record order-linked.

**Batch-wise routes (added 2026-08-11):**
- `POST /production-record-lines/:rowid` — record several batches at once against a plan line (batch-tracked items): one `record` child row per batch (blank batch auto-minted), OrderItem bumped once for the sum, inserts compensated on failure.
- `POST /opening-stock/:designId` — batch-wise opening stock for `is_batched` items, stored as `entry_type="opening"` rows (no plan, no order link; counted as on-hand by stock derivation, never as produced). Locked once any opening row exists — then admin-only with required `_reason` (mirrors the `accounting_stock` lock).
- **Duplicate-batch guard** (`assertBatchesAllowed`): same design + same batch number always 409; same batch on a *different* design allowed unless AppSetting `allow_duplicate_batches` = `"false"`.

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

### PalletisedBatch (live id 69851000000051080)
| Column | Type | Notes |
|---|---|---|
| boxes_packed | int | |
| delivery_date | date | |
| status | varchar(30) | "closed" → eligible for loading |
| remarks | text(10000) | |
| sales_order | FK → SalesOrder | SET-NULL |
| pallet | FK → Pallet | SET-NULL |
| design | FK → Design | SET-NULL (null on a mixed pallet) |
| is_demo | boolean, default false | demo pool flag (fit tier 3) |
| is_mixed | boolean, default false | mixed pallet — combined sub-pallet leftovers across items (design null; batch per line). Created via `/combine-leftovers` — added 2026-08-07 |
| batch_number | varchar(40) | denormalised header batch for a single-batch pallet's slip (blank on mixed) — added 2026-08-07 |
| shade | varchar(60) | RETIRED 2026-08-29 (see ProductionLog.shade) — added 2026-08-07 |

### PalletisedBatchLine (live id 69851000000041727)
| Column | Type | Notes |
|---|---|---|
| boxes | int | |
| batch | FK → PalletisedBatch | **CASCADE** |
| order_item | FK → OrderItem | SET-NULL |
| batch_number | varchar(40) | per-line production batch — mixed-pallet truth (each leftover keeps its own) — added 2026-08-07 |
| shade | varchar(60) | RETIRED 2026-08-29 (see ProductionLog.shade) — added 2026-08-07 |

### Container (76673000000055377)
| Column | Type | Notes |
|---|---|---|
| container_number | varchar(50) | |
| container_type | varchar(20) | picker offers 28ft/30ft since 2026-09-10 (legacy rows: 20/40/40HQ) |
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
| pallet | FK → Pallet | SET-NULL (drives vehicle-fill capacity). Never born null since 2026-09-11: `/pal-plan` + `/update-pal-plan` reject pallet-less lines, and `autoEnqueuePalletization` / `/send-to-loading` fall back to `defaultPalletForDesign()` (the Pallet whose `size` matches the design's size, lowest ROWID) when the OrderItem has no pallet. Legacy nulls: `POST /backfill-line-pallets` (admin) — OrderItem.pallet else size default; returns `{scanned, updated, unresolved}` |
| boxes | int | no-negative |
| position | int | vehicle ordering |
| status | varchar(30) | per-line kanban stage `Planning / Palletizing / ReadyToLoad` via `/pal-line-status` (optional `pallet` in the body sets the pallet in the same call; optional `boxes` < the line's boxes = PARTIAL move — the line splits and only the slice transitions, added 2026-09-10; since CR-281 (2026-10-06) a partial `Palletizing → ReadyToLoad` also sets the remainder back to `Planning`); `Palletizing` added 2026-08-17 |
| batch_number | varchar(40) | production batch these boxes come from (`""` = unattributed legacy aggregate). Set by `autoEnqueuePalletization`, `/pal-plan`, `/pal-topup` and `/send-to-loading` via the shared `unqueuedBatches()` FIFO split; preserved when `/pal-line-box` splits a line for a partial load. **The batch trail from ProductionLog to dispatch runs through this column** — batch-wise stock and the batch reports read it |
| pallet_group | varchar(60) | shared physical pallet group (`""` = none) — legacy mixed pallets |
| manual_edit | varchar(10) | `"true"` = user-authored line (`/pal-plan` + `/update-pal-plan` stamp it; splits carry it) — `autoEnqueuePalletization` skips top-up for an item whose open plan has a manual Planning line (CR 2026-09-10) |
| palletised_batch | FK → PalletisedBatch | nullable; forward hook (Loading-stage link, deferred) |
| load_box | FK → LoadBox | SET-NULL · added 2026-07-27; set only via `/pal-line-box` (Ready line → box). Optional `boxes` in the body = partial load: the line SPLITS (loaded part + a Ready remainder line) |
| box_brand | FK → Brand | SET-NULL · per-line carton-brand override on the /loading Customer Sheet (`""`/null = inherit Customer.box_brand); written via generic PUT; NOT carried through `/pal-line-box` partial splits (overrides are set post-boxing) — added 2026-09-10; repointed BoxBrand→Brand 2026-09-11 |
| pallet_no | varchar(60) | manual pallet number/range typed on the Loading Sheet (`""` = auto running range "1 TO 16"); written via generic PATCH; printed on the Dispatch Entry / Dispatch Copy; NOT carried through `/pal-line-box` partial splits — added 2026-09-14 (CR-184), column 69851000000277499 |
| pallet_type | varchar(60) | manual pallet type typed on the Loading Sheet (`""` = blank); written via generic PATCH; not carried through line splits — added 2026-09-19 (CR-208), column 69851000000293012 |
| deleted_at | datetime | soft delete |

### LoadBox (69851000000089442) — added 2026-07-27 (cross-plan vehicle slots)
A "box" on the Palletization board's Loading columns: Ready-for-Loading lines from ANY
plan are dragged into it (one box can mix customers), a vehicle attaches while Open
(in advance or later), and the box dispatches as one unit. Managed ONLY via the
`/load-box*` routes (`/load-box` create, `/load-box-update` vehicle/capacity,
`/load-box-delete` unallocates its lines, `/load-box-dispatch`); generic CRUD rejects it.
Plan status follows the boxes: first allocated line → plan `Loading`; box dispatch
sets plans whose lines all sit in dispatched boxes to `Completed` (+`dispatch_date`).
Un-boxed (legacy) plans keep the manual `/pal-status` + `/pal-vehicle` flow.
| Column | Type | Notes |
|---|---|---|
| box_number | int | display "Box N" — server-minted (MAX-scan) |
| name | varchar(80) | free container name typed on the Loading Workspace rail (column 69851000000340004, CR-333; written through `LOAD_BOX_FIELDS` on `/load-box` + `/load-box-update`; tab title, Loadings-grid Name column, detail field; searchable) — added 2026-10-12 |
| load_number | varchar(50) | the loading's identity `LOAD/FY/NNN` — server-minted on `/load-box` create (`nextLoadNumber`, prefix-scoped MAX-scan); boxes predating the column stay blank (`boxLabel` falls back to vehicle / "Container N") — added 2026-09-04 |
| vehicle | FK → Vehicle | SET-NULL; required before dispatch |
| capacity | int | advisory boxes-per-vehicle (default 1000) |
| status | varchar(20) | Open / Dispatched |
| dispatch_date | date | planned date entered on the load form / Confirm Load; `/load-box-dispatch` only stamps today (IST) when it is still empty |
| container_number | varchar(50) | loading capture; set via `/load-box-update` or `/load-box-dispatch` — added 2026-08-07 |
| line_seal | varchar(50) | loading capture — added 2026-08-07 |
| electronic_seal | varchar(50) | loading capture — added 2026-08-07 |
| loading_supervisor | varchar(120) | loading capture — added 2026-08-07 |
| container_size | varchar(10) | 28ft / 30ft (default 28ft) since 2026-09-10; legacy rows may hold 20ft/40ft/40HQ — captured on the load form — added 2026-08-25 |
| container_format | FK → ContainerFormat | SET-NULL; the Container Master format this loading uses — its `total_boxes` is the fill % denominator for every line in the loading (blank = size's largest); written via `applyLoadBoxFields` on `/load-box`, `/load-box-update`, `/load-box-dispatch` — added 2026-10-06 (CR-273), column 69851000000319372 |
| transporter | varchar(120) | carrier company — added 2026-08-25 |
| lr_number | varchar(60) | LR / docket number — added 2026-08-25 |
| destination | varchar(120) | destination port / city — added 2026-08-25 |
| share_token | varchar(64) | public pallet-label QR — minted by `POST /load-box-share/:rowid`; tokenless `GET /public/pallet/:token` feeds the scanner page (`#/share/box/<token>`, no login) — added 2026-08-11 |
| load_plan | text(10000) | loading-plan JSON (items + batches from ANY SOs/customers, `parseLoadPlan` in data.ts); advisory, written via `/load-box` and `/load-box-update` with `.slice(0, 10000)`; written by `NewLoadingModal` on create (single slice, no `group`). A multi-container plan stores one slice per box plus a `group: {id, no, of}` key pointing at the primary box's ROWID (siblings found client-side; server never reads the JSON) — added 2026-09-04 |
| deleted_at | datetime | soft delete |

### Vehicle — added 2026-07-23
Truck master behind LoadBox.vehicle (and the PalletizationPlan legacy flow). Since
CR-185 (2026-09-14) the user never picks from it: loading screens take the vehicle as
free text and `resolveVehicle()` (client) finds the row by formatted number, updates
driver/mobile if typed and different, else creates it. In the generic-CRUD ALLOWED set;
registration auto-formatted client-side (`formatVehicleNumber` → `SS-DD-L(L)-NNNN`).
No server natural key — the client match is the only dedupe.
| Column | Type | Notes |
|---|---|---|
| vehicle_number | varchar(50) | truck registration (natural key, client-enforced) |
| driver_name | varchar(100) | optional since CR-185 |
| mobile_number | varchar(30) | optional since CR-185 |
| deleted_at | datetime | soft delete |

---

## System / Audit

### AppSetting — added 2026-08-11
Tiny key/value app-settings store (Settings page). In the generic-CRUD ALLOWED
set; natural key = `setting_key`. Client wrapper: `client/src/features/settings/settingsApi.ts`.
| Column | Type | Notes |
|---|---|---|
| setting_key | varchar | unique key (natural key) |
| setting_value | varchar | stored as string |
| deleted_at | datetime | soft delete |

Keys in use: `zoho_<provider>_refresh_token` / `_dc` / `_org_id` / `_org_name` / `_scope` for provider =
`crm` (active since CR-359) and `books` (CR-325/356, hidden — rows kept): the org-wide Zoho connection,
written only by `lib/zoho.js`; the token rows are hidden from the generic `GET /AppSetting` reads;
`zoho_<provider>_sync_at` (the remote modified-time watermark of the incremental pull; absent = never
imported) and `zoho_<provider>_sync_summary` (JSON of the last run), written by `lib/customerSync.js`;
every `zoho_*` key is Admin-only on the generic writes; `allow_duplicate_batches` — `"false"` blocks reusing a batch number
across different designs (same-design reuse is always a 409); missing row = allow.

## Panel Craft — added 2026-08-26

Showcase panels (printed roll-up banners the reps show retailers) + panel
orders with a cutting-job lifecycle. Menu: Sales ▸ Panel Craft (feature keys
`panels`, `panel-orders`, `cut-stock` — the last is the /cut-stock on-hand
grid, added 2026-08-26 pm). Client wrappers: `client/src/features/panels/`.
FK columns are plain bigint holding ROWID strings (live-project convention).
A Panel is pure master data — a spec of the cut pieces it needs (2026-08-27,
reversing the 08-26 assembly model): `/panel-save` and `/panel-delete` never
touch CutPieceStock. Stock moves only via the PanelOrder status machine
(Ready +, Dispatched −) and the `/cut-stock-entry` ledger (receipt / adjustment,
CR-307/308 — the absolute-set `/cut-stock-adjust` is gone). Generic writes to
PanelLine, CutPieceStock, CutStockEntry and soft Panel deletes are rejected
(`?hard=1` stays open for admin/e2e cleanup). Since CR-306 a `CutPieceStock` row
is also the cut-piece ITEM (weight) and a design with one is "in Panel Craft"
(Panel Items page) — no flag on Design. CR-309 adds the `Mdf` table and
`PanelOrderLine.mdf` (CR-344: `Mdf` is a SIZE-keyed master again — a line picks a row whose `size` = `Panel.mdf_size`; the CR-342 `Mdf.panel` column is dormant); CR-346 adds `PanelOrderLine.design` / `cut_piece_size` (loose cut-piece lines); CR-347 adds `PanelLoad` + `PanelLoadLine` (loading entries — Dispatched is derived from them); CR-308 adds `AdjustmentReason` and `ProductionLog.reason`.

### Panel (live id 69851000000189422)
Natural key = `panel_code`.
| Column | Type | Notes |
|---|---|---|
| panel_code | varchar(60) | unique; **server-assigned `PANEL-NNN` on create** when sent blank (CR-284, `/panel-save` → `nextPanelCode`); legacy typed codes like "C01-F11-S03-118" stay |
| panel_size | varchar(30) | e.g. "1200x2100" |
| vinyl_size | varchar(30) | |
| mdf_size | varchar(30) | the panel's MDF size, e.g. "1200x2400" — matches `Mdf.size` on the size-keyed master; the order line offers that size's thicknesses (CR-342 col 69851000000351002, added 2026-10-15; semantics CR-344) |
| image_urls | text | JSON `[{id,name}]` File Store ids (max 5, same shape as Design.image_urls; shared ImageManager) — added 2026-08-26 |
| deleted_at | datetime | soft delete |

### PanelLine (live id 69851000000194524)
One design on a panel. Replaced wholesale on panel edit (soft-delete + reinsert,
server-side in `/panel-save`; generic PanelLine writes are rejected). No stock
movement.
| Column | Type | Notes |
|---|---|---|
| panel | bigint | logical FK → Panel |
| design | bigint | logical FK → Design (Available Size hydrates from it) |
| cut_piece_size | bigint | logical FK → CutPieceSize |
| cut_piece_qty | int | pieces of this design ON the panel (not stock) |
| deleted_at | datetime | soft delete |

### PanelOrder (live id 69851000000193408)
**CR-302 (2026-10-07): the HEADER of a customer panel order; its panels live in
`PanelOrderLine`.** Created / updated only via `/panel-order-save` (one call, header +
lines; create mints `order_number` and is born `NewRequest`; update only while
`NewRequest` / `Received`, lines replaced wholesale); deleted only via
`/panel-order-delete/:rowid` (same stage rule, lines soft-deleted too). Generic POST /
DELETE refused; generic PATCH stays for `checklist` only — `status`, `checkpoints` and `allocation` are `STATE_COLUMNS` (CR-312/313).
Status machine (server `/panel-order-status/:rowid`, forward-only; generic PATCH
rejects `status`): NewRequest → Received → InCutting → Ready; **Dispatched is DERIVED — written only
by `/panel-load-save` when the last load leaves nothing pending (CR-347)**. **Ready adds** the PENDING
need — Σ over every line of `PanelLine.cut_piece_qty × PanelOrderLine.qty` (+ one piece per unit of a
cut-piece line, CR-346) per (design, cut size) minus what already loaded — to CutPieceStock and books it;
**each load deducts** the pieces it carries (booking-gated, verified for every order before any write).
Flips log StatusTransition (`entity_type: PanelOrder`) and, when `sales_order` /
`quote` is set, an OperationLog row on that source record (`logRelated`, CR-286).
Status changes only from `/panel-orders/:id` (CR-287).
| Column | Type | Notes |
|---|---|---|
| order_number | varchar(30) | `PNL/FY/NNN`, server-minted by `nextOrderNumber(catalyst, "PanelOrder", "PNL")`, unique (CR-302, col 69851000000320070, added 2026-10-07) |
| panel | bigint | **legacy** — the single panel of pre-CR-302 orders; never read or written since CR-302 (kept for history) |
| customer | bigint | logical FK → Customer |
| qty | int | **legacy** — see `panel`; the live quantity is Σ `PanelOrderLine.qty` |
| salesperson | varchar(160) | defaulted from the signed-in user |
| order_date | date | omit when blank |
| status | varchar(20) | NewRequest / Received / InCutting / Ready / Dispatched |
| sales_order | bigint | logical FK → SalesOrder; source of a "Request Panels" order (CR-286, col 69851000000316427, added 2026-10-06) |
| quote | bigint | logical FK → Quote; source of a "Request Panels" order (CR-286, col 69851000000316429, added 2026-10-06) |
| checklist | text | JSON `{"<design>|<cut_piece_size>": true}` — manual Available ticks on the requirements checklist (keys are summed across lines since CR-302), plain column via generic PATCH (CR-288, col 69851000000322244, added 2026-10-06) |
| allocation | text | JSON `{"<design>|<cut_piece_size>": pcs}` — cut pieces BOOKED to this order, a claim on `CutPieceStock.qty` (never a movement); written only by `/panel-order-allocate` (absolute set), `/panel-order-status` Ready (= need) and `/panel-order-save` (clamp); Σ over open orders ≤ on hand; Dispatch requires `allocation ≥ need` (CR-312, col 69851000000314863, added 2026-10-07) |
| checkpoints | text | JSON `{"mdf"\|"vinyl"\|"cut": {"status","by","at"}}` — MDF (Pending/Ordered/Received/Ready), Vinyl Printing (Pending/Printing/Ready), Cut Pieces (Pending/Ready) marks; written only by `/panel-order-checkpoint`; overall readiness is derived, never stored (CR-313, col 69851000000314862, added 2026-10-07) |
| deleted_at | datetime | soft delete |

### PanelOrderLine (live id 69851000000315921)
One showcase panel × qty — or, since CR-346, one loose CUT PIECE (`design` + `cut_piece_size`,
no `panel`) × qty — on a panel order (CR-302, added 2026-10-07). Written only by
`/panel-order-save` (replace-wholesale; refused once a `PanelLoad` exists, CR-347) and
`/migrate-panel-orders` (legacy backfill); soft-deleted with the order by `/panel-order-delete`.
No rate / amount (user's choice). `/panel-delete` refuses a Panel that a live line references (409).
| Column | Type | Notes |
|---|---|---|
| panel_order | bigint | logical FK → PanelOrder (col 69851000000316450) |
| panel | bigint | logical FK → Panel (col 69851000000316451); **blank on a cut-piece line (CR-346)** |
| qty | int | panels of this type / pieces, positive integer; one line per panel (or per design × cut size) per order (col 69851000000316452) |
| design | bigint | logical FK → Design — a loose cut-piece line (CR-346, col 69851000000352019, added 2026-10-15); one piece per unit joins every need |
| cut_piece_size | bigint | logical FK → CutPieceSize — with `design` (CR-346, col 69851000000352020, added 2026-10-15) |
| mdf | bigint | logical FK → Mdf — the thickness picked for this line (CR-309, col 69851000000325548, added 2026-10-07); **CR-344: a master row whose `size` = the panel's `mdf_size` (400 otherwise), required once that size has rows; never on a cut-piece line** |
| deleted_at | datetime | soft delete (col 69851000000316453) |

### SampleOrder (live id 69851000000322323) — added 2026-10-08 (CR-315)
A customer's request for item SAMPLES — a separate order type beside PanelOrder, same
Customer link. Written only by `/sample-order-save` (create / update while `New`),
`/sample-order-delete` (soft delete, `New` only) and `/sample-order-supply` (status);
generic POST / PATCH / DELETE refused.
| Column | Type | Notes |
|---|---|---|
| order_number | varchar(60) | `SMP/FY/NNN`, server-assigned via `nextOrderNumber(…, "SampleOrder", "SMP")`, `assertUnique` (col 69851000000317875) |
| customer | bigint | logical FK → Customer (col 69851000000320533) |
| salesperson | varchar(120) | logged-in user's name at creation (col 69851000000322684) |
| order_date | date | defaults to today in the form (col 69851000000322685) |
| status | varchar(40) | `New` · `PartiallySupplied` · `Supplied` — DERIVED from the lines by `/sample-order-supply`; `STATE_COLUMNS` (col 69851000000322686) |
| sales_order | bigint | source SalesOrder when raised via Request Samples (col 69851000000322687) |
| quote | bigint | source Quote when raised via Request Samples (col 69851000000322688) |
| note | text | header note (col 69851000000326150) |
| deleted_at | datetime | soft delete (col 69851000000322689) |

### SampleOrderLine (live id 69851000000320174) — added 2026-10-08 (CR-315)
One item × piece × qty on a sample order. Written by `/sample-order-save` (replace-wholesale)
and, since CR-347, by `/panel-load-save` / `/panel-load-delete` (`supplied_qty`, `supplied_on` — a supply
IS a load; the old `/sample-order-supply` is gone); soft-deleted with the order.
| Column | Type | Notes |
|---|---|---|
| sample_order | bigint | logical FK → SampleOrder (col 69851000000318658) |
| design | bigint | logical FK → Design — ANY Item-master item (col 69851000000318659) |
| piece_kind | varchar(10) | `Full` (whole tile, record-only stock) · `Cut` (cut piece, deducts CutPieceStock on supply) (col 69851000000318660) |
| cut_piece_size | bigint | logical FK → CutPieceSize, Cut lines only (col 69851000000318661) |
| qty | int | pieces requested, positive integer (col 69851000000318662) |
| supplied_qty | int | pieces supplied so far, 0…qty; `STATE_COLUMNS` (col 69851000000318663) |
| supplied_on | date | date of the LAST supply; `STATE_COLUMNS` (col 69851000000318664) |
| note | text | line remark (col 69851000000318665) |
| deleted_at | datetime | soft delete (col 69851000000318666) |

### PanelLoad (live id 69851000000351032) — added 2026-10-15 (CR-347)
ONE vehicle trip against ONE panel or sample order. A trip that carries several orders writes one row
per order sharing the same `order_number` (`LD/FY/NNN`, minted once per submit by
`nextOrderNumber(catalyst, "PanelLoad", "LD")`). Written only by `/panel-load-save`; soft-deleted by
`/panel-load-delete` (reason; open order only). Generic POST / PATCH / DELETE refused. A load moves the
stock it carries (Panel / Item material, booking-gated) and the last load flips the panel order to
Dispatched (sample order → derived status).
| Column | Type | Notes |
|---|---|---|
| order_number | varchar(60) | `LD/FY/NNN` — shared by every order on the trip (col 69851000000352023) |
| order_type | varchar(10) | `Panel` \| `Sample` (col 69851000000352024) |
| panel_order | bigint | logical FK → PanelOrder when `order_type` = Panel (col 69851000000352025) |
| sample_order | bigint | logical FK → SampleOrder when Sample (col 69851000000352026) |
| load_date | date | (col 69851000000352027) |
| vehicle_number | varchar(60) | free text, required (CR-185 rule) (col 69851000000352028) |
| driver_name | varchar(100) | CR-351 — driver on the trip; also kept on the Vehicle master via `resolveVehicle()` (col 69851000000353054) |
| driver_mobile | varchar(30) | CR-351 — driver mobile (col 69851000000353055) |
| note | text | driver / transporter / LR … (col 69851000000352029) |
| photos | text | JSON `[{id,name}]` — File Store ids (same upload route + shape as Design images) (col 69851000000352030) |
| performed_by | varchar(120) | `currentActor` (col 69851000000352031) |
| deleted_at | datetime | soft delete (col 69851000000352032) |

### PanelLoadLine (live id 69851000000347033) — added 2026-10-15 (CR-347)
One order line × material × qty on a trip. `material`: **Panel** (a panel line's cut pieces — leave
stock), **Mdf** (its board — not stock; only when the line picked one), **Item** (a loose cut-piece line
or a sample line). `weight_kg` is STAMPED at load time (CR-349: unit kg × qty; null when a piece or board
was unweighed) and never recomputed — a master weight edit changes pending and future orders only.
| Column | Type | Notes |
|---|---|---|
| panel_load | bigint | logical FK → PanelLoad (col 69851000000353021; `load` is a reserved word) |
| order_line | bigint | logical FK → PanelOrderLine or SampleOrderLine (col 69851000000353022) |
| material | varchar(10) | `Panel` \| `Mdf` \| `Item` (col 69851000000353023) |
| qty | int | units loaded on this trip (col 69851000000353024) |
| weight_kg | double(3) | kg of this line on this trip, frozen (col 69851000000353025) |
| deleted_at | datetime | soft delete (col 69851000000353026) |

### CutPieceSize (live id 69851000000182460)
Lookup; natural key = `name`. Editable in Settings ▸ Masters; the Panel form's
picker creates missing sizes write-through.
| Column | Type | Notes |
|---|---|---|
| name | varchar(160) | unique (natural key), e.g. "150x725" |
| seq_code | varchar(10) | auto-assigned by the Masters editor |
| deleted_at | datetime | soft delete |

### CutPieceStock (live id 69851000000183280)
**The cut-piece ITEM + its cached on-hand (CR-306/307, 2026-10-07).** One row per
(design, cut_piece_size): `weight_kg` is the item attribute, `qty` the on-hand that
`adjustCutStock` keeps in step with the `CutStockEntry` ledger. qty 0 = defined, nothing
on hand; a design with at least one live row is "in Panel Craft" (`/panel-items`).
Written only server-side: `/cut-piece-save` (upsert weight; blank size → full size),
`/cut-piece-delete` (soft, qty 0 + unused by PanelLine), `ensureCutPiece` (from
`/panel-save`), and `adjustCutStock` for every movement (`/cut-stock-entry`, status
machine). Generic POST / PATCH / DELETE are refused (DF-02 closed). The composite
key's uniqueness lives in `ensureCutPiece` / `adjustCutStock`, not in NATURAL_KEY.
| Column | Type | Notes |
|---|---|---|
| design | bigint | logical FK → Design |
| cut_piece_size | bigint | logical FK → CutPieceSize |
| qty | int | current on-hand (never negative) |
| weight_kg | double(3) | kg per piece (CR-306, col 69851000000326127, added 2026-10-07); null = not set; default on create = Design box weight ÷ pcs per box × the cut's face share (`cutPieceWeight`) |
| deleted_at | datetime | soft delete |

### CutStockEntry (live id 69851000000317365) — added 2026-10-07 (CR-307)
The dated ledger behind `CutPieceStock.qty`: one row per movement, written only by
`adjustCutStock` (via `/cut-stock-entry` and `/panel-order-status`). Never edited or
deleted by a route (reverse = opposite entry); generic writes refused. Browsable as Stock
History on `/panel-items/:designId`.
| Column | Type | Notes |
|---|---|---|
| design | bigint | logical FK → Design (col 69851000000320133) |
| cut_piece_size | bigint | logical FK → CutPieceSize (col 69851000000320134) |
| qty | int | SIGNED pieces (col 69851000000320135) |
| entry_date | date | the sheet's Entry / Adjustment date; today for order movements (col 69851000000320136) |
| kind | varchar(20) | `receipt` (Add Stock sheet) · `adjustment` (Adjust Stock sheet, reason mandatory) · `order_ready` · `order_dispatch` · `sample` (sample supply, CR-316) · `transfer` (CR-330: one leg of a Transfer Order — a −/+ pair sharing `doc_number`) (col 69851000000320137) |
| reason | varchar(100) | AdjustmentReason name, adjustments only (col 69851000000320138) |
| note | text | line remark or the sheet's note (col 69851000000320139) |
| ref_table | varchar(40) | `PanelOrder` on order movements, `SampleOrder` on sample supplies (col 69851000000320140) |
| ref_rowid | bigint | the PanelOrder / SampleOrder ROWID (col 69851000000320141) |
| performed_by | varchar(100) | actor email (col 69851000000320142) |
| deleted_at | datetime | soft delete, never set by a route (col 69851000000320143) |
| warehouse | bigint | **CR-329 — created on live 2026-10-12 (col 69851000000338009).** Logical FK → Warehouse; null = the primary. Set from the sheet's Warehouse picker (receipt / adjustment) or the From / To pair (transfer); order / sample movements leave it null. |
| doc_number | varchar(40) | **CR-330 — created on live 2026-10-12 (col 69851000000338010).** `TRF/<FY>/NNN` on `kind="transfer"` rows (same series as `ProductionLog.request_group` transfer codes); null elsewhere. |

### Warehouse (live id 69851000000335014) — added 2026-10-12 (CR-329)
Settings ▸ Warehouses — the stock locations master (Zoho Books "Locations"). Generic CRUD via
`warehousesApi` (module `items`, `GET_SHARED`); `is_primary` is route-only (`POST /warehouse-primary/:rowid`
stamps every null-warehouse `ProductionLog` / `CutStockEntry` row onto the OLD primary, then flips the flag).
Exactly one primary; the primary and any warehouse referenced by stock rows refuse deletion. No warehouses =
the feature is dormant. Natural key = `name`.
| Column | Type | Notes |
|---|---|---|
| name | varchar(100) | unique (col 69851000000334152) |
| is_primary | boolean | exactly one true — `STATE_COLUMNS` (col 69851000000334153) |
| purposes | varchar(255) | comma list of `Production` · `Palletization` · `Loading Bay` · `Raw Material` · `Sample Cut Panels` (`WAREHOUSE_PURPOSES`); labels only, except **Loading Bay** = where null-warehouse removals (loaded boxes) are taken from first (col 69851000000334154) |
| note | varchar(255) | free text (col 69851000000334155) |
| deleted_at | datetime | soft delete (col 69851000000334156) |

### Mdf (live id 69851000000314493) — added 2026-10-07 (CR-309), size-keyed master again since CR-344
One row per **size × thickness** with its board weight — the MDF master (Settings ▸ Masters ▸ MDF,
generic `MasterDef`; generic POST / PATCH / DELETE allowed, `BLOCK_DELETE` keeps a row a live
`PanelOrderLine.mdf` uses). A panel states its `mdf_size`; the order line picks a row of that size.
CR-342 (2026-10-15, same day) had parented rows per panel — reversed by CR-344; `/migrate-mdf-sizes`
(admin, idempotent) merged the duplicates and repointed order lines.
| Column | Type | Notes |
|---|---|---|
| size | varchar(60) | the MDF size, e.g. "1200x2400" — matched case-insensitively against `Panel.mdf_size` (col 69851000000316960) |
| thickness | varchar(30) | e.g. "8 mm"; unique per size (col 69851000000316961) |
| weight_kg | double(3) | board weight for this thickness; joins the line weight, stamped onto `PanelLoadLine.weight_kg` at load time (col 69851000000316962) |
| seq_code | varchar(10) | assigned by the Masters editor (col 69851000000316963) |
| panel | bigint | **dormant since CR-344** — the CR-342 per-panel owner; never read or written now (col 69851000000348003, added 2026-10-15) |
| deleted_at | datetime | soft delete (col 69851000000316964) |

### AdjustmentReason (live id 69851000000316601) — added 2026-10-07 (CR-308)
Settings ▸ Masters ▸ Adjustment Reason — why stock was adjusted; read by both
adjustment sheets (`GET_SHARED`), stored by NAME on `ProductionLog.reason` /
`CutStockEntry.reason`. Seeded: Breakage · Damaged in transit · Theft · Count correction ·
Sample / Display · Other. Natural key = `name`.
| Column | Type | Notes |
|---|---|---|
| name | varchar(100) | unique (col 69851000000314852) |
| seq_code | varchar(10) | auto-assigned by the Masters editor (col 69851000000314853) |
| deleted_at | datetime | soft delete (col 69851000000314854) |

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
