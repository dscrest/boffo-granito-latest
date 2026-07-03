---
name: ""
metadata: 
  node_type: memory
  originSessionId: 9e7f82ea-8a56-4661-b348-2053151d6821
---

Two distinct pallet concepts in BOFFO — do not confuse them:
- **Pallet Master** (`/pallets`, Pallets.tsx) — the master where pallet formats/specs are defined. Lives under the **Items** menu, labeled "Pallet Master".
- **Palletization** (`/packing`, PalletPacking.tsx) — the process that converts order items into palletised batches. Lives under **Sales** (after Master Orders), labeled "Palletization"; its primary action button reads "New Palletization".

**Why:** On 2026-07-03 I moved Pallet Master into Sales ▸ Master Orders as "Palletise" — the user corrected this: the master belongs in Items; only the process belongs in Sales.

**How to apply:** Any nav/label work keeps Pallet Master under Items and Palletization under Sales in its current position.
