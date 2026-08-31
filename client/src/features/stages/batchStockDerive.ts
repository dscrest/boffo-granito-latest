/* ============================================================
   deriveBatchStock — the pure reducer behind batch-wise stock. Zero imports
   on purpose: batchStockDerive.check.ts runs it directly under Node, and the
   fetch layer (batchStockApi) stays a thin decorator around it.

   Model: per design, SUPPLY buckets keyed by batch number, with "" as the
   "Unattributed" bucket (legacy plan-row output, pre-batch record rows, and a
   singular item's accounting stock). CONSUMPTION nets against supply:

     · an entry carrying a real batch nets that batch directly — consuming
       more than the batch ever supplied flags that row's `over` (a genuine
       anomaly, shown, never reallocated);
     · a blank-batch entry that is in a load box nets FIFO — the "" bucket
       first, then real batches oldest-first — the same rule the server's
       unqueuedBatches uses to allocate, so derivation mirrors allocation.
       Whatever no bucket can absorb lands on "" as `over`;
     · a blank-batch entry merely palletised (no box yet) sits on "" as
       palletised only — it does not reduce on-hand.

   Invariant (the check asserts it): per design,
     Σ current = Σ supply − Σ absorbed loaded boxes
   — naive per-key max(0,…) emission breaks this whenever supply and its
   consumption sit on different keys, which blank batches guarantee.
   ============================================================ */

export interface SupplyIn {
  designId: string;
  batch: string; // "" = unattributed bucket
  qty: number;
  kind: "opening" | "produced";
  date: string; // YYYY-MM-DD or ""
}

export interface ConsumeIn {
  designId: string;
  batch: string; // "" = unattributed — nets FIFO when loaded
  boxes: number;
  loaded: boolean; // in a load box (or legacy container) — reduces on-hand
  dispatched: boolean;
}

export interface DerivedRow {
  designId: string;
  batch: string;
  mfgDate: string; // earliest supply date; "" for the unattributed bucket
  opening: number;
  produced: number;
  palletised: number;
  loaded: number;
  dispatched: number;
  current: number; // max(0, opening + produced − loaded)
  over: number; // max(0, loaded − (opening + produced)) — anomaly marker
}

interface Cell {
  designId: string;
  batch: string;
  mfgDate: string;
  opening: number;
  produced: number;
  palletised: number;
  loaded: number;
  dispatched: number;
}

export function deriveBatchStock(supply: SupplyIn[], consumption: ConsumeIn[]): DerivedRow[] {
  const byDesign = new Map<string, Map<string, Cell>>();
  const cell = (designId: string, batch: string): Cell => {
    const design = byDesign.get(designId) ?? byDesign.set(designId, new Map()).get(designId)!;
    let c = design.get(batch);
    if (!c) {
      c = { designId, batch, mfgDate: "", opening: 0, produced: 0, palletised: 0, loaded: 0, dispatched: 0 };
      design.set(batch, c);
    }
    return c;
  };

  for (const s of supply) {
    const c = cell(s.designId, s.batch);
    if (s.kind === "opening") c.opening += s.qty;
    else c.produced += s.qty;
    if (s.batch && s.date && (!c.mfgDate || s.date < c.mfgDate)) c.mfgDate = s.date;
  }

  // Attributed consumption first — it is ground truth and must claim its
  // batch's supply before blank entries spill into it.
  const blanks: ConsumeIn[] = [];
  for (const e of consumption) {
    if (!e.batch) {
      blanks.push(e);
      continue;
    }
    const c = cell(e.designId, e.batch);
    c.palletised += e.boxes;
    if (e.loaded) c.loaded += e.boxes;
    if (e.dispatched) c.dispatched += e.boxes;
  }

  for (const e of blanks) {
    if (!e.loaded) {
      cell(e.designId, "").palletised += e.boxes;
      continue;
    }
    // FIFO spill: "" bucket first, then real batches oldest-first.
    const buckets = [...(byDesign.get(e.designId)?.values() ?? [])].sort((a, b) =>
      a.batch === "" ? -1 : b.batch === "" ? 1 : a.mfgDate.localeCompare(b.mfgDate) || a.batch.localeCompare(b.batch),
    );
    let left = e.boxes;
    for (const c of buckets) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, c.opening + c.produced - c.loaded));
      if (take <= 0) continue;
      c.palletised += take;
      c.loaded += take;
      if (e.dispatched) c.dispatched += take;
      left -= take;
    }
    if (left > 0) {
      const c = cell(e.designId, "");
      c.palletised += left;
      c.loaded += left;
      if (e.dispatched) c.dispatched += left;
    }
  }

  const rows: DerivedRow[] = [];
  for (const design of byDesign.values()) {
    for (const c of design.values()) {
      if (c.opening + c.produced + c.palletised + c.loaded + c.dispatched <= 0) continue;
      rows.push({
        ...c,
        current: Math.max(0, c.opening + c.produced - c.loaded),
        over: Math.max(0, c.loaded - (c.opening + c.produced)),
      });
    }
  }
  return rows;
}
