# Change Requests — Item Master & Add Item Form

Scope: **Item Master** list/grid + **Add Item** (item creation) form + **Edit Item** mode.
Template fields per the standing change-request template (CHANGE + WHERE mandatory; rest fill-in). Sub-points kept under their parent.

---

## 1. Size & Status filters must be DB-sourced

- **CHANGE:** Size and Status filters read their options from the DB, not a hard-coded list.
- **WHERE:** Item Master grid filters + Add Item form (Size, Status fields).
- **WHY:** Static lists drift from real data; masters must be uniform and DB-driven.
- **APPLY TO:** Everywhere these pick lists appear (all forms/grids using Size or Status).
- **LIKE:** Existing DB-sourced pick lists (`pick-lists-db-sourced` rule).
- **DONE WHEN:** Both filters populate from the master table; no static arrays remain.

## 2. Drop the "Design Master" concept from the page

- **CHANGE:** Remove "Design Master" from the page; align everything to "Design"/"Item".
- **WHERE:** Item Master page.
- **DONE WHEN:** No "Design Master" wording/section remains; page reads as Item.

## 3. Rename "New Design" → "New Item"; remove refresh button

- **CHANGE:** Rename the "New Design" action to "New Item". Remove the refresh button.
- **WHERE:** Item Master page header/actions.
- **DONE WHEN:** Button reads "New Item"; no refresh button on the page.

## 4. Status defaults to "Continue" and is locked at creation

- **CHANGE:** On item creation, Status = "Continue" by default and is **disabled** (not editable). Status can only change later, in edit mode.
- **WHERE:** Add Item form (Status field) + Edit Item mode.
- **WHY:** A new item is always in-progress; status transitions belong to edit, not create.
- **DONE WHEN:** Create form shows Status=Continue, greyed/disabled; edit mode allows changing it.

## 5. No negative values in size/number fields

- **CHANGE:** Width, length, and every numeric size field reject negative values.
- **WHERE:** Add Item / Edit Item forms — all numeric size inputs.
- **APPLY TO:** Everywhere numeric size/number fields exist across all forms.
- **DONE WHEN:** Negative entry is blocked (min 0); enforced on all size inputs.
- **MEMORY:** Standing rule — already covered by `form-ux-standard` (no negatives). Retrofit all existing forms.

## 6. Remove "Associate Pallets" from item creation

- **CHANGE:** Remove the Associate Pallets step/section from item creation. (Will be re-introduced later when needed.)
- **WHERE:** Add Item form.
- **DONE WHEN:** No pallet-association UI during item creation.

## 7. Remove "Accounting Stock" from item creation

- **CHANGE:** Remove the Accounting Stock field/section.
- **WHERE:** Add Item form.
- **DONE WHEN:** No Accounting Stock UI on the create form.

## 8. Unique Name must be unique across, with party brand

- **CHANGE:** The Unique Name is unique across all items; when a party brand name is present it becomes part of the Unique Name.
- **WHERE:** Add Item / Edit Item — Unique Name generation.
- **DONE WHEN:** Unique Name is a validated-unique combination that includes party brand when set.
- **Sub-points:**
  - **8.1** Combination logic — already exists; keep.
  - **8.2** If a party brand name is present, append it to the Unique Name.
  - **8.3** Add a **Party Master** dropdown to the form.
    - **8.3.1** Add a table for the party-master brand.
    - **8.3.2** Add the master-entry form for it under **Settings**.
    - **8.3.3** Make it a **typable** dropdown (Combobox) — entries will grow. *(was mislabelled 8.3.4)*

## 9. Pick-list keyboard nav (arrow + spacebar) must work everywhere

- **CHANGE:** Fix arrow-key navigation and spacebar selection in pick lists; make behaviour identical across all pick lists. Pick lists must be both typable and selectable.
- **WHERE:** All Combobox/pick-list controls, app-wide.
- **APPLY TO:** Everywhere — one shared component, not per-form fixes.
- **DONE WHEN:** Arrow keys move the highlight and space/enter selects, consistently, in every pick list.
- **MEMORY:** Save as a standing pick-list-keyboard rule; retrofit all existing pick lists.

## 10. Rename "Save Design" → "Save"

- **CHANGE:** Button label "Save Design" → "Save".
- **WHERE:** Add Item / Edit Item form.
- **DONE WHEN:** Save button reads "Save" (aligns with `form-ux-standard` Save-only).

## 11. Required markers in red — all forms

- **CHANGE:** The `*` required marker is coloured red.
- **WHERE:** All forms, all new designs (app-wide).
- **APPLY TO:** Everywhere a required marker appears.
- **DONE WHEN:** Every required `*` renders red, consistently.
- **MEMORY:** Save as standing rule; retrofit all forms.

## 12. Remove image upload from item creation

- **CHANGE:** Remove the image-upload option at item-creation time.
- **WHERE:** Add Item form.
- **DONE WHEN:** No image upload on the create form.
- **Sub-points (later, separate feature):**
  - **12.1** Build a dedicated **Inventory Image Upload** screen/feature.
  - **12.2** User will share the reference; that same upload will also be available at item-creation time. *(blocked on reference)*

## 13. Edit Mode redesign

- **CHANGE:** Reworked edit experience driven from the grid item link.
- **WHERE:** Item Master grid → Edit Item.
- **Sub-points:**
  - **13.1** Clicking an item link in any grid report opens the item's associated details in a **left panel** first.
  - **13.2** User will provide the **Zoho Books item reference**. *(blocked on reference)*
  - **13.3** Provide **edit / delete** actions on the same form, top-left corner.
  - **13.4** The item-list grid **shrinks to show only the Unique Item Name** for easy navigation.
- **LIKE:** Detail-page + left-panel pattern (`detail-page-consistency`).
- **DONE WHEN:** Grid click → left-panel details, edit/delete top-left, grid collapsed to Unique Name.

## 14. Item details to display

- **CHANGE:** Show the item's key details.
- **WHERE:** Item detail / left panel.
- **Sub-points:**
  - **14.1** Item Unique Name.
  - **14.2** SKU.
  - **14.3** User will share the reference screenshot. *(blocked on reference)*

## 15. SKU generation from master short codes

- **CHANGE:** Generate a unique SKU per item from the short-code parts of each master value.
- **WHERE:** Master tables + Add Item (SKU auto-generation).
- **WHY:** Readable, deterministic SKUs derived from master values.
- **Sub-points:**
  - **15.1** Choose the short-code value for each master item value.
  - **15.2** Each master table also **holds the SKU code part** — modify the table schema accordingly.
  - **15.3** The same short code drives the auto code.
  - **15.4** Put the logic in code so every new item gets its unique SKU code, used to generate the SKU at creation time.
  - **15.5** SKU must be unique.
- **LIKE:** The deferred readable-SKU plan (`sku-readable-plan`, codeword "SKU").
- **DONE WHEN:** Masters store short codes; new item auto-generates a unique SKU from them at creation.

## 16. Multi-select filter screen

- **CHANGE:** A filter screen listing all available values; user selects any as filters and the grid returns only matching items.
- **WHERE:** Item Master grid — advanced/multi filter.
- **LIKE:** Existing advanced-search modal (`grid-ux-standard`).
- **DONE WHEN:** User can pick multiple values across fields and the list filters to matches.

---

### Blocked on user-supplied references
- **12.2** Inventory image-upload reference.
- **13.2** Zoho Books item reference.
- **14.3** Item-details reference screenshot.
