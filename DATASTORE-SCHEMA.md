# BOFFO — Catalyst Data Store Schema (Live Reference)

> Snapshot pulled directly from Zoho Catalyst on **2026-06-12** via `List_All_Tables` + `List_All_Columns`.
> This is the source of truth for table/column names and IDs — prefer this over plan docs.

**Project:** `boffo-latest-project` · projectId `76673000000030007` · org `926227227` · env `Development`
**Endpoint:** `https://boffo-latest-project-926227227.development.catalystserverless.com/server/data-ops/`

## Conventions

- Every table has system columns (omitted below): `ROWID` (bigint, PK), `CREATORID` (bigint), `CREATEDTIME` (datetime), `MODIFIEDTIME` (datetime).
- A table's **ROWID column_id = table_id + 1** (system cols occupy table_id+1..+4). FKs always point at parent's ROWID column.
- FK constraint types in use: `ON-DELETE-CASCADE` (child dies with parent) and `ON-DELETE-SET-NULL`.
- `date` columns reject empty string — omit the key when blank. `datetime` wants `yyyy-MM-dd HH:mm:ss` (NOT ISO-8601).
- ZCQL `LIMIT` hard-caps at 300 rows/query.
- Reserved keywords avoided: `order` → `sales_order`, `priority` → `priority_level`.
- **Soft delete (added 2026-06-12):** every table except OperationLog has `deleted_at` (datetime, nullable; null = active). data-ops generic `DELETE /:table/:rowid` sets `deleted_at` instead of removing the row (`?hard=1` forces real delete; OperationLog always hard-deletes). `POST /:table/:rowid/restore` clears it. Generic list excludes soft-deleted rows unless `?include_deleted=1`. FK CASCADE/SET-NULL no longer fires on user deletes. Internal hard deletes remain: quote line replacement, saga compensation.

## Table Index (30 tables)

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
| SalesOrder | 76673000000051371 | Master Orders (UI label) |
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

## SalesPerson (76673000000115495) — added 2026-06-23

Master list of sales reps shown on Quotations / Sales Orders. In the generic-CRUD
ALLOWED set; natural key = `name`. Managed via the Sales Persons admin page
(`/salespersons`, admin-only) which reads `/auth/users` for the linked-user picker.

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
Every other data-ops route requires `Authorization: Bearer <token>`; POST/PATCH need
`Role.can_update`, DELETE needs `Role.can_delete` (`POST /fit-suggest` exempt, read-only).

### Role (76673000000092001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(50) | unique, mandatory (Admin / Editor / Viewer seeded) |
| features | text | JSON array of nav ids visible to this role; `["*"]` = all |
| can_update | boolean | default false — gates POST/PATCH (create+edit) |
| can_delete | boolean | default false — gates DELETE |

Seeded: Admin `…89012` (update+delete), Editor `…89013` (update only), Viewer `…89014` (read-only).

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

### Brand (76673000000047360)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| internal_or_external | varchar(50) | |

### Grade (76673000000048008)
| Column | Type | Notes |
|---|---|---|
| name | varchar(50) | key column |

### Size (76673000000050001) — keys on `code`, NOT name
| Column | Type | Notes |
|---|---|---|
| code | varchar(50) | key column |
| width_mm | int | |
| length_mm | int | |
| seq_code | varchar(10) | SKU segment |

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

### PaymentTerm (76673000000049001)
| Column | Type | Notes |
|---|---|---|
| name | varchar(255) | key column |
| term_type | varchar(50) | |

Values: Credit, Advance, Net 15, Net 30, Net 45, Net 60.

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

### Design (76673000000052723) — keys on `unique_name` / `design_name`
| Column | Type | Notes |
|---|---|---|
| unique_name | varchar(255) | unique guard in app |
| design_name | varchar(255) | |
| base_design_name | varchar(255) | |
| sku | varchar(100) | auto NN-NN-NN-NN |
| party_brand_name | varchar(255) | |
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

### QuoteItem (76673000000050364)
| Column | Type | Notes |
|---|---|---|
| quantity_boxes | int | |
| rate | double | |
| rate_basis | varchar(20) | |
| discount_pct | double | |
| sub_total | double | |
| final_total | double | |
| quote | FK → Quote | **CASCADE** |
| design | FK → Design | SET-NULL |

### SalesOrder (76673000000051371) — UI label: "Master Order"
| Column | Type | Notes |
|---|---|---|
| order_number | varchar(50) | via TransactionSeries |
| po_number | varchar(100) | |
| order_date | date | |
| port_of_discharge | varchar(255) | |
| status | varchar(50) | default "Confirmed" on create/convert |
| currency | varchar(10) | |
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
