// Builds docs/BOFFO-DELIVERABLES.xlsx + docs/DELIVERABLES.md — the customer-facing,
// feature-wise list of deliverables (Completed / In progress / Future).
// Run: node scripts/build-deliverables.mjs
// ponytail: rows live here as data; after the first hand-off the Excel is the working copy.
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("../client/node_modules/xlsx");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const P1 = "Phase 1 (by 01-Oct-2026)";
const C = "Completed", I = "In progress", F = "Future";

// [module, feature, what it does, status, delivered on, ref]
const rows = [
  // ── 1 · Foundation & workspace ──────────────────────────────────────────────
  ["Foundation & workspace", "Sign-in and sessions", "Email + password sign-in; sessions last 7 days; sign-out from the user menu.", C, P1, ""],
  ["Foundation & workspace", "Roles and permissions", "A role says, per module, who can view, create, edit, delete and export, and which document types they may approve. Admin is the superuser. Enforced on the server, not just hidden in the menu.", C, P1, ""],
  ["Foundation & workspace", "Organization profile", "Settings ▸ Organization: upload the company logo and enter the company name (both required), legal name, GSTIN / PAN / IEC, address, phone, email, website and bank details. Used on the sidebar, login, browser tab, every PDF / print (quotes, dispatch and load copies, packing report, pallet and batch slips, invoices) and the shared pages. Change it any time.", C, "2026-10-25", "CR-445"],
  ["Foundation & workspace", "Security hardening", "Image uploads accept real images only; query injection closed; secure cookies; allowed-origin list; statuses cannot be changed through generic saves. Two review passes (Jul and Sep 2026).", C, P1, "CR-205…207"],
  ["Foundation & workspace", "App shell", "Sidebar grouped Dashboard · Inventory · Sales · Reports, filtered by role; global search; user menu; settings gear for admins.", C, P1, ""],
  ["Foundation & workspace", "Settings workspace", "Two-pane page: Preferences, Masters, Users, Roles, Currencies, Data operations (admin repair tools).", C, P1, ""],
  ["Foundation & workspace", "House grid standard", "Every list: one-line rows, page footer, show / hide and reorder columns (applied on Apply), advanced search, newest first, click anywhere on a row to open it.", C, P1, ""],
  ["Foundation & workspace", "House form standard", "Required fields marked; grey = calculated, white = you type; every pick list comes from the live masters; dates default to today; Sales Person defaults to the signed-in user; no negative numbers.", C, P1, ""],
  ["Foundation & workspace", "Detail page standard + Clone", "One detail design everywhere; Edit and More top-right; every record can be cloned; after create / clone you land on the new record.", C, P1, ""],
  ["Foundation & workspace", "Create / edit forms are full pages", "Quote, Sales Order, Item, Pallet, Customer, Production, Palletization, Loading — pages, not pop-ups.", C, P1, "CR-219…222"],
  ["Foundation & workspace", "One visual language", "Indigo / slate theme, one input skin, one button family, one font scale on every screen.", C, P1, ""],
  ["Foundation & workspace", "Onboarding tours", "Welcome tour on first sign-in walks the business flow; Palletization and Loading have page guides; replayable from the user menu.", C, P1, "CR-158/159"],
  ["Foundation & workspace", "Public pages", "Pallet QR scan page, batch QR slip page and item images open without sign-in via unguessable links.", C, P1, ""],
  ["Foundation & workspace", "Grids lead with Customer → Design", "Every list opens with Customer and Design (or item / name) first; system numbers (SO, Quote, PNL, PRD, TRF, CUS, SKU) hidden until ticked; customer PO stays visible; whole-row click everywhere.", C, "2026-10-19", "CR-355"],
  ["Foundation & workspace", "Staff default role", "New role Staff: view + create everything, never edit, delete or approve. Default for every new user. Server now enforces no-edit / no-delete on every route; maintenance routes Admin-only.", C, "2026-10-13", "CR-336"],
  ["Foundation & workspace", "Zoho-linked accounts", "Settings ▸ Users shows how each account signs in (Zoho / Password / Both / None); password-less Zoho-only users; company email domains self-provision a Staff account on first Zoho sign-in.", C, "2026-10-13", "CR-337"],
  ["Foundation & workspace", "Discard changes? Yes / No", "Leaving a form or edit mode with unsaved changes asks a plain Yes / No question on every screen (no more 'Delete' wording).", C, "2026-10-03", "CR-268"],
  ["Foundation & workspace", "Delete asks why", "Every delete asks for a reason first (Admin exempt); the reason is kept on the record's activity log and the server refuses a reason-less delete.", C, "2026-10-03", "CR-270"],
  ["Foundation & workspace", "Zoho Books-style form layout", "Every create / edit form page puts the label on the left and the control on the right, two fields per row; Customer on its own row with Billing | Shipping under it; tightened label gap, one-control-wide rows, three-line notes boxes.", C, "2026-10-06", "CR-275, CR-277"],
  ["Foundation & workspace", "Clear / None option on every pick list", "A way to clear a chosen value on every dropdown in the app.", F, "", "CR-069"],
  ["Foundation & workspace", "Pick-list keyboard navigation", "Arrow keys move, Enter / Space selects, on every dropdown — to be verified and completed across all screens.", F, "", "CR-009"],
  ["Foundation & workspace", "Hosting platform upgrade", "Move the app to the newer hosting platform (same app, same data; faster page loads). Planned, not started.", F, "", ""],

  // ── 2 · Masters (Inventory) ─────────────────────────────────────────────────
  ["Masters (Inventory)", "Items (Design Master)", "One record per sellable tile: name, SKU, size, finish, category, glaze, grade, brand, images (gallery + lightbox), per-box weight with per-piece / per-m² helpers, batch-tracked flag, Active / Inactive. Item detail shows stock, production and orders.", C, P1, ""],
  ["Masters (Inventory)", "Design Master to the new spec", "Item form in five sections (Main Information · Calculations · Design Data · Working Data · Marketing Data) with the image on the form; Pcs Per Packing typed per item and coverage from the item's own numbers (a Size edit no longer rewrites them); Design Owner and Custom Design Buyer as customers (default owner in Settings); the buyer's brands offered as Customer Brand; Base Design picked from existing items; new lookups Surface Application, Punch Type (with image), Series, Catalogue.", C, "2026-10-23", "CR-391…396"],
  ["Masters (Inventory)", "Opening stock with lock", "Entered once per item (per batch for batch-tracked items); locks after first save; Admin can re-open with a reason written to the audit log.", C, P1, ""],
  ["Masters (Inventory)", "Size Master with packing defaults", "Dimensions, pieces per box, coverage m² / ft², box weight. Pallet formats snapshot the size; items take the dimensions and start their own pieces per box and box weight from it. Editing a size fans the defaults out (typed item values are kept).", C, P1, "CR-391"],
  ["Masters (Inventory)", "Pallet Master", "Pallet formats: boxes per pallet, empty and loaded pallet weight, which size they fit. Pick lists offer the formats matching the item's size. Boxes-only since Phase 2 (container capacity moved to Container Master).", C, P1, "CR-261"],
  ["Masters (Inventory)", "Stock Details", "Batch-wise on-hand per item.", C, P1, ""],
  ["Masters (Inventory)", "Lookups", "Brand (with logo on forms), Grade, Finish, Category, Glaze, Payment terms, Currency with exchange rate, Vehicle (kept in sync from typed numbers), Container sizes, Organization, document number series.", C, P1, ""],
  ["Masters (Inventory)", "Container Master", "New master: what one container of a size holds — pallet formats as lines (format × how many), totals follow; several containers per size; auto-name shows the pallet maths, e.g. 800x1600 - GVT - 2 · [(48*10) + (10*6)] = 540 boxes. Grid, form page, detail with Clone / Delete, activity.", C, "2026-10-07", "CR-261, 269, 273, 292"],
  ["Masters (Inventory)", "Capacity comes from the Container Master", "Fill % on loading and palletization and the planner's box fitting use the size's container; a size with no container shows no fill % and says so.", C, "2026-10-03", "CR-261"],
  ["Masters (Inventory)", "Warehouse master", "Settings ▸ Warehouses: name, Primary ★, purposes (Production · Palletization · Loading Bay · Raw Material · Sample Cut Panels), note. Primary and any warehouse with history cannot be deleted.", C, "2026-10-12", "CR-329"],
  ["Masters (Inventory)", "Add a new container from where it is needed", "Create a Container Master record without leaving the loading / planning screen. Scope to be confirmed.", F, "", "Panel Craft list #10"],
  ["Masters (Inventory)", "Container master naming", "Naming / login rule for container records. Requirement to be clarified.", F, "", "Panel Craft list #11"],
  ["Masters (Inventory)", "Pallet size as length × width", "New Pallet form takes length and width instead of one size field.", F, "", "CR-101"],
  ["Masters (Inventory)", "Readable SKU", "Acronym-based SKU built from each master's short code (decisions agreed, not built).", F, "", "CR-015"],

  // ── 3 · Customers ───────────────────────────────────────────────────────────
  ["Customers", "Customer master (full page)", "Code, name, contacts, billing and shipping addresses side by side, country, currency, payment terms, default Box Brand, sales person, brand.", C, P1, ""],
  ["Customers", "Customer Brands", "Several brand names per customer on the Customer detail (add / delete); the Item form offers them as the buyer's Customer Brand.", C, "2026-10-23", "CR-393"],
  ["Customers", "Customer detail", "Quotes, sales orders and dispatches for that customer in one place; Showcase Panels and Customer Samples sections.", C, P1, ""],
  ["Customers", "Transactions inherit customer fields", "Every quote and order fills currency, terms, addresses, brand and box brand from the customer on pick — nothing retyped.", C, P1, ""],
  ["Customers", "Sign in with Zoho", "Login page leads with a Zoho button; password form stays as fallback; only existing active app users get in; roles stay Admin-controlled.", C, "2026-10-12", "CR-324"],
  ["Customers", "Zoho CRM Accounts as the customer source", "Changes arrive via webhook / scheduled pull; Import all once; Create in / Push to Zoho CRM from the customer; From Zoho CRM on the Customers page; Map / Re-pull / Unmap by hand. Contact persons from CRM Contacts; GSTIN, PAN, GST treatment, Place of Supply, Credit Limit, Payment Term picked up automatically.", C, "2026-10-21", "CR-359"],
  ["Customers", "Zoho Books customer sync (built, switched off)", "Two-way customer sync with Zoho Books (event-driven pull, Import all, Push) and the Books tax / credit / notes fields on the customer. Hidden since the switch to CRM at the customer's request; data kept.", C, "2026-10-21", "CR-325, 356, 358"],
  ["Customers", "Zoho link status per customer", "Customers grid column Zoho: CRM & Books / CRM only / Books only; customer page spells it out with both ids; advanced filter takes the states; token handling fixed so the status fills for every synced customer.", C, "2026-10-21", "CR-362, 363"],
  ["Customers", "Sync never creates a twin; duplicate names are an error", "The existing-customer lookup reads every customer; a CRM account whose name already belongs to another linked customer is reported as a duplicate and not created; CRM comes first.", C, "2026-10-22", "CR-372"],
  ["Customers", "Duplicate customers card", "Settings ▸ Zoho CRM ▸ Duplicate customers: Find duplicates → Merge N duplicates (quotes, orders, panel and sample orders move to the surviving customer; reused codes renewed). Import all refuses to run while duplicates exist.", C, "2026-10-22", "CR-373"],
  ["Customers", "Zoho item reference", "Link items to the Zoho item master. Blocked — reference layout never supplied.", F, "", "CR-013.2"],

  // ── 4 · Quotes & Approvals ──────────────────────────────────────────────────
  ["Quotes & Approvals", "Quote form (create / edit / clone)", "Customer, currency (INR default, any currency with the day's rate), payment terms, box brand, lines item · size · boxes · rate; totals in document currency and INR.", C, P1, ""],
  ["Quotes & Approvals", "Grouped by design", "On screen, in print and in the PDF, with per-design subtotals.", C, P1, ""],
  ["Quotes & Approvals", "PDF and public share link", "Customer-facing PDF and an unguessable share link.", C, P1, ""],
  ["Quotes & Approvals", "Container planning on the quote", "Plan quoted boxes into containers in Box Fitting or Weight Fitting mode; move boxes between containers; fractional fill for mixed containers; optimiser respects pallet slots, area, weight and box caps.", C, P1, ""],
  ["Quotes & Approvals", "Approvals page", "Approve or reject with a reason; sales person notified; an approver's own quotes are born Approved. Lifecycle Draft → Pending approval → Approved → Sent → Accepted → Converted.", C, P1, ""],
  ["Quotes & Approvals", "Quote aging report", "Shows where quotes are stuck.", C, P1, ""],
  ["Quotes & Approvals", "Suitable Containers panel", "Per size on the quote: the container it fits, boxes quoted, containers needed and how full the last one is (on screen).", C, "2026-10-03", "CR-262"],
  ["Quotes & Approvals", "Planner picks the container per item row", "A Container column on every planner row lists the containers of that size built from the chosen pallet; default the largest; saved with the plan; a loading made from the plan starts on it.", C, "2026-10-07", "CR-274, 300"],
  ["Quotes & Approvals", "Customer search modal", "Magnifier beside the Customer field on Quote, Sales Order and New Palletization opens a searchable customer table; dropdown shows code · country.", C, "2026-10-06", "CR-276"],
  ["Quotes & Approvals", "Suitable Containers on print / PDF / share link", "Carry the on-screen Suitable Containers panel onto the printed quote, PDF and share link.", F, "", "CR-262 follow-up"],
  ["Quotes & Approvals", "Weight fitting from the container's max weight", "Planner uses the container's own weight limit instead of a typed tonnage.", F, "", ""],
  ["Quotes & Approvals", "Qty total on screen and on the printed quote", "Box total shown on the quote and in print / PDF.", F, "", "CR-079"],
  ["Quotes & Approvals", "Collapse long remarks / terms", "Long remarks and terms fold behind 'view more' so the page does not stretch.", F, "", "CR-088"],

  // ── 5 · Sales Orders ────────────────────────────────────────────────────────
  ["Sales Orders", "Convert to Sales Order", "From an Accepted quote, full or partial (quote becomes Partially converted and can be converted again); the quote's container plan is copied and the order owns its editable copy.", C, P1, ""],
  ["Sales Orders", "Sales Order form (page)", "Same layout family as the quote; PO number; editable after work has started (a line with pallets or loads keeps its item and cannot drop below what was done).", C, P1, ""],
  ["Sales Orders", "Allocate Stock", "Hand free boxes of chosen batches to an order line (one flat table item → batch rows, with search). Allocation is a claim, not a movement.", C, P1, "CR-194…200"],
  ["Sales Orders", "Status = order lifecycle; Palletization / Loading progress separate", "Draft → Pending approval → Confirmed → In progress → Partially completed → Completed, rolled up from dispatched vs ordered. Palletization and Loading progress are their own columns / fields. Admin override with reason.", C, P1, "CR-230…233"],
  ["Sales Orders", "Order detail tabs and actions", "Items (ordered · allocated · palletized · loaded · dispatched per line), Palletization, Dispatch, Activity; Send to Palletization, New Loading, Allocate Stock, Containerise, Clone.", C, P1, ""],
  ["Sales Orders", "Orders grid, By-order view, Kanban pipeline", "Three views over the same data.", C, P1, ""],
  ["Sales Orders", "Remaining, totals and Deallocate Stock", "Items table shows Remaining = Ordered − Allocated and a totals row; ✕ per allocated line returns boxes to free stock unless already palletized; partial deallocate ('5 of 520'); Allocate / Deallocate buttons always visible with the reason when greyed.", C, "2026-10-07", "CR-263, 297"],
  ["Sales Orders", "Item STOCK card itemises on-hand", "Awaiting palletization row between In production and In loading, each with per-order drill-down, so Available adds up on screen.", C, "2026-10-07", "CR-298"],
  ["Sales Orders", "A worked order cannot be deleted", "Once any line is allocated, palletized, loaded, dispatched or on a plan, Delete is greyed and refused ('Cancel it instead').", C, "2026-10-03", "CR-271"],
  ["Sales Orders", "Customer PO first, SO number small", "Sales Order page titled by the customer's PO with SO/FY/NNN small beneath; Orders grid first column PO Number; drawer and By-Order cards follow.", C, "2026-10-19", "CR-353"],
  ["Sales Orders", "Cancel Order clears the palletization board", "Cancelling a sales order (reason required) removes its boxes from open containers, every palletization line and every allocation; a dispatched container blocks the cancel.", C, "2026-10-24", "CR-371"],
  ["Sales Orders", "'Mark in progress' → 'Mark as sent'", "Rename the status action to what it means: the sales person acknowledged the customer.", F, "", "CR-041"],
  ["Sales Orders", "'Send to Palletization' in the More menu", "Move the action into More and name it 'Palletization'.", F, "", "CR-042"],

  // ── 6 · Production ──────────────────────────────────────────────────────────
  ["Production", "Production page — Sheet / Kanban / Grid", "Three views of the same rows (Sheet default); one row per logged batch; Group by Item / Customer / Order / Size; status filter with All.", C, P1, ""],
  ["Production", "To Produce view", "Per item: open demand, free stock, in production and what still needs producing, with the Box Brand wanted; tick rows to start a job.", C, P1, ""],
  ["Production", "Start / Log / Complete Production", "Start creates the job (Item · Quantity); Log adds batch rows from the row's + menu (first log → In Production, full coverage → Completed automatically); Complete closes the job.", C, P1, "CR-234…237"],
  ["Production", "Bulk Record Production (make-to-stock)", "A form in the Adjust Stock shape: Production date, recorded by and a description over an Item Table — Size · Item · Batch (blank = automatic) · Qty · Box Brand · Location per line — one line to start, + Add line; paste a block from Excel; one Save records every line into stock; retry-safe.", C, "2026-10-27", "CR-244, 264, 469"],
  ["Production", "Sales Order ▸ Production tab per design", "One row per design with its batches as chips and the requested / produced totals summed; totals footers on both tables.", C, "2026-10-27", "CR-470"],
  ["Production", "Sheet edit mode", "Edit makes plan qty, Produced and Status editable across rows; nothing written until Save; invalid cells block Save.", C, P1, "CR-111"],
  ["Production", "Excel import of the factory file", "Import production from the factory's spreadsheet.", C, P1, ""],
  ["Production", "Batch numbering and rules", "Batches auto-numbered B/YYYY-MM/NNN (restarts monthly per item) or typed; never repeats on one item; Box Brand on every batch row; over-production blocked.", C, P1, ""],
  ["Production", "Production detail page", "Lines, batches logged, activity.", C, P1, ""],
  ["Production", "Date-first production", "Grid opens grouped by date with the Production ID hidden; page titled by its date with the PRD number small; Bulk Record Production is the default button.", C, "2026-10-03", "CR-265, 267"],
  ["Production", "Quality Control stage on the board", "QC exists in the data model; putting it on the board is parked.", F, "", "CR-051"],
  ["Production", "Duplicate detection on Excel re-import", "Warn / skip when the same production file is imported twice.", F, "", ""],

  // ── 7 · Palletization ───────────────────────────────────────────────────────
  ["Palletization", "Palletization board and plan numbers", "Sheet and Kanban views, Group, Today's Report, New Palletization; plans numbered PAL/FY/NNN; a plan may span several orders of one customer; each line is one item × one batch.", C, P1, ""],
  ["Palletization", "Columns, totals footer and selection bar", "Customer · Item · Order · Batch · Boxes · Remaining · Age · Ready Pallets (N (boxes)) · Pallet type; totals footer; selection bar when rows are ticked.", C, P1, "CR-279"],
  ["Palletization", "Counts per batch: Ordered · Ready Pallets · Boxes / Pallet · Remaining", "Every palletization page counts the row's own batch — a loaded batch of the same item no longer shows on its sibling. Columns Boxes · Ordered Boxes · Ready Pallets (N (boxes)) · Boxes / Pallet · Remaining with totals; the Complete Palletization dialog shows the same figures.", C, "2026-10-27", "CR-472"],
  ["Palletization", "Plan detail page", "Lines with status, batches, pallets; Edit + More; activity.", C, P1, ""],
  ["Palletization", "Prints on demand", "Pallet Packing Report; Pallet Slips (one per physical pallet, mixed pallet lists every batch); pallet QR labels; batch QR slips.", C, P1, ""],
  ["Palletization", "Board rules", "Planned boxes never exceed the order; batches attributed oldest-first; a hand-edited plan is pinned; the palletized part of a batch can be loaded while the rest is in progress.", C, P1, "CR-129, 248"],
  ["Palletization", "Three ways onto the queue", "Automatic from every production record; New Palletization (customer-first page); Send to Palletization from a sales order.", C, P1, "CR-223/224"],
  ["Palletization", "'+' menu: Start / Top Up Batch / Complete", "Start confirms the pallet format; Top Up (Mix Batch) moves boxes of another batch onto the open pallet; Complete records finished boxes to Ready for Loading, partial is normal and the rest is re-queued.", C, P1, "CR-148…150, 281"],
  ["Palletization", "Sheet edit mode and multi-select", "Edit adds Palletise qty and Top Up From cells on every row (✓ / ✗ per row, Save all); multi-select rows → palletize together, print slips, or Load.", C, P1, "CR-153"],
  ["Palletization", "Date column, PAL code hidden", "Grids show the date a line entered palletization; PAL code available in the column picker.", C, "2026-10-03", "CR-266"],
  ["Palletization", "Complete dialog shows progress", "Per item: ready pallets (boxes) already palletized and boxes still remaining.", C, "2026-10-06", "CR-280"],
  ["Palletization", "Plan edit keeps Box Brand and batches", "Editing a plan carries carton brand and batch of each line; a Completed plan is refused.", C, "2026-10-13", "CR-340"],
  ["Palletization", "Three pages, one stage each", "Ready for Palletization, In Palletization, Palletization Completed (waiting to load); no status filter — each page lists its own rows.", C, "2026-10-21", "CR-360, 364"],
  ["Palletization", "Release palletized boxes", "From the + menu on Palletization Completed and Loading: boxes + reason. Loaded boxes return to Ready for Loading; palletized boxes return to free stock with the allocation; partial or whole; dispatched refused.", C, "2026-10-21", "CR-361"],
  ["Palletization", "Discard the current palletization task", "+ menu on Ready for / In Palletization: boxes + reason; boxes return to free stock and the allocation is returned. Reason required for every role.", C, "2026-10-24", "CR-369"],
  ["Palletization", "Delete a plan returns its boxes", "Deleting a palletization returns every line to free stock first; refused while any box sits in a container.", I, "", "CR-370"],
  ["Palletization", "Partial Start Palletization", "Start only part of a Ready row (today Start takes the whole line; partial is on Complete).", F, "", "Panel Craft list #9"],
  ["Palletization", "Ready pallets — type and pallet count", "Show pallet type and count per ready row / print. To be confirmed against what CR-279 already shows.", F, "", "Panel Craft list #7"],
  ["Palletization", "Remove 'Ordered / Completed' where not needed", "Screen to be confirmed.", F, "", "Panel Craft list #8"],

  // ── 8 · Loading & Dispatch ──────────────────────────────────────────────────
  ["Loading & Dispatch", "A loading = one container", "Numbered LOAD/FY/NNN; a multi-container plan groups its containers.", C, P1, "CR-120…124"],
  ["Loading & Dispatch", "Loading and Dispatch page", "Sheet with derived stages Ready for Loading → In Loading → Ready for Dispatch → Dispatched; Loadings grid (one row per container); Customer Sheet (every loaded line of one customer, export style).", C, P1, "CR-140, 141"],
  ["Loading & Dispatch", "Loading detail", "Loaded Items (Mix Batch pallets as a tree), Loading Sheet tab (export-style ruled sheet, editable in place), Container Planning tab, Activity.", C, P1, ""],
  ["Loading & Dispatch", "Vehicle and shipment details", "Vehicle number (auto-formatted), driver, mobile, transporter, LR number, destination, supervisor, container size / number, seals; Vehicle master updates itself.", C, P1, ""],
  ["Loading & Dispatch", "Dispatch with gates and warnings", "Dispatch always on the menu, greyed with the reason when it cannot run; blank seals / LR / transporter warn; duplicate seal or container numbers warn; dispatch events show on the order and the plan.", C, P1, ""],
  ["Loading & Dispatch", "Invoice and dispatch prints", "Invoice per container (PDF); Dispatch Entry and Dispatch Copy with design names and pallet numbers.", C, P1, ""],
  ["Loading & Dispatch", "Four ways to fill a container", "New Loading page (batch picker chooses pallets + loose boxes, Fill from plan); Load from the palletization board; New Loading from a sales order; Send to Loading from an order.", C, P1, "CR-126…128, 201/202"],
  ["Loading & Dispatch", "Editing a loading", "Reduce loaded quantities (rest returns to Ready for Loading), remove lines, add pallets, complete details; Sheet edit mode for loaded qty / move / unload.", C, P1, ""],
  ["Loading & Dispatch", "Date column, LOAD code hidden", "Sheet and Loadings grid show the loading date; LOAD code in the column picker.", C, "2026-10-03", "CR-266"],
  ["Loading & Dispatch", "Several containers in one New Loading", "One section per container, each with its own Container Master pick, item rows and vehicle; stock shared across sections; one Save creates the linked loadings.", C, "2026-10-07", "CR-301"],
  ["Loading & Dispatch", "Loading Workspace — a tab per container", "New Loading and Edit are one page: each container a tab with a plain sheet and its own vehicle & seals rail; Dispatch and documents per tab; Tabs | Sheet toggle shows every container on one grid.", C, "2026-10-12", "CR-326, 334, 335"],
  ["Loading & Dispatch", "Every customer listed, with search", "Loading and Palletization list all active customers (stock-bearing first) with the search modal.", C, "2026-10-12", "CR-327"],
  ["Loading & Dispatch", "'What to do first' reasons", "A customer or order that cannot be loaded / palletized shows why and the next step; Sales Order detail shows a Next: line.", C, "2026-10-12", "CR-328"],
  ["Loading & Dispatch", "Pick the planned container at loading", "Each container tab's plan row is a picker over the order's planned containers (format, pallets, boxes, Planned / Sent / Claimed by); the claim is saved.", C, "2026-10-13", "CR-338"],
  ["Loading & Dispatch", "Two steps per container; C1 / C2 naming", "Designs & pallets first, then Container & vehicle (container pick, number, vehicle, driver, seals) under the rows; party and customer PO lead the header, SO numbers small.", C, "2026-10-19", "CR-350, 354"],
  ["Loading & Dispatch", "Mix Batch at loading", "Top up a pallet with another batch at loading time, not only at palletization.", F, "", "CR-260 follow-up"],

  // ── 9 · Stock & batch ledger ────────────────────────────────────────────────
  ["Stock & batch ledger", "One stock rule everywhere", "Opening + produced − loaded, oldest batch first — used by Stock Details, reports, pickers and the server alike.", C, P1, ""],
  ["Stock & batch ledger", "Counters recomputed, never incremented", "Order-line counters are recalculated from the records, so a failed save can never leave a wrong total.", C, P1, ""],
  ["Stock & batch ledger", "Allocation and batch ledger", "Allocation = a claim on free stock, visible on the order line; the ledger shows where every batch went (produced → queued → palletized → loaded → dispatched).", C, P1, ""],
  ["Stock & batch ledger", "Admin repair operations", "Settings ▸ Data operations: recount order lines, resync size snapshots, backfill line pallets, renumber loadings, re-attribute blank batch lines.", C, P1, ""],
  ["Stock & batch ledger", "Inventory adjustments", "Inventory ▸ Stock Adjustments: every ± correction with reason (Adjustment Reason master); bulk New Adjustment sheet; never below on hand; warns when it eats reserved boxes; every stock reader includes adjustments.", C, "2026-10-07", "CR-308"],
  ["Stock & batch ledger", "Stock per warehouse", "Every stock entry records its warehouse (default primary); loads take from the warehouse holding the batch, Loading Bay first; global figures unchanged.", C, "2026-10-12", "CR-329"],
  ["Stock & batch ledger", "Transfer Orders", "Inventory ▸ Transfer Orders: dated TRF/FY/NNN moving boxes or cut pieces between warehouses with a reason; a line cannot exceed what the From warehouse holds.", C, "2026-10-12", "CR-330"],
  ["Stock & batch ledger", "Locations on items", "Item detail ▸ Locations tab (warehouse → batches, on hand · committed · available); Panel Item detail ▸ Locations card.", C, "2026-10-12", "CR-332"],
  ["Stock & batch ledger", "Stock keyed by the item", "Live stock, opening / adjustment / allocation sums and To Produce demand key on the item, not its shared design name; Item detail agrees with Allocate Stock.", C, "2026-10-13", "CR-341"],

  // ── 10 · Reports & audit ────────────────────────────────────────────────────
  ["Reports & audit", "Sales reports", "By Item, By PO, Customer Sales, Salesperson Sales, Size-wise, Quote Aging — date range, filters, CSV, day / week / month buckets.", C, P1, ""],
  ["Reports & audit", "Inventory reports", "Live Stock, Batch-wise Stock (over-consumed flagged), Production Batches (list or item × date matrix), Batch Movement (pivot), Ready Pallets.", C, P1, "CR-104"],
  ["Reports & audit", "Dispatch reports", "Palletization Status, Loading & Dispatch (per container with vehicle, seals, transporter, LR, destination, fill %), Dispatch Register.", C, P1, "CR-104"],
  ["Reports & audit", "Audit log and activity", "Every change logged with who and what; every status move recorded; admin overrides carry their reason; Audit Log page plus Activity tab and Status history on every record.", C, P1, ""],
  ["Reports & audit", "Dashboard", "Headline numbers.", C, P1, ""],
  ["Reports & audit", "Warehouse Stock report", "Boxes or cut pieces, list or Item × Warehouse matrix, a tile per warehouse, filters, CSV.", C, "2026-10-12", "CR-331"],

  // ── 11 · Panel Craft ────────────────────────────────────────────────────────
  ["Panel Craft", "Panel Master", "Showcase panel master with one image, PANEL-001 numbering by the server, full-page New / Edit form; grid opens as photo tiles with a toggle to the column grid; row / tile click opens the panel.", C, "2026-10-08", "CR-283…285, 291, 319"],
  ["Panel Craft", "Remarks on a panel", "Free-text Remarks on New / Edit Panel for the old reference ID; shown on the panel page and searchable in the panel list.", I, "", "CR-425"],
  ["Panel Craft", "Cut Piece Size master under Panel Items", "The cut piece size list is maintained from the Panel Items page (Cut Piece Sizes button) instead of Settings ▸ Masters.", I, "", "CR-426"],
  ["Masters (Inventory)", "Box Weight in Bulk edit, frozen per order", "Search the Items list, select every match, set Box Weight once; each quote / sales-order line keeps the weight it was created with, so Container Planning on older orders does not move.", I, "", "CR-427"],
  ["Foundation & workspace", "Settings groups: Item Master and Panel Master", "Item reference lists under Item Master, panel ones (Cut Piece Size, MDF) under Panel Master; Adjustment Reason and Warehouses under Setup & Configuration. Superseded by the Masters page (CR-436).", C, "2026-10-24", "CR-428"],
  ["Foundation & workspace", "One Masters page", "Single Masters entry in the sidebar with Export Master · Item Master · Panel Master sub-tabs; every master (Pallets, Containers, Sizes, Items, Panel Items, Panels, lookups, Currencies, Warehouses) opens in place; old menu entries and links redirect into it; roles with Items or Panel Craft view see it.", C, "2026-10-24", "CR-436"],
  ["Foundation & workspace", "Masters menu inside Settings with horizontal tabs", "The Settings page's left menu has Masters ▸ Item / Panel / Export; the chosen group shows its title and its masters as horizontal tabs that open each list in place. The sidebar Masters entry opens the same page.", C, "2026-10-24", "CR-439"],
  ["Foundation & workspace", "Masters only under Settings, clearer tabs", "The sidebar no longer lists Masters; the menu is Settings ▸ Masters ▸ Item / Panel / Export and the selected master tab is a highlighted pill. Old links and search still open it.", C, "2026-10-24", "CR-440"],
  ["Items", "Base Design Name defaults to the Design Name", "Leave Base Design Name blank and the item is saved with its Design Name as the base; the field stays clearable while editing.", C, "2026-10-24", "CR-437"],
  ["Foundation & workspace", "Names save as Title Case", "Item, customer, contact, driver, transporter, supervisor, user and master names are stored as \"Dhiraj Shah Of ABC Exports LLP\" however typed — on every form, import and Zoho sync; short acronyms and LLP / LTD / PVT keep their capitals.", I, "", "CR-429"],
  ["Masters (Inventory)", "Brand off the Item form", "The Item form no longer asks for Brand; the Items grid, search, bulk edit and item page still show it.", I, "", "CR-430"],
  ["Panel Craft", "Panel Items with weighed cut pieces", "Designs picked from the Item master into Panel Craft, each with its cut pieces (add, weigh, remove); the Panel form offers only these.", C, "2026-10-07", "CR-306"],
  ["Panel Craft", "Cut Piece stock as items + bulk sheets + ledger", "One row per cut piece (image, size, weight, on hand, stock weight); Add Stock and Adjust Stock are dated bulk sheets; every movement in a ledger shown as Stock History. Menu reads 'Cut Piece'.", C, "2026-10-15", "CR-282, 307, 308, 343"],
  ["Panel Craft", "MDF master", "Settings ▸ Masters ▸ MDF: Size · Thickness · Weight rows; the Panel master states its MDF size; the order line picks a thickness; weight = cut pieces + MDF, × qty.", C, "2026-10-15", "CR-309, 320, 344"],
  ["Panel Craft", "Panel Order = header + lines", "One customer order holds several panels (PNL/FY/NNN); SO-shape form (Pick from showcase with Design · Panel Size · Cut Piece Size · In-stock filters) and detail; loose cut-piece lines ('10 panels + 20 cut pieces'); blank cut piece size = full size.", C, "2026-10-21", "CR-302, 304, 310, 346, 289, 357"],
  ["Panel Craft", "Panel Order page is the only place status changes", "Status chip, next-step buttons (Accept / Start Cutting / Ready / Dispatch), Edit, More ▸ Clone / Delete, Overview | Activity; every order is born 'New'.", C, "2026-10-07", "CR-287, 294"],
  ["Panel Craft", "Request Panels / Samples from a Quote or Sales Order", "More ▸ Request Panels / Request Samples opens the new order with the customer locked and the sale's designs picked; the Quote / SO gains a Panel Orders tab.", C, "2026-10-08", "CR-286, 317"],
  ["Panel Craft", "Requirements checklist with booking", "Per design × cut size: Need, In Stock, Allocated · Short, the panels it serves; one Allocate Stock modal; Dispatch needs every piece booked; Ready books its own output. Replaces the godown print slip.", C, "2026-10-07", "CR-288, 303, 305, 312"],
  ["Panel Craft", "Production checkpoints", "MDF · Vinyl Printing · Cut Pieces · Vinyl Pasted on MDF, marked independently with who / when; readiness on the page, sheet, cards and dashboard.", C, "2026-10-09", "CR-313, 323"],
  ["Panel Craft", "Pending Cut Piece page", "Per cut piece: Required · On Hand · Booked · Free · Shortage · Orders (each order linked with its quantity).", C, "2026-10-09", "CR-314, 322"],
  ["Panel Craft", "Sample Orders", "Separate order type (SMP/FY/NNN) for customer samples — full tile or cut piece; per-line partial supply with a date; cut pieces come off cut stock; Customer page lists every sample line.", C, "2026-10-08", "CR-315…317"],
  ["Panel Craft", "One Orders register", "Panel + Sample orders in one grid with a Type column and filter; New Order asks the type first.", C, "2026-10-15", "CR-345"],
  ["Panel Craft", "Loading entries and Panel Craft ▸ Loading page", "Record Load per order (date, vehicle, driver, photos, qty per line × material — Panel / MDF / cut piece); several orders per trip; Dispatched is derived from the loads; Loading page lists everything pending with multi-select → one trip.", C, "2026-10-15", "CR-347, 348"],
  ["Panel Craft", "Weight split and frozen at load", "Pieces kg · MDF kg · Total kg; shipped kg stamped at load time; pending kg follow the master.", C, "2026-10-15", "CR-349"],
  ["Panel Craft", "Load Copy print", "Branded Load Copy PDF per trip (vehicle block, lines, kg, signatures) from the Loads table; vehicle details kept on the Vehicle master.", C, "2026-10-19", "CR-351"],
  ["Panel Craft", "Load Copy from the Actions tab", "The panel order Actions tab lists every vehicle trip under Load Copy, newest first; each copy shows only what left on that trip.", C, "2026-10-24", "CR-433"],
  ["Panel Craft", "Panel Craft dashboard", "Open / in-cutting / ready / short counts, cut stock pcs + kg, pipeline strip, panels by status, orders per week, shortages, most-ordered panels, latest orders, Pending to Load.", C, "2026-10-07", "CR-311"],
  ["Panel Craft", "Small UX items", "Upload shows the BOFFO processing state; Stock column Available / Unavailable; Panels column opens a card list; filter × clears; (i) card per line; notes under the content they explain.", C, "2026-10-19", "CR-293, 295, 318, 321, 352"],
  ["Panel Craft", "Actions tab on the Panel Order", "Per line × material: Ordered · Loaded · Pending · Ready or what is missing · Load Now; Dispatch opens Record Load with those quantities.", I, "", "CR-365"],
  ["Panel Craft", "Vinyl Pasted waits for MDF + Vinyl", "The pasted checkpoint is greyed and refused until both MDF and Vinyl Printing are Ready.", I, "", "CR-366"],
  ["Panel Craft", "One Status column", "Pending · Not Started · In Progress · Ready · Completed · Cancelled replaces the four checkpoint columns + Readiness on the grid, kanban, dashboard and detail chip; lifecycle stage shown as a Stage field.", I, "", "CR-367"],
  ["Panel Craft", "Cancel Order (panel and sample)", "Reason required for everyone; blocked once a load exists; bookings return to free stock.", I, "", "CR-368"],
  ["Panel Craft", "Panel Order page: customer heading", "The customer's name is the page title; the PNL number sits small under it.", I, "", "CR-399"],
  ["Panel Craft", "One four-state order status", "New → Ready (every panel pasted) → Completed (pieces booked too) → Dispatched, derived automatically; no Accept / Start Cutting buttons.", I, "", "CR-400"],
  ["Panel Craft", "Vinyl print waits for MDF", "The Vinyl Printing mark opens only once that panel's MDF is Ready.", I, "", "CR-401"],
  ["Panel Craft", "Marks on the Actions tab", "MDF · Vinyl · Pasted are set per panel on the Actions tab beside the loading rows.", I, "", "CR-402"],
  ["Panel Craft", "Load pieces, boards or both", "Cut pieces load once booked; the MDF board once pasted; one row alone or everything ready together.", I, "", "CR-403"],
  ["Panel Craft", "Load part of a panel", "Each panel lists its cut pieces one kind per row; any count can leave on a trip, the rest later. Stock and booking move per piece kind.", I, "", "CR-405"],
  ["Panel Craft", "MDF row on every panel", "Every panel line has an MDF board row, thickness picked or not; it loads once the vinyl is pasted.", I, "", "CR-406"],
  ["Panel Craft", "Load whole panel in one click", "A panel's + menu loads all its ready pieces and its pasted board on one vehicle; Allocate Stock sits on the Actions tab.", I, "", "CR-407"],
  ["Foundation & workspace", "Settings search everywhere", "The header search (⌘K) finds settings pages and preferences for admins; the Settings search matches every typed word plus synonyms (godown, truck, login) and the Preferences rows.", C, "2026-10-24", "CR-408"],
  ["Masters (Inventory)", "Locations inside a warehouse", "A warehouse holds locations like A1 … F12 (generate the whole grid in one go). Stock is recorded at a location and stays there until a Transfer Order moves it; every label reads Warehouse ▸ Location; old stock shows as Unassigned until moved.", C, "2026-10-24", "CR-409"],
  ["Masters (Inventory)", "Location per item / per row when recording", "Log Production asks the Location per item, Production Completion per line; the bulk Record Production, cut-stock Add / Adjust and Stock Adjustments sheets have a per-row Location column (blank = the bar's default; paste by label or bay code); the Excel import takes a Location column.", C, "2026-10-24", "CR-438"],
  ["Stock & batch ledger", "Stock adjustment as a line form", "Adjust Stock (Panel Craft) and New Stock Adjustment (Inventory) open with one line and '+ Add line' like Zoho Books; each line shows the current stock at its location and carries its own Location, Add / Remove, Qty, Date, Reason and Remark; Add Stock and Transfers keep the bulk sheet.", C, "2026-10-25", "CR-446"],
  ["Stock & batch ledger", "Adjust Stock in the Zoho Books shape", "Both Adjust Stock pages open with a header (Mode of adjustment, Date, Reason, Description) over an Item Table showing Available, New on hand and one signed Qty adjusted field per line; date and reason are entered once per adjustment.", C, "2026-10-26", "CR-457"],
  ["Stock & batch ledger", "Location Transfer from the Adjust Stock screen", "Mode switch Quantity Adjustment / Location Transfer: pick From and To, list items and the quantity to move, save one Transfer Order (TRF number); total stock unchanged. Boxes and cut pieces.", C, "2026-10-26", "CR-458"],
  ["Stock & batch ledger", "Cut-piece Adjust Stock without a Cut Piece Size column", "On the Panel Craft Adjust Stock screen the Item list names the stock row itself (the item alone for its full size, 'Item · 600x600' for a special cut); pick the row and enter the quantity.", C, "2026-10-26", "CR-459"],
  ["Stock & batch ledger", "Cut Piece detail page inside Panel Craft", "Clicking a row on Panel Craft ▸ Stock opens that cut piece's own page (on hand, booked, free, weight, locations, panels using it, orders booking it, stock history) with the Stock menu still selected; Add / Adjust / Transfer open prefilled with the piece. The grid has no Image column.", C, "2026-10-26", "CR-460/461"],
  ["Foundation & workspace", "Pager with First / Last arrows", "Every list footer has « ‹ › » buttons — first, previous, next, last page — beside the page numbers; the range still shows the total.", C, "2026-10-27", "CR-467"],
  ["Foundation & workspace", "Red close × on every window", "The × that closes any window or drawer is red on every screen.", C, "2026-10-27", "CR-465"],
  ["Foundation & workspace", "Advanced search date range fits the window", "Created Between (and every other date range) sits inside the search window on all grids.", C, "2026-10-27", "CR-464"],
  ["Customers", "New customer menu: From Zoho CRM / Refresh from Zoho CRM", "New customer stays one click; the arrow beside it offers From Zoho CRM (prefill from a CRM account) and, for admins, Refresh from Zoho CRM. The Active / Inactive pills above the grid are gone — use Working Status in Search Customers.", C, "2026-10-27", "CR-463/466"],
  ["Stock & batch ledger", "Stock history in date order", "The Panel Item Stock History and the Item master Production tab list entries by the date shown, newest first, then by when they were saved.", C, "2026-10-26", "CR-455"],
  ["Foundation & workspace", "Title Case for the remaining name fields", "Collection Name on the Item form, a container's vessel name, extra-address attention names and role names save as Title Case like every other name.", C, "2026-10-25", "CR-447"],
  ["Panel Craft", "Stock list: items with their cut pieces beneath", "Panel Craft ▸ Stock (was 'Cut Piece'): one row per item with totals, its cut pieces listed beneath; fold an item, search by item, size or cut size.", C, "2026-10-25", "CR-448"],
  ["Panel Craft", "Stock list: cut-piece rows only for special sizes", "An item whose stock is only its full size is one plain row; the chevron and cut-piece rows appear only for items that also have another cut size.", C, "2026-10-26", "CR-456"],
  ["Panel Craft", "Panel Item page: read-only weight, Actions tab", "The item's Details tab shows cut pieces read-only; adding a cut piece, removing one and the Add Stock / Adjust / Transfer buttons sit on an Actions tab; the weight per piece is the formula value, never typed.", C, "2026-10-25", "CR-449"],
  ["Panel Craft", "Panel Order page: Details informative, Requirements on Actions", "The Requirements card (need, in stock, allocated, short, Available tick, Allocate Stock) lives on the Actions tab; Details shows the order's fields and items only.", C, "2026-10-25", "CR-450"],
  ["Masters (Inventory)", "Location at every stage", "Every production screen records a location (default = the bay of the warehouse marked Production); a pallet carries its location from palletization until it is loaded — asked once in the Palletize dialog (Palletization bay on Start, Loading Bay on Complete), changed with Set Location on the boards, shown as a Location column, on the item's Locations tab and as a Pallets view on Stock Locations; panel orders take a location on the form.", C, "2026-10-24", "CR-411…413"],
  ["Panel Craft", "Panel location", "Set where a panel order's panels sit (More ▸ Set Location); shown on the order, as a grid column and in the Stock Locations report's Panels view.", C, "2026-10-24", "CR-410"],
  ["Panel Craft", "Actions tab: panels on top, cut pieces below", "One row per panel with its marks, its MDF board and a status; click a panel to see its cut pieces underneath with their own Load boxes. Pending counts amber, loaded ones say Loaded; no empty spanning cells.", C, "2026-10-24", "CR-419"],
  ["Panel Craft", "Actions tab reads at a glance", "Material cell = cut size (150x150) or MDF — the design sits behind the Line ⓘ; Status on one line; Vinyl / Pasted dropdowns visibly greyed until their gate is met, with the reason on hover.", C, "2026-10-24", "CR-415"],
  ["Foundation & workspace", "No long helper notes", "Thirteen how-to paragraphs removed from under tables and cards; what blocks a row is said in its Status cell and tooltips. Standing rule: no multi-sentence instructions in the app.", C, "2026-10-24", "CR-416"],
  ["Production", "Production toolbar: Table + Sheet", "Two views only; Kanban, To Produce and Import hidden. Filter, search, Group, Fields, Edit, Start New Production and Bulk Record Production stay.", C, "2026-10-24", "CR-417"],
  ["Foundation & workspace", "Kanban hidden app-wide", "Packing, Panel Orders, Sales Orders and Production show the Sheet only; the Default view setting is hidden with it.", C, "2026-10-24", "CR-418"],
  ["Foundation & workspace", "Notifications read / unread", "Bell rows stay bold until Mark all read; the marker survives new tabs. Sidebar logo centred; Settings sub-pages open with a small Back link above the title.", C, "2026-10-24", "CR-419…421"],
  ["Sales Orders", "Sales Order page without Panel Orders tab", "Production, Palletization and Container Planning tabs only; Request Panels stays in the More menu.", C, "2026-10-24", "CR-422"],
  ["Panel Craft", "Readiness tab on every Panel / Sample order", "Per-order dashboard: ring of panels ready to load, next stage headline, Panels · Pieces · Ready · Pending tiles, one ring per stage (MDF · Vinyl · Pasted · Cut pieces · Weighed · Loaded) and a stage-cell table per panel — all read from the marks, booking, weight and loads already recorded. Sample orders show the one stage Supplied.", C, "2026-10-23", "CR-404"],
  ["Panel Craft", "'Full size — 800x1600' placeholder on the form", "The form half of the full-size default: keep lines without a cut piece size and show the design's size as the placeholder.", I, "", "CR-289 follow-up"],
  ["Panel Craft", "Status change from within the Panel Orders form", "Change the stage while editing the order, not only on the order page.", F, "", "Panel Craft list #3"],
  ["Panel Craft", "Panel request from Quote / SO — refinements", "Follow-ups to the New Request flow. Scope to be confirmed.", F, "", "Panel Craft list #2"],
  ["Panel Craft", "Panel auto-sequence", "PANEL-NNN is already automatic; what 'sequence' should add is to be clarified.", F, "", "Panel Craft list #4"],
  ["Panel Craft", "Godown print — issue / request", "A printed issue / request slip for the godown.", F, "", "Panel Craft list #5"],
  ["Panel Craft", "Missing items to fulfil an order", "A view of what is missing per order (Pending Cut Piece + requirements exist; the extra needed is to be clarified).", F, "", "Panel Craft list #6"],
  ["Panel Craft", "Bill / expense", "Record expenses or bills against panel work. New area, scope to be defined.", F, "", "Panel Craft list #12"],
  ["Masters (Inventory)", "Item code for the catalog", "Every item gets a short unique code such as LSN-800x1600-7K4 (initials of the design · size · three random characters that never repeat), assigned by the system. Shown on the item page, the Items grid, item pickers, the ⌘K search, Panel Craft ▸ Stock and panel pages; existing items are coded in one admin step.", C, "2026-10-27", "CR-473"],
  ["Panel Craft", "Panel Order PDF — one page per panel", "More ▸ Print order PDF on a panel order: a cover page with the order details and lines, then one page per panel with the showcase photo as large as the page allows, the panel's sizes and its cut pieces with totals for the ordered quantity.", C, "2026-10-27", "CR-474"],
  ["Sales Orders", "Sales Order without a Location field", "The order form no longer asks for a Location; location is recorded where stock is written (production, cut stock, pallets).", C, "2026-10-27", "CR-468"],
  ["Masters (Inventory)", "Pallet form without Box Weight", "New / Edit Pallet no longer asks for the box weight; the Size's weight is used.", C, "2026-10-27", "CR-471"],
  ["Panel Craft", "Boffo / Bonza company separation", "Two companies in one system — login-time company selection; the Export module mainly for Bonza. On hold at the user's request (docs/ON-HOLD.md #1).", F, "", "ON-HOLD #1"],

  // ── 12 · Documentation & process ────────────────────────────────────────────
  ["Documentation & process", "System reference and change-request register", "The system as built, kept true with every change; every request numbered with Change · Where · Why · Apply to · Like · Done when, status, date and proof.", C, P1, ""],
  ["Documentation & process", "Change log, user flow, user manual", "Dated change log, user flow guide, user manual, formula reference.", C, P1, ""],
  ["Documentation & process", "Seed and teardown scripts", "Create a full customer-to-dispatch test flow and remove it.", C, P1, ""],
  ["Documentation & process", "Data Flow reference", "For every record type, every screen and server action that can create, change, delete or re-status it, and the one place each rule lives.", C, "2026-10-03", "CR-272"],
  ["Documentation & process", "Phase 2 inventory", "Running plain-language inventory of Phase 2, updated as each request ships.", C, "2026-10-03", ""],
  ["Documentation & process", "Locations guide", "User-manual chapter: what to set up before using locations (warehouses, primary, bays, purposes), every screen where a location is picked or shown for boxes, pallets and panels, and the two rules for the floor.", C, "2026-10-24", "CR-411…413"],
  ["Documentation & process", "Deliverables list (this workbook)", "Feature-wise list of Completed / In progress / Future deliverables, maintained in Excel from here on.", C, "2026-10-22", ""],
  ["Documentation & process", "Demo / test environment", "A second, fully separate copy of the system (own database with the same 60 tables, own server functions, public web address) filled with dummy data for demos and testing; live data is never touched. Runbook: docs/DEMO-ENVIRONMENT.md.", C, "2026-10-25", "CR-441"],
  ["Documentation & process", "Demo carries no BOFFO branding", "The demo shows a neutral \"Demo\" company everywhere (sidebar, tab title, PDFs, sign-in), no BOFFO logo, and a plain pulsing \"Processing…\" / \"Uploading…\" text while it works instead of the BOFFO wordmark; the live system is unchanged.", C, "2026-10-26", "CR-454"],
];

