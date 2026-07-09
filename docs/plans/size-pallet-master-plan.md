# Size Master + Pallet Master — analysis & implementation plan

Date: 2026-07-09 · Branch: `feature/master-order-forms`

> **Status 2026-07-09:** Phases A–D implemented, typecheck clean. Not yet smoke-tested, committed, or deployed.
> Backfill of the 15 existing sizes is **deferred** (see §7).
>
> Decisions taken: tile `Type` is free-text-creatable seeded with `GVT` (no fixed list yet) · Item form auto-fills
> width/length/pcs/box-weight from the picked Size, read-only · `empty_pallet_weight_kg` kept · thickness in mm, optional.

---

## 1. Current DB structure (Catalyst Data Store)

### `Size` (76673000000050001) — key column is `code`, **not** `name`
| Column | Type | Source |
|---|---|---|
| `code` | varchar(50) | manual, e.g. `600x600` |
| `width_mm` | int | manual |
| `length_mm` | int | manual |
| `seq_code` | varchar(10) | SKU segment |

15 rows live: 75x600, 98x600, 98x1200, 198x1200, 200x1200, 300x600, 400x1200, 600x600, 600x900, 600x1200, 800x800, 800x1600, 1200x1200, 1200x2780, 400x400.

### `Pallet` (76673000000049723)
| Column | Type | Today |
|---|---|---|
| `name` | varchar(255) | auto: `SIZE - packing - type` |
| `pallet_type` | varchar(100) | free text + datalist |
| `size` | FK → Size | picker |
| `pallet_size_label` | varchar(100) | denormalised size label |
| `packing_details` | varchar(255) | auto: `[A×B] = N` |
| `coverage_sqm` | double | **manual today** |
| `coverage_sqft` | double | **manual today** |
| `box_weight_kg` | double | **manual today** |
| `boxes_per_pallet` | int | manual (arrangement A) |
| `pallets_per_container` | int | manual (arrangement A) |
| `empty_pallet_weight_kg` | double | manual (A pallet weight) |
| `b_boxes_per_pallet` | int | arrangement B — **UI hidden**, column live |
| `b_pallets_per_container` | int | arrangement B — UI hidden |
| `b_pallet_weight` | double | arrangement B — UI hidden |
| `remarks` | text(10000) | manual |

Per-container totals are **not stored** — computed in `palletsApi.fetchPallets()` and re-computed live in `PalletForm`.

### `Design` (item master) — the duplication problem
`Design` **already carries its own** `width_mm`, `length_mm`, `pcs_per_box`, `box_weight_kg`, `coverage_sqm`, `coverage_sqft`. `DesignForm` derives coverage from width/length/pcs at save time.

So per-box packing data currently lives in **two** places (Design, Pallet), each hand-entered. This request adds Size as the third — and the correct **single source of truth**.

---

## 2. Where the code lives

