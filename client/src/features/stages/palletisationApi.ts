/* ============================================================
   Phase 4 saga callers — close-pallet / load-container / dispatch.

   Thin typed wrappers over the data-ops business routes (lib/dataOps
   `op`). Each saga validates + writes server-side and records to
   OperationLog; callers branch on `ok`. The fit-suggester lives in
   masters/containersApi.ts (it's read-only and container-centric).
   ============================================================ */
import { list, op, type DSRow } from "@/lib/dataOps";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/* ---- palletizable work list (produced not yet fully palletized) ---- */
export interface PalletizableItem {
  orderItemId: string; // OrderItem ROWID → close-pallet line.order_item
  designId: string; // Design ROWID
  designLabel: string;
  ordered: number; // ordered_qty_boxes (confirmed demand)
  available: number; // produced − palletized (boxes free to palletize NOW)
  produced: number;
  palletized: number;
  toProduce: number; // ordered − produced (boxes still to make → production)
}
export interface PalletizableOrder {
  salesOrderId: string; // SalesOrder ROWID → close-pallet sales_order
  label: string; // "PO-123 · Acme"
  items: PalletizableItem[];
}

/**
 * OrderItems grouped by their SalesOrder.
 *
 * Default (no opts): only items with available > 0 (produced − palletized) —
 * the global "Pallet Packing" work list. With `includeOrderId`, that one order
 * is returned in full (every line item, even available ≤ 0 and regardless of
 * stage) so the form can scope to a confirmed Master Order and surface lines
 * that still need production. In preset mode ONLY that order is returned.
 */
export async function listPalletizable(opts?: { includeOrderId?: string }): Promise<{
  ok: boolean;
  orders: PalletizableOrder[];
  error?: string;
}> {
  const [items, sos, customers, designs] = await Promise.all([
    list("OrderItem", { limit: 300 }),
    list("SalesOrder", { order: "ROWID desc", limit: 300 }),
    list("Customer", { limit: 300 }),
    list("Design", { limit: 300 }),
  ]);
  if (!items.ok || !sos.ok) return { ok: false, orders: [], error: items.error || sos.error };

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = new Map<string, string>();
  (customers.rows || []).forEach((c) => custName.set(String(c.ROWID), str(c.name)));
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.design_name)));

  const preset = opts?.includeOrderId;
  const byOrder = new Map<string, PalletizableOrder>();
  for (const it of items.rows || []) {
    const soId = str(it.sales_order);
    if (!soId) continue;
    const isPreset = preset === soId;
    const ordered = num(it.ordered_qty_boxes);
    const produced = num(it.produced_qty_boxes);
    const palletized = num(it.palletized_qty_boxes);
    const available = produced - palletized;
    // Global list: skip lines with nothing ready to palletize. Preset order:
    // keep every line so the form can show "needs production" rows too.
    if (available <= 0 && !isPreset) continue;
    if (preset && !isPreset) continue; // preset mode returns only the chosen order
    if (!byOrder.has(soId)) {
      const so = soById.get(soId);
      const po = so ? str(so.po_number) || str(so.order_number) : soId;
      const party = so ? custName.get(str(so.customer)) || "" : "";
      byOrder.set(soId, { salesOrderId: soId, label: party ? `${po} · ${party}` : po, items: [] });
    }
    const designId = str(it.design);
    byOrder.get(soId)!.items.push({
      orderItemId: String(it.ROWID),
      designId,
      designLabel: designName.get(designId) || designId,
      ordered,
      available,
      produced,
      palletized,
      toProduce: Math.max(0, ordered - produced),
    });
  }

  return { ok: true, orders: [...byOrder.values()].filter((o) => o.items.length > 0) };
}

/* ---- loadable batches (closed PalletisedBatches not yet in a container) ---- */
export interface LoadableBatch {
  batchId: string; // PalletisedBatch ROWID → load-container batches[]
  label: string; // design name (fallback ROWID)
  boxes: number; // boxes_packed
}

/** Closed pallet batches with no ContainerLoading row — ready to load. */
export async function listLoadableBatches(): Promise<{
  ok: boolean;
  batches: LoadableBatch[];
  error?: string;
}> {
  const [batches, loadings, designs] = await Promise.all([
    list("PalletisedBatch", { order: "ROWID desc", limit: 300 }),
    list("ContainerLoading", { limit: 300 }),
    list("Design", { limit: 300 }),
  ]);
  if (!batches.ok) return { ok: false, batches: [], error: batches.error };

  const loadedSet = new Set((loadings.rows || []).map((r) => str(r.batch)));
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.design_name)));

  const rows: LoadableBatch[] = (batches.rows || [])
    .filter((b) => str(b.status) === "closed" && !loadedSet.has(String(b.ROWID)))
    .map((b) => {
      const id = String(b.ROWID);
      return { batchId: id, label: designName.get(str(b.design)) || `Batch #${id}`, boxes: num(b.boxes_packed) };
    });

  return { ok: true, batches: rows };
}

/* ---- close-pallet: produced → palletized ---- */
export interface ClosePalletLine {
  order_item: string; // OrderItem ROWID
  boxes: number;
}
export interface ClosePalletInput {
  sales_order: string; // SalesOrder ROWID
  pallet: string; // Pallet ROWID
  design?: string; // Design ROWID (optional)
  delivery_date?: string; // "" omitted server-side
  remarks?: string;
  performed_by?: string;
  lines: ClosePalletLine[];
}

export function closePallet(input: ClosePalletInput) {
  return op<{ ROWID: string; boxes_packed: number; lines: number }>("close-pallet", input);
}

/* ---- load-container: palletized → loaded ---- */
export interface LoadContainerInput {
  container: string; // Container ROWID
  batches: string[]; // PalletisedBatch ROWIDs (closed, not yet loaded)
  loaded_by?: string;
}

export function loadContainer(input: LoadContainerInput) {
  return op<{ container: string; loaded_batches: number; loading_ids: string[] }>("load-container", input);
}

/* ---- dispatch: loaded → dispatched (whole container) ---- */
export function dispatchContainer(containerId: string, performed_by?: string) {
  return op<{ container: string; batches: number }>(`dispatch/${containerId}`, { performed_by });
}
