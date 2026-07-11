# Plan — Master/Order forms round 2

Status legend: 🟢 net-new · 🟡 small change to existing · ✅ already exists (verify only)

**Round-1 build status (all 5 done):**
- #1 ✅ done — SO number is now a link to the Master Order (list + detail).
- #2 ✅ done — dashboard already matches the screenshot (verified; no change).
- #3 ✅ done — salesperson defaults to the rep linked to the logged-in user.
- #4 ✅ done — already existed on OrderDetail; relabeled to "Send to Palletisation".
- #5 ✅ done — shipped **without** new DB columns: size comes from the Size picker and persists
  as the existing `pallet_size_label`; pallet types are the distinct `pallet_type` values
  (creatable Combobox, no PalletType table). Auto-name + no-required shipped as planned.

> **2026-07-11:** this round is complete. Later rounds are planned per-batch in
> `docs/plans/` and `docs/superpowers/plans/`; shipped work is recorded in `docs/CHANGES.md`.

---

## 1. Clickable SO link on the quotes page  🟡
**Decision:** make the existing SO number a link to its Master Order (not a new create action — conversion already lives on QuoteDetail via "Convert to Master Order" + `ConvertDialog`).

- The SO column already renders `q.soNumber` in `quotes/QuotesTable.tsx` (~line 183-209) and on `quotes/QuoteDetail.tsx` (~line 55).
- Change: when `soNumber` is set, render it as a `Link`/click handler that navigates to the linked order (`/orders` filtered to that SO, or the order detail/drawer).
- Need: a way to resolve `soNumber` → order id. Quote API already joins SalesOrder; confirm the order id (ROWID/order_number) is available on the quote row, else add it to the join in `quotesApi.ts`.
- Files: `quotes/QuotesTable.tsx`, `quotes/QuoteDetail.tsx`, maybe `quotes/quotesApi.ts`.

---

## 2. Dashboard cards — visual polish to match screenshot  🟡
**Decision:** styling only, keep current structure.

- `dashboard/Dashboard.tsx`. "Ready to Load Today" (~line 209-284) is already a table with the exact columns. "Production Progress" (~line 286-318) stays a progress-bar list.
- Match to screenshot: SIZE rendered as a bordered chip (teal = valid, **red = flagged/mismatch**), status badge colors (Packing = purple, Loading = teal), header right-side pill ("Dock N active") + "View all" button.
- Mostly CSS in `styles/styles.css` + minor markup for the size chip + red-flag rule. Confirm what makes a size "red" (e.g. size not in Size master / mismatched against design).
- Files: `dashboard/Dashboard.tsx`, `styles/styles.css`.

---

## 3. Salesperson auto-selected from login  🟡
- Identity is available client-side: `storedAuth()?.user.rowid` (`lib/auth.ts`). SalesPerson rows carry `appUserId` (`masters/salespersonApi.ts`).
- Add a helper: `currentSalesperson(salesPersons) = salesPersons.find(s => s.appUserId === storedAuth()?.user.rowid)`.
- Use its name as the **default initial value** for `salesperson` in `OrderForm.tsx` and `QuoteForm.tsx` (only when not editing / field empty). Field stays editable.
- Files: `masters/salespersonApi.ts` (helper), `orders/OrderForm.tsx`, `quotes/QuoteForm.tsx`.

---

## 4. "Send to Palletisation" from Orders  ✅ (verify only)
- **Already exists.** `orders/OrdersTable.tsx` has a per-row "Palletize" action (~line 223) opening `PalletPackForm presetOrderId=…` (~line 116). `orders/OrderDetail.tsx` has "Palletize all" / "Palletize selected" with per-item selection — exactly "select items accordingly".
- Action: confirm this covers the ask. Optional tiny change: rename label "Palletize" → "Send to Palletisation" for consistency. No new logic.
- Files: `orders/OrdersTable.tsx`, `orders/OrderDetail.tsx` (label only, if desired).

---

## 5. Pallet master creation rework  🟢 (biggest item)
File: `masters/PalletForm.tsx` + `masters/palletsApi.ts`.

**5.1 / 5.2 — enter Width + Length only (pallet record only).**
- Replace the **Size dropdown** (FK to Size master) with two numeric inputs: **Width** and **Length**.
- Build the size label as `"{width}x{length}"`. Persist width/length on the Pallet row (new columns, e.g. `width_mm` / `length_mm`) — **do not** touch the Size or Design masters.
- Drop the `sizes` prop dependency for input (keep only if still shown elsewhere).

**5.3 — Pallet Type: create-on-the-fly master.**
- Today `pallet_type` is free text with a hardcoded datalist (`PALLET_TYPES`). Turn it into a real master:
  - New `PalletType` Data Store table + API (`listPalletTypes` / `createPalletType`) — mirror an existing simple master.
  - In the form, a combobox of existing types; if the typed value doesn't exist, show "Create '<x>'" which inserts it and selects it (persists to DB immediately).
