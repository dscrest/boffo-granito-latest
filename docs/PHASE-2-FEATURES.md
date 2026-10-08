# BOFFO Order OS — Phase 2: what has been built

**Period:** 1 October 2026 → (open) · **Change requests:** CR-261 … · **Status:** running inventory, updated as each request ships

This is the plain-language inventory of Phase 2, in the same shape as `PHASE-1-FEATURES.md`: what each
part of the system gained, and the hours. The technical reference is `SYSTEM.md`; the request-by-request
history is `CHANGE-REQUESTS.md` (Phase 2 heading). Phase 1 figures are frozen and never re-estimated.

---

## Summary

| # | Module | Phase 2 so far | Effort recorded (h) | Conventional build (h) |
|---|---|---|---|---|
| 1 | Foundation & workspace | Discard prompt is a Yes / No question; delete asks for a reason (Admin exempt); Zoho-style label-left layout on every form page, tightened (label gap, one-control-wide rows, notes boxes) | 9 | 28 |
| 2 | Masters (Inventory) | Container Master; Pallet Master boxes only | 8 | 25 |
| 3 | Customers | — | 0 | 0 |
| 4 | Quotes & Approvals | Suitable Containers panel; planner picks the container per item row, narrowed by pallet; Customer search modal | 8 | 27 |
| 5 | Sales Orders | Remaining + totals, per-item Deallocate, partial deallocate with always-visible stock buttons, worked order not deletable | 5 | 16 |
| 6 | Production | Bulk sheet reorder, Date-first grid and detail | 4 | 12 |
| 7 | Palletization | Date column, PAL code hidden | 1 | 2 |
| 8 | Loading & Dispatch | Date column, LOAD code hidden; several containers per New Loading, each with its own vehicle | 5 | 14 |
| 9 | Stock & batch ledger | Inventory adjustments (Stock Adjustments page + sheet, reasons master, every stock reader adjustment-aware) | 2 | 6 |
| 10 | Reports & audit | — | 0 | 0 |
| 11 | Panel Craft | Add Stock wording; row-click grid + Photo \| Grid view; PANEL-001 numbering; New / Edit Panel as a page; Request Panels from Quote / SO (New Request stage); Panel Order page with status steps + requirements checklist; full-size cut piece default; one image per panel; BOFFO loader on image upload; Panel Items with weighed cut pieces; Cut Stock as cut-piece items + bulk Add / Adjust sheets + ledger; MDF master + per-line MDF and auto weight; picker filters; Panel Craft dashboard; cut-piece booking per order (Dispatch = fully booked); MDF / Vinyl / Cut Pieces checkpoints + readiness; Pending Cut Stock page; Sample Orders (separate order type, per-line supply, cut-stock deduction, Request Samples, Customer Samples section) | 18.5 | 56 |
| 12 | Documentation & process | Phase 2 inventory, register, schema, Data Flow reference | 3 | 9 |
| | **Total** | | **≈ 61.5** | **≈ 188** |

Hours follow the Phase 1 method (recorded ≈ actual sessions; conventional ≈ 3×, rounded).

---

## 1 · Foundation & workspace

- **Discard changes?** (CR-268, 2026-10-03). Leaving a form or an edit mode with unsaved changes asks a
  plain Yes / No question ("Yes, discard" / "No, keep editing") on every screen; it no longer says Delete.
- **Delete asks why** (CR-270, 2026-10-03). Deleting anything first asks for a reason, and the delete only
  goes ahead once one is typed. Admin is exempt and sees the plain confirm. The reason is kept on the
  record's activity log, and the server refuses a non-admin delete that arrives without one.
- **Forms laid out like Zoho Books** (CR-275, 2026-10-06). Every create / edit form page — Quote, Sales
  Order, Item, Pallet, Container Master, Customer, Production, Palletization, New Loading — puts the label
  on the left and the control on the right, two fields per row, instead of a long run of label-above
  boxes. The Customer sits on its own full row with Billing | Shipping under it, then a divider, then the
  dates and terms. Narrow screens stack the label above again. Dialogs are unchanged.
