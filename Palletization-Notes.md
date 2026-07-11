# How palletization may work (product-owner notes)

1. Pallet master is created based on the Design Sizes.
2. I receive an order for the design 800x800.
3. When I send to palletize, I get only those size options in the form.
4. Based on the order received (in boxes), my pallet has a fixed number of boxes.
5. The pallet master states how many pallets fit into a container.
6. From the boxes on the order and the selected pallet's details, a calculation shows how full a container is.
7. Example: my pallet is 800x800, 20 boxes per pallet. To fill a container 100%, I need 25 pallets.
8. Now I receive an order of 450 boxes. The calculation should hint whether I need another container, or whether my container has space to fit other boxes as well.
   - 8.1 For an extra container: show a list of already partially-full containers going to the same destination, so I can use one of them.
   - 8.2 For remaining space in a container: let me pick items from other ongoing orders.

## Design changes

1. On the order page, show boxes with a completion indicator. Also create a separate page showing current container availability (needs a good name).

## Issues (item master / grids)

| # | Issue | Status |
|---|-------|--------|
| 1 | SKU present but not shown in the grid and item left panel | ✅ done — SKU shown in grid + detail |
| 2 | Image upload: single upload, 5-button; fix error 4.1.3 | ✅ done — filename preserved + progress (`27fc9ac`) |
| 3 | Hide PO number in Item Details | ✅ done — column hidden (`ItemDetail.tsx:487`) |
| 4 | Rename "Continue" → Active/Inactive everywhere, incl. database | ✅ done — `Design.status` renamed + migrated 2026-07-06 |
| 5 | "Mark as Continue" click — image button | open |
| 6 | Item remove | open |
| 7 | Global search bar in place of Item > Item menu; remove such submenus everywhere | open |
| 8 | Multi-selection filter form, same as Zoho transactions | ✅ done — advanced-search modal on all grids |
| 9 | Orderable field selection in all grids (move columns up/down, persist) | ✅ done — `useColumns` + ColumnPicker standard |
| 10 | Created/modified date-time in grids + audit table for all create/update | ✅ done — Created/Modified columns (default-hidden) + `OperationLog` audit |
| 10.1 | Creation/modification dates on all grids and detail pages | ✅ done |
| 11 | Puvi fonts everywhere | ✅ done — Puvi-only, self-hosted (`e0370f7`) |
| 12 | Label vs value color too contrasting — make labels a bit darker | ✅ done — uniform form/grid design pass (`edf8b82`) |
| 13 | Item name on item detail should look bigger; apply everywhere | open |
