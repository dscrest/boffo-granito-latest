/* ============================================================
   Batch ledger — "where did batch B/26-27/007 actually go?".

   One row per (batch × consumer): the boxes of a batch that landed on a
   pallet, in a load box, or on a truck, named by customer / SO / plan / box.
   Every batch also gets one "On hand" row for whatever is left, so

       Σ rows of a batch  ==  its produced + opening

   which is the report's own self-check.

   Pure — no fetching. It joins the two caches the caller already holds:
   batchStockApi (produced/opening per batch) and palPlansApi (plans + boxes).
   Consumption uses the SAME rule as batchStockApi/recountOrderItems: a line
   counts once it is ReadyToLoad or sitting in a box; Planning/Palletizing
   lines are still queue, so they stay in On hand.
   ============================================================ */
import type { BatchStockRow } from "./batchStockApi";
import type { LoadBox, PalPlan } from "./palPlansApi";

// ponytail: mirrors palPlansApi.boxLabel. Importing it as a VALUE would pull the
// whole dataOps/cache chain into this pure module and into its self-check; one
// line kept in step is the cheaper trade. Change both together.
const labelOf = (b: LoadBox) => b.vehicleNumber || `Container ${b.boxNumber}`;

export type BatchStage = "On hand" | "Palletised" | "Loaded" | "Dispatched";

export interface BatchMoveRow {
  key: string;
  batchNumber: string;
  designId: string;
  itemLabel: string;
  sizeCode: string;
  mfgDate: string;
  /** The batch's total produced + opening — repeated on every row of the batch. */
  batchTotal: number;
  stage: BatchStage;
  boxes: number;
  customerId: string;
  customerName: string;
  salesOrderId: string;
  soNumber: string;
  palNumber: string;
  boxName: string; // "Box 4" / container number
  containerNumber: string;
  vehicleNumber: string;
  dispatchDate: string;
}

/** Batch movement rows, newest dispatch first then batch. */
export function batchLedger(stock: BatchStockRow[], plans: PalPlan[], boxes: LoadBox[]): BatchMoveRow[] {
  // A batch belongs to one item, so (designId · batch) is the ledger key —
  // and batchStockApi already emits exactly one row per key.
  const keyOf = (designId: string, batch: string) => `${designId} ${batch}`;
  const byBatch = new Map<string, BatchStockRow>(stock.map((s) => [keyOf(s.designId, s.batchNumber), s]));

  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const rows: BatchMoveRow[] = [];
  const consumed = new Map<string, number>();

  for (const p of plans) {
    for (const l of p.lines) {
      const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
      if (l.status !== "ReadyToLoad" && !box) continue; // still queue — not consumed
      const k = keyOf(l.designId, l.batchNumber);
      const s = byBatch.get(k);
      consumed.set(k, (consumed.get(k) || 0) + l.boxes);
      const stage: BatchStage = !box ? "Palletised" : box.status === "Dispatched" ? "Dispatched" : "Loaded";
      rows.push({
        key: `line-${l.id}`,
        batchNumber: l.batchNumber,
        designId: l.designId,
        itemLabel: s?.designLabel || l.designLabel,
        sizeCode: s?.sizeCode || l.sizeCode,
        mfgDate: s?.mfgDate || "",
        batchTotal: s ? s.produced + s.opening : 0,
        stage,
        boxes: l.boxes,
        customerId: l.customerId,
        customerName: l.customerName,
        salesOrderId: l.salesOrderId,
        soNumber: l.soNumber,
        palNumber: p.palNumber,
        boxName: box ? labelOf(box) : "",
        containerNumber: box?.containerNumber || "",
        vehicleNumber: box?.vehicleNumber || "",
        dispatchDate: box?.dispatchDate || "",
      });
    }
  }

  // Whatever a batch produced but nothing has consumed is still on hand.
  for (const [k, s] of byBatch) {
    const left = s.produced + s.opening - (consumed.get(k) || 0);
    if (left <= 0) continue;
    rows.push({
      key: `onhand-${k}`,
      batchNumber: s.batchNumber,
      designId: s.designId,
      itemLabel: s.designLabel,
      sizeCode: s.sizeCode,
      mfgDate: s.mfgDate,
      batchTotal: s.produced + s.opening,
      stage: "On hand",
      boxes: left,
      customerId: "",
      customerName: "",
      salesOrderId: "",
      soNumber: "",
      palNumber: "",
      boxName: "",
      containerNumber: "",
      vehicleNumber: "",
      dispatchDate: "",
    });
  }

  return rows.sort(
    (a, b) =>
      (b.dispatchDate || "").localeCompare(a.dispatchDate || "") ||
      b.batchNumber.localeCompare(a.batchNumber) ||
      a.stage.localeCompare(b.stage),
  );
}
