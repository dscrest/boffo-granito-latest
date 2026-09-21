# Walkthrough fixes — 2026-09-19

> **Status 2026-09-19:** built as CR-209…218 (see `docs/CHANGE-REQUESTS.md`). Deployed LIVE 2026-09-19,
> `/renumber-loads` run (001…016); commit pending. Form-driven re-drive (create paths) still to do.

Handoff for a fresh session. Source: a real-browser drive of LIVE as admin, new customer →
new item → quote → convert → production → allocate → palletise → load → dispatch, all
through the forms. Nothing below is fixed yet. No code was changed by the drive.

Test records left on LIVE (all reachable from SO/2026-27/152): customer CUS-00022
"ZZT Walkthrough Tiles LLP", item "ZZT WALK MARBLE - 600x1200 - Carving" (Design
69851000000288011), QT/2026-27/034, SO 69851000000292122, batch B/2026-09/001,
PAL/2026-27/024, LoadBox 69851000000299124 (Dispatched — API cannot delete it; teardown
needs `DELETE FROM LoadBox WHERE ROWID = …`), Vehicle GJ-03-ZZ-9999. Use them to verify.

How to drive: memory `boffo-e2e-test-drive` (mint AuthSession by ZCQL, inject
`localStorage.boffo_auth`, reload). Delete the AuthSession row afterwards.

House rules that apply to every item: CR template + 4-place docs update
(`docs-system-and-cr-register`), next free number is **CR-209**; consistency sweep for
siblings; reuse shared components; deploy/commit only when the user says so.

---

## A · Defects (fix first)

