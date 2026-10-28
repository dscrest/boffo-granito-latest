# BOFFO Order OS — Phase 2: what has been built

**Period:** 1 October 2026 → (open) · **Change requests:** CR-261 … · **Status:** running inventory, updated as each request ships

This is the plain-language inventory of Phase 2, in the same shape as `PHASE-1-FEATURES.md`: what each
part of the system gained, and the hours. The technical reference is `SYSTEM.md`; the request-by-request
history is `CHANGE-REQUESTS.md` (Phase 2 heading). Phase 1 figures are frozen and never re-estimated.

---

## Summary

| # | Module | Phase 2 so far | Effort recorded (h) | Conventional build (h) |
|---|---|---|---|---|
| 1 | Foundation & workspace | Organization profile (logo, name, tax, contact, bank on every screen and document); Staff default role (view + create, never edit / delete) + guard hardening; Zoho-linked account status, Zoho-only accounts, self-provisioning for company domains; discard prompt is a Yes / No question; delete asks for a reason (Admin exempt); Zoho-style label-left layout on every form page, tightened (label gap, one-control-wide rows, notes boxes); every grid leads Customer → Design, system numbers hidden, whole-row click | 14.5 | 44.5 |
| 2 | Masters (Inventory) | Container Master; Pallet Master boxes only; Warehouse master (primary, purposes); Design Master to the new spec — Pcs Per Packing typed per item with its own coverage, Design Owner / Custom Design Buyer, buyer-filtered brands, Base Design picked from items, four new lookups (Surface Application, Punch with image, Series, Catalogue), form in five spec sections with the image on it | 13 | 40 |
| 3 | Customers | Sign in with Zoho on the login page; Zoho Books connection + hand-mapping of customers to Books contacts (From Zoho Books, Map / Re-pull / Unmap); two-way Books sync (event-driven pull via Catalyst Signals, Import all, Push) + the Books tax / credit / notes fields; Zoho CRM Accounts as the customer source (Books hidden); Zoho link status per customer (CRM & Books / CRM only / Books only); Customer Brands list per customer | 13 | 46 |
| 4 | Quotes & Approvals | Suitable Containers panel; planner picks the container per item row, narrowed by pallet; Customer search modal | 8 | 27 |
| 5 | Sales Orders | Remaining + totals, per-item Deallocate, partial deallocate with always-visible stock buttons, worked order not deletable; name lookups page past 300 rows; Customer PO leads the order page and the grid, SO number small | 6 | 19 |
| 6 | Production | Bulk sheet reorder, Date-first grid and detail | 4 | 12 |
| 7 | Palletization | Date column, PAL code hidden; plan edit keeps Box Brand + batches, Completed refused; three pages (Palletization Completed); Release — loaded → Ready for Loading, palletized → free stock | 4.5 | 12.5 |
| 8 | Loading & Dispatch | Date column, LOAD code hidden; several containers per New Loading, each with its own vehicle; Loading Workspace with a tab per container, sheet-first entry, Dispatch and documents per tab; every customer listed with search; "what to do first" reasons on every stage gate; Sheet mode (every container on one grid); plan-container picker (format · pallets · boxes, claim saved) | 15 | 45 |
| 9 | Stock & batch ledger | Inventory adjustments (Stock Adjustments page + sheet, reasons master, every stock reader adjustment-aware); stock per warehouse (one reducer, server twin), Transfer Orders in both modules, warehouse on every stock entry, Locations on items; stock keyed by item (Design ROWID) | 8.5 | 25.5 |
| 10 | Reports & audit | Warehouse Stock report (boxes / cut pieces, matrix) | 1 | 3 |
| 11 | Panel Craft | Add Stock wording; row-click grid + Photo \| Grid view; PANEL-001 numbering; New / Edit Panel as a page; Request Panels from Quote / SO (New Request stage); Panel Order page with status steps + requirements checklist; full-size cut piece default; one image per panel; BOFFO loader on image upload; Panel Items with weighed cut pieces; Cut Stock as cut-piece items + bulk Add / Adjust sheets + ledger; MDF master + per-line MDF and auto weight; picker filters; Panel Craft dashboard; cut-piece booking per order (Dispatch = fully booked); MDF / Vinyl / Cut Pieces checkpoints + readiness; Pending Cut Stock page; Sample Orders (separate order type, per-line supply, cut-stock deduction, Request Samples, Customer Samples section); vehicle + driver on the load, Load Copy print, line (i) cards; Remarks on a panel; Cut Piece Size master under Panel Items | 21.3 | 64.5 |
| 12 | Documentation & process | Phase 2 inventory, register, schema, Data Flow reference | 3 | 9 |
| | **Total** | | **≈ 107.8** | **≈ 336** |

Hours follow the Phase 1 method (recorded ≈ actual sessions; conventional ≈ 3×, rounded).

---

## 1 · Foundation & workspace

- **BOFFO Glass — the app's new look, on every page** (CR-378, 2026-10-22). The whole app now wears
  its own "glass" design: a soft wallpaper, a floating dark menu rail with
  pill-shaped items, a see-through toolbar with a round search box, translucent cards with a soft rim,
  pill buttons and chips, and big display titles. Dark by default; Light / Dark / Match system is chosen
  from the account menu and the choice is remembered on that device. The Customers list gets an initials tile beside each name, a Status column and an
  All / Active / Inactive switch in the toolbar. Printed documents and the sign-in screen keep their
  own look. A kit page (`#/glass-kit`, Admin) shows every control. ≈ 7 h.
- **Account menu at the bottom of the rail** (CR-379, 2026-10-22). Your name and role sit at the bottom of
  the left menu; clicking opens Settings (Admin), Keyboard shortcuts, the tours, Light / Dark / Match
  system and Sign out. The top bar keeps Search and the bell only. ≈ 1 h.
- **Every grid: Customer and Design first, system numbers hidden, click the row** (CR-355, 2026-10-19).
  Every list — Sales Orders, Quotes, Invoices, Purchase Orders, Customers, Items, Panel Orders, Panel
  Loading, Panels, Stock Transfers / Adjustments, the Production sheet — now opens with the Customer and
  the Design (or the item / name) in the first columns. The system's own numbers (SO, Quote, PNL, PRD,
  TRF, CUS, SKU, panel code) are still there for reference but hidden until ticked in the column picker;
  a customer's PO number stays visible. Clicking anywhere on a row opens that record, on every page.
  ≈ 1 h.
- **New accounts start as Staff** (CR-336, 2026-10-13). A new role, Staff, can see and create everything
  (quotes, orders, customers, items, production, panel craft, invoices, reports, exports) but can never
  edit, delete or approve. It is the default for every new user; Admin picks another role when needed.
  The server now enforces "no edit / delete" on every route — a dozen production, allocation and
  order-line routes used to slip past for any role that could create. Maintenance routes are Admin-only.
