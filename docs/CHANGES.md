# Changes

## 2026-07-08 — Item master + grid UI batch

Design/UI changes apply across every grid via shared surfaces (global CSS,
the shared `AdvancedFilter` and `ActivityLog` components).

- **Bold grid headers** — `.tbl th` font-weight 500 → 700 (all grids).
- **Un-clipped advanced-filter popup** — the magnifier "Search" modal no
  longer uses `.card` (`overflow: clip`); a new `.filter-modal` panel with
  `overflow: visible` lets the multiselect dropdowns and panel corners render
  fully. Fixes every grid's advanced filter.
- **Items grid** — removed the inline "All sizes" / "All statuses" selects;
  Size and Status remain filterable via the advanced (magnifier) filter. The
  quick-search box is now a single wide input with a leading magnifier icon
  (new `.gsearch` wrapper), matched on the Orders grid.
- **Activity log (all logs)** — timestamps render in the viewer's local time
  via new `fmtLocalDateTime`; the **Status** column was removed.
- **Preserve uploaded image filename** — `data-ops` `/upload/design-image`
  keeps the original filename (spaces/parens/unicode); strips only path
  separators and control chars. **Requires a `functions/data-ops` redeploy.**
- **Keep selection after edit** — saving an item edit now lands on that item's
  detail (`/design/:id`) instead of the grid list.
- **No refresh on the selected item** — status toggle and image save/delete on
  the item detail patch only the affected design in state + cache (new
  `ListCache.patch` / `patchDesignCache`) instead of `invalidate()` + full
  `listDesigns()` refetch; the list and scroll position stay put.

Notes: breadcrumbs were already removed (2026-07-06); no change needed. New
per-grid Filter options and adopting `.gsearch` on the remaining grids
(Parties, Pallets, Containers, Invoices, Quotes, Reports, SalesPersons, Users,
PurchaseOrders) are deferred.
