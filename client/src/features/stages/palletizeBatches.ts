/* Read-only batch view for New Palletization (CR-223): per order item, the
   produced/allocated batches not yet on any palletization line. Client mirror of
   the server's `unqueuedBatches` (functions/data-ops/index.js), which does the
   real FIFO batch attribution on save — this is display only. Zero imports. */

export interface BatchSupply {
  orderItemId: string;
  batchNumber: string;
  qtyBoxes: number;
  createdTime: string;
}
export interface BatchQueued {
  orderItemId: string;
  batchNumber: string;
  boxes: number;
}
export interface OpenBatch {
  batch: string;
  available: number;
}

/** orderItemId → its batches with boxes still un-queued, FIFO by first record. */
export function unqueuedByItem(supply: BatchSupply[], queued: BatchQueued[]): Map<string, OpenBatch[]> {
  const made = new Map<string, Map<string, { qty: number; first: string }>>();
  for (const s of supply) {
    if (!s.orderItemId || !s.batchNumber) continue;
    let byBatch = made.get(s.orderItemId);
    if (!byBatch) made.set(s.orderItemId, (byBatch = new Map()));
    const cur = byBatch.get(s.batchNumber) || { qty: 0, first: s.createdTime };
    cur.qty += s.qtyBoxes;
    if (s.createdTime < cur.first) cur.first = s.createdTime;
    byBatch.set(s.batchNumber, cur);
  }
  const used = new Map<string, number>(); // "item|batch" → boxes already on plan lines
  for (const q of queued) {
    const k = `${q.orderItemId}|${q.batchNumber}`;
    used.set(k, (used.get(k) || 0) + q.boxes);
  }
  const out = new Map<string, OpenBatch[]>();
  for (const [oi, byBatch] of made) {
    const rows = [...byBatch.entries()]
      .sort((a, b) => (a[1].first < b[1].first ? -1 : 1))
      .map(([batch, p]) => ({ batch, available: Math.max(0, p.qty - (used.get(`${oi}|${batch}`) || 0)) }))
      .filter((r) => r.available > 0);
    if (rows.length) out.set(oi, rows);
  }
  return out;
}