- **Form rows tightened** (CR-277, 2026-10-06). The label now sits right beside its box instead of a fixed
  distance away; fields that have a row to themselves (Customer, Name, Remarks) keep the same box width as
  every other field instead of stretching across the page; and every Remarks / Note field is a multi-line
  box about three lines tall.

## 2 · Masters (Inventory)

- **Container Master** (CR-261, 2026-10-03). A new master under Inventory, after Pallet Master. A
  record says what one container of a size holds: which pallet formats and how many of each; total
  pallets and total boxes follow (one per size at first; several since CR-273, lines since CR-269). Pick the size, add the pallet lines, Save. Grid, form
  page, detail page with Clone and Delete, activity log.
- **Container name shows the pallet maths** (CR-292, 2026-10-07). The auto-name reads
  `800x1600 - GVT - 2 · [(48*10) + (10*6)] = 540 boxes`: one term per pallet line, then the box total.
- **Several containers per size; the loading picks one** (CR-273, 2026-10-06). A size may have any
  number of containers (different pallet mixes). New Loading and the Load dialog have a Container
  field; the fill % of that loading follows the chosen container. Nothing picked, or the planner and
  the quote's Suitable Containers, use the size's largest container; Suitable Containers lists every
  container of the size.
- **Pallets as lines** (CR-269, 2026-10-03). The container form adds pallets the way a quote adds line
  items: pick the pallet format, type how many fit, Add line for the next format of that size, ✕ to
  remove. A pallet already on a line is not offered again; Add line stops when every format of the size
  is on a line.
- **Pallet Master is "boxes only"** (CR-261). A pallet format is boxes per pallet, the empty pallet weight
  and the loaded pallet weight. The old "pallets per container" field and the per-container totals are gone
  — a container's capacity is the Container Master's job.
- **Capacity everywhere comes from the Container Master** (CR-261): the fill % on loading and
  palletization and the container planner's box fitting use the size's container. A size with no container
  yet shows no fill % and the planner says so.

## 4 · Quotes & Approvals

- **Suitable Containers** (CR-262, 2026-10-03). New / Edit Quote and the Quote page show, per size on the
  quote, the container it fits, the boxes quoted, how many containers that needs and how full the last one
  is. On screen only for now (not on the print, PDF or share link).
- **Planner picks the container per size** (CR-274, 2026-10-06). In Plan Containerisation (Box Fitting) a
  strip beside the Box / Weight toggle shows one picker per tile size on the plan, listing that size's
  containers from the Container Master. Default is the size's largest, so old plans open unchanged;
  changing it repacks every container of that size. The pick is saved with the plan, the Container
  Planning tab names each container's format, and a loading made from the plan (New Loading from the
  order, Fill from plan, Load dialog) starts on that container until the user picks another.
- **Container picked on the item row** (CR-300, 2026-10-07). The picker moved from the toolbar strip to a
  Container column right after Pallet Type on every planner row. A row lists only the containers of its
  size built from the pallet chosen on that row (none → all of the size); the default is the largest of
  those. Each row has its own pick, so two items of one size can pack into different containers.
- **Customer search** (CR-276, 2026-10-06). A magnifier beside the Customer field on the Quote, Sales Order
  and New Palletization forms opens a searchable customer table (name, code, country, currency, sales
  person, payment term). Click or Enter on a row picks it and the form fills in exactly as the dropdown
  does. The dropdown stays for quick typing and now shows code · country.

## 5 · Sales Orders

- **Remaining and totals** (CR-263, 2026-10-03). The Items table shows Remaining = Ordered − Allocated and
  a totals row.
- **Deallocate Stock** (CR-263). A ✕ on each allocated line (and "Deallocate Stock" in More) lists that
  line's allocations by batch; each can be returned to free stock, unless its boxes are already palletized.
  Stock Details and the batch ledger follow.