- **Zoho-linked accounts** (CR-337, 2026-10-13). Settings ▸ Users shows how each account signs in —
  Zoho, Password, Both or None. A user can be created without a password (Zoho sign-in only). Admin lists
  the company email domains on the Users page; someone from those domains who signs in with Zoho for the
  first time gets a Staff account on the spot. Other emails are still refused.
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

- **No long helper notes** (CR-416, 2026-10-24, LIVE 2026-10-24). Thirteen multi-sentence how-to notes removed app-wide; a gate's
  reason lives in the Status cell / tooltip. Standing rule. ≈ 0.5 h.
- **Kanban hidden app-wide** (CR-418, 2026-10-24, LIVE 2026-10-24). Packing, Panel Orders, Sales Orders, Production: Sheet only;
  Default view preference hidden; code kept behind a one-line coercion. ≈ 0.5 h.
- **Sidebar logo centred · bell read/unread · "‹ Back" above Settings titles** (CR-419…421, 2026-10-24, LIVE 2026-10-24).
  Logo at the true centre of the rail; notification rows bold until Mark all read (marker survives new tabs);
  Settings sub-pages open with a small "‹ Back" link above the title instead of a button beside it. ≈ 0.5 h.
- **Organization profile** (CR-445, 2026-10-25, LIVE + DEMO 2026-10-25). Settings ▸ Organization: logo (PNG/JPG, required),
  company name (required), legal name, GSTIN / PAN / IEC, address / phone / email / website, bank details — stored as
  `org_*` settings (Admin-only), read through one public route, and used on the sidebar, login, tab title, every PDF /
  print and the shared pages; the old hard-coded BOFFO branding is the fallback. ≈ 2.5 h.
- **Stock history in date order** (CR-455, 2026-10-26, LIVE 2026-10-26). Panel Item Stock History and the Item master Production tab are
  ordered by the date they show, then by save time. ≈ 0.2 h.
- **Stock tree: ↳ rows only for special cut sizes** (CR-456, 2026-10-26, LIVE 2026-10-26). A full-size-only item is one row; the chevron and
  cut-piece rows appear only when the item has another cut size. ≈ 0.3 h.
- **Adjust Stock in the Zoho Books shape, both modules** (CR-457, 2026-10-26, LIVE 2026-10-26). Header Mode · Date · Reason · Description over
  an Item Table with Available, New on hand (live) and one signed Qty adjusted field; date + reason once per adjustment
  (replaces the CR-446 per-line cells). Recorded ≈ 1.5 h · conventional ≈ 5 h.
- **Location Transfer from the Adjust Stock screen** (CR-458, 2026-10-26, LIVE 2026-10-26). Mode radio Quantity Adjustment | Location
  Transfer; From → To in the header, Available at From + Qty to move per line; saves one Transfer Order (TRF number) through
  the existing routes, total unchanged. Recorded ≈ 0.5 h · conventional ≈ 3 h.
- **Cut-piece Adjust Stock: Item picker = stock row, no Cut Piece Size column** (CR-459, 2026-10-26, LIVE 2026-10-26). "Item" alone
  for a full-size piece, "Item · 600x600" for a special cut. ≈ 0.4 h.
- **Stock rows open the cut piece, inside Panel Craft; no Image column** (CR-460, 2026-10-26, LIVE 2026-10-26). A ↳ row opens that
  cut piece, the item row its full-size piece; nothing jumps to the Masters workspace any more. ≈ 0.3 h.
- **Cut Piece detail page** (CR-461, 2026-10-26, LIVE 2026-10-26). `/cut-stock/:design/:cut`: on hand · booked · free · weight,
  locations, panels using it, orders booking it, its own stock history; Actions = Add / Adjust / Transfer prefilled with
  the piece + a Panel Item link. ≈ 1.5 h.
- **⌘K kind label no longer overlaps the name** (CR-462, 2026-10-27, LIVE 2026-10-27). ≈ 0.1 h.
- **Customers: All / Active / Inactive pills removed; status lives in Search Customers** (CR-463, 2026-10-27, LIVE 2026-10-27). ≈ 0.2 h.
- **Advanced search: Created Between fits the modal** (CR-464, 2026-10-27, LIVE 2026-10-27). DateInput wrapper honours flex — fixes every
  date-range field app-wide. ≈ 0.3 h.
- **Red close × on every modal / drawer** (CR-465, 2026-10-27, LIVE 2026-10-27). One `.btn.x` rule, menu / info triggers exempted. ≈ 0.3 h.
- **New customer ▾ menu: From Zoho CRM + Refresh from Zoho CRM (admin)** (CR-466, 2026-10-27, LIVE 2026-10-27). ≈ 0.5 h.
- **Footer pager: First / Last + arrow buttons on all grids** (CR-467, 2026-10-27, LIVE 2026-10-27). ≈ 0.3 h.
- **Demo build shows no BOFFO branding** (CR-454, 2026-10-26). With `VITE_DEMO=1` the fallback profile is "Demo / Demo
  Company" (no address / contact / bank rows), PDFs print the brand name where the logo band would be, the login stays
  logo-free, sign-in errors say "No account for …", and the busy indicator is the label alone pulsing ("Processing…" by
  default) — no wordmark. Live keeps the wordmark, spelling the organization's name. Demo seeds use the brand "Stonecraft".
  ≈ 1 h.

- **PO number leads on every stage screen** (CR-482, 2026-10-28). Palletization, Loading, Dispatch, Production, the
  pipeline and every stage modal show the customer's PO; the SO number is a hidden last column; prints keep the SO. ≈ 1.5 h.

## 2 · Masters (Inventory)

- **Pallet form without Box Weight** (CR-471, 2026-10-27). New / Edit Pallet no longer shows the Box Weight field; the
  Size's weight is stored silently and every reader (pallet page, chips, containerisation fallback) is unchanged. ≈ 0.1 h.
- **Item master Bulk Upload** (CR-451, 2026-10-26). Excel / CSV upload beside New Item with a downloadable sample
  template: match columns, preview every row (unknown master names, duplicates in the file, items that already
  exist are flagged), create the valid ones in one go with SKUs and unique names exactly as the Item form would.
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
- **Warehouse master** (CR-329, 2026-10-12). Settings ▸ Warehouses: name, Primary ★, purposes (Production ·
  Palletization · Loading Bay · Raw Material · Sample Cut Panels, pick any), note. The first warehouse saved is
  the primary; marking another one primary keeps the old history where it was. The primary and any warehouse
  with stock history can't be deleted. Nothing changes anywhere until the first warehouse exists.