| Concern | File |
|---|---|
| Size CRUD (today) | [Masters.tsx:51-64](client/src/features/masters/Masters.tsx#L51-L64) — generic `MasterTable`, reached from the header **gear ▸ Masters** page |
| Size options for Item form | [designsApi.ts:161](client/src/features/masters/designsApi.ts#L161) + [designsApi.ts:102-116](client/src/features/masters/designsApi.ts#L102-L116) |
| Size options for Pallet form | [palletsApi.ts:86](client/src/features/masters/palletsApi.ts#L86) |
| Size options for Orders | [ordersApi.ts:58](client/src/features/orders/ordersApi.ts#L58) |
| Pallet grid | [Pallets.tsx](client/src/features/masters/Pallets.tsx) |
| Pallet form + formulas | [PalletForm.tsx:101-109](client/src/features/masters/PalletForm.tsx#L101-L109) |
| Pallet API + totals | [palletsApi.ts:97-140](client/src/features/masters/palletsApi.ts#L97-L140) |
| Sidebar nav (Items group) | [App.tsx:83-93](client/src/App.tsx#L83-L93) |
| Routes | [App.tsx:418](client/src/App.tsx#L418) |
| Role gating by nav id | [App.tsx:141-145](client/src/App.tsx#L141-L145) → `hasFeature()` in [auth.ts:101](client/src/lib/auth.ts#L101) |

---

## 3. Recommendation: reuse `Size`, do not create a new table

Requested outcome ("same size table, hide from Settings, surface under Items") is the right call. Reasons:

- `Size` is an FK target from `Design` and `Pallet`. A new table would need a data migration + FK rewrite on both.
- `Size.code` already stores the exact `WidthxLength` string the screenshot's *Size* formula produces.
- Catalyst has **no formula columns**. Any "formula" field is either computed client-side on read, or computed on save and **stored**. Store them — `sqm_per_box` / `sqft_per_box` must be readable by ZCQL from Pallet, palletisation, and reports without a join.

---

## 4. Schema changes

### 4.1 `Size` — add 7 columns
| Column | Type | Entry | Formula |
|---|---|---|---|
| `tile_type` | varchar(50) | select | — (GVT, PGVT, …) |
| `thickness_mm` | double | manual | — |
| `pcs_per_packing` | int | manual | — |
| `box_weight_kg` | double | manual | — |
| `sqm_per_box` | double | **stored, computed** | `(width_mm/1000) × (length_mm/1000) × pcs_per_packing` |
| `sqft_per_box` | double | **stored, computed** | `sqm_per_box × 10.7639` |
| `remark` | varchar(1000) | manual | — |

`code` becomes **auto-generated read-only** = `` `${width_mm}x${length_mm}` `` (matches the screenshot's *Size* formula field, and every existing row already satisfies it).

Created via `Create_Column` MCP on table `76673000000050001`. **No FK columns** → no int64 precision problem. Existing 15 rows: new columns null until an operator opens each size and fills pcs/weight/type.

### 4.2 `Pallet` — no new columns
`coverage_sqm`, `coverage_sqft`, `box_weight_kg` stop being hand-entered and become an **auto-filled snapshot** of the chosen Size (`sqm_per_box`, `sqft_per_box`, `box_weight_kg`). Columns stay so nothing downstream breaks and so historical pallets keep the numbers they were costed with.

Net Pallet manual inputs after this change: `pallet_type`, `size`, `boxes_per_pallet`, `pallets_per_container` (+ hidden B pair), `empty_pallet_weight_kg`, `remarks`. Everything else derives.

### 4.3 Pallet formulas (unchanged logic, now fed from Size)
```
Total Boxes per Cont.       = (A_boxes × A_pallets) + (B_boxes × B_pallets)
Total Pallets per Cont.     = A_pallets + B_pallets
Total Sq.M per Cont.        = Total Boxes × Size.sqm_per_box
Total Sq.Ft per Cont.       = Total Boxes × Size.sqft_per_box
Total Box Weight per Cont.  = Total Boxes × Size.box_weight_kg
Total Pallet Weight (kg)    = (Size.box_weight_kg × A_boxes) + empty_pallet_weight_kg   [existing]
```
Arrangement B UI stays hidden ([PalletForm.tsx:271-306](client/src/features/masters/PalletForm.tsx#L271-L306)); the `+ B` terms stay in the formula so the numbers are right the day it is un-hidden.

---

## 5. Implementation steps

**Phase A — schema (Catalyst MCP)**
1. `Create_Column` ×7 on `Size`.
2. Update `DATASTORE-SCHEMA.md` in the same session (standing rule).

**Phase B — Size Master page**
3. New `client/src/features/masters/sizesApi.ts` — `listSizes / createSize / updateSize / deleteSize / bulkDeleteSizes`, stale-while-revalidate cache, computes `code`, `sqm_per_box`, `sqft_per_box` on write. Mirror `palletsApi.ts`.
4. New `Sizes.tsx` grid — `.gsearch` magnifier, bulk select, no inline actions, row-click → edit (per master-page UI convention).
5. New `SizeForm.tsx` modal — read-only `Size` header (`600x600`), Width, Length, Type (select), Thickness, Remark, Pcs. per Packing, read-only Total SQM/SQFT per Box, Box Weight. `confirmDialog()` for delete.

**Phase C — wiring**
6. `App.tsx`: add `{ id: "sizes", label: "Size Master", icon: "tile" }` to the **Items** group (above Pallet Master); add lazy route `/sizes`.
7. Register `sizes` on the roles that should see it (`Role.features`; `["*"]` roles get it free).
8. `Masters.tsx`: remove the `size` entry from `MASTERS[]`. Note `MASTERS[0].key` seeds the default tab ([Masters.tsx:421](client/src/features/masters/Masters.tsx#L421)) — it will fall through to `finish`, which is fine.

**Phase D — Pallet Master**
9. `palletsApi.ts`: project the new Size columns in the `list("Size", …)` call; widen `SizeOption` to carry `sqmPerBox`, `sqftPerBox`, `boxWeightKg`.
10. `PalletForm.tsx`: delete the *Coverage / Weight (per box)* input section; render those three as read-only, sourced from the picked Size. On save, snapshot them into the payload.
11. `Pallets.tsx`: no column change needed (coverage column keeps rendering).

**Phase E — verify**
12. Item creation picker still lists sizes ([DesignForm.tsx:76](client/src/features/masters/DesignForm.tsx#L76)) — the `code` label is unchanged, so this keeps working untouched.
13. Smoke: create a size → pick it in a new pallet → confirm all six per-container totals; then pick it in a new item.

---

## 6. What actually shipped

| Step | File | State |
|---|---|---|
| 7 columns on live `Size` (`69851000000041006`) | Catalyst | done — `remark` landed as varchar(255), Catalyst ignored the requested 1000 |
| Schema doc updated | `DATASTORE-SCHEMA.md` | done |
| Size API + formulas | `client/src/features/masters/sizesApi.ts` | new |
| Size form (3 read-only formula fields) | `client/src/features/masters/SizeForm.tsx` | new |
| Size grid | `client/src/features/masters/Sizes.tsx` | new |
| Nav leaf + `/sizes` route | `client/src/App.tsx` | done |
| Size dropped from Settings ▸ Masters | `client/src/features/masters/Masters.tsx` | done |
| Pallet coverage/weight now read-only, snapshot from Size | `PalletForm.tsx`, `palletsApi.ts` | done |
| Item form dims/pcs/weight read-only from Size | `DesignForm.tsx`, `designsApi.ts` | done |

Role gating needed no change: `Admin`, `Editor`, and `Viewer` all carry `features = ["*"]`, so the new `sizes` leaf is visible to everyone already.

**Not done:** smoke test, commit, deploy.

---

## 7. Backfill (deferred)

The 15 existing sizes have `tile_type`, `thickness_mm`, `pcs_per_packing`, `box_weight_kg`, `sqm_per_box`, `sqft_per_box` all null. Consequences until filled:

- Pallet form shows `—` for coverage/box weight and warns "This size has no packing data yet"; all five per-container totals compute to 0.
- Item form leaves Pcs / Box and Box Weight blank on a fresh size pick. **Existing items keep their own stored values** — the auto-fill only writes into blank fields.
- Pallets already saved keep their stored `coverage_sqm/sqft/box_weight_kg` snapshot and keep computing correctly. Only *re-picking a Size* on an old pallet would zero them.

Two ways to close it, decide later:
1. Operator opens each of the 15 sizes in Size Master and enters Pcs. per Packing + Box Weight (+ Type/Thickness). ~15 × 30s.
2. Hand over a CSV of `code, tile_type, thickness_mm, pcs_per_packing, box_weight_kg` and I bulk-write it, computing `sqm_per_box`/`sqft_per_box` per row.

Existing `Pallet` rows are a ready source for option 2 — each carries the real `coverage_sqm` and `box_weight_kg` for its size, so `pcs_per_packing` can be back-derived as `round(coverage_sqm / ((width/1000) × (length/1000)))`.
