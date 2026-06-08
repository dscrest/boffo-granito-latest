# BOFFO Order OS — Technical Plan

> Grounded in **verified Zoho Catalyst capabilities** (checked against docs.catalyst.zoho.com,
> June 2026). Companion to `BOFFO_Architecture.md` (decisions), `BOFFO_Build_Plan.md` (phases),
> `BoffoExport_Tracker.md` (spec). This is the build contract — implementation follows after sign-off.

---

## 0. Verified Catalyst facts that shape this plan

| Capability | Verified result | Source |
|---|---|---|
| Multi-row/table **transactions** | **Not supported** (no BEGIN/COMMIT/ROLLBACK) | zcql/syntax-exceptions, data-store/bulk-operations |
| **Compound** unique index | **No** — only single-column `IsUnique` | data-store/columns |
| Single-column unique | Yes (`IsUnique`) | data-store/columns |
| Foreign keys | Yes, with cascade / set-null on delete | data-store/columns |
| Column types | Text(10k), VarChar(≤255), Date, DateTime, **Int(±9,999,999,999)**, Double(17), Boolean, **BigInt(±9.2e18)**, ForeignKey, EncryptedText | data-store/columns, zcql/syntax-exceptions |
| ZCQL | SELECT/INSERT/UPDATE/DELETE, ≤4 JOINs (1 cond. each), GROUP BY, ORDER BY, WHERE, HAVING, numeric fns, SELECT-only alias | zcql/introduction, zcql/groupby-orderby |
| Advanced I/O Function | **30s timeout**; Node.js (Express); logs ≤1500 chars | functions/advanced-io |
| Bulk write | CSV via Stratus, ≤100k rows, **async/job — not atomic** | data-store/bulk-operations |

### Design rules derived from the above
1. **No transactions → compensating actions.** Every flow that writes >1 row is an explicit,
   idempotent, ordered sequence with rollback-on-failure compensation and a `saga_state` marker.
   (Detailed in §3.)
2. **Compound uniqueness → materialized key column.** Add a `VarChar(255)` column holding the
   composite (e.g. `unique_name`, `sku`), mark it `IsUnique`. DB enforces it; app builds the string.
3. **Money → BigInt minor units** (paise/cents). Never Int (overflows ~₹10 Cr), never Double (FP error).
4. **Long work → async.** PDF (`pdfmake`, not Puppeteer) and Books sync must finish well under 30s, or
   run as paginated/queued jobs. No single call iterates an unbounded set.
5. **Reports needing >4 joins** → split into multiple queries or read from a denormalized rollup column.
6. **Every mutation** validates with Zod first, writes an `Activity` row, stamps `created_by`/`updated_*`.

---

## 1. Data Store schema — exact column types (ZCQL)

> Every table also gets Catalyst's implicit `ROWID` (BigInt PK), `CREATEDTIME`, `MODIFIEDTIME`,
> `CREATORID`. Columns below are the app columns. `FK` = ForeignKey to that table's ROWID.
> `U` = IsUnique, `M` = IsMandatory.

### 1.1 Masters
```
Organization      name VarChar M | books_org_id VarChar | default_currency VarChar(3) M | address Text | active Boolean
AppUser           catalyst_user_id BigInt U M | email VarChar U M | name VarChar | role VarChar M | active Boolean
Role              name VarChar U M | permissions_json Text
PaymentTerm       name VarChar U M                      -- seed: Advance, Credit, Net 15/30/45/60
Size              code VarChar U M | width_mm Double M | length_mm Double M
Finish            name VarChar U M
Category          name VarChar U M
Glaze             name VarChar U M
Brand             name VarChar U M | internal_or_external VarChar
Grade             name VarChar U M
NumberMaster      entity_type VarChar M | entity_id BigInt(FK) M | seq_code VarChar M  -- 2-digit SKU part per Size/Finish/Category/Glaze
                  + materialized unique: entity_key VarChar U  (= "size:12")
TransactionSeries doc_type VarChar M | prefix VarChar | current_number Int | fy_token VarChar
                  + materialized unique: series_key VarChar U  (= "QUOTE:2026-27")
Customer          code VarChar U | name VarChar M | country VarChar | flag_emoji VarChar |
                  currency VarChar(3) M | payment_term_id BigInt(FK) | books_contact_id VarChar |
                  port_of_discharge VarChar | address_json Text | active Boolean
Vendor            name VarChar M | books_vendor_id VarChar | currency VarChar(3) | active Boolean
```

