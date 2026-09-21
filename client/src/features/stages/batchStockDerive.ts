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

/* ---- Free stock (CR-199, production-first) ----------------------------------
   On-hand (`current`) minus boxes already spoken for: an order item's CLAIM on
   a batch (order-linked production records + stock allocations) that has not
   left the building yet. Loaded boxes drop out of BOTH sides — they already
   reduced `current` — so a claim is netted by that order item's own loaded
   boxes: same batch first, then its blank-batch loads FIFO over what is left. */
export interface ClaimIn {
  designId: string;
  batch: string;
  orderItemId: string;
  qty: number;
}
export interface LoadedIn {
  orderItemId: string;
  batch: string;
  boxes: number;
}

const stockKey = (designId: string, batch: string) => `${designId}|${batch}`;

/** Reserved boxes per `designId|batch` — subtract from `current` for free stock. */
export function reservedByBatch(claims: ClaimIn[], loaded: LoadedIn[]): Map<string, number> {
  // order item → batch → outstanding claim (insertion order = FIFO for blanks)
  const byOi = new Map<string, Map<string, { designId: string; left: number }>>();
  for (const c of claims) {
    if (c.qty <= 0 || !c.orderItemId) continue;
    const m = byOi.get(c.orderItemId) ?? byOi.set(c.orderItemId, new Map()).get(c.orderItemId)!;
    const cur = m.get(c.batch);
    if (cur) cur.left += c.qty;
    else m.set(c.batch, { designId: c.designId, left: c.qty });
  }
  const blank = new Map<string, number>();
  for (const l of loaded) {
    const m = byOi.get(l.orderItemId);
    if (!m || l.boxes <= 0) continue;
    const hit = l.batch ? m.get(l.batch) : undefined;
    if (hit) hit.left -= l.boxes;
    else blank.set(l.orderItemId, (blank.get(l.orderItemId) || 0) + l.boxes);
  }
  const out = new Map<string, number>();
  for (const [oi, m] of byOi) {
    let spill = blank.get(oi) || 0;
    for (const [batch, c] of m) {
      let left = Math.max(0, c.left);
      const take = Math.min(left, spill);
      left -= take;
      spill -= take;
      if (left > 0) out.set(stockKey(c.designId, batch), (out.get(stockKey(c.designId, batch)) || 0) + left);
    }
  }
  return out;
}

/** Free boxes of one derived row = max(0, current − reserved). */
export function freeOf(row: { designId: string; batch: string; current: number }, reserved: Map<string, number>): number {
  return Math.max(0, row.current - (reserved.get(stockKey(row.designId, row.batch)) || 0));
}