const MODULES = [...new Set(rows.map(r => r[0]))];
const STATUSES = [C, I, F];

// ── Excel ───────────────────────────────────────────────────────────────────
const header = ["#", "Module", "Feature", "What it does", "Status", "Delivered on", "Ref"];
const aoa = [header, ...rows.map((r, i) => [i + 1, ...r])];
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws["!cols"] = [{ wch: 4 }, { wch: 24 }, { wch: 44 }, { wch: 100 }, { wch: 12 }, { wch: 22 }, { wch: 22 }];
ws["!autofilter"] = { ref: `A1:G${aoa.length}` };

const sum = [["Module", ...STATUSES, "Total"]];
MODULES.forEach((m, i) => {
  const r = i + 2;
  sum.push([m,
    ...STATUSES.map(s => ({ t: "n", v: 0, f: `COUNTIFS(Deliverables!$B:$B,$A${r},Deliverables!$E:$E,"${s}")` })),
    { t: "n", v: 0, f: `SUM(B${r}:D${r})` }]);
});
const last = MODULES.length + 1, tot = last + 1;
sum.push(["Total", ...["B", "C", "D", "E"].map(c => ({ t: "n", v: 0, f: `SUM(${c}2:${c}${last})` }))]);
sum.push([], ["Status key"],
  [C, "Built, verified and live on the system."],
  [I, "Built and under test; goes live at the next release."],
  [F, "Requested or planned; not built. Add / reorder rows here as priorities change."]);
