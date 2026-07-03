---
name: pick-lists-db-sourced
description: "Master pick-list values must be uniform everywhere and sourced from the DB, never static"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3b91e813-f3f9-47dd-8f98-89236daa53e3
---

Master pick-list values (Size, Finish, Category, Glaze, Brand, Grade, PaymentTerm, …),
wherever they are used in any form, must be uniform across all pick lists and sourced from
the live DB tables — never hardcoded static arrays.

**Why:** Static lists drift out of sync with the DB. The reported symptom was the Pallet form
showing free-text Width/Length while the Design form showed live Size options; and PaymentTerm
was hardcoded (`Credit 30`, etc.) in Order/Quote even though a `PaymentTerm` table exists.

**How to apply:** Source options from the live lookups (the `list("<Table>")` pattern in
designsApi/palletsApi, or `useMasters()` which exposes `paymentTerms`). Make the Masters editor
page the single write surface. Avoid re-introducing static lookup consts like `PAYMENT_TERMS` in
[[data.ts]]. Note: Quote/Order store the term *name* string while Customer stores the term ROWID —
keep each form's existing storage semantics when only swapping the option *source*.