### 1.2 Product / Design
```
Design   design_name VarChar M | base_design_name VarChar | sku VarChar U M |
         unique_name VarChar(255) U M               -- materialized "Design - Size - Finish"
         size_id BigInt(FK) M | finish_id BigInt(FK) M | category_id BigInt(FK) | glaze_id BigInt(FK) |
         brand_id BigInt(FK) | grade_id BigInt(FK) | party_brand_name VarChar |
         pcs_per_box Int M | box_weight_kg Double |
         coverage_sqm Double | coverage_sqft Double        -- computed on write
         random_faces Int | status VarChar | collection_name VarChar |
         rate_per_sqft BigInt | rate_per_sqmt BigInt |     -- minor units
         image_file_id VarChar | books_item_id VarChar
DesignPallet  design_id BigInt(FK) M | pallet_id BigInt(FK) M
              + materialized unique: link_key VarChar U  (= "<design>:<pallet>")
```

### 1.3 Pallet master
```
Pallet  size_id BigInt(FK) M | pallet_type VarChar | pallet_size_label VarChar |
        boxes_per_pallet Int M | pallets_per_container Int M |
        empty_pallet_weight_kg Double | remarks Text
        -- total_pallet_weight, boxes/container, sqm/sqft per container = computed at query time
```

### 1.4 Quote → Order → Dispatch
```
Quote      quote_number VarChar U M | customer_id BigInt(FK) M | quote_date Date |
           payment_term_id BigInt(FK) | port_of_discharge VarChar |
           status VarChar M           -- Draft|Shared|Accepted|Rejected|Converted
           currency VarChar(3) M | fx_rate Double | remarks Text |
           public_link_token VarChar U | conversion_flag VarChar |  -- None|Full|Partial
           total_amount BigInt | created_by BigInt
QuoteItem  quote_id BigInt(FK) M | design_id BigInt(FK) M | quantity_boxes Int M |
           rate BigInt | rate_basis VarChar |   -- per_sqft|per_sqmt|per_box
           discount_pct Double | sub_total BigInt | final_total BigInt
SalesOrder order_number VarChar U M | quote_id BigInt(FK) | customer_id BigInt(FK) M |
           po_number VarChar | order_date Date | payment_term_id BigInt(FK) |
           port_of_discharge VarChar | status VarChar M |   -- Confirmed|In Progress|Cancelled
           currency VarChar(3) M | fx_rate Double | remarks Text
OrderItem  order_id BigInt(FK) M | design_id BigInt(FK) M |
           ordered_qty_boxes Int M | produced_qty_boxes Int | qc_passed_qty_boxes Int |
           palletized_qty_boxes Int | loaded_qty_boxes Int | dispatched_qty_boxes Int |
           stage VarChar M |   -- po|prod|qc|packing|loading|final
           priority VarChar | due_date Date
OrderItemEvent  order_item_id BigInt(FK) M | event_type VarChar M | qty_delta Int |
                performed_by BigInt | performed_at DateTime | note Text
```

### 1.5 Palletisation & Container
```
PalletisedBatch     order_id BigInt(FK) M | pallet_id BigInt(FK) M | design_id BigInt(FK) M |
                    boxes_packed Int M | packed_at DateTime | packed_by BigInt |
                    status VarChar |   -- open|closed|loaded
                    delivery_date Date | remarks Text
PalletisedBatchLine batch_id BigInt(FK) M | order_item_id BigInt(FK) M | boxes Int M
Container           container_number VarChar U | container_type VarChar |  -- 20ft|40ft|40HQ
                    capacity_boxes Int M | capacity_pallets Int |
                    vessel_name VarChar | etd Date | eta Date |
                    port_of_loading VarChar | port_of_discharge VarChar |
                    status VarChar      -- planned|loading|sealed|dispatched
ContainerLoading    container_id BigInt(FK) M | batch_id BigInt(FK) M |
                    loaded_at DateTime | loaded_by BigInt | position Int
Invoice             invoice_number VarChar U M | container_id BigInt(FK) | order_id BigInt(FK) |
                    invoice_date Date | total_amount BigInt | currency VarChar(3) | status VarChar
Activity            occurred_at DateTime M | actor_user_id BigInt | entity_type VarChar |
                    entity_id BigInt | action VarChar | detail_text Text | tag VarChar
```

