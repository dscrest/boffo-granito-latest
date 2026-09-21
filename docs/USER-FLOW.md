# BOFFO Order OS — How the work flows

A short guide for anyone new to the system. It follows one order from the first quote to the
truck leaving the gate, and tells you which screen to open and which button to press at each step.

## The whole journey in one line

**Customer → Quote → Sales Order → Production → Allocate Stock → Palletization → Loading → Dispatch**

| Step | Who usually does it | Screen (left menu) |
|---|---|---|
| 1. Add the customer | Sales | Sales ▸ Customers |
| 2. Make a quote | Sales | Sales ▸ Quotes |
| 3. Turn it into a sales order | Sales | Sales ▸ Quotes, then Sales Orders |
| 4. Record production | Factory | Inventory ▸ Production |
| 5. Allocate stock to the order | Sales / Planning | Sales ▸ Sales Orders |
| 6. Palletize | Warehouse | Sales ▸ Palletization |
| 7. Load the container | Warehouse / Dispatch | Sales ▸ Loading and Dispatch |
| 8. Dispatch | Dispatch | Sales ▸ Loading and Dispatch |

You only see the menu items your role is allowed to use. If something in this guide is missing
from your menu, ask your administrator.

## A few things to know first

- **Two views on most pages.** *Sheet* is a table, *Kanban* is a board of cards. Same data — use
  whichever you prefer. Pages open on Sheet.
- **Click a row to open it.** The full record opens with **Edit** and a **More** menu at the top right.
- **The "+" on a row** holds every action you can take on that row. An action shown in grey is not
  possible yet — hover over it to see why.
- **Grey fields are filled in by the system. White fields are yours to type.** A red asterisk means
  the field is required.
- **Nothing is saved until you press Save.** This includes the Edit mode on sheets.
- **Need a walkthrough inside the app?** Click your name (top right) ▸ **Take a tour**, or
  **Page guide** on the Palletization and Loading pages.

---

## 1. Add the customer

**Sales ▸ Customers ▸ New Customer.** Fill in the name, addresses, currency, payment terms and the
customer's usual Box Brand, then Save.

It is worth doing this properly once: every quote and order for this customer fills in these
details automatically.

## 2. Make a quote

**Sales ▸ Quotes ▸ New Quote.**

1. Pick the customer. Their currency, terms, addresses and Box Brand fill in by themselves.
2. Add the items and quantities. Save.
3. *(Optional)* **More ▸ Plan Containerisation** shows how many containers the quote needs and how
   full each one is.
4. Move the quote forward with the button at the top right:
   **Submit for Approval → Approve** (done by an approver, under Sales ▸ Approvals) **→ Mark As Sent
   → Accept** (when the customer says yes).

If you are an approver yourself, your quotes are approved as soon as you save them.

## 3. Turn the quote into a sales order

Open the **accepted** quote ▸ **Convert to Sales Order** (top right; also under **More**). Enter the customer's **PO Number**
(required), choose a pallet for each line, then Save. You land on the new order.

- You can convert the whole quote or only part of it. The rest stays on the quote for later.
- The button only works once the quote is *Accepted*.
- The container plan comes along with the order, and the order keeps its own copy that you can change.
- If your role needs approval: **Submit for Approval**, and an approver confirms it. A confirmed
  order is live.

## 4. Record production

The factory produces **into stock**. Production is not tied to one order — stock is handed to
orders in the next step.

**What should we make?** On **Inventory ▸ Production**, click **To Produce** (the labelled button
at the end of the view icons next to Search). It lists, item by item, what open
orders still need, what is already free in stock, what is already being made, and which Box Brand
is wanted. Tick the rows you plan to make and they are carried into a new production entry.

**To start a production:**

1. **Inventory ▸ Production ▸ Start New Production.**
2. Add one line per item: **Item · Qty (boxes)**.
3. Save. The job appears under **In Production** with nothing produced yet.

**To record what was made:** press **+** on the job's row ▸ **Log Production**, enter the boxes,
**Batch No.** and Box Brand, Save. **Batch No.** — type the factory's batch number, or leave it blank
and the system numbers it (`B/2026-09/001`, next one `…/002`). Repeat for every batch; each batch
shows as its own row. **+ ▸ Complete Production** logs whatever is left and closes the job. The job's status moves by itself — *New → In Production →
Completed* — as the boxes add up.