- Files: new `masters/palletTypesApi.ts`, `PalletForm.tsx`.

**5.4 — Auto-generate Name.**
- Name becomes computed (read-only / auto-filled), formula:
  `` `${width}x${length} - [${boxesPerPallet} * ${palletsPerContainer}] = ${boxesPerPallet*palletsPerContainer} - ${palletType}` ``
  → e.g. `800x1600 - [30 * 18] = 540 - Junglee`.
- Recompute live as width/length/boxesPerPallet/palletsPerContainer/palletType change.

**5.5 — Remove mandatory.**
- Drop the required `*` and `missing`/`nameErr` gate on Name (it's now auto-derived). Submit no longer blocks on it.

**Open question for round 2:** the formula uses Arrangement A's `boxes_per_pallet` (30) × `pallets_per_container` (18). Confirm that's the intended pair (vs. boxes only).

---

## Rough order of work
1. #3 salesperson default (smallest, isolated) 
2. #1 SO link 
3. #5 pallet rework (needs the new PalletType table + width/length columns) 
4. #2 dashboard polish 
5. #4 verify/relabel only

Awaiting the second list before locking #5 details (formula pair, any extra fields).

---

# Item Master round — change-request spec 2026-07-04

Status legend: ✅ done · ⏳ blocked on a product-owner reference · 🔴 deferred/pending

| # | Item | Status |
|---|------|--------|
| 1 | Size & Status filters DB-sourced | ✅ (were already derived from live rows; Size filter unchanged — see open Qs) |
| 2 | Remove "Design Master" title | ✅ |
| 3 | "New Design" → "New Item"; Refresh removed | ✅ |
| 4 | Status defaults "Continue", locked at create, editable in edit | ✅ |
| 5 | 🧠 No negative numbers app-wide (input `min=0` + server 400 guard; `adjustment`/`qty_delta` exempt) | ✅ |
| 6 | Associate Pallets removed from creation AND edit (per follow-up; DesignPallet capability kept in designsApi) | ✅ |
| 7 | Accounting Stock removed from creation (kept in edit) | ✅ |
| 8 | Unique name (+ Party Brand append) · PartyBrand master table `69851000000060042` + Settings form + creatable combobox · server 409 + client pre-check | ✅ (no existing duplicates found in audit 2026-07-04) |
| 9 | 🧠 Pick lists standardized on Combobox: arrow nav + Enter + arrow-then-Space select + typable | ✅ item module; 🔴 sweep of remaining forms (Party/Order/Quote/Container/Pallet/stage forms) |
| 10 | "Save Design" → "Save" | ✅ |
| 11 | 🧠 Required `*` red everywhere (global `.req` rule in styles.css) | ✅ |
| 12 | Image upload removed from creation; Inventory Image Upload manager on item detail (Front/Rear/Other slots) | ✅ · 12.2 image reference at creation time ⏳ |
| 13 | Item detail: left shrunk name list + right panel, Edit/Delete top-left | ✅ · 13.2 Zoho Books field mapping ⏳ (stub rows on detail) |
| 14 | Detail shows Unique Name + SKU + primary details | ✅ · 14.3 remaining fields/layout ⏳ (screenshot ref) |
| 15 | SKU formula CONFIRMED & live 2026-07-04: `DesignShortCode-Size-Finish-Category-Glaze-Brand-Grade[-PartyBrand]` from stored `seq_code`s (PartyBrand segment only when set; "00" = unset). New Design "Short Code" field + seq_code on Brand/Grade/Design (Brand/Grade seeded alphabetically) | ✅ · 🔴 fill Short Codes per design + PartyBrand seq codes, then backfill existing NULL SKUs; server-side SKU uniqueness once codes are filled |
| 16 | Multi-select filter panel | 🔴 DEFERRED (per PO, do later) |

**SKU uniqueness note:** distinct designs legitimately share a classification
(8 designs are 600x1200·Glossy), so segment-only SKUs can't be unique. Server
uniqueness enforcement + backfill wait for the suffix format reference
(`NumberMaster` exists as the sequence source — don't build early).

**Project note (2026-07-04):** `boffo-latest-project` was deleted; live project is
`boffo-granito-export-tracker` (OCTFIS org). PartyBrand recreated there
(`69851000000060042`), seq_codes reseeded, design_images folder `69851000000059622`,
app deployed. See boffo-deploy-target memory.

**Open Qs for PO:** Size grid filter — show full Size master or only in-use
sizes (current)? Front/Rear image slots are positional (deleting Front makes
Rear the new Front) — OK, or need fixed view-type columns?
