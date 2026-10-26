# Changes

> Newest first. For the system as it currently stands, see [`SYSTEM.md`](SYSTEM.md);
> for what was requested and whether it shipped, see [`CHANGE-REQUESTS.md`](CHANGE-REQUESTS.md).

## 2026-10-26 — Stock history order, Stock tree, Adjust Stock in the Zoho Books shape with Location Transfer (CR-455…458) — LIVE 2026-10-26

- **Stock history in date order (CR-455).** The Panel Item page's Stock History and the Item master's Production tab list
  entries by the date shown in the Date column (newest first), then by when they were saved. Back-dated adjustments used to
  appear wherever they were saved.
- **Stock tree shows cut-piece rows only where there are special sizes (CR-456).** On Panel Craft ▸ Stock an item whose
  stock is only its full size is one plain row. The chevron and the ↳ rows appear only for items that also have another cut
  size; those rows still add up to the item row.
- **Adjust Stock, Zoho Books shape (CR-457).** Both Adjust Stock pages (Inventory and Panel Craft) now open with a short
  header — Mode of adjustment, Date, Reason, Description — over an Item Table: Item, Batch / Cut Piece Size, Location,
  Available, New on hand (updates as you type) and one signed Qty adjusted field ("+10" adds, "-10" removes). Date and
  Reason are entered once per adjustment, not per line. One line by default, "+ Add line" below.
- **No Cut Piece Size column on the cut-piece Adjust Stock (CR-459).** The Item list itself names the stock row:
  an item alone when only its full size is stocked, "Item · 600x600" for a special cut. Pick the row, enter the qty.
- **Location Transfer from the same screen (CR-458).** The Mode switch offers Location Transfer: pick From and To, list the
  items and the quantity to move. Saving creates one Transfer Order (TRF number, visible under Transfer Orders); the total
  stock never changes, only where it sits. Boxes and cut pieces alike. The bulk Transfer sheet stays for long lists.

## 2026-10-26 — Demo build carries no BOFFO branding; plain "Processing…" instead of the wordmark (CR-454) — BUILT, demo deploy pending

- **Demo = neutral branding (CR-454).** On the demo build (`VITE_DEMO=1`) nothing says Boffo: the fallback organization
  profile is "Demo / Demo Company" with no address, phone, email or bank rows (sidebar mark D, tab title "Demo Order OS",
  tour, PDF letterheads), PDFs print the brand name in the logo band when no logo is saved, the login page stays logo-free,
  and sign-in errors no longer name BOFFO ("No account for …"). The browser tab reads "Order OS" until the profile loads.
  The demo seed scripts create the brand "Stonecraft" instead of "Boffo". Live is unchanged: it still falls back to BOFFO
  until Settings ▸ Organization is saved.
- **Processing indicator on the demo (CR-454).** The busy state shows only its label pulsing — "Processing…" by default,
  "Uploading…" / "Loading…" / "Searching…" where the screen says so — with no wordmark. Live keeps the wordmark, which now
  spells the organization's name from Settings ▸ Organization ("BOFFO" by default) rather than a fixed word.

## 2026-10-26 — Item Bulk Upload, add many Panel Items, Location mandatory on orders (CR-451…453) — BUILT, deploy pending

- **Item master ▸ Bulk Upload (CR-451).** A Bulk Upload button beside New Item takes an Excel / CSV file. Download the sample
  template first, fill it, upload: the columns are matched automatically, every row is checked (unknown Size / Finish / Category /
  Glaze / Grade / Party Brand, a bad number, a duplicate inside the file, an item that already exists) and the valid rows are
  created in one go with the same SKU and unique name the Item form would give them. Blank packing figures take the Size's defaults.
- **Panel Items ▸ Add Items (CR-452).** Add Item now lists every active item not yet in Panel Craft with a search box and a
  checkbox per row; tick several and press Add N items. Each gets its full-size cut piece as before.
- **No order without a Location (CR-453).** The Sales Order form has a mandatory Location (Warehouse ▸ Bay), the same picker the
  Panel Order form uses; the Panel Order's Location is mandatory too. The server refuses an order without one on create, edit and
  convert-from-quote as soon as at least one warehouse exists. The order page shows the Location.

## 2026-10-25 — Panel Craft walk: adjustment form, Title Case gaps, Stock tree, Details-vs-Actions split (CR-446…450) — LIVE 2026-10-25

- **Stock adjustment is a line form (CR-446).** Adjust Stock (Panel Craft) and New Stock Adjustment (Inventory) open with ONE
  line and "+ Add line" below, like Zoho Books. Each line shows the **current stock** at the chosen location and carries its own
  Location, Add / Remove, Qty, **Date**, **Reason** and Remark — nothing in a top bar any more. Add Stock and Transfer Orders keep
  the bulk sheet, so the two screens no longer look alike. The server stores each line's own date and reason and still refuses a
  removal that would take a location below what it holds, even when split across reasons.
- **Collection Name and other names save as Title Case (CR-447).** The Item form's Collection Name, a container's vessel name, extra
  address attention names and role names now follow the CR-429 rule.
- **Panel Craft ▸ Stock (CR-448).** The "Cut Piece" menu entry is now **Stock**, and the list shows each item as a row with its cut
  pieces beneath it (↳), totals on the item row; fold an item with the chevron, search by item, size or cut size.
- **Panel Item page: weight is never typed; editing moved to Actions (CR-449).** The Details tab shows cut pieces read-only; the
  Actions tab holds the "+ Cut piece" row, remove ✕ and Add Stock · Adjust · Transfer. The weight per piece is the formula value.
- **Panel Order page: Details informative only (CR-450).** The Requirements card (need, in stock, allocated, short, the Available
  tick, Allocate Stock) lives on the Actions tab; Details shows the order's fields and items.

## 2026-10-25 — Organization profile: your logo, name, tax and bank details on everything (CR-445) — LIVE + DEMO 2026-10-25

- **Settings ▸ Organization (CR-445).** A new first entry in Settings where an Admin uploads the company logo (PNG/JPG)
  and types the company name — both required — plus, optionally, legal name, GSTIN / PAN / IEC, address, phone,
  email, website and bank details. Save any time; the app picks it up at once: sidebar and login logo, the browser
  tab title, every PDF and print (quotes, dispatch and panel load copies, packing report, pallet and batch slips,
  invoices) and the shared quote / batch / pallet pages. Until a profile is saved everything looks as before.
- **Demo builds (CR-441…444, 2026-10-25).** A separate demo stack (own database, own server, own web address) with
  dummy data; Zoho sign-in works from it; the "Plant Morbi" label is gone app-wide; the demo login shows no logo
  until one is saved in Settings ▸ Organization.

## 2026-10-24 — Masters out of the main menu, clearer master tabs (CR-440) — LIVE 2026-10-24

- **Masters only under Settings (CR-440).** The sidebar no longer lists Masters; the menu lives in Settings (gear) ▸
  Masters ▸ Item / Panel / Export. Old links and search still open it. The master tabs are bordered pills with the
  selected one highlighted, so the current tab is obvious.

## 2026-10-24 — Masters page as menu + sub-menu with horizontal tabs (CR-439) — LIVE 2026-10-24

- **Masters menu inside Settings (CR-439).** The Settings page's left menu now has **Masters ▸ Item / Panel / Export**
  as a menu with a sub-menu; the chosen group opens on the right under its own title ("Item Master") with its masters
  as **horizontal tabs** (Items | Size Master | Finish | …) that swap the list in place. Item is the first group. The
  sidebar Masters entry opens that same page on Masters; roles without Settings access see the Masters menu only.
  Links, redirects and search land exactly where they did.

## 2026-10-24 — Location per item / per row when recording production and cut pieces (CR-438) — BUILT, deploy pending

- **Pick a Location per item, not one for the whole form (CR-438).** Log Production now asks for the Location inside
  each item's section (the batches of one item share it); Production Completion has a Location column per line. The
  bulk Record Production sheet, cut-stock Add / Adjust and Stock Adjustments gained a last **Location** column per row —
  leave it blank and the row goes to the Location in the bar, which stays as the default; Excel paste accepts
  "Warehouse ▸ A1" or just "A1". The Excel import takes an optional Location column (blank rows use the Default
  location picker). The same item and size at two bays on one sheet is no longer flagged as a duplicate, and the
  on-hand hints and "only N on hand" warnings follow the row's own bay. Transfer orders are unchanged.

## 2026-10-24 — One Masters page, Base Design Name defaults to the Design Name (CR-436, CR-437) — LIVE 2026-10-24

- **One Masters page (CR-436).** The sidebar has a single **Masters** entry. Inside, three sub-tabs — **Export Master**
  (Pallet Master, Container Master, Vehicles, Payment Terms, Adjustment Reason, Currencies, Warehouses & Locations),
  **Item Master** (Items, Size Master, Finish, Category, Glaze, Box Brand, Customer Brand, Grade, Surface Application,
  Punch Type, Series, Catalogue) and **Panel Master** (Panel Items, Cut Piece Size, MDF, Panels) — each a row of tabs,
  and the chosen master opens right there. The separate Pallet Master, Container Master, Panel Items and Panel Master
  menu entries are gone; old links and every Close / Back from a pallet, size, container or panel land on the right tab.
  Settings keeps one Masters tile group so the header search still finds every list. Roles with Items or Panel Craft
  view see the page; admin-only lists stay admin-only inside it.
- **Base Design Name defaults to the Design Name (CR-437).** Leave Base Design Name blank on an item and it is saved
  as the Design Name. The field still clears with × while editing, so a different base can be picked at any time.

## 2026-10-24 — Base Design search, whiter menu text in Light mode (CR-434, CR-435) — LIVE 2026-10-24

- **Search items for the Base Design Name (CR-434).** The Item form's Base Design Name now has the same 🔍 button as
  the Design Owner and Buyer pickers. It opens a Search Items window — active items with their SKU, size, collection
  and customer brand — and picking a row fills the field with that item's name. The item being edited is left out.
- **Menu text whiter in Light mode (CR-435).** The sidebar's menu labels, group titles and the user line are brighter
  on the dark rail in Light mode; Dark mode is unchanged.

## 2026-10-24 — Load Copy from the Actions tab (CR-433) — LIVE 2026-10-24 (with CR-431/432 server side)

- **Load Copy where you dispatch (CR-433).** The panel order's Actions tab now has a **Load Copy** menu listing every
  vehicle trip, newest first. Each entry downloads that trip's copy only — the pieces and boards that left on that
  vehicle — so items from earlier dispatches never appear on a new copy, and every past trip keeps its own. The
  Dispatch tab's Loads table kebab still offers the same copies.

## 2026-10-24 — Weight bulk edit frozen per order, Item/Panel Master settings, Title Case names, Brand off the Item form (CR-427…430) — LIVE 2026-10-24

- **Box Weight in Bulk edit, frozen per order (CR-427).** On Items, Search (the advanced filter) → the header
  checkbox now selects every matching item → Bulk edit has a Box Weight (kg) field. A changed weight applies to
  orders and quotes created from then on: each quote / sales-order line keeps the weight it was created with, and
  Container Planning uses that frozen weight (older lines without one, and rows added in the planner, read the
  live item). Actual container loading checks keep using the live item weight. New `box_weight_kg` on QuoteItem
  and OrderItem (LIVE).
- **Settings groups: Item Master and Panel Master (CR-428).** "Product Masters" is now Item Master; Panel Master
  holds Cut Piece Size (opens the Panel Items list) and MDF; Adjustment Reason and Warehouses moved to Setup &
  Configuration since both modules use them.
- **Names save as Title Case (CR-429).** Item design names, customer / company / contact names, drivers,
  transporters, loading supervisors, user and sales-person names and every lookup master name are stored as
  "Dhiraj Shah Of ABC Exports LLP" however they were typed — once, on the server, for every form, import and
  Zoho sync. Short all-caps words (ABC, MDF, A12) and legal suffixes (LLP, LTD, PVT…) keep their capitals.
  Codes, SKUs, vehicle numbers, sizes and locations are untouched; existing rows change on their next save.
- **Brand off the Item form (CR-430).** The Design Data section no longer shows Brand and it is not required;
  the Items grid, filter, bulk edit and item page still show it.

## 2026-10-24 — MDF and Vinyl independent, instant marks on the Actions tab (CR-431, CR-432)

- **Vinyl no longer waits for MDF (CR-431, reverses CR-401).** On a panel order's Actions tab the Vinyl dropdown
  works whatever the MDF state; the server accepts it too. Pasted still unlocks only when BOTH MDF and Vinyl are
  Ready ("Mark MDF and Vinyl Printing Ready first").
- **Marks change the moment you pick them (CR-432).** The dropdown used to sit on the old value until the save
  finished and the page had re-downloaded every panel order. Now the new value shows at once, the save runs in the
  background (an error puts the old value back with a message), and the page only patches that one order.

## 2026-10-24 — Cut Piece Size master under Panel Items (CR-426)

- **Cut Piece Sizes live in Panel Craft.** The Panel Items page has a Cut Piece Sizes button that opens the size
  list (`/cut-piece-sizes`, same New / Edit / Delete as before, Back returns to Panel Items). The entry under
  Settings ▸ Masters and the Settings tile are gone; typing a new size on a cut-size picker still works.

## 2026-10-24 — Remarks on a panel (CR-425)

- **Remarks on the Panel master.** New / Edit Panel has a Remarks box under Vinyl Size for free text such as
  the old reference ID. It shows on the panel page (Panel Details) and `/panels` search matches it; a Remarks
  column is available in the grid (hidden by default). New `Panel.remarks` column; `/panel-save` stores it.

## 2026-10-24 — Darker sidebar in Light mode, Panel Craft data reset (CR-423, CR-424)

- **Sidebar is near-black in Light mode (CR-423).** The menu rail's tint was 82 % black and looked grey over
  the pale wallpaper. Light mode now uses 94 %; Dark mode is unchanged. One token in `glass.css`.
- **Panel Craft starts empty (CR-424, LIVE data).** Every panel order (14), sample order line (8), load (3),
  cut-stock entry (34), cut-piece item (31), panel (9), MDF row (4) and the matching Activity (418) and status
  history (43) rows were hard-deleted, so PANEL-, PNL/, SMP/ and LD/ numbers restart at 001. Cut Piece Sizes,
  Adjustment Reasons, Warehouses, Customers and Items were not touched. Add Stock on an item brings it back into
  Panel Craft; add MDF sizes in Settings before a panel order line can pick one.
- **Export transactions start empty too (CR-424, LIVE data, same afternoon).** Quotes (1 + 1 line), Sales Orders
  (3 + 6 lines + 1 event), Production entries incl. opening stock and transfers (40), Palletization plans (3 + 15
  lines), Load boxes (10) and all status history (126) were hard-deleted. The Operations log kept only its
  Customer rows (3,002); every other row (277) went. Vehicle, Customers, Items and every master stay; QT/SO/PAL/
  LOAD/TRF numbers restart at 001. No Item carried a singular opening stock, so nothing was reset on Items.
- **Item master emptied as well (CR-424, LIVE data, same afternoon).** The 12 Items (9 real designs + 3 ZZT test rows)
  were hard-deleted; DesignPallet, recipes and Item activity were already empty. Sizes, Brands, Grades, Finishes,
  Categories, Glazes, Catalogues, Series, Punches, Surface Applications, Pallets and Container formats stay, so new
  Items pick from the same lists. Their uploaded images remain in the file store as orphans.

## 2026-10-24 — Actions tab: panels on top, cut pieces of the selected panel below (CR-419)

- **One row per panel.** The Actions tab's first table lists each panel once: its pieces still pending, the MDF ·
  Vinyl · Pasted marks, its MDF board (pending count + a Load box) and one status. Pending counts are amber,
  loaded ones say Loaded.
- **Click a panel, see its cut pieces.** A second table under it shows that panel's piece kinds with their own
  Load Now boxes and "+" menu; Allocate Stock sits on it. The panel with something pending is selected on open.
- Dispatch still loads everything typed on any panel. No empty spanning cells any more.
- Verified: tsc, vite build, `panelOrderNeeds` self-check. **Deployed live 2026-10-24**; browser walk + commit pending.

## 2026-10-24 — Shorter Actions tab, no long notes, two Production views, Kanban hidden (CR-415…418)

- **Material cell says the cut size (CR-415).** On a panel order's Actions tab (and Record Load, the Dispatch tab)
  a piece row reads `150x150`, the board row `MDF`; the design name is in the Line (i) card. The Status cell stays
  on one line. The Loads table and the Load Copy PDF keep "design · size".
- **Locked marks look locked (CR-415).** Vinyl before MDF is Ready, and Pasted before both are, were already
  disabled — now they are visibly greyed wherever they sit, with the reason on hover.
- **No more paragraphs under tables (CR-416).** Thirteen how-to notes are gone across Panel Craft, Settings,
  Warehouses, Users and Loading. What blocks a row is said in its Status cell and tooltips.
- **Production toolbar (CR-417).** Two views, Table and Sheet. Kanban, To Produce and Import are hidden; Filter,
  search, Group, Fields, Edit, Start New Production and Bulk Record Production stay.
- **Kanban hidden everywhere (CR-418).** Packing, Panel Orders and Sales Orders show the Sheet only; the Default
  view setting is hidden with it.
- Verified: tsc, vite build, `panelOrderNeeds` self-check. **Deployed live 2026-10-24**; browser walk + commit pending.

## 2026-10-24 — Add Stock brings the item into Panel Craft (CR-414)

- **One step instead of two.** The Add Stock sheet (Panel Items ▸ Add Stock, and the Cut Piece page) now lists
  every active item from the Item master, not just the ones already in Panel Craft, and any cut piece size —
  pick an item, a size (or leave it blank for the full size, or type a new size and Create it), a qty, Save.
  The item joins Panel Craft with that stock and its weight in the same save. Bulk and Excel paste as before.
- **Add Stock / Adjust from an item** open the sheet with that item already in the first row and come back to it.
- **"+ Cut piece" on the item has an On Hand box.** Type a qty and it records a receipt (same effect as Add
  Stock, one ledger row); leave it blank and it only defines the piece at 0 pcs, as before.