### A1 · Every loading is numbered LOAD/2026-27/001
- **Where:** `nextLoadNumber`, [functions/data-ops/index.js:3021](../../functions/data-ops/index.js#L3021).
- **Cause (verified by query):** ZCQL's LIKE wildcard is `*`. The code uses `%`, the scan
  returns 0 rows, max stays 0, every loading mints `001`. 16 live LoadBox rows share it.
- **Fix:** `LIKE '${prefix}*'`. The `startsWith(prefix)` filter already guards the parse.
- **Data:** the 16 duplicates need renumbering (by CREATEDTIME, oldest = 001). **Ask the
  user first** — printed Dispatch Copies may already carry 001. One-off admin route in the
  style of `/backfill-line-pallets`, or a ZCQL script.
- **Verify:** create two loadings → 017, 018 (or 002… after renumber); `/loading` rail shows distinct codes.

### A2 · Auto batch number has the same wildcard bug (latent — not reproduced)
- **Where:** `nextBatchNumber`, [index.js:2067](../../functions/data-ops/index.js#L2067).
  Also `batchSeriesSettings.clean` strips `%` and `_` — it must strip `*` too once the wildcard changes.
- **Effect by code reading:** Production sheet inline output (blank batch) mints
  `B/YYYY-MM/001` every time for the same item+month; blank entries are exempt from the
  duplicate guard, so two production runs silently merge into one batch.
- **Fix:** same one-character change. **Sweep:** `grep -n "LIKE" functions/` — the comment at
  index.js:3769 already notes "ZCQL LIKE doesn't match here", i.e. this was hit before.
- **Verify:** sheet-edit Produced on the same item twice in one month → 001 then 002.

### A3 · Loading detail shows Order(s) "—" and Customer "—" with items loaded
- **Where:** `soHeads`, [LoadingDetail.tsx:128](../../client/src/features/stages/LoadingDetail.tsx#L128);
  fields at :247-248. Heads resolve only through the `orders` cache.
- **Seen:** right after creating the loading for a same-session SO. Loaded Items table below
  showed the order + customer correctly (the line rows carry them).
- **Fix:** fall back per field to the loaded lines' own order number / customer when the cache
  has no head (same fallback order the Loadings grid uses, CR-174). Reproduce first — confirm
  whether it is only a stale cache.

### A4 · To Produce says "No brand" while the SO has a Box Brand
- **Where:** [ToProduce.tsx:41](../../client/src/features/stages/ToProduce.tsx#L41) —
  `brands.find(x => x._id === b.boxBrandId)?.name || "No brand"`; id comes from
  [ordersApi.ts:169](../../client/src/features/orders/ordersApi.ts#L169).
- **Seen:** SO box_brand = Boffo Granito, row read "No brand 640"; the Record New Production
  form opened from that row prefilled "Boffo Granito" correctly — so the id is present and
  the name lookup (or `useBoxBrands` load timing) is what fails. Compare with how
  ProductionForm resolves it and reuse that.

### A5 · SO detail stays "In Loading" after Dispatch until refresh
- Dispatch on `/loading/:id`, then open the SO in the same session → chip "In Loading";
  reload → "Dispatched". The orders cache is not invalidated by `/load-box-dispatch`.
- **Fix:** invalidate/refresh the orders cache in the dispatch success path (check what
  `refresh()` in LoadingDetail covers; siblings: row "+" Dispatch on LoadingBay).

---

## B · Users get blocked (no reason shown / action hidden)

### B1 · Accepted quote has no visible Convert button
- **Where:** [QuoteDetail.tsx:382](../../client/src/features/quotes/QuoteDetail.tsx#L382) — only in More.
  Header at :523 (`status === "Accepted"`) renders Reject alone.
- **Fix:** primary header button "Convert to Sales Order" when `canConvert`
  (Accepted / PartiallyConverted), same place Mark As Sent / Accept sit. Keep the More entry.

### B2 · Record New Production — Batch No. required but unmarked
- **Where:** [ProductionForm.tsx:141](../../client/src/features/stages/ProductionForm.tsx#L141) label,
  :167 placeholder, :85 validation.
- **Fix:** red asterisk on the Batch No. header (form-ux-standard); placeholder to the live
  format `e.g. B/2026-09/001`. **Ask the user:** should blank = auto-number for batched items
  here too (server already mints when blank)? That removes the block entirely.

### B3 · "Send to Palletization" greyed with no reason
- **Where:** [OrderDetail.tsx:708](../../client/src/features/orders/OrderDetail.tsx#L708) (`title` empty when disabled).
- **Fix:** `title` = the reason ("Allocate stock first" / "Nothing left to palletise" …), the
  MoreMenu greyed-with-reason pattern. When the SO chip reads "Stock ready — allocate",
  surface **Allocate Stock** as a visible button on the Items card, not only in More.

### B4 · "Send to Loading" / "New Loading" enabled with nothing to load
- Same card, :719. On a fresh SO (0 produced) both are clickable; after full dispatch
  "New Loading" is still enabled. Gate on ready/loadable boxes with a reason tooltip.
  Check `dispatchGate`-style shared predicate before writing a new one.

### B5 · "Mark as Sent" stays the primary SO button through Dispatched
- Seen on SO/2026-27/152 in status Dispatched. Decide with the user what it means post-approval;
  at minimum it should not be the primary action on a finished order.

### B6 · To Produce is an unlabeled icon
- **Where:** [ProductionTable.tsx:577](../../client/src/features/stages/ProductionTable.tsx#L577) — 4 icon-only view toggles.
- **Fix:** text label on the To Produce toggle (or all four). Check the shared ViewToggle
  first — uniform-control-aesthetics applies; do not one-off.

### B7 · Convert / SO form — silent required field, wrong-size pallets
- Save without PO Number only reddens the input; no message. Add the form's standard inline error.
- Pallet Combobox on a 600x1200 line offered `600x600 - [44 * 23] = 1012 - Junglee`. Find the
  option builder for the SO form's pallet cell and filter by the line's size (PalPlanForm's
  `opts` already does "No matching pallet" — reuse that filter).

---

## C · Polish (batch together, low risk)

| # | Where | Issue |
|---|---|---|
| C1 | QuoteForm line items ([QuoteForm.tsx:420](../../client/src/features/quotes/QuoteForm.tsx#L420)) | Rate has no unit and is not prefilled from the item's rate. Typed 450 (item's Rate/m²) → totalled per box (640 × 450). Convert form labels Qty "(boxes)"; quote form does not. **Ask user** which unit the quote rate is. |
| C2 | OrderDetail Details card | PO Number (required on the form), payment term, currency, addresses, totals not shown. QuoteDetail shows all of these — detail-page-consistency. |
| C3 | QuoteDetail | Shows "Port of Discharge" but the quote form has no such field. |
| C4 | DesignForm | Rate / ft² does not fill when Rate / m² is typed (or vice versa). |
| C5 | App-wide copy | "Palletization" vs "Palletisation" mixed (nav/page titles vs "+" menu, SO chip, modal). Pick one — ask user. |
| C6 | /loading Sheet | Status codes IL / RFL / DSP have no legend or tooltip check (`codeOf`, CR-152). |
| C7 | /packing | After Start Palletisation the row vanishes; toast should say "Moved to In Palletization". |
| C8 | New Loading step 1 | No "load all ready" shortcut when the SO has no container plan; customer with 0 ready listed in the rail. |
| C9 | PalletiseModal footer | Info summary ("640 boxes · 1 item → In Palletization") is rendered in error red. |
| C10 | Customer form | Shipping Country stays editable while "same as billing" locks the other shipping fields. Currency / Payment Term / Sales Person are native selects, not Combobox (form-ux-standard). |
| C11 | QuoteDetail status buttons | A fast second click on Mark As Sent / Accept fires a second request → 409 toast "Cannot move quote from Sent to Sent". Keep `busy` until the refetch lands. |
| C12 | ItemDetail | Activity is empty after create (no "Created" entry); Unit shows "—". |

---

## Not covered by the drive — worth a second pass

Non-admin role (Draft → PendingApproval → Approvals loop, role-hidden menus), partial
palletise + Partial/Recorded chips, Top Up Batch, multi-SO container, Fill from plan,
Loading Sheet tab edits, Panel Craft, Excel import.

## Suggested order

A1 + A2 together (one deploy, then the renumber decision) → B1, B2, B3 (the three hard
stops for a new user) → A3, A4, A5 → B4–B7 → C as one batch. Then re-run the drive and
update `docs/USER-FLOW.md`, which currently documents the workarounds (Convert under More,
Batch No. required, To Produce icon).