**Many rows at once:** on the Sheet press **Edit**, type the *Produced* boxes against each row, then
**Save**.

**From Excel:** **Import** on the Production page. Do not import the same file twice — it will count
the boxes twice.

**Check the stock:** **Inventory ▸ Stock Details** shows the boxes on hand, batch by batch.

## 5. Allocate stock to the order

Open the sales order ▸ **More ▸ Allocate Stock**. Pick the batches and the number of boxes to
reserve for each order line, then Save.

Allocated boxes belong to that order — no other order can take them. Each order line shows where it
stands: *Allocated · Stock ready · Partial stock · In production · Need production*.

## 6. Palletize

There are two pages under **Sales ▸ Palletization**:

- **Ready for Palletization** — boxes waiting to go onto pallets. Produced boxes for an order
  appear here by themselves.
- **In Palletization** — pallets being built right now.

Everything is done from the **+** on a row:

1. **Start Palletisation** — confirm the pallet type. The line moves to *In Palletization*.
2. **Complete Palletisation** — enter the boxes that are finished. They move on to *Ready for Loading*.
   - Doing part today and the rest tomorrow is fine: enter only what is done. The row shows a
     **Partial** chip until the rest is recorded.
   - **Top Up Batch** — when a pallet is a few boxes short, fill it with boxes from another batch of
     the same design.

To do several rows together, tick them and use the bar at the bottom of the page.

**Pallet Slips** and the **Packing Report** are printed from that same bar — tick the rows, then
print. They only print when you ask.

> **Important:** a batch can be loaded only once the **whole batch** is palletized. Until then it
> stays on *In Palletization* with a **Recorded** chip.

## 7. Load the container

**Sales ▸ Loading and Dispatch ▸ New Loading** (or open the sales order ▸ **More ▸ New Loading**).
One loading is one container, for one customer. There are two steps:

1. **Select items** — pick the customer on the left. On the right, type the number of boxes to load
   against each batch. **Fill from plan** fills these in from the order's container plan. Save.
2. **Seals, sheet & vehicle** — the loading sheet lists each design and its boxes. Against them, type
   the truck number (just type it; there is no list to pick from), container number, seal numbers and
   LR number. The system warns you if a seal or container number has been used before. Below the sheet,
   fill the driver name and mobile, container size, transporter, destination and supervisor. Save.

You land on the loading's own page. From there:

- **Add Pallets** puts more items into the same container.
- The **Loading Sheet** tab is the customer-style sheet — you can type straight into it (P.O., L.R.,
  truck, container, seals, pallet numbers).

On the Loading and Dispatch sheet, each line shows where it is:
*Ready for Loading → In Loading → Ready for Dispatch → Dispatched*.

## 8. Dispatch

Open the loading ▸ **More ▸ Dispatch** (or the **+** on its row ▸ **Dispatch**).

- Dispatch needs **a vehicle** and **at least one item loaded**. Until then the button is grey and
  tells you what is missing.
- A missing seal, LR number or transporter only gives a warning — you can still dispatch.
- After dispatch the **Dispatch Entry** opens for printing, and the loading is locked.

The sales order's **Dispatch** tab shows everything that has left against that order.

---

## Quick answers

| I want to… | Go to |
|---|---|
| See where an order stands | Sales ▸ Sales Orders ▸ open the order (tabs: items, palletization, dispatch) |
| Know what the factory should make | Inventory ▸ Production ▸ To Produce |
| Check the stock of a design | Inventory ▸ Stock Details |
| Find out why I can't load a batch | It is not fully palletized yet — finish it on In Palletization |
| Find out why I can't dispatch | Add a vehicle and load at least one item |
| Find out why I can't convert a quote | The quote must be *Accepted* first |
| Print pallet slips | Palletization ▸ tick the rows ▸ Pallet Slips |
| See what went out and when | Reports ▸ Dispatch Register |
| See who changed something | Reports ▸ Audit Log |