- **Deallocate part of an allocation** (CR-297, 2026-10-07). Each allocation row has a Return box
  (default the whole row, capped at what is not yet palletised) — "5 of 520" returns 5 and leaves 515
  allocated; the confirm spells out the split. Allocate Stock and Deallocate Stock now always sit side
  by side on the Items card, greyed with the reason when not applicable; the Production tab's button
  opens the same window. ≈ 1.5 h.
- **Item STOCK card itemises on-hand** (CR-298, 2026-10-07). An Awaiting palletization row (boxes an
  order owns that are not on a pallet yet) sits between In production and In loading, each with a
  per-order drill-down, so Available stock adds up on screen. Also fixed the In loading drill-down,
  which always came up empty. ≈ 0.5 h.
- **"Palletized" chip; Ready for Palletization is the queue only** (CR-299, 2026-10-07). The chip on a
  recorded slice reads Palletized instead of Recorded, and the Ready for Palletization page has no
  All option, so palletized rows show only under In Palletization and Ready for Loading. ≈ 0.5 h.
- **A worked order cannot be deleted** (CR-271, 2026-10-03). Once any line has stock allocated, boxes
  palletised, loaded or dispatched, or sits on a palletization plan, Delete is greyed out on the order
  page and refused by the server with "Cancel it instead" — the same rule the order form already applied
  to removing a line.

## 6 · Production

- **Bulk Record Production** (CR-264, 2026-10-03). Columns Size · Design · Batch · Box Brand · Qty ·
  Remark; the Size narrows the item list; the toolbar date is the production date for every row (a per-row
  Date column can be shown); "+ 10 rows" button.
- **Date first** (CR-265). The production grid opens grouped by date and hides the Production ID (one
  tick to show it); the production page is titled by its date with the PRD number in small print.
- **Bulk Record Production is the default button** (CR-267). Start New Production is the secondary one.

## 7 · Palletization

- **Date column, PAL hidden** (CR-266, 2026-10-03). The palletization grids show the date a line entered
  palletization instead of the PAL code (still available in the column picker).
- **Each page shows its own rows** (CR-278, 2026-10-06). Ready for Palletization opens on the queue; In
  Palletization opens on its own rows plus the recorded, not-yet-loaded ones (Load in their "+" menu).
  "All" remains in the dropdown as the overview. Before this both pages opened on All and looked identical.
- **Ready Pallets + Pallet columns** (CR-279, 2026-10-06). Ordered and Completed left the palletization sheet.
  Ready Pallets shows the item's palletized boxes as pallets with boxes in brackets, e.g. `8 (480)`; Pallet
  shows the pallet type (Jungli …) rather than the full size-packing-type name. The footer sums the same way.
- **Complete dialog shows progress** (CR-280, 2026-10-06). Complete Palletization lists, per item, the ready
  pallets (boxes) already palletized and the boxes still remaining.
- **Partial Complete re-queues the rest** (CR-281, 2026-10-06). Completing part of an In-Palletization line
  sends the leftover boxes back to Ready for Palletization, where Start Palletization applies to them again.

## 8 · Loading & Dispatch

- **Date column, LOAD hidden** (CR-266). The loading sheet and the Loadings grid show the loading's date
  instead of the LOAD code (still available in the column picker).
- **Several containers in one New Loading** (CR-301, 2026-10-07). One section per container, each with its
  own Container Master pick, item rows and vehicle details; stock shared across sections so an item can be
  split between containers; Fill from plan fills one container at a time; one Save creates the linked
  loadings. ≈ 4 h.

## 9 · Stock & batch ledger

- **Inventory adjustments** (CR-308, 2026-10-07). Inventory ▸ Stock Adjustments lists every box-stock
  correction (date, item, batch, ± boxes, reason, note, who); New Adjustment is a bulk sheet — date and
  reason (from the new Adjustment Reason master) in the bar, rows of Item · Batch · Add / Remove · Qty.
  A removal never goes below what is physically on hand and warns when it eats into boxes a sales order
  reserved. Stock Details, the Item STOCK card, the stock reports, batch pickers and allocation all
  include adjustments; the Item detail Production tab lists them with an Adjust chip.

## 11 · Panel Craft