- **Locations inside a warehouse** (CR-409, 2026-10-23). Settings ▸ Warehouses & Locations: a warehouse holds
  locations like A1 … F12 (60–70 per godown — generate rows A–F × bays 1–12 in one go, existing codes skipped).
  Stock is recorded at a location (pickers offer locations only, default the primary's A1, type a code to jump)
  and stays there until a Transfer Order moves it; every label reads Warehouse ▸ Location; stock recorded before
  the locations existed reads "▸ Unassigned". Lists and the report show only locations that hold something.
  One live column (`parent`); no change to the stock maths. ≈ 4 h.

## 3 · Customers

- **Sign in with Zoho** (CR-324, 2026-10-12). The login page leads with a Zoho button; the password
  form stays as the fallback. A Zoho account gets in only when its email is an existing, active app
  user — roles stay Admin-controlled. Consent starts on accounts.zoho.in; other data centres work too.
- **Zoho Books customer mapping** (CR-325, 2026-10-12). Settings ▸ Zoho Books connects the organisation
  once (Admin). Customers ▸ From Zoho Books creates a customer from a Books contact; a customer's More
  menu maps, re-pulls or unmaps. The contact fills the normal customer form for review — nothing is
  written until Save. (The "nothing ever syncs" part was reversed by CR-356 below.)
- **Zoho CRM Accounts are the customer source; Zoho Books switched off, nothing lost** (CR-359,
  2026-10-21). Same approach as the Books sync below, pointed at CRM Accounts: changes arrive via the
  webhook / scheduled pull (CRM reports only what changed), Import all once, Create in / Push to Zoho CRM
  from the customer, From Zoho CRM on the Customers page, Map / Re-pull / Unmap by hand. Contact persons
  come from the account's CRM Contacts; GSTIN, PAN, GST treatment, Place of Supply, Credit Limit and
  Payment Term are picked up from the org's custom fields automatically. Books stays installed and hidden
  (one flag each side); every existing customer record is untouched.
- **The sync never creates a twin; duplicate names are an error** (CR-372, 2026-10-22). The 2026-10-21
  imports had made a second customer for most CRM accounts (822 customers for ≈530 accounts) and reused
  CUS- codes — the existing-customer lookup stopped at 300 rows. It now reads every customer. A CRM
  account whose name is already on a customer linked to another CRM account, or on several unlinked
  customers, is reported as a duplicate and not created; CRM comes first, so an existing Books / add-on
  customer with that name is linked to the account. ≈ 1 h.
- **Duplicate customers card** (CR-373, 2026-10-22). Settings ▸ Zoho CRM ▸ Duplicate customers: Find
  duplicates (one row per CRM account with two or more customers — the CRM & Books one stays, the others
  merge into it with their quotations, sales orders, panel orders and sample orders; codes used twice are
  renewed; names shared by different CRM accounts are listed and left alone) → Merge N duplicates
  (Yes/No). ≈ 2 h.
- **List pages load whole-table lookups in one round trip** (CR-478, 2026-10-28). The 2,820-row Customer table
  was fetched 300 rows per request, serially, at ≈ 1 s per request on every list page; the server now returns a
  whole table in one response, paging ZCQL in parallel internally. ≈ 1 h.
- **Import all reaches every CRM account; re-runs skip the unchanged in bulk** (CR-477, 2026-10-27). Zoho CRM
  serves page numbers only up to record 2,000, so the import had stopped there and older accounts never arrived;
  it now walks Zoho's page tokens, 200 accounts per list call, working on the changed / unlinked ones ten at a
  time and skipping the rest without re-listing them. ≈ 1.5 h.
- **Import all never waits for duplicates** (CR-387, 2026-10-22). Import all customers runs every page, skips a
  duplicate name per record, and runs Find duplicates when it finishes (also after a page that timed out), so the
  Duplicate customers card shows what is left to merge; the summary toast counts the skipped duplicates. ≈ 0.5 h.
- **Each customer shows which Zoho systems hold it** (CR-362, 2026-10-21). Customers grid column **Zoho**:
  **CRM & Books** when Zoho's own CRM ⇄ Books integration links the account to a Books contact, **CRM only**
  when it is in CRM but not synced with Books, **Books only** for the old Books mapping; the customer page
  spells the sentence out with both ids and the advanced filter takes the four states. The CRM pull asks
  Books once per account, so Import all / Refresh fill it. ≈ 1 h.
- **CRM & Books status fills in for every synced customer** (CR-363, 2026-10-21). The first import had
  left most customers at "CRM only" because the server re-requested its Zoho sign-in token on every
  CRM ⇄ Books switch and ran into Zoho's ten-per-ten-minutes limit. One token per system now, a throttle
  says "wait 10 minutes", Books problems are listed under the sync card, and Import all re-checks the
  Books link of customers it already has. ≈ 1 h.
- **Zoho Books customer sync, both ways** (CR-356, 2026-10-21; event-driven since CR-358 the same day; ⚠ hidden since CR-359).
  The moment a customer is created or edited in Zoho Books, Catalyst Signals pokes the server and the
  customers changed since the last run come across (a daily refresh is the safety net) (Books wins; add-on-only fields untouched; same-name
  customers are linked, new ones created) — never a full pull on the schedule. Settings ▸ Zoho Books has
  **Refresh now** and a one-time **Import all customers**. A customer's More menu offers **Create in /
  Push to Zoho Books**. The Books fields now live on the customer: GST Treatment, GSTIN, Place of Supply,
  PAN, Website, Credit Limit, Notes (Tax & Other block) and Opening Balance (shown only).

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

- **Location is mandatory on a Sales Order** (CR-453, 2026-10-26). The SO form asks where the order's stock will
  sit (Warehouse ▸ Bay, the same picker as the Panel Order); create, edit and convert-from-quote all refuse
  without it once a warehouse exists; the SO detail header shows it. **Reversed by CR-468** the next day.
- **No Location on the Sales Order** (CR-468, 2026-10-27, reverses CR-453). The field is gone from the form and the
  page; the server takes it as optional. Location is asked where stock is written — production, cut stock, pallets. ≈ 0.3 h.
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
- **Name lookups page past 300 rows** (CR-339, 2026-10-13). Creating a Sales Order or Quote resolved item
  and customer names through one 300-row query cached per server instance; paged now, and refreshed when a
  needed name is missing. ≈ 0.5 h.
- **Customer PO first, SO number small** (CR-353, 2026-10-19). The Sales Order page is titled by the
  customer's PO number with `SO/FY/NNN` small beneath it; the Orders grid's first column is PO Number and SO
  Number is the last column; the drawer and By-Order cards follow. The SO number stays the record identity.
  Orders module only — the production, palletization and loading screens and the printed SO keep the SO
  number. ≈ 0.5 h.
- **No Panel Orders tab on the Sales Order page** (CR-422, 2026-10-24, LIVE 2026-10-24). Production · Palletization ·
  Container Planning only; Request Panels stays in the More menu. ≈ 0.1 h.
- **Sidebar near-black in Light mode** (CR-423, 2026-10-24, LIVE 2026-10-24). The rail's 82 % tint read
  grey over the light wallpaper; the light theme now sets `--g-rail` to 94 % black. Dark theme unchanged. ≈ 0.1 h.
- **Search items for the Base Design Name** (CR-434, 2026-10-24, LIVE 2026-10-24). The Item form's Base Design Name carries the
  same 🔍 as the Customer pickers; a Search Items window (active items — name, SKU, size, collection, brand) fills the
  field with the picked item's name. ≈ 0.3 h.
- **Whiter menu text in Light mode** (CR-435, 2026-10-24, LIVE 2026-10-24). Rail labels and group titles brightened on the dark
  light-mode rail via two tokens; Dark mode unchanged. ≈ 0.1 h.
- **One Masters page** (CR-436, 2026-10-24, LIVE 2026-10-24). One sidebar entry; Export Master · Item Master · Panel Master sub-tabs,
  each a row of its masters opening in place; old Pallet / Container / Panel Items / Panel Master menu entries and links
  redirect into it; Settings keeps a Masters tile group for search. Recorded ≈ 2 h · conventional ≈ 6 h.
- **Base Design Name defaults to the Design Name** (CR-437, 2026-10-24, LIVE 2026-10-24). Blank at save = the Design Name; the field
  stays clearable while editing. Recorded ≈ 0.25 h · conventional ≈ 1 h.
- **Location per item / per row when recording production and cut pieces** (CR-438, 2026-10-24, BUILT — deploy pending).
  Log Production asks the Location per item section, Production Completion per line; the bulk Record Production,
  cut-stock Add / Adjust and Stock Adjustments sheets gained a per-row Location column (blank = the bar's default,
  paste by label or bay code, one pair at two bays allowed, hints follow the row's bay); the Excel import takes a
  Location column. Server resolves row ⊳ bar ⊳ primary on all four routes. Recorded ≈ 1 h · conventional ≈ 4 h.
- **Masters menu inside Settings with horizontal tabs** (CR-439, 2026-10-24, LIVE 2026-10-24). The Settings rail
  carries Masters ▸ Item / Panel / Export as a menu + sub-menu; the chosen group shows its title and its masters as
  horizontal tabs opening in place; /masters opens the same page on Masters (non-admins see Masters only). ≈ 0.6 h · conventional ≈ 2 h.
- **Masters out of the main menu, clearer tabs** (CR-440, 2026-10-24, LIVE 2026-10-24). No sidebar Masters entry; the
  menu is Settings ▸ Masters only; master tabs are highlighted pills. ≈ 0.2 h.
- **Stock adjustment as a Zoho-style line form, both modules** (CR-446, 2026-10-25, LIVE 2026-10-25). One line by
  default + "Add line"; each line shows the current stock at its location and carries its own Location, Add / Remove, Qty,
  Date, Reason, Remark (no top bar); Add Stock / Transfers keep the bulk sheet. Server takes date + reason per line and nets
  the on-hand floor per bay. Recorded ≈ 1.5 h · conventional ≈ 6 h.
- **Title Case for the Name columns CR-429 missed** (CR-447, 2026-10-25, LIVE 2026-10-25). Collection Name, vessel
  name, extra-address attention, role names. Recorded ≈ 0.2 h · conventional ≈ 1 h.
- **Panel Craft ▸ Stock — items with their cut pieces beneath** (CR-448, 2026-10-25, LIVE 2026-10-25). Menu entry
  renamed; the list is item rows (totals) with ↳ cut-piece rows, fold / search / sort over items. Recorded ≈ 0.6 h ·
  conventional ≈ 3 h.
- **Panel Item page: read-only weight, editing on an Actions tab** (CR-449, 2026-10-25, LIVE 2026-10-25). Details
  informative; "+ Cut piece", ✕ and the stock buttons on Actions; weight = the formula value. Recorded ≈ 0.4 h · conventional ≈ 2 h.
- **Panel Order page: Requirements on Actions, Details informative** (CR-450, 2026-10-25, LIVE 2026-10-25). The
  Requirements card (tick + Allocate Stock) moved whole to the Actions tab; card 2's duplicate Allocate removed. Recorded
  ≈ 0.4 h · conventional ≈ 2 h.
- **MDF and Vinyl marked independently** (CR-431, 2026-10-24, LIVE 2026-10-24 — REVERSES CR-401). The Vinyl
  dropdown is never greyed by MDF any more; Pasted still needs both Ready. Client gate + server 409 removed. ≈ 0.2 h.
- **Load Copy from the Actions tab** (CR-433, 2026-10-24, LIVE 2026-10-24). A Load Copy menu on the Actions tab
  lists every trip newest first; each PDF carries only that trip's lines, so earlier dispatches never appear on a new
  copy and every past trip keeps its own. ≈ 0.2 h.
- **Marks change instantly on the Actions tab** (CR-432, 2026-10-24, LIVE 2026-10-24). The dropdown shows the
  new value the moment it is picked; the save lands in the background and reverts on error. The page no longer
  re-downloads every panel order after a mark — the cached order is patched with the server's answer. ≈ 0.3 h.
- **Panel Craft data reset** (CR-424, 2026-10-24, done on LIVE). All panel orders, sample orders, loads, cut-stock
  entries, cut-piece items, panels, MDF rows and their activity/status history were hard-deleted for fresh entry;
  numbering restarts at 001. Cut Piece Sizes, Adjustment Reasons, Warehouses, Customers and Items untouched. Same
  afternoon the export transactions followed (quotes, sales orders, production, palletization, load boxes, status
  history; Operations log kept only Customer rows), then the Item master (12 Items; lookups kept). ≈ 0.4 h.

- **Box Brand mandatory** (CR-483, 2026-10-28). Form and server refuse a Sales Order without a box brand. ≈ 0.3 h.
- **Production tab per batch with Production date + stock actions** (CR-479, 2026-10-28). One row per design × batch
  with the day the batch was produced; Allocate / Deallocate Stock buttons live on the tab, off the Items card. ≈ 1 h.

## 6 · Production

- **Bulk Record Production** (CR-264, 2026-10-03). Columns Size · Design · Batch · Box Brand · Qty ·
  Remark; the Size narrows the item list; the toolbar date is the production date for every row (a per-row
  Date column can be shown); "+ 10 rows" button.
- **Date first** (CR-265). The production grid opens grouped by date and hides the Production ID (one
  tick to show it); the production page is titled by its date with the PRD number in small print.
- **Bulk Record Production is the default button** (CR-267). Start New Production is the secondary one.

- **Toolbar: Table + Sheet only** (CR-417, 2026-10-24, LIVE 2026-10-24). Kanban, To Produce and Import hidden; Filter, search,
  Group, Fields, Edit, Start New / Bulk Record stay. ≈ 0.25 h.
- **Bulk Record Production in the Adjust Stock shape** (CR-469, 2026-10-27). Production section (date, recorded by,
  description) over an Item Table — Size · Item · Batch · Qty · Box Brand · Location per line — one line to start,
  "+ Add line"; no toolbar options; Excel paste kept. ≈ 1.5 h.
- **Bulk Record Production: no Size column — REVERSED** (CR-476, 2026-10-27 → back 2026-10-28). The Size column stays
  as CR-469 built it; the no-Size version was live for one night. ≈ 0.25 h.
- **SO Production tab per design** (CR-470, 2026-10-27). One row per design, batches as chips, Requested / Produced /
  Boxes summed, totals footers. ≈ 0.5 h.

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
- **Plan edit keeps Box Brand and batches** (CR-340, 2026-10-13). Editing a palletization plan carries the
  carton brand and batch of each replaced line, attributes new items to their real batches, refuses a
  Completed plan. ≈ 1 h.
- **Three pages, one stage each** (CR-360, 2026-10-21). A third sidebar page, **Palletization Completed**,
  lists the palletized stock waiting to be loaded; In Palletization shows work in progress only. The page
  guide covers all three. ≈ 0.5 h.
- **Release** (CR-361, 2026-10-21). From the row's "+" menu on Palletization Completed and on Loading and
  Dispatch: type the boxes and a reason. Loaded boxes return to Ready for Loading; palletized boxes return
  to free stock and the order's allocation is returned. Partial or whole; dispatched containers refused.
  Replaces the loading sheet's whole-line, reason-less "Unload item". ≈ 2 h.
- **No status filter on the palletization pages** (CR-364, 2026-10-21). Each page is one stage, so the
  page | All dropdown is gone; every page lists its own rows only. ≈ 0.25 h.
- **Discard…** (CR-369, 2026-10-22). The "+" menu on Ready for Palletization and In Palletization:
  boxes and a reason; the boxes leave the task and return to free stock, the allocation is returned.
  A reason is required on every release and discard, Admin included. ≈ 1.5 h.
- **Delete returns the boxes** (CR-370, 2026-10-22). Deleting a palletization returns every line to free
  stock first; refused while any box sits in a container. ≈ 1 h.
- **Cancel Order empties the board** (CR-371, 2026-10-22). Reason required; boxes leave open containers,
  every line is removed, every allocation returned; a dispatched container blocks the cancel. ≈ 2 h.
- **Counts per batch + four columns** (CR-472, 2026-10-27). Ready Pallets / Remaining count the row's own batch (a
  loaded sibling batch no longer bleeds in — the "4 (100)" bug); Boxes · Ordered Boxes · Ready Pallets · Boxes / Pallet ·
  Remaining on all three palletization pages, totals footer and Complete dialog on the same numbers. ≈ 1 h.

- **Whole pallets, per-page columns, Complete Palletization in pallets** (CR-481, 2026-10-28). Floor arithmetic
  (23 boxes / 18 = 1 pallet · 18 boxes · 5 pending); Possible / Prepared Pallets; Boxes / Pallet and Remaining
  removed; the dialog records pallets and the remainder waits for a Top Up. ≈ 1.5 h.

## 8 · Loading & Dispatch

- **Date column, LOAD hidden** (CR-266). The loading sheet and the Loadings grid show the loading's date
  instead of the LOAD code (still available in the column picker).
- **Several containers in one New Loading** (CR-301, 2026-10-07). One section per container, each with its
  own Container Master pick, item rows and vehicle details; stock shared across sections so an item can be
  split between containers; Fill from plan fills one container at a time; one Save creates the linked
  loadings. ≈ 4 h.
- **Loading Workspace — a tab per container** (CR-326, 2026-10-12). New Loading and Edit are one page:
  each container is a tab with a plain sheet (design, pallets, pallet no., pallet type) and its own vehicle
  & seals rail; status follows the data; Dispatch per tab; documents per container; Edit opens every
  container of a group. ≈ 3 h.
- **Sheet: design first, container details behind "+"** (CR-374, 2026-10-22). A container is one line (C1, C2)
  over its design rows; "+ Container & vehicle" appears once it has a design and opens the details window;
  Add Items in Bulk under the rows; columns aligned. Combobox chevron fix (CR-375). ≈ 1.5 h.
- **Workspace follow-ups** (CR-334, 2026-10-12). "Add Items in Bulk" label back; ✕ on every row; removing a loaded
  item or a saved container asks for a reason like Delete. ≈ 0.5 h.
- **Sheet mode** (CR-335, 2026-10-12). Tabs | Sheet toggle; Sheet lists every container of the loading on one grid
  with a band row per container (vehicle, seals, Dispatch, Documents) and the design rows under it. ≈ 2 h.
- **Every customer in the Customer box, with search** (CR-327, 2026-10-12). Loading and Palletization list
  all active customers (stock-bearing first) and carry the 🔍 search modal. ≈ 0.5 h.
- **"What to do first" reasons** (CR-328, 2026-10-12). A customer or order that cannot be loaded or
  palletized shows why and the next step; Sales Order detail shows a Next: line; empty pickers name their
  reason. ≈ 1 h.
- **Pick the planned container at loading** (CR-338, 2026-10-13). Each container tab's plan row is a picker
  over the order's planned containers — format, pallets, boxes, per-design pallet type, Planned / Sent /
  Claimed by … — Fill from plan fills the chosen one; the claim is saved so a loaded container is not
  offered again. ≈ 3 h.
- **Design + container first, then vehicle & seals; party · PO on top** (CR-350, 2026-10-15). The Container
  pick moves above the items; vehicle / seal fields unlock once the container has an item (a note says so);
  the header leads with the party and customer PO, SO numbers small. ≈ 1.5 h.
- **Two visible steps per container; C1/C2 naming** (CR-354, 2026-10-19). Designs & pallets first (step 1),
  then Container & vehicle (step 2: Container pick, name, container no., vehicle, driver, seals) under the
  rows, hidden behind one line until step 1 has an item; both Sheet and Tabs views. Containers read C1, C2 ….
  Reverses the container-first half of CR-350 at the user's request. ≈ 1.5 h.

- **Five stage pages** (CR-480, 2026-10-28). Palletization Completed stays its own page, Loading holds the items being loaded, the new Dispatch page the containers ready to dispatch and the dispatched ones. ≈ 1 h.

## 9 · Stock & batch ledger

- **Inventory adjustments** (CR-308, 2026-10-07). Inventory ▸ Stock Adjustments lists every box-stock
  correction (date, item, batch, ± boxes, reason, note, who); New Adjustment is a bulk sheet — date and
  reason (from the new Adjustment Reason master) in the bar, rows of Item · Batch · Add / Remove · Qty.
  A removal never goes below what is physically on hand and warns when it eats into boxes a sales order
  reserved. Stock Details, the Item STOCK card, the stock reports, batch pickers and allocation all
  include adjustments; the Item detail Production tab lists them with an Adjust chip.
- **Stock per warehouse** (CR-329, 2026-10-12). Every stock entry (production output, opening stock,
  adjustments, cut-stock receipts and adjustments) records the warehouse it was counted in (default the
  primary). Boxes a container loads are taken from the warehouse holding that batch — Loading Bay first.
  Global stock figures are unchanged; the warehouse is a second view of the same rows.
- **Transfer Orders** (CR-330, 2026-10-12). Inventory ▸ Transfer Orders: a dated `TRF/FY/NNN` document
  moving items from one warehouse to another with a reason — boxes on the bulk sheet, cut pieces from
  Cut Stock ▸ Transfer. A line can't exceed what the From warehouse holds. Reverse with the opposite transfer.
- **Locations on items** (CR-332, 2026-10-12). Item detail ▸ Locations tab (warehouse → batches, on hand ·
  committed · available); Panel Item detail ▸ Locations card (warehouse × cut size).
- **Stock keyed by item** (CR-341, 2026-10-13). Live stock, opening / adjustment / allocation sums and the
  To Produce demand key on the item, not its shared design name; Item detail now agrees with Allocate
  Stock. ≈ 1.5 h.

## 10 · Reports & audit

- **Warehouse Stock report** (CR-331, 2026-10-12). Boxes or cut pieces, list or Item × Warehouse matrix, a tile
  per warehouse, filters, CSV. Batch-wise Stock's totals row gained the Adjusted total it was missing.

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
- **MDF per line + auto weight** (CR-309, 2026-10-07). Each panel-order line carries an MDF and shows
  Weight = cut pieces × weight + MDF, × qty; order total on the form and the detail.
- **MDF under the Panel master, thickness-only pick** (CR-342, 2026-10-15 — ⚠ superseded by CR-344 the
  same day). A panel had its own thickness rows; the order line picked one of them.
- **MDF is a size-keyed master again** (CR-344, 2026-10-15). Settings ▸ Masters ▸ MDF = editable Size ·
  Thickness · Weight rows; the Panel master states its MDF Size only; the order line offers the thicknesses
  of that size (auto when one, mandatory once the size has rows). Migration merges duplicates. ≈ 2 h.
- **"Cut Stock" → "Cut Piece"** (CR-343, 2026-10-15). Sidebar, dashboard and sheet titles. ≈ 0.25 h.
- **One Orders register** (CR-345, 2026-10-15). Panel + Sample orders in one grid with a Type column and
  filter; New Order asks the type first. ≈ 2 h.
- **Cut-piece line defaults to the full size** (CR-357, 2026-10-21). A loose cut-piece line with no Cut
  Piece Size means the design's full size (CR-289 rule, server-resolved); only the Item is required. ≈ 0.5 h.
- **Actions tab** (CR-365, 2026-10-22). Per line × material: Ordered · Loaded · Pending · Ready or what is
  missing · Load Now; Dispatch opens Record Load with those quantities. ≈ 3 h.
- **Vinyl Pasted waits for MDF + Vinyl** (CR-366, 2026-10-22). The pasted checkpoint is greyed and refused
  until both are Ready. ≈ 0.5 h.
- **One Status column** (CR-367, 2026-10-22). Pending · Not Started · In Progress · Ready · Completed ·
  Cancelled replaces the four checkpoint columns + Readiness; kanban, dashboard and the detail chip follow;
  the lifecycle stage is a Stage field on the order. ≈ 2.5 h.
- **Cancel Order** (CR-368, 2026-10-22). Panel and sample orders; reason required for everyone; blocked once
  a load exists; bookings return to free stock. ≈ 2 h.
- **MDF · Vinyl · Pasted marked per panel** (CR-376, 2026-10-22). The team marks each panel line's MDF, vinyl
  print and pasting on its own; a panel loads once its three are Ready, so panels of one order leave on
  different vehicles; Cut Pieces stays one order-level mark. Old order-level marks still show. ≈ 2.5 h.
- **Items card = marks + (i)** (CR-377, 2026-10-22). The three marks are columns of the Items card; Panel
  Size, Designs and the MDF spec moved behind the (i) line details. ≈ 1 h.
- **Customer detail in tabs** (CR-384, 2026-10-22). Details · Transactions (collapsible Sales Orders /
  Quotes / Samples / Panels, counts in the headings) · Dispatch · Activity; Associated Orders table removed,
  Quotes listed on the customer for the first time. ≈ 1.5 h.
- **Status pills never wrap** (CR-385, 2026-10-22). The count (`420 left`, `760 of 900`) sits beside the pill
  in muted mono instead of inside it; `.chip` is nowrap app-wide. ≈ 0.5 h.
- **Record lists behind an (i) card** (CR-386, 2026-10-22). A grid cell holding several orders / panels shows
  `3 orders` + (i); the details open in a floating card (`InfoTag`). Pending Cut Stock → Orders first; the
  Loading / Items line details moved from the under-row block into the same card. ≈ 1 h.
- **Design-glitch sweep** (CR-388, 2026-10-22). Numbers and units never wrap in any table; 14 further
  rendering/polish fixes from a code audit (phantom column on the Loading Sheet, see-through chart tooltip,
  locked fields and focus ring under glass, hover vs selected rows, `.hbtn.sm` + `.card-head` replace 37
  inline styles, dead duplicate CSS removed). ≈ 1 h.
- **No internal wording in front of staff** (CR-389, 2026-10-22). Zoho ids behind (i) on the customer page,
  no `#rowid` in the palletization toast, the empty Documents tab removed from the order drawer, Audit Log
  named instead of its route, `ƒx` out of panel tooltips. ≈ 0.5 h.
- **Noise cuts** (CR-390, 2026-10-22). One status chip per screen, no field that restates the title or
  subtitle, no column that is empty on every row, no vehicle on palletization screens; eleven screens,
  storage keys bumped. ≈ 1 h.
- **Order lines: ⓘ instead of the photo, one column set** (CR-398, 2026-10-23). Panel Order and Sample
  Order rows share one grid; details on hover, photo on click behind an ⓘ; the create-time stock check is
  a single verdict line. ≈ 0.5 h.
- **Panel location** (CR-410, 2026-10-23). A panel order says where its panels sit (More ▸ Set Location, open
  orders only): Location field on the order, a default-hidden grid column, and a Panels view on Reports ▸ Stock
  Locations. Manual placement; loading and dispatch untouched. One live column. ≈ 1 h.
- **Production always records a location** (CR-411, 2026-10-24). Record Production sheet, Complete Production
  and the Excel import gain the Location picker; the default is the Production-purpose bay (purposes now drive
  defaults everywhere). ≈ 1 h.
- **Pallet location** (CR-412, 2026-10-24). A palletized line carries where its pallet stands until it enters a
  container: asked once in the Palletize dialog (Palletization bay on Start, Loading Bay on Complete), changed via
  Set Location from the boards, the loading row menu or the plan; Location column + group-by, Item ▸ On pallets
  at, Pallets view on Stock Locations. Splits keep it; a tag, never a stock movement. One live column. ≈ 3 h.
- **Panel order form Location** (CR-413, 2026-10-24). Optional Location on create / edit. ≈ 0.25 h.
- **Panel order Location is mandatory** (CR-453, 2026-10-26). Save waits for it; the server refuses a panel order
  without one on create and edit.
- **Add Items to Panel Craft — many at once** (CR-452, 2026-10-26). Search + tick list of items not yet in Panel
  Craft, one Add; each gets its full-size cut piece.
- **Add Stock brings the item into Panel Craft** (CR-414, 2026-10-24). The Add Stock sheet takes any item from
  the Item master and any cut size (blank = full size, Create … for a new one) and defines the piece with its
  weight while receiving — import + stock in one Save, bulk / paste as before. Add Stock sits beside Add Item on
  Panel Items; Add Stock / Adjust open prefilled from the item; "+ Cut piece" has an On Hand qty that records the
  same receipt. ≈ 1 h.
- **Settings search everywhere** (CR-408, 2026-10-23). The header search finds settings pages and preferences
  for admins; the Settings search matches every typed word plus synonyms (godown, truck, login) and the
  Preferences rows. Tile renamed Warehouses & Locations. ≈ 0.5 h.
- **Load a whole panel, pieces of a panel, or its pasted MDF** (CR-405…407, 2026-10-23). Load rows are
  per cut-piece kind of each panel (any count) + its MDF board (always present); "Load whole panel" from
  the row's "+"; Allocate Stock on the Actions tab; readable mark dropdowns. Two live schema columns on
  the load line. ≈ 3 h.
- **Panel Order page: customer heading, four-state status, marks on Actions, free loading** (CR-399…403,
  2026-10-23). Title = customer, PNL small; ONE derived status New → Ready → Completed → Dispatched with no
  stage buttons (lifecycle column dormant, open from birth); Vinyl waits for MDF Ready (reversed by CR-431); MDF · Vinyl · Pasted
  marked on the Actions tab per panel; cut pieces load once booked, MDF boards once pasted — one row or all.
  ≈ 2 h.
- **Readiness tab on every Panel / Sample order** (CR-404, 2026-10-23). The user's Order Readiness Dashboard
  design, per order, in the glass skin: ring of panels ready to load, headline with the next stage, four tiles,
  one ring per stage (MDF · Vinyl · Pasted · Cut pieces · Weighed · Loaded) and a table of stage cells per
  panel; all derived from the marks, booking, weight and loads already recorded. Sample orders show the one
  stage Supplied. ≈ 1.5 h.
- **Cut pieces ready when booked** (CR-380, 2026-10-22). A panel row's pieces count as ready once booked to
  the order; the order-level Cut Pieces mark no longer blocks loading one panel. ≈ 0.5 h.
- **Only Ready rows load** (CR-381, 2026-10-22). Blocked rows sit at 0, disabled, with the reason, on the
  Actions tab and in Record Load (Status column there too); the server refuses a pick whose panel marks are
  not Ready. ≈ 1.5 h.
- **"+" Load per row + Requirements grouped by panel** (CR-382, 2026-10-22). Each Ready to Dispatch row has
  the house "+" menu → Load… for that row alone; the Requirements card bands its rows per panel. ≈ 1.5 h.
- **MDF loads only once pasted** (CR-383, 2026-10-22). The MDF row needs MDF · Vinyl · Pasted Ready, not the
  MDF mark alone. ≈ 0.5 h.
- **Loose cut-piece lines on a panel order** (CR-346, 2026-10-15). "10 panels + 20 cut pieces" on one
  order; pieces join requirements, booking and Pending Cut Piece. ≈ 2 h.
- **Loading entries, derived Dispatched** (CR-347, 2026-10-15). Dispatch tab per order: Record Load with
  date, vehicle, photos and qty per line × material (Panel / MDF / cut piece); several orders per trip;
  a load moves the stock it carries; the last load dispatches the order; Loading Status + Pending on the
  order, grid and cards; a sample supply is a load. ≈ 8 h.
- **Panel Craft ▸ Loading page** (CR-348, 2026-10-15). Everything pending to load, "+" per row,
  multi-select → one trip; dashboard KPI Pending to Load. ≈ 1.5 h.
- **Weight split and frozen** (CR-349, 2026-10-15). Pieces kg · MDF kg · Total kg; shipped kg stamped at
  load time, pending kg follow the master. ≈ 1 h.
- **Vehicle details on the load + Load Copy print** (CR-351, 2026-10-19). Record Load takes Vehicle Number
  (auto-formatted) · Driver Name · Driver Mobile, kept on the trip and on the Vehicle master; a branded Load Copy
  PDF per trip (vehicle block, lines, kg, signatures) from the Loads table. ≈ 1.5 h.
- **Panel name only, details behind (i); notes at the bottom** (CR-352, 2026-10-19). Load tables show the short
  line label with an (i) card (panel size · vinyl · MDF · design rows); every helper note sits under the content it
  explains; the bottom note says how to send one material only. ≈ 0.5 h.
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
- **Fourth checkpoint — Vinyl Pasted on MDF** (CR-323, 2026-10-09). Pending · Ready, marked once the
  printed vinyl is fixed on the board; Readiness needs all four Ready; Vinyl Pasted column on the sheet.
- **Pending Cut Stock** (CR-314, 2026-10-07). Per cut piece Required · On Hand · Booked · Free · Shortage ·
  Orders, zero-stock items included; Booked · Free on Cut Stock.
- **Sample Orders** (CR-315, 2026-10-08). A separate order type for customer samples — full tile or cut
  piece of any item, SMP/FY/NNN, same customer link as Panel Orders; SO-shape form, order page, grid.
- **Record Supply** (CR-316, 2026-10-08). Per-line partial supply with a date; status derives itself;
  cut pieces come off cut stock (ledger kind "sample"), full tiles are record-only.
- **Request Samples + Customer Samples** (CR-317, 2026-10-08). Request Samples from a Quote / SO; the
  Customer page lists every sample line with quantities, date, status and source.
- **Panels column = count → card list** (CR-318, 2026-10-08). Panel Orders sheet shows "N panels"; click
  opens the panels as cards.
- **Panels → Panel Master** (CR-319, 2026-10-08). Rename only.
- **MDF tile on Settings home** (CR-320, 2026-10-08). Settings ▸ Product Masters ▸ MDF.
- **Filter selects clear with ×** (CR-321, 2026-10-08). Picker filters back on one row; applied filter
  shows a clear × (shared `FilterSelect`, all Panel Craft bars).
- **Pending Cut Stock names its orders** (CR-322, 2026-10-09). The Orders column lists each order as a
  link with its own quantity (`PNL/2026-27/003 ×4`) instead of a count.

- **Actions tab master–detail** (CR-419, 2026-10-24, LIVE 2026-10-24). Card 1 = one row per panel (pieces pending, marks, board +
  Load board, status, "+"); card 2 = the selected panel's cut pieces with Load Now / "+" and Allocate Stock.
  Pending amber, Loaded green, `.sel` row. ≈ 0.75 h.
- **Actions tab cells** (CR-415, 2026-10-24, LIVE 2026-10-24). Material = cut size / MDF (design behind the Line ⓘ; `pieceLabel`
  keeps the full text for the Loads table + PDF), Status nowrap, disabled Comboboxes visibly locked everywhere
  (`input.combo-input[disabled]`). ≈ 0.5 h.
- **Remarks on a panel** (CR-425, 2026-10-24). Free-text Remarks on the New / Edit Panel form (for the old
  reference ID), shown on the panel page and searchable on /panels (column hidden by default). ≈ 0.5 h.
- **Cut Piece Size master under Panel Items** (CR-426, 2026-10-24). The size list is edited from a Cut Piece Sizes
  button on Panel Items (`/cut-piece-sizes`, Back above the title); gone from Settings ▸ Masters and the Settings tiles. ≈ 0.3 h.
- **Box Weight in Bulk edit, frozen per order line** (CR-427, 2026-10-24, LIVE 2026-10-24). Items Bulk edit gains Box Weight; select-all
  covers every filtered row; `box_weight_kg` snapshot on QuoteItem + OrderItem stamped at line creation, read first by
  Container Planning; loading checks stay live. ≈ 2 h.
- **Settings: Item Master / Panel Master** (CR-428, 2026-10-24, LIVE 2026-10-24). Product Masters → Item Master; new Panel Master
  (Cut Piece Size, MDF); Adjustment Reason + Warehouses under Setup & Configuration. ≈ 0.3 h.
- **Names stored Title Case** (CR-429, 2026-10-24, LIVE 2026-10-24). One server helper (`lib/names.js`) on the generic routes and
  every bypassing writer (panel loads, load boxes, users, Zoho sync); client mirror on the Item form for
  `unique_name` / SKU parity. ≈ 1.5 h.
- **Brand off the Item form** (CR-430, 2026-10-24, LIVE 2026-10-24). Field hidden and no longer required; grid / filter / bulk edit /
  detail unchanged; SKU slot = `00`. ≈ 0.2 h.
- **Item code for the catalog** (CR-473, 2026-10-27). Every item gets `ABBR-SIZE-NNN` (e.g. `LSN-800x1600-7K4`) —
  server-assigned, never repeats, never typed; shown on the item page, grid, pickers, ⌘K, Panel Craft Stock and panel
  pages; admin backfill for existing items. ≈ 1.5 h.
- **Panel Order PDF** (CR-474, 2026-10-27). More ▸ Print order PDF: cover page + one page per panel with the showcase
  photo as large as the page allows and the cut-piece table × ordered qty. ≈ 1.5 h.
- **Delete leaves an Activity trace** (CR-475, 2026-10-27). Deleting a panel order is recorded on the source SO / Quote /
  Customer like a cancel. ≈ 0.1 h.

- **Panel form without a default size** (CR-484, 2026-10-28). ≈ 0.1 h.
- **Sample order Actions tab; header Record Load removed** (CR-485, 2026-10-28). The sample order page carries the
  panel order's tabs; loads are recorded from the Actions tab (Load Now per row, "+" Load…, Dispatch, Load Copy
  per trip) or the Dispatch tab. ≈ 0.8 h.