- **Add Item stays** for "define with nothing on hand"; Adjust and Transfer are unchanged.
- Server: a receipt for a pair not defined yet creates it with the line's weight, and gives a weight to a piece
  that had none — the `0 kg *` rows fill in on their next receipt. Deployed 2026-10-24; browser walk pending.

## 2026-10-24 — A location at every stage: produced, palletized, ready for loading, panels (CR-411…413)

- **Production always records a location (CR-411).** The bulk Record Production sheet, the Complete Production
  dialog and the Excel import now have the same Location picker Record Output has. The default is the bay of the
  warehouse marked **Production** (purposes finally do something), else the primary's first location. Nothing
  recorded from a production screen lands on "▸ Unassigned" any more.
- **Pallets have a location (CR-412).** When you Start or Complete palletization the dialog asks for ONE
  location for all the items — prefilled with the **Palletization** bay on Start and the **Loading Bay** on
  Complete, so the common path costs no extra click. Change it any time with **Set Location**: the "+" menu on a
  card or row (checked items come along), the selection bar's **Set Location (n)**, the /loading row menu, or the
  plan's More menu. A **Location** column on the packing and loading sheets, a Location group-by on /packing, the
  location on the card, Item ▸ Locations ▸ **On pallets at**, and a **Pallets** view on Reports ▸ Stock
  Locations. Once a pallet is in a container its place is the container. Stock maths unchanged — a location on a
  pallet is a tag, not a transfer. One live column (`PalletizationPlanLine.warehouse`).
- **Panel orders take a location on the form (CR-413).** Optional Location under Order Details when creating or
  editing; the detail's Set Location still works.
- Verified: tsc, server syntax, `warehouseStock.check` + `warehouseReduce.check` (unchanged, passing).
  **Deployed live 2026-10-24** (client + both functions; this deploy also carried CR-408…410). Browser walk +
  API drive pending; commit pending.

## 2026-10-23 — Settings search everywhere · Warehouse ▸ Location (A1 … F12) · Panel location (CR-408…410)

- **Find any setting (CR-408).** The header search (⌘K) now lists settings pages and preferences for admins
  — type "godown" and Warehouses & Locations comes up. The Settings search matches every word you type,
  knows synonyms (godown, truck, login), and finds the Preferences rows (batch series, default view…).
- **Locations inside a warehouse (CR-409).** Settings ▸ Warehouses & Locations: a warehouse holds locations
  like A1 … F12 — the row's "+" adds one or generates the whole grid (rows A–F × bays 1–12, 72 in one go,
  existing codes skipped). Every stock picker (Record Output, Opening Stock, adjustments, transfers, cut
  sheets) now picks a **location** ("Main Godown ▸ A1", type `c4` to jump); stock stays there until a
  Transfer Order moves it. Item ▸ Locations, Panel Item ▸ Locations and the report (now **Stock Locations**)
  list only the locations that hold something. Stock recorded before the locations existed shows as
  "▸ Unassigned" until transferred. One live column (`Warehouse.parent`); the stock maths is unchanged.
- **Panel location (CR-410).** A panel order's More menu gains **Set Location**; the order shows a Location
  field, the Panel Orders grid has a Location column (hidden until used), and Stock Locations has a Panels
  view. One live column (`PanelOrder.warehouse`).
- Verified: `warehouseStock.check`, `warehouseReduce.check` (both unchanged and passing), tsc. **Deployed live
  2026-10-24** with CR-411…413; browser walk + API drive pending.

## 2026-10-23 — Load a whole panel, pieces of a panel, or its pasted MDF (CR-405…407)

- **Pieces load per kind, in any count (CR-405).** On the Actions tab (and Record Load, the Dispatch tab)
  each panel now lists one row per cut-piece kind on it — "Grey · 300x300 · ordered 6" — plus its MDF
  board. Type any count on a piece row: 2 of the 6 grey pieces can leave today, the rest later. Stock,
  booking and the pending figures move per piece kind. Loads recorded before today (whole panels) still
  read correctly. Two columns were added live on the load-line table (design, cut piece size).
- **Every panel has an MDF row (CR-406)** — even when no thickness was picked on the order line (that is
  why the three panels in the screenshot showed no MDF row). It loads once the vinyl is pasted on it.
- **Load whole panel + readable marks (CR-407).** The "+" on a panel's first row offers *Load whole panel*
  (every ready piece row and, once pasted, its board, on one vehicle); *Load…* on any row still loads that
  row alone; Dispatch loads everything typed. The Actions tab head gains *Allocate Stock*. The MDF ·
  Vinyl · Pasted dropdowns now show their value — the "× ⌄" was the clear button eating the label.
- Verified: `panelOrderNeeds` self-check, tsc, vite build, appauth 5/5. **Deployed live 2026-10-23** (functions + client); API drive + commit pending.

## 2026-10-23 — Readiness tab on every Panel / Sample order (CR-404)

- **Order readiness at a glance.** A new **Readiness** tab (first after Details) shows the user's Order Readiness
  Dashboard design in the house glass skin: a ring of panels ready to load out of the total with a one-line
  headline ("3 of 4 panels pending · next up: Cut pieces"), Panels · Pieces · Ready to load · Pending tiles, one
  ring per stage — MDF · Vinyl · Pasted · Cut pieces · Weighed · Loaded — and a table with the six stage cells
  per panel (done / next step / pending), its quantity and a Loaded / Ready / "<stage> pending" chip.
- **Nothing new to fill in.** Every stage is read from what the godown already records: the per-panel marks,
  the booking on the Requirements card (pieces that already left count as done), the known weight, the loads.
  A loose cut piece skips the three panel marks. A sample order shows its one stage, Supplied, per item.
- Per order only, by the user's decision; a global view can follow later.
- Verified: `panelOrderNeeds` self-check, tsc, vite build, mocked screenshots in dark + light. **LIVE 2026-10-23** (deployed with the pending CR-365…403 batch); commit pending.

## 2026-10-23 — Panel Order page: customer heading, one four-state status, marks on the Actions tab, free loading (CR-399…403)

- **Customer first (CR-399).** The Panel Order page title is the customer's name; `PNL/FY/NNN` sits small in
  the sub line with an "Open customer" link and the Loading chip. The left rail reads the same way.