const ws2 = XLSX.utils.aoa_to_sheet(sum);
ws2["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Deliverables");
XLSX.utils.book_append_sheet(wb, ws2, "Summary");
XLSX.writeFile(wb, join(root, "docs/BOFFO-DELIVERABLES.xlsx"));
// xlsx 0.18 community does not write <calcPr>; without it some viewers show the cached 0s on Summary.
// Patch workbook.xml in place so every spreadsheet app recalculates the COUNTIFS on open.
{
  const out = join(root, "docs/BOFFO-DELIVERABLES.xlsx");
  const tmp = mkdtempSync(join(tmpdir(), "deliv-"));
  execFileSync("unzip", ["-q", out, "-d", tmp]);
  const wbx = join(tmp, "xl/workbook.xml");
  writeFileSync(wbx, readFileSync(wbx, "utf8").replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'));
  rmSync(out);
  execFileSync("zip", ["-q", "-r", "-X", out, "."], { cwd: tmp });
  rmSync(tmp, { recursive: true });
}

// ── Markdown twin ───────────────────────────────────────────────────────────
const count = s => rows.filter(r => r[3] === s).length;
let md = `# BOFFO Order OS — Deliverables\n\n`;
md += `Feature-wise list of what has been delivered, what is being built and what is planned. The working copy is\n`;
md += `\`BOFFO-DELIVERABLES.xlsx\` (same rows); regenerate both with \`node scripts/build-deliverables.mjs\`.\n\n`;
md += `| Status | Count |\n|---|---|\n` + STATUSES.map(s => `| ${s} | ${count(s)} |`).join("\n") + `\n| **Total** | **${rows.length}** |\n`;
for (const m of MODULES) {
  md += `\n## ${m}\n\n| Feature | What it does | Status | Delivered on | Ref |\n|---|---|---|---|---|\n`;
  for (const r of rows.filter(r => r[0] === m)) md += `| ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} |\n`;
}
writeFileSync(join(root, "docs/DELIVERABLES.md"), md);
console.log(`rows ${rows.length}: ${STATUSES.map(s => `${s} ${count(s)}`).join(", ")}`);