- **Add Stock** (CR-282, 2026-10-06). The cut-piece stock button and dialog say Add Stock instead of
  Update Stock.
- **Panels grid opens the record; Photo | Grid view** (CR-283, 2026-10-06). No pencil or bin on the rows
  and no Edit / Clone icons in the toolbar — click a row or a tile to open the panel, where Edit and
  More ▸ Clone / Delete live. Panels opens as photo tiles (the same tile as the panel picker) with a toggle
  to the column grid. Cut Stock rows open the prefilled Add Stock dialog; the Panels tables on Item and
  Customer detail click through. This is now the rule for every grid in the app.
- **Panel numbers** (CR-284, 2026-10-06). A new panel is numbered `PANEL-001`, `PANEL-002`… by the server;
  the Panel Code box is gone. Edit keeps the number, Clone gets a new one.
- **New / Edit Panel is a page** (CR-285, 2026-10-06). The Panel form is a full page in the Zoho-style
  label-left layout like every other form; the modal is gone.
- **Request Panels from a Quote or Sales Order** (CR-286, 2026-10-06). More ▸ Request Panels on the Quote
  and Sales Order pages opens the New Panel Order page with the customer locked and the panels that carry
  that sale's designs already picked. Saved rows land in Panel Orders as **New Request** — a new first
  stage before Received — and Panel Craft accepts them with one button. The Quote / SO page gains a Panel
  Orders tab, and every stage change of the request shows on its Activity.
- **Panel Order page; status changed only there** (CR-287, 2026-10-06). Clicking a row or card opens
  `/panel-orders/:id`: status chip, the next-step buttons (Accept / Start Cutting / Ready / Dispatch),
  Edit, More ▸ Delete, Overview | Activity. The grid and kanban no longer carry stage buttons; the sheet is
  a column-picker grid with Stock and Source columns.
- **Requirements checklist** (CR-288, 2026-10-06). The order page lists every design × cut piece size the
  order needs with Need, In Stock and a manual Available tick that is saved on the order. Missing pieces
  are called out in amber on the page, in the sheet's Stock column and on the card. This replaces the
  godown print slip.
- **Blank cut piece size means full size** (CR-289, 2026-10-06). A panel line saved without a cut piece
  size takes the design's own size (server rule). The form half — not dropping such lines and showing
  "Full size — 800x1600" as the placeholder — is pending.
- **New Panel Order is a page** (CR-290, 2026-10-06). Label-left layout with the Customer search modal;
  the modal form is gone.
- **One image per panel** (CR-291, 2026-10-06). The panel page carries a single Image tile; Rear View,
  Other Images and the five-image counter belong to the Item master only.
- **Upload shows a BOFFO processing state** (CR-293, 2026-10-07). While an image uploads, the Item /
  Panel tile shows the animated BOFFO wordmark with "Uploading…" instead of a stray glyph and a
  truncated phone filename. The same loader runs on the Box Brand logo tile and the sign-in check.
- **Every panel order is born "New"** (CR-294, 2026-10-07). The first stage (`NewRequest`) is labelled
  "New" and every order starts there, direct or from a Quote / SO; Accept moves it to Received.
- **Stock column reads Available / Unavailable** (CR-295, 2026-10-07). Replaces Covered / Short · n on
  the Panel Orders sheet; the missing pieces stay in the tooltip.
- **Item detail hides the Panels tab** (CR-296, 2026-10-07). Overview | Production only; Customer
  detail keeps its Showcase Panels section.
- **Panel Order = header + lines, like a Sales Order** (CR-302, 2026-10-07). One customer order holds
  several showcase panels (Panel + Qty lines), numbered `PNL/2026-27/NNN`; the form is the SO shape
  (Order Details + Panels table with Add panel / Pick from showcase + stock check across lines), the
  detail the SO shape (Items card, Requirements summed across lines, Edit / Clone / Delete — Edit and
  Delete only while New / Received). Ready / Dispatch move the pieces of all lines at once. Grid, board,
  Quote / SO Panel Orders tab, Panel detail and Customer section show one row per order.