**Table create order (FK resolution):** masters → Pallet/Design/DesignPallet → Quote/QuoteItem →
SalesOrder/OrderItem/OrderItemEvent → PalletisedBatch/Line → Container/ContainerLoading/Invoice → Activity.

---

## 2. Compute engines (server is source of truth)

- **SKU** = `NN-NN-NN-NN` from NumberMaster seq per Size/Finish/Category/Glaze. Generator function
  reads + increments the four `NumberMaster` rows, builds the string, sets `Design.sku` (unique).
- **Coverage** `sqm = (width_mm/1000)·(length_mm/1000)·pcs_per_box`; `sqft = sqm·10.763915`.
- **Quote amount** per tracker: rate is per sqmt → convert to box rate via `Design.coverage_sqm`,
  then `amount = box_rate · qty_boxes`; apply `discount_pct`; `final_total` in minor units.
- **Pallet rollups** (computed at read): `total_pallet_weight = box_weight·boxes_per_pallet +
  empty_pallet_weight`; `boxes/container = boxes_per_pallet·pallets_per_container`; sqm/sqft & weight
  per container scale from there.
- **Currency**: per-document `currency` + `fx_rate` captured at create; minor units in storage;
  format on display. No revaluation.

---

## 3. Non-transactional mutation patterns (the load-bearing part)

Each multi-write flow is an **idempotent saga** with an ordered write list and compensation. Pattern:
write a `saga_state` field (or an `Activity` checkpoint) so a retry can resume/clean up; use a
client-supplied `idempotency_key` to dedupe retries.

**3a. Convert Quote → Sales Order** (Quote.status, new SalesOrder, N OrderItems, Activity)
1. Guard: quote is `Accepted` and not already `Converted` (idempotency on `quote_id`).
2. Insert `SalesOrder` (status `Confirmed`) → keep its ROWID.
3. Insert `OrderItem` rows (one per QuoteItem, or subset for **partial**).
   - On failure mid-way: delete the SalesOrder + any inserted OrderItems (compensate), surface error.
4. Update `Quote.conversion_flag` + `status=Converted`.
5. Insert `Activity`.
   *Partial convert* copies a subset with adjusted qty and sets `conversion_flag=Partial`.

**3b. Close pallet** (PalletisedBatch + BatchLines + OrderItem counters + Activity)
1. Insert `PalletisedBatch` (status `closed`).
2. Insert `PalletisedBatchLine`(s).
3. Increment `OrderItem.palletized_qty_boxes` (clamp ≤ produced).
4. Append `OrderItemEvent` + `Activity`.
   Compensation: if step 3/4 fails, mark batch `open` and reverse lines; never leave counters > produced.

**3c. Load container / dispatch cascade** (ContainerLoading + batch status + OrderItem.loaded/dispatched)
1. Insert `ContainerLoading`, set `PalletisedBatch.status=loaded`.
2. On **dispatch**: set `Container.status=dispatched`, bump `OrderItem.dispatched_qty_boxes`, events.
   Guard against double-load via unique `(container_id,batch_id)` materialized key.

**Invariant checks** (enforced in code since no DB constraints): `loaded ≤ palletized ≤ produced ≤ ordered`;
`SUM(ContainerLoading.boxes) ≤ Container.capacity_boxes`.

---

## 4. Container-fit suggester (greedy v1)

