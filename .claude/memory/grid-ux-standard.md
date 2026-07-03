---
name: grid-ux-standard
description: "Every list grid needs footer pagination (25 default, persisted), column show/hide, and wired basic-field filters"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9e7f82ea-8a56-4661-b348-2053151d6821
---

Every list/grid page must ship with: (1) **footer pagination** — record counts "x–y of z", Prev/Next + windowed page-number buttons, page-size select with options 10/25/50/100, default 25, chosen size persisted per user (localStorage key `<page>PageSize`); (2) **column show/hide** via `ColumnPicker` + `useHiddenColumns("<page>TableColumns")` from `client/src/ui/ColumnPicker.tsx`; (3) **basic-field filters** — a wired search box plus a generic "Filter by…" field+value pair (values derived from live rows; see Parties.tsx `FILTER_FIELDS`); (4) **header-click sorting** via `useSortRows` + `<SortTh>` from GridFooter.tsx (click = asc, click again = desc, ▲/▼ indicator); (5) **no duplicate counts** — record counts appear ONLY in the footer, never as "N rows" in the filter bar or "X of Y" in the page subtitle. See [[pick-lists-db-sourced]] for filter option sourcing.

**Why:** User mandate (2026-07-03), modeled on the Design Master / item master page; grids without pagination or field toggles don't scale past a few dozen rows.

**How to apply:** Reuse `usePagination` + `GridFooter` from `client/src/ui/GridFooter.tsx` (footer sits inside the `.card` below the table's overflow wrapper; tbody maps `pager.slice(filtered)`; filter changes reset to page 1). Copy the column-gating pattern from `client/src/features/stages/PurchaseOrders.tsx`. Any NEW grid added to the project must follow this standard from day one.