- **One status, no stage buttons (CR-400).** Accept / Start Cutting / Ready are gone. The header chip, the
  Orders grid, its kanban columns, the Status filter and the dashboard all show the SAME derived status:
  **New** (some panel not yet pasted) → **Ready** (every panel's MDF · Vinyl · Pasted Ready) → **Completed**
  (Ready and every cut piece booked) → **Dispatched** (last load) — plus Cancelled. The stored lifecycle
  column is dormant: an order stays `NewRequest` until its last load; marks, Allocate Stock and loads work
  from the day the order is raised (server `PANEL_ORDER_OPEN` includes NewRequest). The order-level Cut
  Pieces mark and the Production Readiness card are gone. Lists without stock data (Source tab, Panel
  detail, Customer ▸ Panels, Loading page) read the collapsed lifecycle label — New / Ready / Dispatched.
- **Vinyl waits for MDF (CR-401).** The Vinyl Printing mark is greyed ("Mark MDF Ready first") until that
  panel's MDF is Ready; the server refuses it the same way. Pasting still waits for both.
- **Marks on the Actions tab (CR-402).** MDF · Vinyl · Pasted are set on the Actions tab, once per panel
  line, beside the loading rows; the Items card on Details keeps image · panel (i) · weights · qty.
- **Load pieces, boards, or both (CR-403).** A panel's cut pieces (and loose cut pieces) load once booked;
  its MDF board loads once the vinyl is pasted on it; nothing else gates a row. Load one row with its "+"
  menu or everything ready with Dispatch. Reverses CR-380/383, where pieces waited for the panel's marks.
- Verified: `panelOrderNeeds` self-check, tsc, vite build, appauth 5/5. **Deployed live 2026-10-23**; browser drive + commit pending.

## 2026-10-23 — Panel / Sample order rows: ⓘ instead of the photo, one column set, one-line stock verdict (CR-398)

- **The photo leaves the order line; an ⓘ carries it (CR-398).** On New Panel Order and New Sample Order
  the 28px thumb sat inside the Item cell on cut-piece / sample rows but beside the details text on panel
  rows, so the pickers of the two row kinds started at different x and the "Details" column held a
  combobox on one row and prose on the next (user: "Photo in details not necessary at the time of adding.
  Show it with the info icon. Align the controls properly."). Now every row is Panel / Item · ⓘ · Cut
  Size · MDF Thickness · Weight · Qty · ✕ — a panel row shows "—" under Cut Size, a cut-piece row "—"
  under MDF; the ⓘ (`InfoDot`, pcBits) shows the record's details on hover and opens its photos in the
  existing lightbox on click. Sample rows: Item · ⓘ · Piece · Cut Piece Size · Qty · Note · ✕.
- **Cut Piece Stock Check is one line while creating.** The per-cut-piece rows with the per-panel
  breakdown are gone from the form; the green / amber `Note` ("Stock covers this order" / "Short on cut
  pieces") stays. The breakdown is unchanged on the saved order's detail page.
- The Panel form's Total line no longer wraps inside the 280px totals block.
- tsc + build pass; deploy + commit pending.

## 2026-10-23 — Design Master to the new spec: per-item packing, owner / buyer, buyer brands, four new lookups (CR-391…397)

- **Pcs Per Packing is the item's own (CR-391).** The user's Design Master spec: "Pcs Per Packing – do not
  take from size master." The field is typed on the Item form (the Size value only prefills it), coverage
  ft² / m² are ƒx fields from the item's own width × length × pcs and are stamped server-side on every
  item save, and a Size edit no longer rewrites item pcs or coverage (box weight keeps its CR-133 default
  rule). Pallet coverage still follows the Size.
- **Design Owner and Custom Design Buyer (CR-392).** Two Customer pickers (Combobox + search modal) on the
  item; the owner is prefilled from a new Settings ▸ Preferences "Default design owner" (the spec's
  "default will be boffo"). Customer delete / dedupe guard both links.
- **Buyer brands per customer (CR-393).** A Customer Brand now belongs to a customer: the item's "Custom
  Design Buyer Brand" list narrows to the buyer's brands (plus unassigned legacy names), a typed new brand
  is filed under that buyer, and the Customer detail gains a **Customer Brands** list (add / delete). The
  spec's "Customer Master — Customer Brands, add multiple" lands here with no new table.
- **Four new lookups (CR-394).** Surface Application, Punch Type (with image), Series and Catalogue —
  Settings ▸ Masters entries, tiles, Design FKs, delete guards. Picked under Design Data / Marketing Data.
- **Base Design Name picked from items (CR-395).** A Combobox over existing design names (still stored
  as the name).
- **Form in the spec's five sections, image on the form, status editable on edit (CR-396).** Main
  Information · Calculations · Design Data (image at the top) · Working Data · Marketing Data. Status
  values stay Active / Inactive (2026-07-06 rule); only the grouping changed.
- **Capacity queries paged (CR-397, drive-by).** `/load-container` and `/fit-suggest` read every item's
  coverage with a bare SELECT that stopped at 300 rows; now paged.
- LIVE: four tables + seven columns created via the Catalyst MCP (ids in DATASTORE-SCHEMA.md). tsc + build
  pass; **DEPLOYED LIVE 2026-10-23** (functions + client, one `catalyst deploy` that also carried the
  pending CR-365…390 batches); commit pending.

## 2026-10-22 — Noise cuts: a status once per screen, no field that repeats the title, no empty columns (CR-390)

- **Eleven repeated details removed (CR-390).** From the audit's noise group, approved as a plan. Panel Order
  detail keeps one progress chip and loses its Stage row and two of three note sentences; the Panel Orders
  grid drops the Pending column (the Loading Status tooltip has it); the Dispatch card loses its Plan line;
  the Loading card its two container chips; the SO detail its PO / SO rows; the Loading detail its Order(s)
  and Customer rows; Production detail and grid hide Date / Customer / Created / Modified and the empty
  Batch / Mfg Date columns by default; the Palletization detail loses the vehicle number everywhere (its
  lines' column is now "Loading", a Container link); the Loading box grid hides Date, Name and Container
  format and shows the LOAD code + Container No. Storage keys bumped so saved column pickers pick up the new
  defaults. tsc + build pass; not deployed.

## 2026-10-22 — Internal wording off the screen: Zoho ids behind (i), no raw ids in toasts, Documents tab gone (CR-389)

- **Four leaks closed (CR-389).** The user asked for the "unnecessary details and chips" audit's leak group
  first. Customer detail no longer prints the raw CRM / Books ids in the Zoho row; the sentence stays and
  the ids open from an (i) card. The New Palletization toast never shows a `#rowid`. The order drawer on
  /byorder and /kanban loses its Documents tab, which only ever said storage wasn't connected, and its
  Activity note names the Audit Log instead of a route. Panel Order, Panel Item and Panel Items weight
  tooltips drop the `ƒx` prefix for plain words. tsc + build pass; not deployed.

## 2026-10-22 — Design-glitch sweep: numbers never wrap, 15 skin fixes (CR-388)

- **A number and its unit stay on one line (CR-388).** The user, Panel Order Items card: "Adjust spaces so KG
  and values come in single line." `20.25 kg` was breaking after the number in the kg columns. Every numeric
  table cell is now `white-space: nowrap` (`.tbl td.num`, production sheet, quote table), so the column takes
  the width it needs and the other columns give way.
- **Fourteen more glitches from a code audit (CR-388).** The user then asked "Find design glitches in the
  code?" and said "start working on it." Rendering bugs fixed: a phantom 10th column on the Loading Workspace
  Sheet band row, a see-through chart tooltip, locked/formula fields that looked editable under the glass
  skin, an invisible input focus ring on the light theme, a beige stripe in the shared quote. Polish: hover no
  longer hides a selected row or a load band, in-row buttons line up with the selects, the "Add container"
  dashed outline is back, hover borders show, Panel Orders' Ready colour follows the theme, 22 inline
  compact-button styles became one `.hbtn.sm` class, 15 inline card headers became `.card-head`, two dead
  duplicate CSS blocks removed, the Mix-batch chip keeps its amber. tsc + build pass; not deployed.

## 2026-10-22 — Import all customers runs through; duplicates are reported after it (CR-387)

- **No duplicate gate in front of Import all (CR-387).** The user, Settings ▸ Zoho CRM: "as soon as I hit
  import contact, I get message merge duplicate… We need to have all imports, skip duplicate, and once done
  then duplicate only." The CR-373 pre-check refused to start the pull while any duplicate group existed,
  although the sync itself already skips a duplicate name per record and reports it (CR-372). The groups it
  showed were leftovers of the 2026-10-21 runs before the pager fix; today's refresh created its one new
  customer once. Now the confirm opens at once, every page runs, and Find duplicates runs when the pull ends
  (also after a page that timed out), so the Duplicate customers card lists what is left to merge; the summary
  toast says `N duplicates skipped — see Duplicate customers below`. The two offset pagers behind the sync and
  the dedupe now order by ROWID, so a page sequence can never skip a row again. tsc + build pass; deployed 2026-10-22.

## 2026-10-22 — Grid cells show a count + (i) card instead of a list of records (CR-386)

- **No more inline record lists in a cell (CR-386).** The user, Pending Cut Stock: "At all places if there are
  items such as Orders, Panels, give (i) tag and show count or small details. Showing these details ruins the
  designs." The Orders column stacked three or four `PNL/… ×n` links and tripled the row height. It now reads
  `3 orders` with an (i); clicking it opens a floating card (new `InfoTag`) listing each order with the pieces it
  needs, each a link. Row click still opens the item. The user then asked for "a proper card, not in line", so the
  CR-352 line-details row under Loading / Items rows is gone too: the same (i) card now carries the panel size,
  vinyl, MDF and design rows there. Standing rule for every grid from here on. tsc + build pass; deploy, browser
  drive, commit pending (joins the CR-365…385 tree).

## 2026-10-22 — Customer page in tabs; status pills stop wrapping (CR-384, CR-385)

- **Customer detail is four tabs (CR-384).** The user: "Except associated orders, everything is tab."
  Details = Primary Details + Additional Addresses (the Associated Orders table is gone).
  **Transactions** = collapsible sections — Sales Orders (every SO, newest first, open by default),
  Quotes (new on this page: Quote No · Date · Status · Sales Order), Samples, Panels — each with its count
  in the heading. **Dispatch** and **Activity** are their own tabs. Same tab row as the Quote / Order pages.
- **Status pills never wrap (CR-385).** The user, Orders grid: "These kind of long status ruin the design."
  `Partially Completed — 420 left` / `Partial — 760 of 900` were one pill wrapping to four lines. The pill
  now carries the word only; the count sits beside it in muted mono (`Partially Completed 420 left`,
  `Partial 760 of 900`); hover keeps the full sentence. The SO detail header chip is the word alone and its
  Palletization / Loading Status rows read `Partial · 760 of 900`. Every `.chip` is now `white-space: nowrap`.
  tsc + build pass; deploy, browser drive, commit pending (joins the CR-365…383 built-not-deployed tree).

## 2026-10-22 — Panel loading: only Ready rows load, "+" Load per row, Requirements grouped by panel, MDF goes pasted (CR-380…383)

- **A panel's cut pieces are ready once they are booked (CR-380).** The user: "my only PANEL-005 is fully
  ready" — yet its row read "Cut pieces not ready" because the Cut Pieces mark is one mark for the whole
  order. Now a panel row's cut-piece readiness is its booking on the Requirements card (Allocated ≥ Need —
  the "Book N more pcs" / "Cut N more" text stays). The order-level Cut Pieces mark no longer gates loading;
  it still feeds the order's derived Status on the Production Readiness card.
- **Rows that are not Ready cannot load (CR-381).** Load Now sits at 0 and disabled on every blocked row
  (title = what is missing) on the Actions tab AND in Record Load (which gained the same Status column —
  the Loading page opens it too); "Load all pending" became **Load all ready**. The server
  (`/panel-load-save`) now refuses a pick whose panel marks are not Ready — 409 "PANEL-004 MDF on
  PNL/…: MDF not ready · Not pasted on MDF" (`materialBlockers`, mirrors client `materialReadiness`); the
  booking + on-hand gate for pieces is unchanged. Sample rows have no marks and load as before.
- **"+" menu on every Ready to Dispatch row (CR-382).** The house "+" menu (as on the Loading page) with
  **Load…** opens Record Load preset to THAT row alone (every other row 0); greyed with the missing reason on a
  blocked row. The **Requirements card is grouped panel-wise**: a band per panel (PANEL-004 · PANEL-005 …; a
  row whose pieces serve two panels bands under both codes; loose cut-piece lines band as "Cut piece"), the
  rows below it unchanged — still one row per design × cut size with its Available tick.
- **An MDF board loads only once the vinyl is pasted on it (CR-383).** The user: "only vinyl ready is not
  enough — Pasted on MDF marked Ready makes the MDF loadable." The MDF row now needs the panel's MDF, Vinyl
  AND Pasted marks Ready (the missing list names each). Notes under both tables say so.
  Self-check `panelOrderNeeds.test.ts` updated; tsc + build + appauth pass; deploy, drive, browser drive,
  commit pending (joins the CR-365…379 built-not-deployed tree).

## 2026-10-22 — Account menu at the bottom of the menu rail (CR-379)

- **Your name is now at the bottom of the left rail** (CR-379). Click it for Settings (Admin), Keyboard
  shortcuts, the tours, the Light / Dark / Match system choice (a tick marks the current one) and Sign out.
  The top bar keeps only Search and the bell; the moon/sun button and the gear moved into this menu.
  The menu list scrolls on short screens while your name stays put.

## 2026-10-22 — BOFFO Glass: the app's new look, on every page (CR-378)

- **Glass skin, app-wide** (CR-378). Every page now uses the app's own "glass" design system:
  a soft wallpaper, a floating dark menu rail with pill items, a see-through toolbar with a round search box,
  translucent cards with a soft rim, pill buttons and chips, big display titles. Dark by default; the header's
  moon / sun / screen button switches to light or follows the computer, remembered per device. Customers gets
  an initials tile beside each name, a Status column and an All / Active / Inactive switch. Printed documents
  and the sign-in screen keep their own look. Spec: `docs/DESIGN-SYSTEM-GLASS.md`; kit page `#/glass-kit` (Admin).

## 2026-10-22 — Loading sheet: design first, container details behind "+" (CR-374…375)

- **Design first** (CR-374). In the loading sheet a container starts as one line — C1, C2 — with its design
  rows under it and "Add Items in Bulk" below them. Nothing about the container, vehicle or seals shows until
  the container has a design; then the C1 line's **+** menu offers **Container & vehicle…**, which opens a
  window with every detail (container, name, container no., vehicle, driver, seals, size, transporter, LR,
  destination, supervisor); Dispatch and the documents live in the same menu. The numbers typed show beside
  it. Containers are called C1, C2… throughout — the LOAD number appears once, at the top. The status chip and
  the step labels are gone, and the columns line up under their headings.
- **Pick lists** (CR-375). The small arrow on every search box no longer sits on top of the text; a long
  name is cut short before it.

## 2026-10-22 — Panel orders: MDF · Vinyl · Pasted marked per panel on the Items card (CR-376…377)

- **Per-panel marks (CR-376).** The user: "move status update for MDF, Vinyl print, paste in the Item column…
  team will mark individual item-wise MDF, Vinyl and make it ready to load; loads might go in different
  vehicles; keep the cut piece as it is." MDF, Vinyl Printing and Vinyl Pasted on MDF are now marked **per
  panel line** — `PanelOrder.checkpoints.panels[panelId][key]` (same JSON column, no schema change; keyed by
  the Panel ROWID because a panel sits on one line per order and the key survives the wholesale line rewrite
  on edit). Cut Pieces stays one order-level mark. `POST /panel-order-checkpoint/:rowid {key, status, panel}` —
  `panel` required for the three (400), must be on a live line (400), the CR-366 pasting gate is checked per
  panel (409). Legacy order-level marks still read for a panel without its own (`lineCheckpoint` fallback,
  server `lineCp`) — nothing migrated. `panelProgress` = cut Ready AND every panel line's three Ready AND every
  piece booked → Ready; any mark anywhere → In Progress. `materialReadiness` (Actions tab) reads the row's own
  panel, so PANEL-A's MDF row can be Ready while PANEL-B's still says "MDF not ready" — each Dispatch is one
  vehicle, so they leave on different trips (already CR-347).
- **Items card columns (CR-377).** Image · Panel (i) · **MDF · Vinyl · Pasted** · Pieces kg · MDF kg · Total kg ·
  Qty. Panel Size, Designs and the MDF spec column are gone from the table — the (i) toggle on the Panel cell
  opens the same `LineInfoRow` the Actions / Dispatch tabs use (panel size · vinyl size · MDF · ordered + the
  design rows). Each mark cell is the house Combobox while the order is open and the user may edit (chip
  otherwise); the cell title carries the spec (MDF label / vinyl size), who · when, and the pasting gate.
  Cut-piece lines show "—". The Production Readiness card keeps only the Cut Pieces row + the overall chip.
  Helper note under the table. Self-check `panelOrderNeeds.test.ts` + `scripts/drive-cr365.mjs` extended.
  tsc + build + self-check + appauth pass; deploy, drive, browser drive, commit pending.

## 2026-10-22 — Customer deliverables list

- **`docs/BOFFO-DELIVERABLES.xlsx` + `docs/DELIVERABLES.md`.** One feature-wise list of every deliverable with a
  status — Completed / In progress / Future — built from the Phase 1 and Phase 2 inventories, the register and
  the open to-do lists (164 rows: 130 · 8 · 26). Generated by `scripts/build-deliverables.mjs`; the Excel is the
  working copy the customer-facing Future section is maintained in from here on. Document only, no CR number.

## 2026-10-22 — Customers: duplicates found and merged, the sync never twins again (CR-372…373)

- **Why there were duplicates** (CR-372). The 2026-10-21 imports created a second customer for most Zoho
  CRM accounts (822 customers for about 530 accounts) and handed the same CUS- code to two customers: the
  sync looked up existing customers with a query that silently stops at 300 rows. The lookup now reads
  every customer, so an account that is already here is updated, never created again.
- **Duplicate names are an error, not a new customer** (CR-372). When a CRM account arrives whose name is
  already on a customer linked to a *different* CRM account, or on several unlinked customers, nothing is
  written: the run reports "duplicate — already linked to CUS-… ; merge the accounts in Zoho CRM" and
  moves on. CRM comes first: an existing Zoho Books or add-on customer with that name is simply linked
  to the CRM account and takes its values.
- **Duplicate customers card** (CR-373). Settings ▸ Zoho CRM ▸ Duplicate customers: **Find duplicates**
  lists each CRM account that has two or more customers here — the one synced in CRM & Books stays, the
  others are merged into it with their quotations, sales orders, panel orders and sample orders; codes used
  twice are renewed; names shared by different CRM accounts are listed at the bottom and left alone.
  **Merge N duplicates** does it after a Yes/No confirmation. **Import all** refuses to run while
  duplicates exist.

## 2026-10-22 — Panel orders: Actions tab, one status, pasting gate, Cancel (CR-365…368)

- **Actions tab on every panel order** (CR-365). Beside Details and Dispatch: one row per line and
  material (panel, MDF board, cut piece) with Ordered · Loaded · Pending, a **Status** that says
  **Ready** or exactly what is missing ("MDF not ready", "Vinyl not printed", "Not pasted on MDF",
  "Book 3 more pcs", "Cut 2 more"), and a **Load Now** quantity. **Dispatch** opens Record Load with
  those quantities filled in; vehicle, driver and photos are entered there as before.
- **Vinyl Pasted waits for MDF and Vinyl** (CR-366). The Vinyl Pasted on MDF checkpoint can be marked
  Ready only once MDF and Vinyl Printing are both Ready — the dropdown is greyed until then and the
  server refuses the same way.
- **One status on the Orders grid** (CR-367). The MDF, Vinyl Printing, Cut Pieces, Vinyl Pasted and
  Readiness columns are gone. The Status column now reads **Pending** (new request), **Not Started**
  (accepted, nothing done), **In Progress** (any checkpoint, booking or partial load), **Ready** (all
  four checkpoints Ready and every piece booked), **Completed** (dispatched) or **Cancelled**. The
  kanban groups by the same states; the panel order page shows the same chip, with the lifecycle stage
  (New / Received / In Cutting / Ready / Dispatched) as a Stage field and the dashboard's Latest Orders
  table shows both.
- **Cancel Order** (CR-368). More ▸ Cancel Order on a panel order or a sample order asks for a reason
  (required for everyone, Admin included) and cancels it: booked cut pieces return to free stock and the
  order stops counting against stock. An order that already has a load cannot be cancelled — delete the
  loads in the Dispatch tab first (each returns its pieces). A sample order cancels only while nothing has
  been supplied.

## 2026-10-22 — Palletization: Discard a task, Delete returns stock, Cancel Order returns everything (CR-369…371)

- **Discard…** (CR-369). The "+" menu on Ready for Palletization and In Palletization gains Discard…:
  type the boxes and a reason, and the boxes leave the task and return to free stock — the order's
  allocation is returned. Same dialog as Release… on Palletization Completed. A reason is now required for
  every release and discard, Admin included.
- **Deleting a palletization returns its boxes** (CR-370). Delete on the palletization page first returns
  every line's boxes to free stock, then removes the plan. It is refused while any of its boxes sit in a
  container — release those first. Reason required.
- **Cancel Order empties the board** (CR-371). Cancel Order on a sales order now asks for a reason and
  then takes its boxes out of open containers, removes every palletization line and hands every allocation
  back to stock. If any box is already in a dispatched container the cancel is refused with the container
  named — nothing changes. Before this, a cancelled order quietly kept palletized boxes claimed.

## 2026-10-21 — Palletization pages no longer carry a status filter (CR-364)

- **The status dropdown is gone from Ready for Palletization, In Palletization and Palletization
  Completed** (CR-364). Each page is one stage since the split, so the dropdown only ever showed rows
  that belong to another page. Every page now lists its own rows, nothing else.

## 2026-10-21 — The CRM & Books status now fills in for every synced customer (CR-363)

- **Most customers showed "CRM only" although they are synced with Books** (CR-363). The cause was on
  our side: the server asked Zoho for a fresh sign-in token every time it switched between CRM and Books,
  and Zoho allows only ten such requests per ten minutes. Once the quota was gone the Books check failed
  quietly and the customer was recorded as CRM only. The server now keeps one token per system (one
  request an hour each), a throttled request says "wait 10 minutes" instead of asking to reconnect, and
  any Books problem during an import is listed under the sync card. Run **Import all customers** once
  more: customers already imported are not re-fetched, only their Zoho Books link is checked and filled.

## 2026-10-21 — Customers show whether they are in Zoho CRM, Zoho Books, or both (CR-362)

- **Zoho link status on every customer** (CR-362). The Customers grid column now reads **Zoho** with a
  chip: **CRM & Books** (green — the account is linked to a Books contact by Zoho's own CRM ⇄ Books
  integration), **CRM only** (amber — in CRM, not synced with Books), **Books only** (the old Books mapping
  with no CRM account), or a dash. The customer page spells it out ("Synced in Zoho CRM & Zoho Books",
  "In Zoho CRM, not synced with Zoho Books", …) with both ids, and the advanced filter takes the same four
  states. Behind it the CRM pull asks Zoho Books once per account whether a linked contact exists; that is
  what fills the Books id, so run **Import all customers** once after this ships. Books stays hidden.
- **Import all is safe to re-run** (CR-362, same day). The first live import stopped with a browser "fetch error"
  after about 560 accounts: each page of 25 took close to the server's 30-second limit. Pages are now 10
  accounts, and a re-run skips every account already imported and unchanged, so finishing an interrupted
  import costs seconds. If it stops, the message names the page; just run Import all again.

## 2026-10-21 — Palletization is three pages; palletized boxes can be released (CR-360, CR-361)

- **Three palletization pages, one stage each** (CR-360). The sidebar now reads **Ready for
  Palletization** (the queue), **In Palletization** (work in progress only) and the new **Palletization
  Completed** (`/palletized`: palletized stock waiting to be loaded). In Palletization no longer lists the
  completed rows. The Loading and Dispatch sheet keeps its own Ready for Loading section. The page guide
  covers the third page.
- **Release** (CR-361). Every row's **+** menu on Palletization Completed and on Loading and Dispatch has
  **Release…**: type how many boxes and a reason (Admin may leave it blank). Boxes sitting in an **open
  container** return to **Ready for Loading** (the rest of the line stays loaded). Boxes that are
  palletized but not loaded return to **free stock** — the line shrinks or disappears and the order's
  allocation is returned, so Available stock rises and the order must allocate again to reuse them. A
  dispatched container, a queue line and a line still in palletization cannot be released this way. On the
  loading sheet this replaces the old "Unload item", which took the whole line and asked for no reason.

## 2026-10-21 — Customers now sync with Zoho CRM Accounts; Zoho Books switched off, nothing lost (CR-359)

- **Zoho CRM is the customer source** (CR-359). The client changed direction the same day: customers come
  from **Zoho CRM → Accounts**, not Zoho Books. Same approach as before — changes in CRM reach the add-on
  through the webhook / scheduled pull (CRM tells us only what changed, so a quiet pull costs one call),
  **Import all customers** once from Settings ▸ Zoho CRM, **Create in / Push to Zoho CRM** from a customer's
  More menu, **From Zoho CRM** on the Customers page, Map / Re-pull / Unmap by hand. Contact persons come
  from the account's CRM Contacts and are pushed back too. GSTIN, PAN, GST treatment, Place of Supply,
  Credit Limit and Payment Term are picked up automatically from whatever custom fields the CRM org has
  (matched by label). **Zoho Books is hidden, not removed:** its connection, its code and every existing
  `books_contact_id` stay; CRM links live in a new `crm_account_id` column, so no customer record changed.
  The Customers grid column now reads **Zoho CRM**. Nothing to change in the Zoho API console — an Admin
  connects CRM once from Settings ▸ Zoho CRM (the old Settings ▸ Zoho Books link redirects there).

## 2026-10-21 — Zoho Books customers arrive the moment they change (CR-358)

- **Books → add-on sync is event-driven** (CR-358). Catalyst Signals listens to the Zoho Books organisation
  (customer created / updated) and calls the server's existing incremental pull at once, so a customer
  edited in Books is here within moments instead of up to 30 minutes later. The 30-minute cron becomes a
  once-a-day safety net. Overlapping runs (webhook, cron, Refresh now) now queue one behind the other so
  a brand-new Books customer can never be created twice. Settings ▸ Zoho Books wording updated.

## 2026-10-21 — Panel order cut-piece line defaults to the full size (CR-357)

- **Blank Cut Piece Size on a panel-order cut line = the design's full size** (CR-357). Same CR-289 rule the
  Panel form already follows: the picker reads "Full size — 600x1200" and the server resolves a blank size to
  the `CutPieceSize` row named after the design's Size code (minted on first use), so stock, booking and
  loading key on one row per size. Only the Item is required on a loose cut-piece line now. First item of the
  2026-10-21 Panel Craft list.

## 2026-10-21 — Zoho Books customer sync, both ways, with the Books fields (CR-356)

- **Customers sync with Zoho Books** (CR-356). Every 30 minutes the server pulls the customers changed in
  Zoho Books since the last run (newest-first page, stops at the saved watermark — never a full pull on the
  schedule); **Refresh now** on Settings ▸ Zoho Books runs the same pull. A Books customer already here is
  updated (Books wins where Books has a value; add-on-only fields such as Box Brand or Sales Person are
  untouched); one with the same name is linked; a new one is created with the next CUS number. **Import all
  customers** (Admin, once) brings in every Books customer, 25 per request. From the customer page, More ▸
  **Create in Zoho Books** / **Push to Zoho Books** sends the customer to Books. Reverses the CR-325 rule
  "never a sync"; Map / Re-pull / Unmap stay. Eight Books fields now have columns — GST Treatment, GSTIN,
  Place of Supply, PAN, Website, Credit Limit, Notes (a **Tax & Other** block on the form) and Opening
  Balance (shown only). The Customers grid gets a **Zoho Books** column (Synced) and filter. The connection needs the write scope: Settings shows **Reconnect** until an Admin
  connects once more; nothing changes in the Zoho API console. Also: non-Admins can no longer write the
  `zoho_books_*` settings through the generic routes, and a column projection can no longer leak the token row.

## 2026-10-19 — Every grid: Customer → Design first, system numbers hidden, whole-row click (CR-355)

- **Every grid leads with Customer → Design; the auto-generated number is a hidden column; the whole
  row opens the record** (CR-355). The CR-161 stage-grid rule is now global: Sales Orders (Customer,
  Design, PO Number … SO Number hidden last), Quotes (Quote No hidden last), Invoices, Purchase Orders,
  Customers (Name in the picker, CUS- code hidden), Items (SKU hidden), Panel Orders / Panel Loading
  (PNL / SMP number hidden), Panels (panel code hidden), Stock Transfers (TRF # hidden), the SO-detail
  Palletizations tab and the Production **sheet** view. "Design" on an order-level grid is the record's
  design names in one clipped cell (`ui/DesignNames.tsx`). No column is pinned outside the picker any
  more; every changed grid bumps its column-prefs key to `.v2`. Row click added on Invoices (opens the
  PDF), Purchase Orders, Approvals, Stock Transfers / Adjustments (item stock tab) and Production sheet
  rows outside edit mode. Hand-coded order tables (Source Panel Orders, Customer Samples, PanelsPanel,
  Panel dashboard, Approvals) move Order No to the last column. Customer-supplied numbers (PO, Container
  No.) stay visible. Display only.

## 2026-10-19 — Loading Workspace: two steps per container, C1/C2 naming (CR-354)

- **Loading Workspace: two steps per container, C1/C2 naming** (CR-354). Each container reads **C1, C2 …**
  and is laid out as **1 · Designs & pallets** (the sheet) then **2 · Container & vehicle** (Container pick,
  name, container no., vehicle, driver, seals, More fields, Dispatch) under its rows — step 2 stays a single
  line until the first design is picked, so nothing greyed-out competes with where to start. Tabs view
  mirrors it (rail = step 2). Reverses the "container first" half of CR-350.

---

## 2026-10-19 — Sales Orders: Customer PO first, SO number small (CR-353)

From the user's look at `SO/2026-27/002`: the team works by the customer's PO number, so the Sales Order page
title and the Orders grid's first column now show the **PO Number**; the server-minted `SO/FY/NNN` rides small
under the title (and in the Details card, the left order list, the drawer and the By-Order cards) and remains
the record identity in the database and the URL. In the grid, **SO Number is the last column** (existing column
preferences get it appended automatically). Orders module only, by the user's decision: Production,
Palletization, Loading, Approvals, pipeline cards and the printed SO sheet still say the SO number. This reverses
the 2026-07-20 "SO number on the details card" mandate. Display only — no server, schema or write-path change.
BUILT 2026-10-19 (tsc + build); deploy and commit pending.

## 2026-10-19 — Record Load: vehicle + driver details, Load Copy print, panel name with (i) cards, notes at the bottom (CR-351…352)

From the user's review of the Record Load modal on LIVE (PNL/2026-27/007). BUILT 2026-10-19 (tsc + build +
self-checks); the two `PanelLoad` columns, deploy, drive and commit follow the CR-343…350 batch.

- **Vehicle details on the load + Load Copy** (CR-351). Record Load takes **Vehicle Number** (auto-formatted,
  required) · **Driver Name** · **Driver Mobile**; the trip stores them (`PanelLoad.driver_name` / `driver_mobile`)
  and the Vehicle master is kept silently (CR-185 rule). The Loads table shows driver · mobile under the vehicle;
  its kebab offers **Load Copy** — a branded PDF (vehicle block with number / driver / mobile, LD no. · date ·
  order · customer, line × material × qty × stamped kg, signatures), printed on demand only.
- **Panel name only, details behind (i); notes at the bottom** (CR-352). The Line column on the Record Load and
  Dispatch-tab tables shows just `PANEL-005` (or design · cut size) with an (i) toggle; the card under the line's
  rows lists panel size · vinyl size · MDF · ordered qty and the panel's design rows. Every helper note now sits
  UNDER the content it explains (the booking warning moved below the table), and the bottom note answers "how do I
  load only the MDF": Load Now is what goes on this vehicle — leave 0 on the row that stays back.
  Sweep 2026-10-21: the Loading detail "Fill the load details before dispatch" note moved under the lines table and
  the Item stock-breakdown modal's explainer moved under its table; every other note already sat below its content.

## 2026-10-15 — Panel Craft orders ship in parts: loading entries, merged Orders, size-keyed MDF, Loading Workspace reorder (CR-343…350)

From the user's walkthrough of Panel Craft and the main Loading Workspace. BUILT 2026-10-15 (tsc + build +
self-checks + appauth 16/16; LIVE schema created via MCP); deploy, API drive (`scripts/drive-cr347.mjs`) and commit pending.

- **"Cut Stock" is "Cut Piece"** (CR-343) in the sidebar, the dashboard and the bulk-sheet titles.
- **MDF is a size-keyed master again** (CR-344, reverses CR-342's per-panel link, user decision). Settings ▸
  Masters ▸ MDF = editable rows Size · Thickness · Weight; the Panel master states its MDF Size only; the order
  line offers the thicknesses of that size (auto when one, mandatory once the size has rows). `/migrate-mdf-sizes`
  merges duplicate rows and repoints order lines.
- **One Orders register** (CR-345). Panel and Sample orders in one grid with a Type column and filter; New Order
  asks the type first; `/sample-orders` redirects into it. Detail pages unchanged.
- **Loose cut-piece lines on a panel order** (CR-346). "10 panels + 20 cut pieces" on one order; the pieces
  join the requirements, booking and Pending Cut Piece maths.
- **Loading entries + derived Dispatched** (CR-347). A panel order ships in parts — the cut-piece "panel"
  first, the MDF board later, on different vehicles. Each trip is recorded on the order's new **Dispatch** tab
  (Record Load: date, vehicle, note, photos, qty per line × material; several orders may share one trip =
  one LD/FY/NNN); a load moves the stock it carries (booking-gated), and the last load flips the order to
  Dispatched by itself — the Dispatch button is gone. A sample supply is a load too (`/sample-order-supply`
  retired). Loading Status (Not loaded · Partially loaded · Loaded) + Pending show on the order, the grid and
  the cards; a load can be removed while the order is open.
- **Panel Craft ▸ Loading** (CR-348). Every order with something pending, the house "+" menu per row,
  multi-select → one vehicle trip. Dashboard KPI "Pending to Load".
- **Weight split and frozen** (CR-349). Pieces kg · MDF kg · Total kg per line; what has shipped keeps the
  kg stamped at load time, what is pending follows the master. **Item master box weight needs no change** —
  Sales Orders store no weight copy; every reader is live and the container plan's tonnes are already frozen
  when sent.
- **Loading Workspace: design + container first** (CR-350). The Container pick sits above the items; vehicle
  and seal fields unlock with the first item (a Note says so); Party · PO lead the header with the SO numbers
  small.
## 2026-10-15 — MDF moves into the Panel master (CR-342) — ⚠ superseded by CR-344 the same day

From the client's Panel-module review: MDF is not an item a salesperson picks; it is part of the panel's
technical definition. LIVE 2026-10-15 (functions + client); API drive 8/8; commit pending.

- **Panel master owns its MDF** (CR-342). Each panel has one MDF Size and a list of thickness options,
  each with its board weight (Panel form ▸ MDF section; detail shows the table; clone copies it). The
  `Mdf` table is reused as that variant table (`Mdf.panel`, `Panel.mdf_size`), written only by
  `/panel-save`; a thickness an order line uses cannot be removed (409).
- **Order line picks only the thickness** (CR-342). The MDF cell lists the panel's own thicknesses, picks
  itself when there is one, and is mandatory once the panel has any (client + server). Size and weight
  follow; the MDF checkpoint reads "size · thickness × qty".
- **Settings ▸ MDF is a read-only list** (CR-342). The generic editor is gone; `/mdf` lists every
  panel's thicknesses side by side.

## 2026-10-13 — Flow review: plan-container picker at loading + three latent bugs (CR-338…341)

Built from an end-to-end review of Item → Production → Customer → SO → Container plan → Palletization →
Loading. Built, tsc + build + self-checks pass; deploy, drive and commit pending.

- **Pick the planned container at loading** (CR-338). The plan-hint row on the Loading Workspace is a
  **Plan container** Combobox per order — `C1 · 800x600 format · 24 pallets = 640 boxes`, per-design
  `20P 800x600 · 640 Grey`, badge Planned / Partially sent / Sent / Claimed by … — Fill from plan fills the
  chosen one. The claim is saved on the loading (`load_plan.plan`), so a loaded-but-not-dispatched
  container is no longer offered to the next loading (it was: only dispatched boxes counted). Detail and
  grid show a plan-only loading's own container; the SO's Container Planning card reads one line per
  container with the format and the pallet type per design.
- **Name lookups page past 300 rows** (CR-339). SO/Quote creation resolved designs and customers through
  one unpaged ZCQL query (300-row cap) cached per instance; now paged, and rebuilt once when a needed
  name is missing.
- **Plan edit keeps Box Brand and batches** (CR-340). `/update-pal-plan` carries `box_brand` /
  `pallet_group` from the replaced Planning lines, attributes batch-less lines like create, refuses a
  Completed plan.
- **Stock keyed by item, not name** (CR-341). `designStock`, the opening / adjusted / allocated maps,
  `useStockLookup` and `needProduction` key on the Design ROWID; items that share a design name across
  sizes no longer pool their stock, and Item detail agrees with Allocate Stock.

## 2026-10-13 — Staff default role, guard hardening, Zoho-linked accounts (CR-336…337)

- **Staff** (CR-336). New default role for every new account: view + create + export everywhere, never
  edit, delete or approve. Self-seeds on first use. The Users page's New user form preselects it and
  describes each role from its matrix (full / no delete / view + create / read-only).
- **The guard keeps its promise** (CR-336). Thirteen routes that a create-only role could still call
  (production delete/update/record/stage/complete/status, order-line delete, SO edit, allocate /
  deallocate, send to loading, combine leftovers) are mapped to edit or delete; the save upserts for
  panel orders, sample orders and panels count as edit when they carry a rowid; maintenance routes are
  Admin-only. `routeAction()` + `appauth.test.js`. `/delete-order-item` asks the CR-270 reason.
- **Sign-in status** (CR-337). `AppUser.zoho_zuid` / `zoho_linked_at` stamped on the first Zoho sign-in;
  Users grid column **Sign-in** = Zoho / Password / Both / None. Password optional on New user.
- **Self-provisioning** (CR-337). Users page card **Zoho sign-in domains** (AppSetting
  `zoho_login_domains`, Admin-only write). A first Zoho sign-in from a listed domain creates a Staff
  account; other emails, disabled or removed accounts are refused with a specific message.

## 2026-10-12 — Warehouses, Transfer Orders, Warehouse Stock report, Locations on items (CR-329…332)

**LIVE 2026-10-12 (functions + client deployed; tsc + build; `warehouseStock.check.ts`, `warehouseReduce.check.js` and the four stock checks pass; live API drive `scripts/drive-cr329.mjs` 11/11 with ZZT rows removed). Browser walk and commit pending.**

- **Warehouses** (CR-329). Settings ▸ Warehouses: name, Primary ★, purposes (Production · Palletization ·
  Loading Bay · Raw Material · Sample Cut Panels, any number), note. Until the first warehouse exists nothing
  changes anywhere. The first one saved is the primary; stock recorded without a warehouse counts there.
  Record Output, Opening Stock, Stock Adjustments and the cut-stock sheets pick a warehouse (default primary).
  Marking another warehouse primary first pins the unassigned history to the old one, so nothing moves.
- **Transfer Orders** (CR-330). Inventory ▸ Transfer Orders: New Transfer is the bulk sheet with From / To
  and a reason; each line is refused beyond what the From warehouse holds. Cut pieces transfer from
  Cut Stock ▸ Transfer. Every transfer gets a `TRF/2026-27/NNN` number and appears in the list with
  From → To, the reason and who did it. Global stock never changes — only where it sits.
- **Loaded boxes leave the right place.** Loading screens are untouched: boxes a container takes are
  netted from the warehouse holding that batch, Loading Bay purpose first, then the fullest.
- **Warehouse Stock report** (CR-331). Boxes or cut pieces, list or Item × Warehouse matrix, a tile per
  warehouse, CSV. Batch-wise Stock's totals row now carries the Adjusted total it was missing.
- **Locations on items** (CR-332). Item detail ▸ Locations tab (warehouse → batches, on hand · committed ·
  available); Panel Item detail ▸ Locations card (warehouse × cut size).

## 2026-10-12 — Loading Workspace Sheet mode (CR-335)

**LIVE 2026-10-12 (client-only deploy; tsc + build + self-checks); drive and commit pending.** Design: artboard 4 on https://claude.ai/artifact/YP9GKRqMBNybyrzR3XVdt9

- **Tabs | Sheet** on the Loading Workspace. Sheet shows every container of the loading on one grid: a band row per
  container with its name, container no., vehicle, driver, e-seal and line seal typed inline (More fields for the
  rest), its status, Dispatch and Documents, then the design rows under it. Add designs under any container
  without switching tabs; stock, reasons and the ✕ rules are the same as the tabs.
- Opens on the org's default view (Settings ▸ Preferences ▸ Default view), and remembers your last choice.

## 2026-10-12 — Loading Workspace follow-ups (CR-334) + container renaming (CR-333)

**LIVE 2026-10-12 (client, then functions deployed by the user; tsc + build); drive and commit pending.**

CR-333 **Container renaming** is live: a Container name typed on the tab's rail becomes the tab title (LOAD code underneath) and is searchable on the Loadings grid. The ✕ that removes or deletes a container sits on its tab.

- **Add Items in Bulk** is the bulk button's name again (same picker). Every sheet row has a ✕; a blank row just clears.
- **Removing a loaded item or a saved container asks for a reason** (Admin: Yes / No), exactly like Delete. The item
  returns to Ready for Loading; a saved container's ✕ deletes that loading. Unsaved rows and tabs clear without a prompt.
- The sheet no longer scrolls sideways on a wide screen; the vehicle rail stacks below it under 1280 px.

## 2026-10-12 — Loading Workspace: a tab per container, every customer listed, reasons everywhere (CR-326…328)

**LIVE 2026-10-12 (client-only deploy; tsc + build + `nextStep` / `newLoadingRows` / `loadSheetEdit` / `sealChecks` self-checks); live drive and commit pending.** Design canvas: https://claude.ai/artifact/YP9GKRqMBNybyrzR3XVdt9

- **Loading Workspace** (CR-326). New Loading and a loading's Edit are one page: **one tab per container**.
  Each tab is a plain sheet (Design · Order · Batch · Pallets · Boxes · Pallet No. · Pallet type · Box Brand;
  a blank row appears as you type) beside that container's own **vehicle & seals rail** (driver, mobile,
  container no., e-seal, line seal, transporter, LR, destination, supervisor). Status follows the data
  (items → In Loading, container no. or seal → Ready for Dispatch) and each open tab has its own
  **Dispatch** button; a dispatched tab locks and shows its documents (Loading Sheet · Dispatch Copy ·
  Pallet QR labels · Packing Report). Edit opens every container of a multi-container loading as tabs.
- **Every customer in the Customer box** (CR-327) on New Loading and New Palletization, with the 🔍 search
  modal from the Quote / SO forms. Customers with ready stock sort first with their count.
- **"What to do first"** (CR-328). When a customer has nothing to load or palletize, an amber note lists
  each order and its next step (approve · allocate stock · send to palletization · complete palletization).
  The same rule writes the **Next:** line on the Sales Order's Items card, the empty-list reasons in Send to
  Loading and the Load dialog, and replaces "No match" in pickers with the actual reason.

## 2026-10-12 — Sign in with Zoho + Zoho Books customer mapping (CR-324…325)

**BUILT 2026-10-12 (functions + client; tsc + build, offline route smoke test, `booksMap.check.ts`); deploy and the browser drive wait on the Zoho API-console client; commit pending.**

- **Sign in with Zoho** (CR-324). The login page leads with a Zoho button; the password form stays
  below. A Zoho account signs in only when its email is an existing, active app user — roles stay
  Admin-controlled, nothing is auto-created. Consent starts on `accounts.zoho.in`; accounts in other
  Zoho data centres still work. Same 7-day session, same cookie, same sign-out as before.
- **Map a customer to Zoho Books** (CR-325). An Admin connects the Zoho Books organisation once
  (Settings ▸ Zoho Books). Then Customers ▸ **From Zoho Books** creates a customer from a Books contact,
  and a customer's More menu offers **Map to Zoho Books** / **Re-pull** / **Unmap**. Picking a contact
  opens the normal customer form prefilled from it; nothing is written until Save. This is a manual
  mapping, never a sync. GSTIN and the other Books tax fields have no column yet and are not mapped.
- **Secrets out of git.** `functions/data-ops/catalyst-config.json` (function env vars) is gitignored;
  `catalyst-config.example.json` documents the keys. The committed `FX_CRON_KEY` should be rotated.

## 2026-10-09 — Fourth checkpoint + Pending Cut Stock names its orders (CR-322…323)

**LIVE 2026-10-09 (functions + client, together with CR-318…321); API drive 3/3; commit pending.**

- **Vinyl Pasted on MDF** (CR-323). A fourth checkpoint on the Production Readiness card, Pending or
  Ready, marked once the printed vinyl is fixed onto the MDF board. Readiness reads "Ready for
  Production" only when all four are Ready; the Panel Orders sheet gains a Vinyl Pasted column.

- **Orders column lists the orders** (CR-322). Each order that needs the cut piece shows as a link with
  its own quantity — `PNL/2026-27/003 ×4` — so a row answers "which order wants these pieces, how many".
  Click the code to open the order; clicking anywhere else on the row still opens the item.

## 2026-10-08 — Sample Orders: a separate order type for customer samples (CR-315…317)

**LIVE 2026-10-08 (functions + client; LIVE schema: `SampleOrder`, `SampleOrderLine`); committed `27473ee`; API drive passed (32 checks, ZZT data removed).**

- **Sample Orders** (CR-315). Panel Craft gains a second order type: a customer's request for item
  samples — a full tile or a cut piece of any item in the Item master — numbered SMP/FY/NNN, kept apart
  from Panel Orders but linked to the same customer. New Sample Order is the Sales Order shape (item,
  Full tile / Cut piece, cut size, qty, note); the order page shows Requested · Supplied · Remaining per
  line. Edit and Delete only while nothing has gone out.
- **Record Supply** (CR-316). One button on the order: date, note and how many of each line go out now —
  partial supplies are fine, the status reads New / Partially Supplied / Supplied on its own. A cut-piece
  sample comes off cut stock (Cut Stock history shows "Sample supplied"); a full tile is recorded only —
  write the opened box off on Stock Adjustments with the "Sample / Display" reason.
- **Request Samples + Customer Samples** (CR-317). "Request Samples" next to "Request Panels" on a Quote or
  Sales Order pre-fills the customer and items; the Customer page gains a Samples section listing every
  sample line with order, quantities, supplied date, status and source — the answer to "what did we send
  this customer, how much, against which request?".
- **Panel Orders grid: Panels column is a count** (CR-318). "N panels" instead of every code; click it for
  the panels as cards (thumb, code, designs, qty, MDF).
- **Panels → Panel Master** (CR-319). Sidebar, page title and dashboard link renamed.
- **MDF on Settings home** (CR-320). Settings ▸ Product Masters ▸ MDF opens the MDF master.
- **Panel picker filters** (CR-321). Design · Panel Size · Cut Piece Size sit on one row again; an applied
  filter shows a × that clears it — on every Panel Craft filter bar.

---

## 2026-10-07 — Cut-piece booking, production checkpoints, Pending Cut Stock (CR-312…314)

**LIVE 2026-10-07 (functions + client; LIVE schema: `PanelOrder.checkpoints`, `PanelOrder.allocation`); API drive passed (28 checks, ZZT data removed); commit pending.**

- **Cut pieces are booked to a panel order** (CR-312). The Requirements card shows Allocated and Short
  (what must still be cut after this order's booking and the free pieces) and an Allocate Stock button:
  one modal, type the booked figure per cut piece — higher books free pieces, lower releases them.
  Free = on hand not booked by any open order. Dispatch now needs every piece booked; Ready books the
  order's own cutting output automatically. A stock removal can no longer dip below what open orders hold.
- **Production checkpoints** (CR-313). MDF (Pending · Ordered · Received · Ready), Vinyl Printing
  (Pending · Printing · Ready) and Cut Pieces (Pending · Ready) are marked independently on the order page,
  with who marked them and when; Overall Readiness reads Pending / In Progress / Ready for Production.
  The orders sheet, kanban cards and dashboard show them.
- **Pending Cut Stock** (CR-314). New Panel Craft page: per cut piece Required · On Hand · Booked · Free ·
  Shortage · Orders, zero-stock items included, Short only / Zero stock only toggles. Cut Stock gains
  Booked and Free columns; the dashboard shortage card links to the page.

---

## 2026-10-07 — Panel Craft as an inventory module: Panel Items, bulk cut stock, adjustments in both modules, MDF weight, filters, dashboard (CR-306…311)

**LIVE 2026-10-07 (functions + client; LIVE schema: tables `CutStockEntry`, `Mdf`, `AdjustmentReason`; columns `CutPieceStock.weight_kg`, `PanelOrderLine.mdf`, `ProductionLog.reason`); API drive passed (22 checks, ZZT data removed); commit pending.**

- **Panel Items** (CR-306). Panel Craft ▸ Panel Items lists the designs you picked from the Item master;
  Add Item pulls one in with its full-size cut piece (weight = box weight ÷ pcs per box). Open an item to add,
  weigh, or remove its cut pieces — the weight of a `600x600` cut is pre-filled from the tile's face share
  and can be typed over. The Panel form now offers only these items and their cut pieces.
- **Cut Stock is a list of cut-piece items** (CR-307): image, item, size, cut piece size, weight per piece,
  on hand, stock weight. **Add Stock is a bulk sheet** with an Entry date (like Bulk Record Production);
  the one-at-a-time modal is gone. Every movement is kept in a dated ledger (receipt, adjustment, cutting
  output, dispatch) that the item page shows as Stock History.
- **Inventory adjustments, both modules** (CR-308). Inventory ▸ Stock Adjustments lists every box-stock
  correction; New Adjustment is a sheet (date, reason, note; Item · Batch · Add / Remove · Qty). Cut Stock ▸
  Adjust Stock is the same sheet for cut pieces. Reasons come from the new Adjustment Reason master
  (Breakage, Damaged in transit, Theft, Count correction, Sample / Display, Other). A removal can never go
  below what is physically on hand; it warns when it eats into boxes a sales order reserved. On-hand
  everywhere (Stock Details, Item STOCK card, reports, batch pickers, allocation) now includes adjustments.
- **MDF per panel-order line + auto weight** (CR-309). New MDF master (Size · Thickness · Weight). Each line
  on a panel order picks its MDF (defaulting to the one matching the panel size); the line and the order
  show Weight = cut pieces × their weight + MDF, × qty.
- **Pick from showcase filters** (CR-310): Design, Panel Size, Cut Piece Size and In stock only.
- **Panel Craft dashboard** (CR-311): open / in-cutting / ready / short counts, cut stock pcs + kg,
  pipeline strip, panels by status, orders per week, what is short, most-ordered panels, latest orders.

---

## 2026-10-07 — Requirements card drops the "Short:" sentence (CR-305)

**LIVE 2026-10-07 (client only); commit pending.**

- The long amber "Short: … have 0 of N" line is gone from the Requirements card. A short row's In Stock
  figure is now red; the status chip and Dispatch button still explain the shortfall on hover.

---

## 2026-10-07 — Panel Order form picks panels from the showcase only (CR-304)

**LIVE 2026-10-07 (client only); commit pending.**

- **"Add panel" is gone.** Panels come in only through Pick from showcase, which already lets you tick
  several tiles and press Done once; each ticked panel becomes a line with Qty 1.

---

## 2026-10-07 — Requirements rows name their panels (CR-303)

**LIVE 2026-10-07 (client only); commit pending.**

- **Panels column on the Requirements checklist.** Every design × cut size row on the panel order page now
  lists which panels it serves and how many pieces each takes (`PANEL-001 ×1 · 456 ×2`); the codes open the
  panel. Rows stay summed per design × cut size so the Available tick and In Stock keep their meaning.
- The form's Cut Piece Stock Check carries the same panel suffix.

---

## 2026-10-07 — Panel Orders hold several panels, like a Sales Order (CR-302)

**LIVE 2026-10-07 (functions + client; schema live, legacy rows migrated); drive + commit pending.**

- **One order, many panels.** A Panel Order is now a customer order with a line per showcase panel
  (Panel + Qty), numbered `PNL/2026-27/NNN`. Earlier, every panel was its own order.
- **Form like the Sales Order.** Order Details on top; a Panels table below with Add panel / Pick from
  showcase, a total of panels and pieces, and the cut-piece stock check summed across all lines.
  Edit and Clone are full pages (`/panel-orders/:id/edit`, `/:id/clone`).
- **Detail like the Sales Order.** PNL number + status, customer link, Edit · stage buttons · More
  (Clone, Delete) on the right; an Items card lists the panels; the Requirements checklist sums every
  line. Edit and Delete work only while the order is New or Received — once cutting starts they are
  greyed with the reason.
- **Stock moves per order.** Ready adds, Dispatch deducts, the pieces of ALL lines at once; Dispatch
  still refuses when any piece is short.
- Grid, board, the Panel Orders tab on Quote / SO, the Panel detail and the Customer section each show
  one row per order with its panel codes and total quantity.

---

## 2026-10-07 — New Loading holds several containers (CR-301)

**LIVE 2026-10-07 (functions + client); drive + commit pending.**

- **One section per container.** New Loading shows `Container 1`, `Container 2`, … each with its own
  Container Master pick in the header, its own Item Table, its own Loading Details | Vehicle Details.
  **+ Add Container** adds one; ✕ removes one. The footer totals the containers.
- **Shared stock.** Pallets one container took are gone from the others, so an item can be split
  10 + 20 pallets across two containers and nothing can be loaded twice.
- **Fill from plan, one container per click.** Each section offers the order's next planned container
  no other section has taken, and starts on that container's format.
- **One Save, N loadings.** Each container becomes its own LOAD/… loading with its own vehicle; they are
  linked (the grid shows `C1/2`, `C2/2`; a loading's page lists its siblings). Server: the line-attach
  route now reports the remainder a partial load splits off, which the next container loads.
- Edit Loading is unchanged: one container.

---

## 2026-10-07 — Container column on the planner rows (CR-300)

**LIVE 2026-10-07; browser drive + commit pending.**

- **Where the container is picked.** Plan Containerisation (Quote + SO) now has a **Container** column
  right after Pallet Type on every item row. The toolbar strip of CR-274 is removed.
- **Each row picks its own container, narrowed by pallet.** A row lists the Container Master containers of
  its size that are built from the row's chosen pallet (none use it → all of the size); default = the
  largest of those. Two items of one size may pack into different containers; the plan repacks live.
- **Saved per container.** The pick persists as the `containerFormat` each container already carried since
  CR-274 and reseeds per row on reopen; the plan-level `formats` key is no longer written. The Container
  Planning tab and the loading prefills read per container, so they keep working unchanged.

## 2026-10-07 — "Palletized" chip; Ready for Palletization is the queue only (CR-299)

**LIVE 2026-10-07; commit pending.**

- **Chip.** A recorded slice of a partially palletized item now wears **Palletized** (was Recorded);
  the unrecorded rows still read Partial.
- **No All on Ready for Palletization.** `/packing` lists only its queue — the status dropdown has no
  All option, so palletized rows never appear there. They live under In Palletization (which keeps
  All) and Ready for Loading on Loading and Dispatch.

## 2026-10-07 — Item STOCK card: Awaiting palletization + drill-downs that work (CR-298)

**LIVE 2026-10-07; commit pending.**

- **Awaiting palletization.** A new row between In production and In loading: boxes an order owns
  (produced or allocated) that are not on a pallet yet, with a per-order drill-down. Available stock
  now itemises on screen — 520 = 40 awaiting + 480 in loading.
- **Bug.** The In loading drill-down (and Overview's "Open quantity across orders") always showed
  nothing: Item detail matched orders on the full item label while the number came from the plain
  design name. One key now.

## 2026-10-07 — Deallocate part of an allocation; stock buttons always visible (CR-297)

**LIVE 2026-10-07 (client + functions); commit pending.**

- **Partial deallocate.** Each allocation row in Deallocate Stock has a Return box (default the whole
  row, capped at allocated − palletised) and a Deallocate button; "5 of 520" trims the row to 515 and
  frees 5. The confirm spells out the split; an amber note flags boxes already palletised.
  `/deallocate-stock/:rowid` accepts `boxes`; without it the whole row goes, as before.
- **Buttons.** Allocate Stock and Deallocate Stock sit side by side on the SO Items card for every
  stages editor, greyed with the reason rather than hidden. The Production tab's ✕ opens the same modal.

## 2026-10-07 — Panel Craft: born New, Available / Unavailable, no Panels tab (CR-294…296)

**LIVE 2026-10-07 (client + functions); commit pending.**

- **Born "New" (CR-294).** Every panel order starts at the first stage, relabelled "New" (chip
  `NEW`) — direct orders no longer start as Received. Accept moves it to Received. The stored value
  is still `NewRequest`; the server's insert rule accepts only that now.
- **Stock column (CR-295).** `/panel-orders` reads `Available` / `Unavailable · n` instead of
  `Covered` / `Short · n`; the pieces still sit in the tooltip.
- **Item detail (CR-296).** Overview | Production only; the Panels tab is hidden. Customer detail
  keeps its Showcase Panels section.

## 2026-10-07 — Upload shows a BOFFO processing state (CR-293)

**LIVE 2026-10-07; commit pending.**

- **BOFFO loader.** New `BoffoLoader` (`ui/BoffoLoader.tsx`): the BOFFO wordmark with its letters
  pulsing in sequence, the house indicator for anything that waits on a request.
- **Image upload.** The Item / Panel image tile shows the loader + "Uploading…" while the file goes
  up. The old `…` glyph + raw filename rows are gone from the single-slot Panel tile; the Item
  master's multi-upload list reads "Uploading N of M…" with check / x / clock icons. Box Brand
  logo tile and the sign-in "checking" screen use the same loader. A failed save no longer leaves
  the tile stuck on "Uploading…".

## 2026-10-07 — Container name spells out the pallet lines (CR-292)

**LIVE 2026-10-07; commit pending.**

- **Container Master auto-name.** `800x1600 - GVT - 2 · [(48*10) + (10*6)] = 540 boxes`: one
  `(boxes per pallet * pallets per container)` term per pallet line, then the box total. The old
  `16 pallets = 540 boxes` form is gone from new saves; existing rows keep their name until re-saved.

## 2026-10-06 (night, Panel Craft) — one image per panel (CR-291)

**Deployed live (client); committed `dd54401`.**

- **Panel detail keeps one image.** The image box on `/panels/:id` is a single "Image" tile: click the
  dashed box to upload, ✕ to delete. Rear View, Other Images, Add Image and the N/5 counter are gone
  from panels. The Item master's five-image manager is unchanged (same component, new `max` prop).

## 2026-10-06 (evening, Panel Craft) — Request Panels from Quote / SO, Panel Order page, requirements checklist, full-size cut piece (CR-286…290)

**Built; deploy (client + functions) + commit pending. `PanelOrder` gained `sales_order`, `quote`, `checklist`
(created on the live Data Store 2026-10-06). One line still to add by hand: `ORDER_STATUS_TONE.NewRequest`
in `pcBits.tsx` (that file was being edited in another session), and the Panel form's `completeLines` /
placeholder change for CR-289.**

- **New Request stage.** Panel Orders now runs New Request → Received → In Cutting → Ready → Dispatched.
  A Quote or Sales Order page has More ▸ **Request Panels**: it opens the New Panel Order page with the
  customer locked and every panel carrying that sale's designs preselected; the rows saved are born New
  Request and show on a new **Panel Orders** tab of the Quote / SO, and every stage flip is mirrored onto
  the source record's Activity. Panel Craft accepts a request with **Accept** (→ Received). Direct New
  Order is still born Received.
- **Panel Order page** (`/panel-orders/:id`). Click a row or card to open it. The header carries the
  status and the forward-step buttons (Accept / Start Cutting / Ready / Dispatch — Dispatch greyed with
  the shortage in its tooltip while stock is short), Edit (greyed: delete and raise again), More ▸ Delete
  (New Request / Received only, reason asked), ✕. Overview | Activity tabs (status timeline + log). The
  grid rows and kanban cards lost their stage buttons; the sheet is now a column-picker grid with Stock,
  Source, Created and Modified columns.
- **Requirements checklist.** On the order page: one row per design × cut piece size with Need, In Stock
  and a manual **Available** tick the godown saves on the order (`PanelOrder.checklist`). An amber
  "Short: Design · size — have 2 of 6" line sits above it, in the sheet's Stock column (`Short · n`) and
  on the kanban card. This replaces the godown print slip.
- **Blank cut piece size = full size** (server). A panel line saved without a cut piece size resolves to
  the design's own Size (a CutPieceSize named after the Size code, created on first use).
- **New Panel Order is a page** at `/panel-orders/new` in the label-left layout with the Customer 🔍
  search modal; the modal is gone.

## 2026-10-06 (late, Panel Craft) — Add Stock, row-click grid + photo view, PANEL numbers, Panel form page (CR-282…285)

**LIVE 2026-10-07 (client + functions); committed `dd54401`.**

- **"Add Stock."** The cut-piece stock button on Panel Orders and Cut Stock, and its dialog title, now say
  Add Stock. Wording only; the dialog still sets the on-hand for a design + cut size.
- **Panels grid opens the record.** No pencil or bin on the rows and no Edit / Clone icons in the toolbar:
  click a row (or a tile) to open the panel, where Edit and More ▸ Clone / Delete live. Bulk Delete on the
  selection stays. This is now a house rule for every grid; Cut Stock rows open the prefilled Add Stock
  dialog, and the Panels tables on Item and Customer detail click through.
- **Photo | Grid view on Panels.** Panels opens as photo tiles (image, code, sizes, designs) — the same tile
  as the New Panel Order picker; a toggle switches to the column grid. Filter, search, sort and paging are
  shared.
- **Panel numbers.** A new panel is numbered `PANEL-001`, `PANEL-002`… by the server; there is no Panel
  Code box any more. Editing keeps the number; Clone gets a fresh one. Needs the functions deploy.
- **New / Edit Panel is a page** like every other form (label-left layout), reached from New panel, Edit
  and More ▸ Clone; the modal is gone.

## 2026-10-06 (late) — Palletization pages read in pallets; partial remainder re-queues (CR-278…281)

**LIVE 2026-10-07 (client + functions); committed `dd54401`.**

- **Each page shows its own rows.** Ready for Palletization opens on the queue, In Palletization opens on
  its own rows plus the recorded (not yet loaded) ones; "All" is still in the dropdown as the overview.
  The two pages had been opening on All and so looked identical (CR-278).
- **Ready Pallets + Pallet columns.** Ordered and Completed are gone from the palletization sheet.
  Ready Pallets shows palletized boxes as pallets with the boxes in brackets, e.g. `8 (480)`; Pallet shows
  the pallet type (Jungli …) instead of the full size-packing-type name. Footer follows (CR-279).
- **Complete Palletization dialog** shows each item's ready pallets (boxes) and remaining boxes (CR-280).
- **Partial Complete re-queues the rest.** Completing 480 of 520 boxes now leaves the 40 under Ready for
  Palletization (Start available again) instead of stuck in In Palletization (CR-281, server).

## 2026-10-06 (night) — Form rows tightened: label gap, one-control-wide full rows, Notes boxes (CR-277)

**LIVE 2026-10-07; committed `dd54401`.**

- **Label hugs its control.** The label column on every form page is now only as wide as the longest
  label in that section (capped where it was), so *Name* no longer sits a hand's width from its box.
- **Full-row fields stay one control wide.** Customer, the formula Name, Remarks and Note still have their
  own row, but the box is the same width as every other control instead of running to the page edge.
- **Notes are real text boxes.** Remarks / Note on Pallet, Container Master, Quote, Sales Order,
  Palletization and Production are multi-line (about three lines, drag to grow); Customer Notes and
  Terms get the same height. No database change.

## 2026-10-06 (evening) — Zoho-style form layout + Customer search modal (CR-275, CR-276)

**LIVE 2026-10-07; committed `dd54401`.**

- **Every form page** (Quote, Sales Order, Item, Pallet, Container Master, Customer, Production,
  Palletization, New Loading) now lays its header fields out label-left / control-right, two pairs per
  row, like Zoho Books. The Customer sits on its own full row with Billing | Shipping under it and a
  divider before the dates / terms. One CSS class (`.form-rows`) — modals keep the old label-above grid.
  Narrow screens stack the label above the control again.
- **Customer search modal**: a magnifier beside the Customer picker on Quote, Sales Order and New
  Palletization opens a searchable customer table (name, code, country, currency, sales person, payment
  term); click or Enter picks, and the form fills in exactly as the inline picker does.
- Swept while there: SO dates use the house calendar; Payment Term / Currency on Quote + SO are
  Comboboxes; checkboxes on form pages no longer look like text inputs. No database change.

## 2026-10-06 (later) — Planner picks the container per Size; the loading starts on it (CR-274)

**Built; deploy + browser drive + commit pending.**

- **Plan Containerisation ▸ Box Fitting**: a Containers strip beside the Box / Weight toggle shows one
  picker per tile size on the plan, listing that size's containers from the Container Master
  (`N pallets = M boxes`). Default is the size's largest, so existing plans open unchanged. Changing
  the pick repacks every container of that size at once; Save keeps it with the plan.
- **Container Planning tab** (SO and Quote): each planned container names the container it was packed for.
- **Loading from the plan**: New Loading opened from the SO, Fill from plan, and the Load dialog's new
  container all start on the plan's container — only when the Container field is still blank. The
  loading's own pick remains what the fill % is measured against.
- Weight Fitting is untouched. No database change.

## 2026-10-06 — Several containers per Size; the loading picks one (CR-273)

**LIVE 2026-10-06 (functions + client); browser drive + commit pending.**

- **Container Master**: a Size may now have any number of containers (different pallet mixes). The
  Size picker offers every size; Clone keeps the size. Server one-per-size key removed.
- **Loading picks its container**: a Container field on New Loading (Loading Details) and on the
  Load dialog's new-container form, stored on the loading (`LoadBox.container_format`). The fill %
  of that loading — while typing and everywhere it is shown afterwards — uses that container's
  boxes. Shown on the loading page header and as a Loadings grid column.
- **No pick**: the size's largest container is the denominator (also what the planner's Box
  Fitting uses). Quote Suitable Containers lists every container of the size.

## 2026-10-03 (evening) — SO Delete obeys "work recorded"; DATA-FLOW.md (CR-271, CR-272)

**LIVE 2026-10-07; committed `dd54401`.**

- **Sales Order ▸ Delete**: refused once any line has work (allocated / palletised / loaded /
  dispatched / on a plan) — "Work is recorded on this order — it can't be deleted. Cancel it
  instead." The SO page greys the Delete item with that reason. Root cause: the form saved through
  the business route carrying the CR-232 rule, the page deleted through the generic table route
  that never had it. The rule now sits on the generic route too.
- **`docs/DATA-FLOW.md`** (new): every mutation path per entity (server route + client surface),
  the owner helper of each rule, the invariant chain, and a 22-row register of paths that enforce
  different rules for the same thing today. Fifth place in the "closing a change" contract.
- **Not fixed yet** (user decision): the divergence register is documentation only; the Orders grid
  bulk delete (DF-06) and the three-way OrderItem delete (DF-01) are the agreed next fix.

## 2026-10-03 — Phase 2 batch 1: Container Master, quote containers, SO remaining, date-first grids (CR-261…266)

**LIVE 2026-10-03 (functions + client); browser drive and commit pending. First Phase 2 batch — see `PHASE-2-FEATURES.md`.**

- **Container Master** (Inventory ▸ Container Master, `/containers`): one record per Size — the pallet
  formats of that size with a count each; total pallets and boxes follow. New table `ContainerFormat`.
- **Pallet Master is boxes only**: no "Pallets / Container", no per-container totals. Fill % on loading and
  palletization and the planner's box fitting now read the size's container format.
- **Quote**: a "Suitable Containers" table on New / Edit Quote and the Quote page (per size: container,
  boxes, containers needed, last fill). Screen only for now.
- **Sales Order Details**: Remaining = Ordered − Allocated, a totals row, and a per-line ✕ → Deallocate
  Stock (by batch; refused once palletized). Also in More for the whole order.
- **Bulk Record Production**: Size · Design · Batch · Box Brand · Qty · Remark; Size narrows the items;
  per-row Date hidden (toolbar date rules); "+ 10 rows".
- **Production**: grid opens grouped by Date, Production ID hidden by default, detail titled by the date
  with the PRD number small. Grid and detail both say `PRD-`.
- **Palletization + Loading grids**: a Date column; PAL / LOAD codes hidden by default (column picker
  re-shows them).
- **/prod buttons** (CR-267): Bulk Record Production is the primary button, Start New Production secondary.
- **Discard prompt** (CR-268): leaving unsaved changes asks "Discard changes?" with Yes / No wording everywhere, never "Delete".
- Legacy per-shipment container page moved to `/container-shipments` (still hidden).

## 2026-09-19 — New Loading is two steps; vehicle sits with the sheet (CR-225)

- The "Vehicle & loading" step is gone. After **Select items** comes one step, **Seals, sheet & vehicle**:
  the loading sheet first — type truck, container, seals and LR against the designs and boxes — and
  below it the driver, mobile, container size, transporter, destination and supervisor for this container.
- Same day: that lower details card is hidden for now — the step shows the sheet and the Checks card;
  driver, transporter etc. are still editable from the loading's Edit.
- LIVE 2026-09-19 (client deployed); browser drive and commit pending.

## 2026-09-19 — New Palletization: customer on top, in-progress chip (CR-224)

- `/packing/new` no longer has the left customer rail: **Customer** is a required pick list at the
  top of the Plan section, and that customer's orders and designs list below it.
- The "⚠ This order already has an open palletization (PAL/…)" banner is gone. A row whose item is
  already on an open plan shows an amber **Palletization in progress** chip — no PAL number.
- LIVE 2026-09-19 (client deployed); browser drive and commit pending.

## 2026-09-19 — New Palletization starts from the customer (CR-223)

**LIVE 2026-09-19 (functions + client).**

- **New Palletization Plan** opens with a customer list on the left. Search the customer, pick
  them, and every order of theirs with stock to palletize shows on the right.
- Each design shows Order Qty, Produced, Available and the **batches** that production or stock
  allocation has given that order line. Type the boxes per design and choose the pallet.
- **One Save = one plan for that customer**, across as many of their orders as you like.
- **Batches are assigned automatically, oldest first**, when the plan is saved — a hand-made plan
  no longer loses its batch numbers.
- Send to Palletization from a Sales Order, Edit and Clone look the same as before.

---

## 2026-09-19 — Loading Sheet columns (CR-208)

**NOT deployed yet (client-only; LIVE column `PalletizationPlanLine.pallet_type` created).**

- **Design comes first** on each line: Design, Size, Finish, Batch, Box Brand, Pallet No., Boxes, Pallet type.
- **Pallet 2 is removed.** **Pallet type is typed by the user** — blank stays blank.
- **Box Brand fills itself** from the production record, else the Sales Order (which takes it from
  the quote), else the customer's default. It is no longer a dropdown on the sheet.

---

## 2026-09-19 — Security review fixes (CR-205…207)

**NOT deployed yet (server-only, `functions/data-ops`).**

- **Image uploads are raster-only.** The server checks the file's actual bytes — JPG, PNG, GIF,
  WebP, BMP or AVIF. An SVG is refused. Images already stored keep working; the public image
  link can no longer run script if someone opens it as a page.
- **Permissions no longer depend on how a URL is capitalised.** A role without the right for a
  business action (dispatch, create a Sales Order, …) is refused however the path is spelled.
- **A Quote or Sales Order cannot be created already approved.** Both are created only through
  their own forms' routes, where the starting status follows the approver rule; the generic
  create also refuses the status columns it already refused on edit.

---

## 2026-09-18 — New Loading is a three-step page (CR-203)

**DEPLOYED LIVE 2026-09-18 (client-only); browser drive and commit pending.**

- **One page, three steps**: New Loading (toolbar, Sales Order detail, and Add Pallets on a
  loading) opens a full page instead of a modal — **1 Select items** (the same customer rail and
  pick list, plus a container-fill meter) → **2 Vehicle & loading** (vehicle, driver, container,
  seals, transporter… beside what is in the container) → **3 Seals & sheet** (the Loading Sheet
  for all of that customer's open containers, with a checks list). Each step saves with Save.
- **Duplicate warning**: a container number or seal already recorded on another loading shows an
  amber warning on step 3. It never blocks the save.
- Dispatch is unchanged and stays on the loading's detail page.

## 2026-09-18 — New Loading: customer rail, one pick list, batch pick (CR-201…202)

**DEPLOYED LIVE 2026-09-18 (client-only); browser drive and commit pending.**

- **Pick the customer on the left, load on the right** (CR-201): every order of the customer with
  its designs — Design · Box Brand · Batch · Ready · Load — in one list. No Customer / Sales Order /
  Container Size fields any more; container and vehicle details go in Assign Vehicle after Save.
  Batches that are only partly palletised show greyed with the reason instead of disappearing.
- **Choose the batches; the plan only helps** (CR-202): type a design quantity and it spreads
  oldest-batch-first, then adjust any batch. Several designs and orders share the one container.
  **Fill from plan** prefills an order's next planned container — designs outside the plan still load.

## 2026-09-18 — Production first, then SO allocation; container override; customer-wide loading (CR-194…200)

**DEPLOYED LIVE 2026-09-18 (column → function → client), commit pending; browser drive pending.**

- **Production goes to stock** (CR-197/198): Record New Production is Item + Qty only; confirming
  an SO no longer creates production jobs; the SO lost "Record New Production". Record Output
  takes a **Box Brand** per item (prefilled from the orders waiting on it) and the Excel import
  reads an optional Box Brand column.
- **Allocate Stock** (CR-199): on the SO, pick free boxes per batch for each line. The allocation
  is a claim (`alloc` row), not supply — on-hand is unchanged, **free** stock drops — and it feeds
  Ready for Palletization exactly as a production record used to. De-allocate from the SO
  Production tab until the boxes are palletised. Send-to-Loading only ships allocated boxes.
- **Record New Production redesigned, same day** (CR-197 follow-up, client-only, LIVE): the form
  IS the recording — lines first (**Item · Batch No. · Box Brand · Qty**), then Note / Recorded by /
  Production date below. Save creates the job and records each line's output with its batch +
  brand in one go (`productionApi.recordNewProduction`; the job auto-steps to Completed). Batch
  No. is mandatory for batch-tracked items, auto-numbered otherwise; Box Brand prefills from the
  orders waiting on the item. Record Output (`+`) still exists for legacy / partially recorded jobs.
- **What to produce** (CR-200): every open order line shows Allocated / Stock ready / Partial
  stock / In production / Need production; `/prod` has a **To Produce** view with the shortfall
  and the carton brand wanted per item, which prefills a new production job.
- **Overrides** (CR-195/196): a tick lets a container load — and the planner pack — beyond 100%.
- **Loading by customer** (CR-194): New Loading starts from the customer and mixes all their
  orders and designs into one container.
- `scripts/seed-flow.mjs` now produces to stock and allocates (the old step needed SO-confirm jobs).

## 2026-09-15 — Panel images at every sales touchpoint, several panels per sale (CR-192…193)

**DEPLOYED LIVE 2026-09-15 (client-only deploy), commit pending.**

- **Several panels in one sale** (CR-193): the picker tiles multi-select; the form lists each
  picked panel with its thumb, a qty and a remove button; the stock check sums need across all
  of them. Save writes one Panel Order row per panel with the shared customer, date and sales
  person, so the board and the stock machine are unchanged and each panel dispatches on its own.

- **Panel picker is an e-commerce tile grid**: each showcase panel shows its front-view image,
  code, sizes and design names; the picked tile wears the accent ring. Search is unchanged.
- **Order form shows the picked panel**: a thumb beside the picker and a **Panel** section with
  every image; click any image for the lightbox with ‹ › across all of them.
- **Thumbs everywhere else a rep meets a panel**: Panel Orders board cards and Sheet, a new
  Image column on `/panels`, and both Showcase Panels tables (Item + Customer detail). Click
  zooms, never navigates; no image = dashed placeholder.
- Mechanism: the lightbox left `ImageManager` for a shared `ImageLightbox` / `ImageThumb`
  (`features/common`). No server change — images were already in the panel list payload.

## 2026-09-15 — Weight on the Item form, Item wins in planning, form regroup (CR-190…191)

**DEPLOYED LIVE 2026-09-15 (client-only deploy), commit pending.**

- **Box Weight (kg) on the Item** (CR-190): typable in Dimensions & Coverage, prefilled from the
  picked Size (placeholder shows the Size value); a typed value is the item's own and survives
  Size edits (CR-133 guard). Two ƒx fields beside it: **Weight / piece** = box ÷ pcs/box and
  **Weight / m²** = box ÷ coverage m². Item detail Overview gets a **Box weight** row.
- **Planning precedence flipped**: Weight Fitting in Plan Containerisation reads the Item's box
  weight first, the Pallet format's as fallback — matching the server loading-capacity check
  (which always used the Item weight). Before, the planner preferred the Pallet format's copy.
- **Form regroup** (CR-191): Identity → Classification → Dimensions & Coverage (Width, Length,
  Rate / ft², Rate / m², weight group) → **Misc** (Random Faces, Status, Batch-tracked item,
  Opening Stock on edit). Numeric inputs on this form now use the house `NumberInput`.

## 2026-09-14 (night) — Single-image upload tile on the Box Brand form (CR-189)

**Built 2026-09-14, deploy pending.** Client-only.

- The Box Brand master's **Image** field is a 120 px tile instead of a raw file input: click or
  drop to upload, cover preview once set, **Replace** / **Remove** beside it. `ImageUploader`
  is single-image only now; `ImageManager` (Item/Panel detail) is unchanged.

## 2026-09-14 (night) — Container merging in Plan Containerisation (CR-188)

**DEPLOYED LIVE 2026-09-14 (client-only deploy), commit pending.**

- **⇄ Move on every item inside a container** (SO, Quote and Loading-tab planners): pick the
  target container ("C3 · can take 240 boxes") and the quantity (defaults to the most that
  fits). Drag-a-card and the Adjust panel's "Move here" suggestions use the same action.
- **Merges persist.** A move splits the row and tags the moved boxes with the target
  container's `group`; grouped rows pack into one container, and a saved mixed container
  reseeds as grouped rows — so Save + reopen keeps the merge instead of re-packing item-wise
  (the old session-only `moves` layer is gone). Plan JSON unchanged.

## 2026-09-14 (night) — Loading Sheet: design name on prints, manual Pallet No., free-text vehicle, sheet look (CR-183…186)

**DEPLOYED LIVE 2026-09-14 (client-only deploy; LIVE column `PalletizationPlanLine.pallet_no` created), commit pending.**

- **Design name only on prints** (CR-183): Dispatch Entry, Dispatch Copy PDF and pallet QR
  label print `design_name` alone — no composite unique name, no PAL code, no doubled size.
  The Loading Sheet's Design cell follows (it has Size/Finish columns).
- **Manual Pallet No.** (CR-184): typable on the Loading Sheet; typed wins, blank = auto
  range (grey); same value on the two dispatch prints.
- **Vehicle as free text** (CR-185): Vehicle Number / Driver / Mobile are plain inputs in
  Assign Vehicle / Edit Load Details, the new-container form and the sheet's Truck No.;
  `resolveVehicle()` keeps the Vehicle master in sync without the user seeing it.
- **Sheet look** (CR-186): standard rounded house grid (the black-bordered `ruled` variant
  is deleted); "Pallet 1" → "Pallet type".

## 2026-09-14 (evening) — SO tab trims, totals bar, rail order, batch on SO Palletization, Box Brand image (CR-177…182)

**DEPLOYED LIVE 2026-09-14 (LIVE column + client), committed c1d6400.**

- **SO Production tab** (CR-177): Remaining column removed.
- **Totals bar** (CR-178): on /packing and /palletizing the bar under the grid reads
  *Total · N pallets · N boxes* when nothing is ticked (both views, every viewer); the
  "Tick items…" hint and the Sheet's tfoot Total row are gone on these pages.
  - **CR-187 (2026-09-14 night, deploy pending):** the Sheet's totals moved back into a
    column-aligned tfoot (pallets in the first column, Boxes/Ordered/Completed/Remaining
    under their headers); the bar's idle text now shows in Kanban only.
- **Rails** (CR-179): `/packing/:id` and `/loading/:id` sibling rows read *customer · status*
  above and the PAL/LOAD code below.
- **SO Palletization tab** (CR-180): Batch column (mono chip) after Design.
- **Box Brand image** (CR-181): `Brand.logo` (File Store id) created on LIVE; Image upload on the
  Box Brand master; thumbnails in the Box Brand Combobox popup + preview beside the field on the
  Quote, SO and Customer forms (`useBoxBrands()`); Combobox options accept `icon`.
- **Held** (CR-182): Completed / Remaining boxes on the SO Palletization tab — user paused it.

## 2026-09-14 — Two Palletization pages, column pickers, Box Brand, SO tabs, Dispatch always reachable, Edit + More everywhere (CR-160…168)

**DEPLOYED LIVE 2026-09-14 (data-ops + client), committed 3e672e8; manual drive pending.**

- **Palletization is two sidebar pages** (CR-160): `/packing` Ready for Palletization (queue) and
  `/palletizing` In Palletization (+ Ready for Loading, where the Load handoff sits). Same board,
  scoped by a `stages` prop.
- **Column pickers** (CR-161): the /packing Sheet is ColumnDef-driven; on /packing, /loading and
  /prod the ID column (PAL / Loading / Production ID) is last and hideable, and Customer → Design
  lead the default order. Storage keys bumped to `.v2`.
- **Box Brand on Quote + SO** (CR-162): FK `box_brand` → Brand on both tables (LIVE columns
  created), Combobox from the Brand master, prefilled from the customer, carried on convert;
  the free-text Box Branding input is retired. Customer Sheet brand fallback = line → SO → customer.
- **Plan detail** (CR-163): Begin Dispatch / Mark Dispatched / Assign Vehicle removed.
- **SO detail** (CR-164/165): Items table drops In Production + Available; Palletization tab =
  Design · Date · Pallets (fractional, 1 dp) · Boxes · Status + Total, PAL column gone.
- **Dispatch always listed** (CR-166): greyed with the reason until a vehicle is assigned and items
  are loaded; blank seals/transporter/etc. warn in the confirm and in a standing note on `/loading/:id`.
- **Edit + More on every detail page** (CR-167) and **"+" menu on every grid row** (CR-168).

## 2026-09-10 — CR-143 undone: New Loading is a modal form (CR-144)

**DEPLOYED LIVE 2026-09-10 (client only), uncommitted.** The same-day queue board + pallet-first workspace
(CR-143 below) is deleted — `LoadingQueueBoard`, `StartLoadingModal`, `LoadingPlan`,
`virtualPallets`, the `/loading/:id/plan` route and `LoadingDetailsModal` are gone
(28ft/30ft container sizes from CR-142 stay). "New Loading" opens **`NewLoadingModal`**:
SO picker (optional Customer filter, options from Ready-for-Loading stock) + container
size; the SO's containerisation plan propagates (containers with `planProgress` chips,
first unsent container prefilled against ready stock FIFO, all editable), or a flat
checkbox+qty list of palletised lines when no plan exists. One submit = one loading:
`/load-box` minted with a single-slice `load_plan`, `allocateFifo` + `/pal-lines-box`
allocate the lines, land on `/loading/:id`. LoadingDetail's "Plan Loading" → **Add
Pallets** (same modal scoped to the box); `/packing`'s Load confirm lands on the loading
detail; `/loading` opens on Sheet (a persisted "board" view falls back to kanban).

## 2026-09-10 — Loading redesign: queue board + pallet-first workspace, 28ft/30ft (CR-142…143)

**DEPLOYED LIVE 2026-09-10, uncommitted.** The Loading pages follow the Claude Design "Container
Loading" spec (layout + features; house slate/indigo skin, fonts unchanged).

- **Container sizes are 28ft / 30ft** (CR-142): `CONTAINER_TYPES` shrunk from 20ft/40ft/40HQ,
  default 28ft everywhere a default exists; legacy stored sizes still display as-is. The
  **Send as Single/Multiple toggle is gone** — packing is automatic (fits in one container →
  one; overflow chunks into siblings).
- **`/loading` queue board** (CR-143): new default view — active-loading cards (one per Open
  LoadBox: status, customers, container, loaded/planned boxes, fill) + the Loading queue
  (ready work grouped by SO, derived pallet counts, Start loading →). "New Loading" opens
  `StartLoadingModal` (Sales order / Customer / Container / Free pick tabs). Kanban / Sheet /
  Loadings / Customer Sheet unchanged.
- **Pallet-first loading workspace** (CR-143): `/loading/:id/plan` rebuilt — 3 columns:
  Container gauges + Order requirement · Ready pallets (virtual pallet cards from
  `virtualPallets.ts`: full/partial per batch, weight incl. tare; scan input matching pallet
  code / batch / LOAD number; design filters) · Loading plan (floor map + ordered list).
  **Suggest fill** plans full pallets from the requirement and proposes a **Compose mixed
  pallet** for the shortfall (plan-level composition across batches). **Save plan** = advisory
  `load_plan` JSON only (plan-only loadings intact; lines gain `plt`/`mix` keys); **Send for
  loading** also allocates lines via `/pal-lines-box` (partial takes split server-side). The
  old items-table planner (Dispatch Qty grid, SO-plan seeding via `loadingPlanSeed.ts`) is
  retired — `loadingPlanSeed.ts` deleted.

## 2026-09-10 — Loading-first sheet + Customer-only grouping + dispatch reset (CR-141)

**DEPLOYED LIVE 2026-09-10** (this deploy also shipped CR-140's client + data-ops). The
`/loading` Sheet's pinned first column now identifies the **Loading** (LOAD/FY/NNN via
`boxLabel`, vehicle/"Container N" fallback) instead of the display-only PAL-NNN pallet
sequence; the duplicate Container column is gone and the advanced-filter facet is relabelled
"Loading". **Group by offers Customer only** for now — Order/Container/Batch/Item dims removed
from board and sheet; stale persisted selections self-filter on read. Alongside, the LIVE
loading/dispatch test data was reset for a clean Loading retest: every LoadBox soft-deleted,
boxed plan lines un-boxed back to Ready for Loading, plans reverted (ReadyToLoad, or Planning
when only Planning lines remain; dispatch dates cleared), legacy loaded/dispatched
PalletisedBatch rows back to closed, OrderItem loaded/dispatched counters zeroed with stage →
packing, and dispatch history purged (OrderItemEvents, LoadBox/plan/OrderItem
StatusTransitions, OperationLog `dispatched` fan-outs). New loadings continue the LOAD number
sequence.

## 2026-09-10 — Customer Sheet on /loading + Box Brand master (CR-140)

**DEPLOYED LIVE 2026-09-10 (with CR-141).** Fourth `/loading` view **Customer Sheet**: pick one customer
and see every loaded line across all their SOs as the export-style loading sheet — one section
per container (merged Sr / L.R. / Truck / Container / E-seal / Line-seal cells), P.O. per SO
run, Design/Size/Finish/Batch per line, auto-computed pallet ranges ("1 TO 16", running per
container from `ceil(boxes / boxesPerPallet)`), Pallet 1/2 from the Pallet master's A/B
arrangements, Total footer. **Edit** stages everything into drafts and saves sequentially:
L.R./truck/container/seals → `/load-box-update`, P.O. → `SalesOrder.po_number`, per-line
**Box Brand** override → new `PalletizationPlanLine.box_brand` (grey = inherited from the new
`Customer.box_brand` default, set in the customer form). New **BoxBrand** lookup master
(Settings ▸ Product Masters ▸ Box Brand); table + both FK columns already live
(`BoxBrand` 69851000000265385). Server change: `BoxBrand` added to the generic-CRUD ALLOWED
set — **requires a `functions/data-ops` redeploy**. Pure sheet logic in
`customerSheetEdit.ts` with an `npx tsx` self-check.

## 2026-09-09 — SO-first New Loading (CR-126)

**DEPLOYED LIVE 2026-09-09 (client only), uncommitted.** "New Loading" on `/loading` now asks for just
the **Sales Order** and opens the load planner at `/loading/new/plan?so=…` — no record yet.
The planner seeds from the SO's container plan remainder when one exists (empty planner with
Add-item otherwise, same as before); the first **Save mints the LoadBox(es)** — primary created
plain, group stamped once the ROWID exists, siblings pointing at it — and pops a **skippable
container/vehicle details modal** (`LoadingDetailsModal`, reusing the ContainerPicker form;
"Later" defers to Confirm Load). Abandoning the planner leaves nothing behind. The old
container-details-first branch of `useLoadFlow.confirmLoad` is deleted; pallet-mode Load from
`/packing` is unchanged. No server change.

## 2026-09-08 — Batch series setting (CR-125)

**DEPLOYED LIVE 2026-09-08, uncommitted.** Settings → Preferences: admin sets the batch series
**prefix, separator and start number** (defaults `B`, `/`, `1`) with a live preview; the server
builds the auto-minted format `<prefix><sep>YYYY-MM<sep>NNN` from AppSetting keys
(`batch_series_*`, read by `nextBatchNumber`). Per-item monthly restart unchanged. Changing
prefix/separator starts a fresh series (old batches no longer match the scan's LIKE).

## 2026-09-04 — Multi-container loading plan, LOAD series, per-item-month batches (CR-120…124)

**DEPLOYED LIVE 2026-09-08** (`LoadBox.load_number` column → functions → client, in that order), **uncommitted**.

- **Loading plan goes multi-container + SO-plan-seeded** (CR-120): an empty `/loading/:id/plan`
  seeds from the box's own lines + the SO container plan's remainder (`loadingPlanSeed.ts` + test);
  "Send as Single / Multiple containers" auto-packs item-wise with the shared `containerPack.ts`
  math (extracted from the SO planner + test) and Save creates/updates one **sibling LoadBox per
  extra container**, linked via `load_plan.group {id,no,of}` (JSON key, no new column). Items
  table gains Pcs/Box, Ordered, Balance-after; container cards show per-container pallet cells,
  status and vehicle. Reverses CR-119's "one loading = one container" note; stock still moves
  only via the load modal flows.
- **Multi-select Load lands on the plan screen** (CR-121): `useLoadFlow.confirmLoad` navigates
  to `/loading/:id/plan` after loading lines.
- **LOAD series** (CR-122): `LoadBox.load_number` = `LOAD/FY/NNN`, minted in `/load-box`
  (`nextLoadNumber`, prefix-scoped scan); `boxLabel` and server dispatch labels prefer it; old
  boxes keep the fallback label (no backfill). `/packing` item codes stay PAL-NNN.
- **Batch format** (CR-123): auto-minted batches are now `B/YYYY-MM/NNN`, series **per item per
  calendar month** — `nextBatchNumber(catalyst, designId)` with a design+month-scoped scan (also
  fixes the 300-row ZCQL truncation the old global scan silently hit). Typed batches unchanged.
- **Container Planning tab embeds the editable SO planner** (CR-124): `PlanSoContainerisation`
  takes `{soId, embedded}`; multi-SO loadings get an SO chip selector. Save still writes
  `SalesOrder.container_plan`; the `/orders/:id/containerise` route stays.
- Loadings grid + detail derive a **Planned** display state (Open + plan, nothing loaded) and
  show `C n/of` sibling chips / a sibling strip.

## 2026-09-04 — Loading & Dispatch revamp + SO planner fix (CR-115…119)

**DEPLOYED LIVE 2026-09-04** (column → functions → client, in that order), **uncommitted**.
Plan Loading screen re-laid-out same day from the Claude Design "Loading and Dispatch" spec
(info cards + SO chips, mono items table, container pallet-cell graphic), palette mapped to
app theme tokens.

- **BUG fixed:** SO Plan Containerisation's item combobox showed empty — lines were seeded
  with plain `designName` while options are keyed `uniqueName || name`. One-word fix
  (`o.design || o.designName`); also stops the SO planner opening dirty. Quote planner now
  reopens on the saved pallet; "Ready Pallets" header corrected to "Pallets".
- **Two-step palletise** on `/packing` (reverses 2026-08-27's one-hop): Palletise → *In
  Palletization* (pallet confirmed in the modal), then **Mark Palletised** → *Ready for
  Loading*. Middle column/status label renamed "In Palletization".
- **Load lives on `/packing`** now: Ready-for-Loading cards/rows have the Load button and
  load-together checkboxes (shared `useLoadFlow` hook, extracted from LoadingBay). `/loading`
  drops its "Ready for Loading" panel — boxed lines only: In Loading → Ready for Dispatch →
  Dispatched (+ the Loadings grid). Sidebar renamed **"Loading and Dispatch"**.
- **Per-loading plan** (`/loading/:id/plan`, "Plan Loading" on the detail): lines = item +
  batch + order across ANY SOs/customers; "Ready" column = palletised un-boxed stock;
  fulfillment bar = planned % and palletised-covered % of container capacity (Box/Weight
  fitting); per-line "planned earlier" hint from the SO container plan. Stored as
  `LoadBox.load_plan` JSON (text 10000; whitelisted in `/load-box` + `/load-box-update`).
- Deploy order for the plan feature: column (done) → `catalyst deploy` functions → client.
- Verified: tsc, vite build, `productionSheetEdit` + `planProgress` self-checks.

## 2026-09-04 — Design system applied APP-WIDE (slate/indigo)

Working tree — **built, not deployed.** The Panel Craft trial (below, same day) was accepted;
the theme now applies to the whole app.

- **`styles/panelcraft.css` → `styles/theme.css`** — tokens moved to `:root`, all component
  rules de-scoped (the `.nd` wrapper is gone from CSS and the four page roots). The file
  still loads after `styles.css`; equal-specificity ties resolve to it, which is how it
  re-skins the old rules without editing them. Extra `.fbar`/`.page-head`/`.lp-search`
  control overrides were added at the specificity the old 26px skins held.
- **Legacy aliases now on `:root`** — `--panel`, `--fg`, `--muted`, `--c-*`, `--t-*`… point
  at the new palette, so all ~2300 lines of styles.css re-theme untouched. Retire an alias
  only by migrating every rule that reads it.
- **`App.tsx` boot accent override deleted** (`TWEAK_DEFAULTS`/`applyAccent`) — it wrote the
  old orange onto `<html>` at runtime, which would have beaten the `:root` tokens.
- **Deliberately unchanged:** the logo and dark sidebar (`--sidebar-bg`/`--sb-*` not
  remapped), the login screen (`.boffo-auth` scoped), print sheets (own palette), and
  per-grid *behaviour* on non-Panel-Craft pages (row-click, text toolbars) — the new
  conventions (hover row-actions, icon toolbars, `Chip`) retrofit page-by-page as follow-ups.
- Verified: tsc + build clean; headless-Chromium sweep over /quotes, /orders, /prod,
  /loading, /settings, /cut-stock — all themed, no page errors.

## 2026-09-04 — Panel Craft design-system TRIAL (light slate/indigo)

**Superseded same day** — trial accepted and applied app-wide (entry above). Kept for the
record of what the trial covered.

- **`styles/panelcraft.css`** (new, imported after `styles.css`) — the full token set
  (slate surfaces, `--blue` primary, `--accent` indigo, radius/shadow tokens, Inter /
  Space Grotesk / JetBrains Mono) scoped under a **`.nd`** wrapper class, plus a trial-only
  legacy-alias block that re-points the old token names (`--panel`, `--fg`, `--muted`,
  `--c-*`, `--t-*`…) so global classes inside `.nd` re-theme with no TSX changes. Same
  scoping pattern as `login.css`/`.boffo-auth`. Fonts self-hosted in `public/fonts/`
  (7 woff2 files), matching the Puvi precedent.
- **`.nd` applied to the four Panel Craft roots only**: `/cut-stock`, `/panels`,
  `/panels/:id`, `/panel-orders` (+ their in-tree modals). `PanelsPanel` embeds on
  Item/Customer detail keep the old look. Toast/Confirm hosts sit outside the scope (known
  trial limitation).
- **New grid conventions (trial)** — no row-click; hover pencil/trash `.row-actions`
  (always visible on touch), record code is an indigo link to the detail, toolbar is a
  slate bar joined to the grid card with 30×30 icon buttons (`pcBits.tsx` `IconBtn`:
  Edit/Clone enabled at exactly 1 selected, Delete ≥1, disabled = dimmed), per-column
  `FilterSelect` fed by distinct data values, 44px footer.
- **`ui/Chip.tsx`** (new) — the one status-chip component: 9-tone map, tinted pill
  (tone + `18` alpha), CamelCase→spaced labels, renders nothing without a status.
  Panel-order tones: Received amber, InCutting blue, Ready teal, Dispatched green
  (`STAGE_COLOR` dots now match).
- **Page upgrades riding along**: Panels grid gained header sorting (was unsortable) and
  toolbar edit/clone/delete without leaving the grid; Panel Orders sheet became a full
  record grid (sorting, pagination + `GridFooter`, search, status filter — both views
  share the filters); Panel Orders/Panels/CutStock chips + statuses render via `Chip`.
- **`ui/Icon.tsx`**: added `trash`, `copy`, `refresh` (additive).
- Verified via headless-Chromium drive with mocked `data-ops` responses: all 4 pages +
  modal render to spec; `.nd` appears only on the 4 page roots; tsc + vite build clean.

## 2026-09-02 — Sheet-first: every board opens on the grid, default is a setting

Working tree — **built, not deployed.** CR-113, CR-114.

- **Sheet/Grid is the default view** on `/packing`, `/loading`, `/panel-orders` (all three
  previously opened on Kanban) and stays the default on `/prod`. The per-page toggle is
  unchanged and still wins for the rest of the browser session.
- **`useViewState(key, sheet, kanban)`** (`lib/usePersistedState.ts`) — one seam every board
  goes through. Thin wrapper over `usePersistedState`: same sessionStorage behaviour, but the
  initial value comes from the org preference instead of a hard-coded literal.
- **Settings → Preferences → Default view** (Sheet | Kanban) writes `AppSetting.default_view`;
  a missing row means Sheet. `settingsApi.ts` was generalised — the per-key bodies now sit on
  shared `rowFor` / `putSetting` helpers, and the duplicate-batch functions are unchanged
  wrappers over them.
- The setting is fetched asynchronously but a view is seeded synchronously at mount, so
  `settingsApi` mirrors the resolved value to `localStorage["pref.defaultView"]` and
  `cachedDefaultView()` falls back to it. No first-paint flip on a cold tab. `App.tsx` refreshes
  the preference on boot alongside the session check.
- **`/prod` view state moved from `localStorage` to sessionStorage** (key `productionView` →
  `production.view`) so it matches the other three boards and the org default actually applies
  on a new session. Anyone who had Production pinned to Board loses that pinning — one click to
  restore. Its status-tab seed (board → All, else Pending) now reads the resolved view.

## 2026-09-02 — Production sheet: edit mode (bulk qty + status)

Working tree — **deployed LIVE 2026-09-02, not yet committed.** CR-111, CR-112.

- **Edit mode on `/prod` sheet view** (`ProductionTable.tsx`). **Edit** makes three columns
  editable across every row — **In Production** (`qty_requested`), **Produced** (boxes made now),
  **Status** — staged in a draft keyed by plan-line id. Nothing reaches the server until **Save**;
  Cancel or leaving the view asks before discarding. Remaining and the group band totals recompute
  live from the draft. Kanban and grid views are untouched.
- The sheet's old `Requested` column **is** the new editable In Production column (same field);
  the `Produced` column hidden on 2026-08-12 is back, now as the inline output input.
- **`productionSheetEdit.ts`** — pure `resolveSheetEdit(entry, draft)` → server ops or an error.
  Mirrors `RecordOutputForm.capFor()` (line remaining ∩ order remaining, reading the drafted plan
  qty) and refuses a qty change once output exists, matching `/production-update`. An invalid cell
  turns red and disables Save. Self-check: `npx tsx client/src/features/stages/productionSheetEdit.test.ts`.
- **Save** runs per row: `/production-update` → `/production-record` → `/production-stage`, stage
  last so an explicit choice outranks the server's auto-step. Sequential and non-atomic (no
  array-accepting production endpoint); failed rows stay in the draft with a per-row toast.
- Inline output sends **no batch number** — the server mints `B/FY/NNN`. Batch-specific entry
  still goes through the `+` dialog, which is hidden while editing.

## 2026-08-29 — Batch stock overhaul: FIFO reducer, 5 new reports, shade retired

Working tree — **deployed LIVE 2026-08-29, not yet committed.**

- **`deriveBatchStock` reducer** (`client/src/features/stages/batchStockDerive.ts`, zero
  imports) — pure supply/consumption netting per (item, batch). Attributed consumption nets
  its own batch first; blank-batch consumption that is *loaded* nets **FIFO** (blank bucket
  first, then real batches oldest-mfg-date first); the unabsorbed remainder becomes `over` on
  the blank bucket and is never reallocated. Palletising alone does not reduce stock.
  Conservation law `Σ current = Σ supply − Σ absorbed loaded` asserted by
  `batchStockDerive.check.ts` (7 scenarios).
- **`unqueuedBatches` shared helper** (`functions/data-ops/index.js:2078`) — FIFO-available
  boxes per production batch. `autoEnqueuePalletization` was refactored onto it (~25 duplicated
  lines removed), and **`/send-to-loading` now uses it too**: instead of one blank-batch plan
  line per item, it splits the requested boxes across the item's unqueued batches FIFO, one
  line per batch. Skipping palletization no longer loses the batch trail.
- **`batchLedger`** (`client/src/features/stages/batchLedger.ts`) — one row per batch ×
  consumer (Palletised / Loaded / Dispatched / On hand), same "counts once ReadyToLoad or in a
  box" rule as `recountOrderItems`. Invariant `Σ rows == produced + opening`.
- **Five new reports** — Batch-wise Stock (`stock-batch`, over-consumed rows flagged ⚠),
  Batch Movement (`batch-movement`, list + pivot by customer/stage), Palletization Status
  (`pal-status`), Loading & Dispatch (`loading-status`), Dispatch Register
  (`dispatch-register`). Production Batches gained a List/Matrix toggle. Registry is now 14
  reports across 5 sections.
- **`PivotTable.tsx`** — generic cross-tab (row/col/grand totals, rows by total desc);
  **`bucket.ts`** — day/week/month bucketing, week keys computed in **UTC** so a viewer west of
  Greenwich does not roll Monday into the previous week. `ReportShell` gained a `bar` slot for
  per-report controls beside the filter button.
- **Shade retired** — `ProductionLog.shade`, `PalletisedBatch.shade`, `PalletisedBatchLine.shade`
  marked `RETIRED 2026-08-29` in the schema: columns kept, nothing reads or writes them. Removed
  from every insert in `data-ops`, from the Excel import template, the Stock Details grid, the
  batch QR PDF, and the `batchStockApi` grouping key (now `designId + batch` only).
- **Legacy pallet entry points retired** — `FinalLoading.tsx`, `DispatchForm.tsx`,
  `LoadContainerForm.tsx`, `PalletPackForm.tsx`, `Palletizations.tsx` carry a `RETIRED` header
  and have no callers; the `/final` route is deleted; `PalletDetail`'s "Palletize Order" action
  is gone (it drove the `/close-pallet` saga — a second record of boxes the live PalPlan/LoadBox
  flow already counts). **`batchStockApi` still reads the legacy `PalletisedBatch` /
  `ContainerLoading` data as historical supply** — the UI is retired, the data is not.

## 2026-08-27 — Panel Craft, palletise straight to Ready, image manager

- **Panel Craft** — new module: `Panel` / `PanelLine` / `PanelOrder` / `CutPieceSize` /
  `CutPieceStock` tables, `/cut-stock` → `/panels` → `/panel-orders` screens, routes
  `/panel-save`, `/panel-delete/:rowid`, `/panel-order-status/:rowid`, `/cut-stock-adjust`.
  **Reversal in the same pass:** the Panel master is **decoupled from stock** — create/edit/
  delete never touch `CutPieceStock`; only PanelOrder `Ready` (+) and `Dispatched` (−) move it.
  `PANEL_ORDER_TRANSITIONS` is forward-only for that reason.
- **Palletise straight to Ready** — `/packing` drops to 3 columns (Dispatch column gone,
  "Mark ready" deleted); Palletise → `ReadyToLoad` in one hop. Pallet details prefill from the
  SO container plan (`containerPlanPrefill.ts`); the Record Output pallet picker is hidden;
  `/loading` relabels its last column "Dispatched" and shows a plan hint.
- **Image manager** — shared `common/ImageManager.tsx`.
- Commit `9656f22`.

## 2026-08-25 — Container-first loading, Dispatch tab, Record Output multi-item

- **Container-first loading** — `LoadContainerModal` replaces the box picker at all three entry
  points; plan progress is consumed automatically, with no per-container id to manage.
  `dispatch_date` is planned first, then actual. (`0b21918`)
- **Dispatch visibility** — `logRelated` fans loading events onto both the sales order's and the
  PalPlan's activity feeds; one shared `DispatchTab` renders on SO, PalPlan and Quote, and the
  same content as a section on Customer. (`0b21918`)
- **Record Output multi-item modal** — one modal, a section per item, Tab moves across items.
  (`0b21918`)
- **Production stage auto-step** — recording output steps the Kanban stage `New → InProduction`
  on the first record and `→ Completed` once records cover `qty_requested`. QC stays manual-only
  and is dropped from the board. (`0b00bdd`)
- **Produced counter shows committed output only.** (`fa40145`)
- **Loading first-class** — `/loading/:id` detail page, New Loading + delete, `/send-to-loading`
  to skip palletization entirely, Shipping Stage chip; grouped DESIGN-band estimates in all
  three quote renderers, lines storing `unique_name`. (`8d9b75c`)

## 2026-08-22 — Dispatch Control Board redesign + Palletization 2nd stage

- **Dispatch Control Board declutter** — full-width 4-column board, one header Kanban/Sheet
  toggle; dock + loading panes paused (own section later); checkbox multi-select opens
  `PalletiseModal`; Mix Batch top-up via `pallet_group` + `POST /pal-topup`.
- **Palletization 2nd stage** — the Palletizing line status becomes its own "Palletization"
  column; the pallet picker is dropped; Record Output gains a 2nd-stage checkbox. The
  queued-filter invariant holds throughout.
- Deployed LIVE 2026-08-22, commit `b600df5`.

## 2026-08-17 — Batch-aware loading + batch QR share

- **One batch per customer** — PalPlan lines are per-batch; a mixed-batch pallet raises a
  "Mixed batches" warning rather than a block.
- **Batch QR slip + public share page** — `batchQrPdf.ts`, `SharedBatch.tsx`, tokenless
  `GET /public/batch/:token`, token minted by `POST /production-record-share/:rowid`.
- **Uniform Record Output lines.**
- Deployed LIVE 2026-08-17, commit `9349e36`.

## 2026-08-12 — Production polish: designStock unification, SO picker filter, Excel import placement, container tab

- **designStock unification** — Item detail, Reports and transaction line rows all
  derive live stock through the one `designStock()` path in `client/src/lib/stock.ts`
  (`openingStockFor()` picks `accounting_stock` vs summed opening-batch rows per item —
  the guard against double-counting opening).
- **SO picker filter** — Production's Sales Order picker hides fully-produced orders.
- **Excel import** — `/prod` Import button placement finalized (`ProductionImport.tsx`);
  no re-upload dedupe yet.
- **Container planning** — quote-level container planning surfaced as a tab
  (`ContainerPlanCard` on QuoteDetail).
- Deployed LIVE 2026-08-12 (commit `a242dbc`).

## 2026-08-11 — Batch-wise production & opening stock + batch/shade UI revamp

- **`Design.is_batched`** — batch-tracked items. Server rejects flipping the flag
  once the item carries stock.
- **Batch-wise opening stock** — `POST /opening-stock/:designId` stores opening as
  `ProductionLog entry_type="opening"` rows (one per batch); locked after the first
  submission (admin-only re-edit with required `_reason` → OperationLog). Singular
  items keep the `accounting_stock` single number + same lock.
- **Multi-batch recording** — `POST /production-record-lines/:rowid` records several
  batches (qty + batch + mfg_date) against one plan line in one shot; OrderItem
  bumped once, inserts compensated on failure.
- **Duplicate-batch guard** — same item + same batch always 409; cross-item reuse
  controlled by the new **AppSetting** table (`allow_duplicate_batches`, Settings page).
- **Stock Details grid** (`/stock`, `StockDetails.tsx`) — batch-level stock view;
  `batchStockApi` derives per-batch on-hand.
- **Shared pallet page + pallet QR PDF** — `SharedPallet.tsx` public scanner page
  (`#/share/box/<token>`, tokenless `GET /public/pallet/:token`, token minted by
  `POST /load-box-share/:rowid`); printable pallet QR labels (`palletQrPdf.ts`).
- Commits `1342599` (deployed LIVE 2026-08-11) + `96db631`.

## 2026-08-07 — Production batches, mixed pallets, loading capture, auto-enqueue

- **Batch/shade columns** — `ProductionLog.batch_number` (`B/FY/NNN`, auto-minted) +
  `shade`; `PalletisedBatch`/`PalletisedBatchLine` carry batch/shade (header for
  single-batch pallets, per-line truth on mixed).
- **Mixed pallets** — `/combine-leftovers` combines sub-pallet leftovers across items
  into one `is_mixed` pallet (design null, batch/shade per line).
- **Loading capture** — LoadBox gains `container_number` / `line_seal` /
  `electronic_seal` / `loading_supervisor`, set via `/load-box-update` or at dispatch.
- **SO-confirm auto-enqueue** — confirming a Sales Order inserts one production plan
  row per order item (`request_group="so-{soId}"`, deduped on order_item). Auto-queued
  jobs count toward in-production only once *touched* (recorded or dragged out of New);
  a manual request supersedes an untouched auto job.
- **Production Sheet view** — per-row Record button + record prompt on Complete.
- Commits `7609790`, `d1e8509`/`df8abbb` (TDZ fixes), `a8e30f7`.

## 2026-07-31/08-03 — Plan Containerisation

- Quote-level container planning page: split plan boxes into containers, move boxes
  between containers, Remaining column driven by order quantities.
- **Box Fitting / Weight Fitting mode toggle** — Box Fitting (default; capacity fixed
  from the Pallet master) vs Weight Fitting; a saved plan reopens in its mode.
- Commits `2abed9b`, `be87adc`, `73d273f`, `21c39a6`, `27924f8`.

## 2026-07-28/29 — LoadBox vehicle slots + Dispatch Control Board

- **LoadBox** (new table) — cross-plan "boxes" on the Loading columns; dragging any
  Ready line onto In Loading auto-creates/reuses an open box (no +Box/kebab); vehicle
  attaches while Open or is asked at dispatch; a box dispatches as one unit and plan
  status auto-follows (`Loading` → `Completed`). Partial loads split the plan line.
- **Dispatch Control Board** — `/packing` board becomes the two-panel `DispatchBoard`
  (order kanban + Loading bay); `PalKanban` + groupBy swimlanes deleted.
- Commits `9cbdb78`, `c650e72`.

## 2026-07-24 — Security hardening + palletization form polish

- ZCQL injection sweep, read-authz on list routes, httpOnly session cookie (`e3b8946`).
- Palletization form: vehicle picker, PAL links, date rename; instructional modal
  subtitles dropped app-wide (`73113ec`). Vehicle master: auto-hyphen registration
  formatting + Save button (`b8bc2c0`).

## 2026-07-23 — Palletization: per-item stages, produced gate, detail tabs

- **Per-item kanban movement** — palletising is now tracked **per line**, not per
  plan. New `PalletizationPlanLine.status` (`Planning` → `ReadyToLoad`); dragging
  one item card between **In Palletization** and **Ready for Loading** moves only
  that item (`setPalLineStatus` → new server route `POST /pal-line-status/:rowid`).
  Loading & Dispatch stay **per vehicle**: once every line of a plan is Ready, a
  **Load vehicle** button on the Ready column assembles the whole plan onto a
  vehicle and it advances as one card through **In Loading → Dispatched**.
- **"Palletized" stage removed** — plan lifecycle simplified to `Planning →
  Loading → Completed`; the board is now 4 columns. `PAL_TRANSITIONS` and
  `STATUS_CHIP` updated on both client and `data-ops`. **Requires a migration**
  (add `PalletizationPlanLine.status`; backfill lines of already-loaded/dispatched
  plans to `ReadyToLoad`; remap plan `Palletized`/`ReadyToLoad` → `Planning`) and
  a `functions/data-ops` redeploy.
- **Palletization detail tabs** — `PalPlanDetail` splits into **Palletise items /
  Timeline / Activity** tabs (default items).
- **Form: Palletise Boxes** — renamed from "Load Boxes"; rows with **nothing
  produced are disabled** ("⚠ needs production") and box entry is **capped at the
  produced-available qty**. Added the SO-style **stock signal dot**
  (`LineStockChip`) per line and a **dedup hint** ("in PAL-N") when an item is
  already in an open plan.
- **Come-back-later flag** — Sales Orders list + Order detail now show a
  **"Partially palletised — N left"** / "Ready for Palletisation — N" chip; the
  Palletization page shows a banner counting orders with produced boxes still to
  palletise.

## 2026-07-23 — Palletization: item-wise board + unified send flow

- **Item-wise board** — the Palletization Kanban (`PalKanban`) now renders **one
  card per plan line (item)** instead of one per plan. Each line gets a
  display-only sequential **`PAL-NNN`** code (computed in
  `palPlansApi.fetchPalPlans`, mirrors Production's `PROD-NNN`) shown on the card
  and in the plan detail's item rows. Dragging any item card advances its whole
  plan (a plan = one SO's palletised items; per-line stages were not added).
- **Unified send flow** — Sales Order detail **More → Palletization** now opens
  the same `/packing?fromOrder=<so>` screen as *New Palletization* and
  Production's *Send to Palletization* (no longer the old Close Pallet form). The
  inline "Send selected" per-line shortcut still opens the legacy Close Pallet
  form.
- **Select-SO on New Palletization** — `PalPlanForm` in New mode adds a **Sales
  Order** picker (orders with produced-but-unpalletised stock); choosing one
  scopes the item table to that SO and pre-fills Load Boxes with available.
  Always SO-associated — no independent palletization.
- **Vehicle moved to the Loading step** — entering **In Loading** no longer
  prompts for a vehicle (the `VehicleLoadModal` gate is gone). A plan In Loading
  now gets an **Assign Vehicle** action (truck button on the board card + a
  button on the detail); the vehicle is **required before Dispatch** (Mark
  Dispatched is disabled / server 400 until one is set). New server route
  `POST /pal-vehicle/:rowid` + `setPalVehicle`; `/pal-status` swaps the
  "vehicle required to enter Loading" guard for "vehicle required to Complete".
  The advisory `VehicleFillBar` planning stays in the form.
- **SO send fully unified** — the SO detail's inline **Send selected** (per-line
  checkboxes) is replaced by a single **Send to Palletization** button →
  `/packing?fromOrder=`; the old close-pallet form, `PalletPackForm`, and the
  item-selection machinery are removed from `OrderDetail`.
- **Partial-friendly palletization form** — `PalPlanForm` Load Boxes now start
  **blank** (both New and Send-to-Palletise), so a subset — even one item — can be
  palletised and the rest done later; a per-order **Fill available** button fills
  them. The advisory **`VehicleFillBar` was removed** from the form (no vehicle at
  palletization; it's assigned at the Loading step).

## 2026-07-11 — Quotation redesign (Books parity)

- **Quotes list** — page heading removed, New Quote moved to the fbar (masters
  layout); row checkboxes with a bulk status-change + delete bar (DesignMaster
  pattern).
- **Quote detail** — tabs Details / Orders / Activity; a Details | PDF
  segmented toggle renders the real pdfmake document inline; Convert to Master
  Order moved into the More menu; shared `ActivityLog` replaces the bespoke
  table.
- **quotesApi** — collects ALL SalesOrders per quote (`sos[]`) instead of a
  last-write-wins single SO; feeds the Orders tab.
- **PDF fix** — pdfmake 0.3.x font VFS registration (Download PDF failed with
  "Roboto-Medium.ttf not found"); new `pdfDataUrl()` for previews.

## 2026-07-10/11 — Customer master redesign (Books parity)

- **Form** — Books-style field order (Company/Display Name above Primary
  Contact), contact-person rows with validation (started row requires first
  name, valid email, phone; save blocked otherwise), address Country/Region as
  a typable Combobox with the full country list, phones digits-only capped at
  10\. New `Customer.contact_persons` JSON column (see DATASTORE-SCHEMA.md).
- **Detail** — editable primary details, contacts & addresses; Contact Persons
  tab; More-menu actions; status locked at create; quote deep-link; Associated
  Orders grouped by PO and kept beside Primary Details on normal widths.
- **Fix** — radio/checkbox exempted from the shared input skin.

## 2026-07-10 — Brand palette + uniform form/grid pass

- Brand palette from boffogranito.com: orange accent, warm neutrals, dark
  sidebar; brand logo + dark login theme.
- Uniform form & grid design pass across Size/Pallet masters and all forms.

## 2026-07-09 — Size & Pallet masters: own pages + detail views

- **Size Master** — own page with packing data (`tile_type`, `thickness_mm`,
  `pcs_per_packing`, `box_weight_kg`, remark) and computed `sqm_per_box` /
  `sqft_per_box` on save; Size is now the single source of truth for per-box
  packing (new columns in DATASTORE-SCHEMA.md).
- **Detail pages** — Size and Pallet get detail pages; Associated Pallets on
  Size detail, Associated Orders (order number + boxes) on Pallet detail;
  More > Create Pallet (from Size) and More > Palletize Order (from Pallet).
- **Related lists** — rows link to the records they name.
- **Activity log + confirm dialog** — readable details, unified date format;
  destructive confirms use explicit wording; Puvi-only fonts.
- The 2026-07-08 deferred item is closed: `.gsearch` magnifier adopted on the
  remaining 8 grids.

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
