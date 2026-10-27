# On hold — requirements asked for and deliberately parked

Requests the user has raised and then said **hold** on. They are not forgotten and not refused: each row
says why it waits and what should bring it back. A held requirement does **not** take a CR number until it
is picked up; when it is, add the CR and move the row to the "Picked up" table at the bottom.

Rule (user, 2026-10-27): "Create a register for hold requirements as well, to touch them at later."

| # | Date | From | Requirement | Why held | Revisit when |
|---|---|---|---|---|---|
| 1 | 2026-10-27 | Voice note 1 (walkthrough) | **Boffo / Bonza — two companies in one system.** The Export module will mainly serve Bonza; Panel Craft and the domestic flow stay Boffo. Separate the two companies' transactions, prints and branding without a second installation. | User decision at plan time: this will be a **login-time company selection (multi-tenancy)**, not a per-document Company field or a second user. Needs its own design (company on the session, company-scoped lists and numbering, a second Organization profile for prints). | The user says "Bonza" / "company selection" / "multi-tenancy". Starting point: `functions/data-ops/lib/appauth.js` (session + guard), `lib/org.ts` + `lib/orgProfile.js` (branding), `nextOrderNumber` (series). |
| 2 | 2026-10-26 | Stock walk | **"Add New Production" compact UI** — a shorter Start New Production form. | User: HOLD (2026-10-26) after the Stock tree work; Bulk Record Production took the Adjust Stock shape instead (CR-469). | The user asks for the Start New Production form again. |
| 3 | 2026-10-27 | Delete-effects check (voice note 1) | **Undo the final panel load.** A load that flipped a panel order to Dispatched cannot be deleted (`/panel-load-delete` refuses once the order is closed), so cut-piece stock and booking can only be corrected by a manual adjustment. | Needs a "reopen" route (Dispatched → open, stock + booking reversal, Activity entry) — not asked for yet; every other delete path was checked consistent (CR-475). | A wrong final load has to be undone on a live order. |
| 4 | 2026-10-21 | Panel Craft to-do list (`~/.claude/plans/Panel Craft.md`) | Open items 2…12 of the 12-item list that have no CR yet: status change from the order form (3), panel auto sequence (4 — superseded in spirit by the CR-473 item code), godown print issue / request (5), missing items to fulfil (6), "Ordered Completed" not needed (8), partial start palletization (9), add new container from the planner (10), container master naming (11), bill / expense (12). Item 2 (Quote / SO → New Request) exists via `?fromOrder=` / `?fromQuote=`. | Ambiguous or lower priority; 4, 6, 8, 11 need clarification before building. | The user picks one by number. Some already have Future rows in `DELIVERABLES.md`. |

## Picked up

| # | Picked up on | CR | Note |
|---|---|---|---|
| — | | | |