- **Requirements rows name their panels** (CR-303, 2026-10-07). A Panels column on the order's
  Requirements checklist lists the panels each design × cut size serves and each one's share
  (`PANEL-001 ×1 · 456 ×2`); the form's stock check shows the same.
- **Panel Order form: Pick from showcase only** (CR-304, 2026-10-07). The blank-row Add panel button is
  gone; the tile picker (multi-select, one Done) is the only way to add panels.
- **Requirements card without the "Short:" sentence** (CR-305, 2026-10-07). Short rows show a red In
  Stock figure; the shortfall text stays on the status chip and Dispatch button tooltips.
- **Panel Items** (CR-306, 2026-10-07). The designs picked from the Item master into Panel Craft, each
  with its cut pieces underneath: add, weigh (pre-filled from the tile's weight per piece and the cut's
  face share), remove. Add Item pulls a design in with its full-size piece. The Panel form offers only
  these items and their cut pieces.
- **Cut Stock as cut-piece items + bulk Add Stock + ledger** (CR-307, 2026-10-07). One row per cut piece
  with image, size, weight per piece, on hand and stock weight; Add Stock is a dated bulk sheet (the
  modal is gone); every movement is kept in a dated ledger shown as Stock History on the item.
- **Adjust Stock for cut pieces** (CR-308, 2026-10-07). The same adjustment sheet, reason mandatory,
  never below on hand.
- **MDF master + per-line MDF + auto weight** (CR-309, 2026-10-07). MDF (Size · Thickness · Weight) in
  Settings ▸ Masters; each panel-order line picks its MDF and shows Weight = cut pieces × weight + MDF,
  × qty; order total on the form and the detail.
- **Pick from showcase filters** (CR-310, 2026-10-07). Design · Panel Size · Cut Piece Size · In stock only.
- **Panel Craft dashboard** (CR-311, 2026-10-07). First leaf of the group: open / in-cutting / ready /
  short counts, cut stock pcs + kg, pipeline strip, panels by status, orders per week, shortages,
  most-ordered panels, latest orders.
- **Cut-piece booking per order** (CR-312, 2026-10-07). Allocated · Short on the Requirements card, one
  Allocate Stock modal in both directions, free = on hand − every open order's booking, Dispatch needs
  every piece booked, Ready books its own output, removals never dip below what is booked.
- **Production checkpoints** (CR-313, 2026-10-07). MDF · Vinyl Printing · Cut Pieces marked independently
  with who / when; Overall Readiness Pending / In Progress / Ready for Production on the order page, the
  sheet, the cards and the dashboard.
- **Pending Cut Stock** (CR-314, 2026-10-07). Per cut piece Required · On Hand · Booked · Free · Shortage ·
  Orders, zero-stock items included; Booked · Free on Cut Stock.
- **Sample Orders** (CR-315, 2026-10-08). A separate order type for customer samples — full tile or cut
  piece of any item, SMP/FY/NNN, same customer link as Panel Orders; SO-shape form, order page, grid.
- **Record Supply** (CR-316, 2026-10-08). Per-line partial supply with a date; status derives itself;
  cut pieces come off cut stock (ledger kind "sample"), full tiles are record-only.
- **Request Samples + Customer Samples** (CR-317, 2026-10-08). Request Samples from a Quote / SO; the
  Customer page lists every sample line with quantities, date, status and source.

## 12 · Documentation & process

- This inventory, the Phase 2 heading in the register, the `ContainerFormat` table in the schema doc.
- **Data Flow reference** (CR-272, 2026-10-03). A single document listing, for every record type,
  every screen and every server action that can create, change, delete or re-status it, and the one
  place each business rule is meant to live. It ends with a numbered list of the places that enforce
  different rules for the same thing today, so they can be fixed one by one. Every future change
  must update it.

---

## Not yet built / parked in Phase 2

- Suitable Containers on the quote print, PDF and share link (CR-262 follow-up).
- Mix Batch at loading (CR-260 follow-up).
- Weight fitting from a container's max weight (the planner still uses a typed tonnage).