- **Sample order pick slip** (CR-486, 2026-10-28). More ▸ Print order PDF: items with photo + item code, piece,
  Requested · Supplied · Remaining, line remarks, a blank Broken / Adjustment box per row, the Stock Adjustments
  reminder and sign-off lines. ≈ 1.2 h.
- **Full-tile samples book the sample stock, not batches; only panel items can be sampled** (CR-489, 2026-10-28).
  A full-tile line books the item's full-size piece on Cut Stock in pieces, like a cut-piece line; the batch picker
  is gone from the sample Allocate Stock window and export box stock is never touched; the sample form lists
  Panel Items only. Reverses CR-488 the same day. ≈ 2 h.
- **Full-tile samples book boxes; no dispatch until booked** (CR-488, 2026-10-28, REVERSED by CR-489). Full-tile lines appear on the
  sample Requirements card in boxes (pending pieces ÷ pieces per box); the one Allocate Stock window books pieces and batches together; the load is
  refused until booked, consumes the booked boxes as a "Sample / Display" adjustment and a load delete restores
  them; boxes booked to a sample are not free for a Sales Order. Reverses the 2026-10-08 record-only rule. ≈ 4 h.
- **Allocate Stock on sample orders** (CR-487, 2026-10-28). The sample order's Actions tab carries the panel order's
  Requirements card (Need · In Stock · Allocated · Short) and the same Allocate Stock window; a cut-piece row loads
  only once booked and the load consumes the booking; panel and sample bookings share one pool (no piece promised
  twice); Cut Stock, the item page, the dashboard and Pending Cut Stock count sample bookings and demand. Full
  tiles stay record-only. ≈ 2.5 h.