Inputs: pending closed batches (`design_id`, `boxes_packed`, pallet → `boxes_per_pallet`, weights) +
available containers (`capacity_boxes`, `capacity_pallets`, ETD). Algorithm: sort pallets by design;
fill earliest-ETD containers first; while `capacity_boxes − loaded > min_pallet`, place next fitting
pallet; if none fits whole, suggest a **partial** (split batch). Flag containers <95% full in red.
UI allows drag-swap of a batch between containers. v2 = First-Fit-Decreasing with weight limits.

---

## 5. Backend — function & endpoint contracts

One Advanced I/O Function per resource (Express router inside). Shared `functions/lib`:
`db.ts` (ZCQL DAL), `auth.ts` (Embedded Auth + role guard), `currency.ts`, `ids.ts` (SKU/series),
`saga.ts` (compensation helpers), `zod.ts` (schemas), `errors.ts`.

| Function | Routes (REST) | RBAC (write) |
|---|---|---|
| api-health | GET / | public |
| api-masters | CRUD: customers, vendors, sizes, finishes, categories, glazes, brands, grades, payment-terms | Admin |
| api-designs | CRUD designs; POST /designs/:id/image; POST /sku/generate | Admin, Sales |
| api-pallets | CRUD pallets; design↔pallet links | Admin |
| api-quotes | CRUD; POST /:id/share; GET /public/:token; POST /:id/convert; GET /:id/pdf | Sales |
| api-orders | CRUD SalesOrder; list/detail | Sales |
| api-orderitems | PATCH stage; POST /:id/produce; POST /:id/qc | Production |
| api-palletisation | POST /batches (close); list ready | Packing |
| api-containers | CRUD; POST /fit-suggest; POST /:id/load; POST /:id/dispatch | Dispatch |
| api-invoices | POST (per container); GET /:id/pdf | Admin, Dispatch |
| api-books-sync | POST /customers /vendors /items (one-way pull, paginated) | Admin |

**Cross-cutting:** Zod-validate input; list endpoints support `?cursor&limit&fields`; all writes →
`Activity`; RBAC enforced in-function (not just UI); errors as `{code,message}`.

---

## 6. Frontend (Vite + React 18 + TS)

- `client/src/styles/` ← prototype `styles.css` **byte-for-byte**.
- `client/src/ui/` ← `Icon, ProgressBar, SplitBar, StageBadge, Spark, KPI` ported verbatim (markup
  unchanged), typed.
- `client/src/features/<domain>/` ← ported view layouts (Dashboard, Kanban, ByOrder, OrderDrawer,
  QuickView, DesignMaster, Parties, stage views) wired to the API client instead of `window.*`.
- `lib/`: typed API client, Zod schemas (shared shapes with server), TanStack Query hooks, Zustand
  store for UI/session, React Hook Form for entry. React Router v6.
- Auth: Catalyst Embedded Auth (login/logout, session guard, role from `AppUser`).
- `prototype/` stays untouched as reference.

---

## 7. Phase 0 — concrete bootstrap tasks (first sign-off gate)

1. Remove Next.js scaffold (`src/app`, `next.config.ts`, `postcss.config.mjs`, next deps).
2. `client/` Vite + React 18 + TS; copy `styles.css`; port the app shell (sidebar/header from
   `app.jsx`) + `Icon`.
3. `functions/api-health` → `{status:"ok"}`; wire client → health.
4. Catalyst Embedded Auth login/logout working against `boffo-latest-project`.
5. `catalyst.json` for client + functions; deploy to Development env. **Deliverable: live URL.**
6. Copy `prototype/` in verbatim; commit `BOFFO_*` docs.
   → **STOP, demo URL, get "go" for Phase 1.**

---

## 8. Still to confirm before/within each phase
- **Catalyst Function memory/payload ceilings** (undocumented) — validate empirically in Phase 0 with a
  representative PDF + a 200-row convert.
- **Books API**: customer + vendor one-way pull confirmed; **item create-vs-link deferred to Phase 6.**
- **`AppUser.role` source**: Catalyst built-in roles vs our `Role` table — decide in Phase 1.
- **Public quote link**: read-only token page hosting (same client app, unauthenticated route).
