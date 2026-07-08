# Item Master + Grid UI Change Batch — Design

Date: 2026-07-08
Branch: feature/master-order-forms

Design/UI changes (bold headers, un-clipped filter popup, removed inline
size/status selects) apply across **every grid** via shared components/CSS.
Behavior changes are scoped to the Item master.

---

## A. Global CSS — affects every grid

### A1. Bold grid headers (req 6)
- File: `client/src/styles/styles.css`, `.tbl th` (~line 477).
- Change `font-weight: 500` → `font-weight: 700`.
- Single rule; every `.tbl`-based grid inherits it. No per-grid edits.

### A2. Un-clip the Advanced-filter popup (req 7)
- Root cause (confirmed): the modal panel is `className="card modal-panel"`.
  `.card { overflow: clip }` (styles.css ~line 379) clips the absolutely
  positioned multiselect checkbox dropdowns (`.hdr-menu`) and the panel's
  rounded edges. Not fixed dimensions, not padding — it is container overflow.
- Fix:
  - `client/src/ui/AdvancedFilter.tsx` `FilterModal`: panel className
    `card modal-panel` → `modal-panel filter-modal` (drop `.card` so its
    `overflow: clip` no longer applies).
  - `client/src/styles/styles.css`: add `.filter-modal` — same visual box as
    `.card` (background, border, border-radius 8px, box-shadow) but
    `overflow: visible` so child dropdowns render fully.
  - `.modal-body` inside the filter modal must not clip the dropdowns: for the
    filter modal, let the body grow (rely on `.modal-panel { max-height }` +
    backdrop scroll) instead of `overflow-y: auto` slicing popups. Keep the
    generic `.modal-body` unchanged; scope the override to `.filter-modal .modal-body`.
- Shared component ⇒ fixes the popup on every grid at once.

---

## B. Grid filter bars — Items + Orders (req 5)

Applies to grids that render the two quick-select dropdowns: `DesignMaster.tsx`
(Items) and `OrdersTable.tsx` (Orders).

- Remove the inline `<select>` "All sizes" / "All statuses" (and the Orders
  equivalents) from the `.fbar`. Delete the `sizeF` / `statusF` state, their
  options memos, and their predicate lines in `filtered`.
- Size and Status remain available in the Advanced (magnifier) filter — already
  present in `filterFields`; leave those entries.
- Re-flow the `.fbar`: the quick-search `<input>` fills the freed width and gets
  a leading magnifier icon (mirror the global-search look: relative wrapper +
  `Icon name="search"` absolutely positioned, left padding on the input).
- `usePagination` reset key must drop the removed `sizeF|statusF` segments.
- Breadcrumbs: already removed 2026-07-06 (App.tsx:368) — no action; note in
  the changelog.

---

## C. Activity Log — shared component, every log (req 3, 4)

File: `client/src/features/common/RecordDetail.tsx`, `ActivityLog`.

### C1. Remove Status column (req 4)
- Drop `<th>Status</th>` and its `<td>` chip cell.
- `colSpan={5}` on the empty-state row → `4`.
- The `ok` boolean is still needed (drives the Detail/Error cell color), keep it.

### C2. Local-time timestamps (req 3)
- Add to `client/src/lib/format.ts`:
  `fmtLocalDateTime(iso?: string)` — parse the server string to a `Date`
  (append `Z` when the string lacks a timezone so it is read as UTC), return
  `toLocaleString()` in the viewer's local zone; fall back to `—` / raw slice
  on unparseable input.
- Activity Time cell: render `fmtLocalDateTime(str(r.occurred_at) || str(r.CREATEDTIME))`
  instead of the raw string.
- Apply the same helper to any other activity-log time renderers found
  (OrderDrawer, QuoteDetail) so "all activity logs" show local time.
- Do NOT change the shared `fmtDateTime` — grid Created/Modified columns keep
  their current truncated display (dedicated helper avoids collateral changes).
- Memory: record "activity logs render timestamps in local time" as a standing
  convention.

---

## D. Item-master behavior

### D1. Preserve uploaded filename (req 1)
- File: `functions/data-ops/index.js`, `POST /upload/design-image` (~line 444).
- Relax `safeName`: keep the original filename (allow spaces, parentheses,
  unicode); strip only path separators and control characters
  (`/`, `\`, NUL / `\x00-\x1f`), and trim. Minimal-strip chosen over fully-raw
  for File Store safety.
- The tmp path already prefixes random bytes, so a preserved name with spaces
  is fine on disk. Upload call passes `name: safeName`; response echoes it.

### D2. Keep selection after edit (req 2)
- File: `client/src/features/masters/DesignEdit.tsx`.
- On successful `updateDesign`: `navigate('/design/${id}')` (item detail) instead
  of `navigate('/design')` (the list).
- Patch the edited row into the designs cache so the detail renders the new
  values without a full refetch (use the D3 helper / existing invalidate as the
  backstop, but the cache should already reflect the update).

### D3. Do not refresh the selected item (req 2 + design note)
- File: `client/src/features/masters/ItemDetail.tsx`.
- `onToggleStatus`, `saveImages`, `deleteAt`: replace the
  `invalidateDesigns()` + full `refresh()` (`listDesigns()`) with an in-place
  patch of the single design in local `designs` state, and mirror that patch
  into the designs cache.
- Add `patchDesignCache(id, patch)` (or equivalent) to
  `client/src/features/masters/designsApi.ts` that updates the cached
  `DesignRow` in place and notifies subscribers, without a network round-trip.
- Result: status/image changes update only the affected item; the list, the
  selected item, and scroll position stay put.

---

## E. Docs & memory (req 3 "add to memory")

- Update the project changes-&-plans doc with this batch.
- Memory entries:
  - `activity-log-local-time` (reference/convention): all activity logs render
    timestamps in the viewer's local time via `fmtLocalDateTime`.
  - Note this batch under the master-page UI convention memory.

---

## Out of scope / deferred

- New per-grid Filter options UI (req 5 "we will add Filter options. But later").
- Any grid that has neither size/status selects nor the Advanced filter is
  untouched except by the global CSS (bold headers).

## Verification

- Bold headers visible on Items, Orders, Activity Log, and one more grid.
- Advanced-filter popup: open on Items, expand a multiselect — dropdown and
  panel corners render fully, nothing clipped; check a narrow viewport.
- Items/Orders filter bar: no size/status selects; wide search input with
  magnifier; Size/Status still filterable via magnifier.
- Activity Log: no Status column; timestamps in local time.
- Upload an image named `my photo (front).jpg` → stored name preserved.
- Edit an item → lands on its detail, item still selected, values updated,
  no list flash.
- Toggle status / add image on an item → only that item updates, no full reload.
