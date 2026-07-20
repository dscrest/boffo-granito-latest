/* ============================================================
   Phase 4 saga callers — close-pallet / load-container / dispatch.

   Thin typed wrappers over the data-ops business routes (lib/dataOps
   `op`). Each saga validates + writes server-side and records to
   OperationLog; callers branch on `ok`. The fit-suggester lives in
   masters/containersApi.ts (it's read-only and container-centric).
   ============================================================ */
import { list, listAll, op, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { invalidateOrders } from "@/features/orders/ordersApi";
import { invalidateContainers } from "@/features/masters/containersApi";
import { invalidatePalletOrders } from "@/features/masters/palletsApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/* ---- palletizable work list (produced not yet fully palletized) ---- */
export interface PalletizableItem {
  orderItemId: string; // OrderItem ROWID → close-pallet line.order_item
  designId: string; // Design ROWID
  designLabel: string;
  sizeId: string; // Size ROWID via Design.size ("" when unset)
  sizeCode: string; // Size.code e.g. "300x300" (for per-line pallet-size matching)
  ordered: number; // ordered_qty_boxes (confirmed demand)
  available: number; // produced − palletized (boxes free to palletize NOW)
  produced: number;
  palletized: number;
  toProduce: number; // ordered − produced − in-flight requests (boxes still to request → production)
}
export interface PalletizableOrder {
  salesOrderId: string; // SalesOrder ROWID → close-pallet sales_order
  label: string; // "PO-123 · Acme"
  portOfDischarge: string; // destination for container matching ("" when unset)
  items: PalletizableItem[];
}

/**
 * OrderItems grouped by their SalesOrder.
 *
 * Default (no opts): only items with available > 0 (produced − palletized) —
 * the global "Pallet Packing" work list. With `includeOrderId`, that one order
 * is returned in full (every line item, even available ≤ 0 and regardless of
 * stage) so the form can scope to a confirmed Sales Order and surface lines
 * that still need production. In preset mode ONLY that order is returned.
 */
export function listPalletizable(opts?: { includeOrderId?: string }): Promise<{
  ok: boolean;
  orders: PalletizableOrder[];
  error?: string;
}> {
  // Preset mode is parameterized — bypass the cache; the global work
  // list (no opts) is cached + deduped like every other list.
  if (opts?.includeOrderId) return fetchPalletizable(opts);
  return palletizableCache.load();
}

const palletizableCache = createListCache(() => fetchPalletizable());

async function fetchPalletizable(opts?: { includeOrderId?: string }): Promise<{
  ok: boolean;
  orders: PalletizableOrder[];
  error?: string;
}> {
  const [items, sos, customers, designs, sizes, prod] = await Promise.all([
    listAll("OrderItem"),
    listAll("SalesOrder", { order: "ROWID desc", columns: ["po_number", "order_number", "customer", "port_of_discharge"] }),
    listAll("Customer", { columns: ["name"] }),
    listAll("Design", { columns: ["design_name", "size"] }),
    listAll("Size", { columns: ["code"] }),
    // Outstanding production requests (not yet produced) so "remaining to
    // produce" doesn't offer boxes already awaiting approval/output.
    listAll("ProductionLog", { columns: ["order_item", "qty_requested", "status"] }),
  ]);
  if (!items.ok || !sos.ok) return { ok: false, orders: [], error: items.error || sos.error };

  const inFlight = new Map<string, number>();
  (prod.rows || []).forEach((p) => {
    const s = str(p.status);
    if (s !== "PendingApproval" && s !== "Approved") return;
    const k = str(p.order_item);
    if (k) inFlight.set(k, (inFlight.get(k) || 0) + num(p.qty_requested));
  });

  const soById = new Map<string, DSRow>();
  (sos.rows || []).forEach((s) => soById.set(String(s.ROWID), s));
  const custName = new Map<string, string>();
  (customers.rows || []).forEach((c) => custName.set(String(c.ROWID), str(c.name)));
  const designName = new Map<string, string>();
  const designSize = new Map<string, string>();
  (designs.rows || []).forEach((d) => {
    designName.set(String(d.ROWID), str(d.design_name));
    designSize.set(String(d.ROWID), str(d.size));
  });
  const sizeCodeById = new Map<string, string>();
  (sizes.rows || []).forEach((s) => sizeCodeById.set(String(s.ROWID), str(s.code)));

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
      const po = so ? str(so.order_number) || str(so.po_number) : soId;
      const party = so ? custName.get(str(so.customer)) || "" : "";
      byOrder.set(soId, {
        salesOrderId: soId,
        label: party ? `${po} · ${party}` : po,
        portOfDischarge: so ? str(so.port_of_discharge) : "",
        items: [],
      });
    }
    const designId = str(it.design);
    const sizeId = designSize.get(designId) || "";
    byOrder.get(soId)!.items.push({
      orderItemId: String(it.ROWID),
      designId,
      designLabel: designName.get(designId) || designId,
      sizeId,
      sizeCode: sizeCodeById.get(sizeId) || "",
      ordered,
      available,
      produced,
      palletized,
      toProduce: Math.max(0, ordered - produced - (inFlight.get(String(it.ROWID)) || 0)),
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

/** Closed pallet batches with no ContainerLoading row — ready to load.
    Cached + deduped; sagas below invalidate. */
export function listLoadableBatches(): Promise<{
  ok: boolean;
  batches: LoadableBatch[];
  error?: string;
}> {
  return loadableCache.load();
}

const loadableCache = createListCache(fetchLoadableBatches);

async function fetchLoadableBatches(): Promise<{
  ok: boolean;
  batches: LoadableBatch[];
  error?: string;
}> {
  const [batches, loadings, designs] = await Promise.all([
    listAll("PalletisedBatch", { order: "ROWID desc" }),
    listAll("ContainerLoading", { columns: ["batch"] }),
    listAll("Design", { columns: ["design_name"] }),
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
/* ---- palletisation batches for one Sales Order (SO detail "Palletization" tab) ---- */
export interface OrderBatchRow {
  batchId: string;
  design: string;
  pallet: string;
  boxes: number;
  date: string; // palletization date (delivery_date)
  status: string;
}

/** Palletised batches committed against one Sales Order — powers the SO
    detail Palletization tab (parallel to the Production tab). */
export async function listOrderBatches(
  salesOrderId: string,
): Promise<{ ok: boolean; rows: OrderBatchRow[]; error?: string }> {
  const [batches, designs, pallets] = await Promise.all([
    listAll("PalletisedBatch", { order: "ROWID desc" }),
    listAll("Design", { columns: ["design_name"] }),
    listAll("Pallet", { columns: ["name"] }),
  ]);
  if (!batches.ok) return { ok: false, rows: [], error: batches.error };
  const designName = new Map<string, string>();
  (designs.rows || []).forEach((d) => designName.set(String(d.ROWID), str(d.design_name)));
  const palletName = new Map<string, string>();
  (pallets.rows || []).forEach((p) => palletName.set(String(p.ROWID), str(p.name)));
  const rows: OrderBatchRow[] = (batches.rows || [])
    .filter((b) => str(b.sales_order) === String(salesOrderId))
    .map((b) => ({
      batchId: String(b.ROWID),
      design: designName.get(str(b.design)) || "—",
      pallet: palletName.get(str(b.pallet)) || "—",
      boxes: num(b.boxes_packed),
      date: str(b.delivery_date) || "—",
      status: str(b.status) || "—",
    }));
  return { ok: true, rows };
}

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

/* Sagas move boxes across stage counters, so every cache built on
   OrderItem / PalletisedBatch / Container is stale after one runs. */
function bustStageCaches(): void {
  palletizableCache.invalidate();
  loadableCache.invalidate();
  invalidateOrders();
  invalidateContainers();
  // close-pallet inserts a PalletisedBatch — the pallet detail's order list is stale.
  invalidatePalletOrders();
}
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    bustStageCaches();
    return r;
  });
}

export function closePallet(input: ClosePalletInput) {
  return bust(op<{ ROWID: string; boxes_packed: number; lines: number }>("close-pallet", input));
}

/* ---- production-log: OrderItemEvent + produced bump (+ stage po→prod) ---- */
export interface ProductionLogInput {
  order_item: string; // OrderItem ROWID
  qty_boxes: number;
  production_date?: string;
  shift?: string;
  performed_by?: string;
  note?: string;
}

export function logProduction(input: ProductionLogInput) {
  return bust(op<{ produced_qty_boxes: number; stage: string }>("production-log", input));
}

/* ---- load-container: palletized → loaded ---- */
export interface LoadContainerInput {
  container: string; // Container ROWID
  batches: string[]; // PalletisedBatch ROWIDs (closed, not yet loaded)
  loaded_by?: string;
}

export function loadContainer(input: LoadContainerInput) {
  return bust(
    op<{ container: string; loaded_batches: number; loading_ids: string[] }>("load-container", input),
  );
}

/* ---- dispatch: loaded → dispatched (whole container) ---- */
export function dispatchContainer(containerId: string, performed_by?: string) {
  return bust(op<{ container: string; batches: number }>(`dispatch/${containerId}`, { performed_by }));
}