## 12 · Documentation & process

- This inventory, the Phase 2 heading in the register, the `ContainerFormat` table in the schema doc.
- **Deliverables list** (2026-10-22). `BOFFO-DELIVERABLES.xlsx` (+ `DELIVERABLES.md` twin): every feature with a
  Completed / In progress / Future status, module by module, with a Summary sheet; regenerated by
  `scripts/build-deliverables.mjs`, maintained in Excel afterwards.
- **Data Flow reference** (CR-272, 2026-10-03). A single document listing, for every record type,
  every screen and every server action that can create, change, delete or re-status it, and the one
  place each business rule is meant to live. It ends with a numbered list of the places that enforce
  different rules for the same thing today, so they can be fixed one by one. Every future change
  must update it.

---

- **Hold register** (2026-10-27). [`ON-HOLD.md`](ON-HOLD.md) — requirements the user has deliberately parked, with the
  reason and the revisit trigger (Boffo / Bonza company separation first).

## Not yet built / parked in Phase 2

- Everything in [`ON-HOLD.md`](ON-HOLD.md).

- Suitable Containers on the quote print, PDF and share link (CR-262 follow-up).
- Mix Batch at loading (CR-260 follow-up).
- Weight fitting from a container's max weight (the planner still uses a typed tonnage).
