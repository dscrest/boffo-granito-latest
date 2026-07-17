/* ============================================================
   Pallet master — typed Data Store wrapper over lib/dataOps.

   The Pallet table (Catalyst) holds the pallet specs that Phase 4
   (palletisation + container fit) depends on. `size` is a real
   ForeignKey → Size (stores the Size ROWID). Every write is recorded
   server-side in OperationLog.
   ============================================================ */
import { list, listAll, insert, update, remove, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { sizeDisplayName } from "./sizesApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface SizeOption {
  id: string; // Size ROWID
  label: string; // human label (code, falling back to name)
  // Per-box packing data owned by the Size master. The pallet form shows these
  // read-only and snapshots them onto the Pallet row on save.
  sqmPerBox: number;
  sqftPerBox: number;
  boxWeightKg: number;
}

export interface PalletRow {
  id: string; // ROWID
  name: string;
  packingDetails: string; // e.g. "[32 * 30] = 960"
  sizeId: string; // Size ROWID ("" if unset)
  sizeLabel: string;
  palletType: string;
  palletSizeLabel: string;
  coverageSqm: number; // per box
  coverageSqft: number; // per box
  boxWeightKg: number; // per box
  // Arrangement A
  boxesPerPallet: number;
  palletsPerContainer: number;
  emptyWeightKg: number; // A pallet weight
  // Arrangement B (mixed loads; 0 when single-arrangement)
  bBoxesPerPallet: number;
  bPalletsPerContainer: number;
  bPalletWeightKg: number;
  remarks: string;
  boxesPerContainer: number; // computed: boxesPerPallet * palletsPerContainer (arrangement A)
  // Computed per-container totals (A + B), not stored
  totalBoxesPerContainer: number;
  totalPalletsPerContainer: number;
  totalSqmPerContainer: number;
  totalSqftPerContainer: number;
  totalBoxWeightPerContainer: number;
  createdTime: string; // Catalyst CREATEDTIME
  modifiedTime: string; // Catalyst MODIFIEDTIME
}

function sizeLabelOf(r: DSRow): string {
  return (
    sizeDisplayName({
      code: r.code,
      tileType: r.tile_type,
      pcsPerPacking: r.pcs_per_packing,
      thicknessMm: r.thickness_mm,
    }) ||
    str(r.name) ||
    str(r.ROWID)
  );
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchPallets);

/** Last fetched pallets, or null if never fetched this session. */
export function cachedPallets(): PalletRow[] | null {
  return cache.cached()?.pallets ?? null;
}
/** Drop the cache so the next listPallets() hits the network. */
export function invalidatePallets(): void {
  cache.invalidate();
}

/** All pallets (size label hydrated) + Size options. Cached + deduped. */
export function listPallets(): Promise<{
  ok: boolean;
  pallets: PalletRow[];
  sizes: SizeOption[];
  error?: string;
}> {
  return cache.load();
}

async function fetchPallets(): Promise<{
  ok: boolean;
  pallets: PalletRow[];
  sizes: SizeOption[];
  error?: string;
}> {
  // listAll pages past ZCQL's 300-row cap; Size projects its label + packing columns.
  const [pallets, sizes] = await Promise.all([
    listAll("Pallet", { order: "ROWID desc" }),
    list("Size", { limit: 300, columns: ["code", "tile_type", "pcs_per_packing", "thickness_mm", "sqm_per_box", "sqft_per_box", "box_weight_kg"] }),
  ]);
  if (!pallets.ok) return { ok: false, pallets: [], sizes: [], error: pallets.error };

  const sizeLabel = new Map<string, string>();
  (sizes.rows || []).forEach((r) => sizeLabel.set(String(r.ROWID), sizeLabelOf(r)));

  const sizeOptions: SizeOption[] = (sizes.rows || [])
    .map((r) => ({
      id: String(r.ROWID),
      label: sizeLabelOf(r),
      sqmPerBox: num(r.sqm_per_box),
      sqftPerBox: num(r.sqft_per_box),
      boxWeightKg: num(r.box_weight_kg),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows: PalletRow[] = (pallets.rows || []).map((p) => {
    const boxesPerPallet = num(p.boxes_per_pallet);
    const palletsPerContainer = num(p.pallets_per_container);
    const bBoxesPerPallet = num(p.b_boxes_per_pallet);
    const bPalletsPerContainer = num(p.b_pallets_per_container);
    const coverageSqm = num(p.coverage_sqm);
    const coverageSqft = num(p.coverage_sqft);
    const boxWeightKg = num(p.box_weight_kg);
    const sizeId = str(p.size);
    // Per-container totals sum both arrangements (A + B); coverage/weight are per box.
    const totalBoxesPerContainer =
      boxesPerPallet * palletsPerContainer + bBoxesPerPallet * bPalletsPerContainer;
    const totalPalletsPerContainer = palletsPerContainer + bPalletsPerContainer;
    return {
      id: String(p.ROWID),
      name: str(p.name),
      packingDetails: str(p.packing_details),
      sizeId,
      sizeLabel: sizeLabel.get(sizeId) || "",
      palletType: str(p.pallet_type),
      palletSizeLabel: str(p.pallet_size_label),
      coverageSqm,
      coverageSqft,
      boxWeightKg,
      boxesPerPallet,
      palletsPerContainer,
      emptyWeightKg: num(p.empty_pallet_weight_kg),
      bBoxesPerPallet,
      bPalletsPerContainer,
      bPalletWeightKg: num(p.b_pallet_weight),
      remarks: str(p.remarks),
      boxesPerContainer: boxesPerPallet * palletsPerContainer,
      totalBoxesPerContainer,
      totalPalletsPerContainer,
      totalSqmPerContainer: totalBoxesPerContainer * coverageSqm,
      totalSqftPerContainer: totalBoxesPerContainer * coverageSqft,
      totalBoxWeightPerContainer: totalBoxesPerContainer * boxWeightKg,
      createdTime: str(p.CREATEDTIME),
      modifiedTime: str(p.MODIFIEDTIME),
    };
  });

  return { ok: true, pallets: rows, sizes: sizeOptions };
}

/* ---- orders packed on a pallet (PalletisedBatch.pallet → Pallet) ---- */

export interface PalletOrder {
  salesOrderId: string; // SalesOrder ROWID
  orderNo: string; // order_number, falling back to po_number
  boxes: number; // sum of boxes_packed across that order's batches
}

const ordersCache = createListCache(fetchPalletOrders);

/** Last fetched pallet→orders map, or null if never fetched this session. */
export function cachedPalletOrders(): Record<string, PalletOrder[]> | null {
  return ordersCache.cached()?.byPallet ?? null;
}
/** Drop the cache so the next listPalletOrders() hits the network. */
export function invalidatePalletOrders(): void {
  ordersCache.invalidate();
}

/** Orders packed on each pallet, keyed by Pallet ROWID. Cached + deduped. */
export function listPalletOrders(): Promise<{
  ok: boolean;
  byPallet: Record<string, PalletOrder[]>;
  error?: string;
}> {
  return ordersCache.load();
}

async function fetchPalletOrders(): Promise<{
  ok: boolean;
  byPallet: Record<string, PalletOrder[]>;
  error?: string;
}> {
  const [batches, sos] = await Promise.all([
    listAll("PalletisedBatch", { columns: ["boxes_packed", "sales_order", "pallet"] }),
    listAll("SalesOrder", { columns: ["order_number", "po_number"] }),
  ]);
  if (!batches.ok) return { ok: false, byPallet: {}, error: batches.error };

  const orderNo = new Map<string, string>();
  (sos.rows || []).forEach((s) =>
    orderNo.set(String(s.ROWID), str(s.order_number) || str(s.po_number) || String(s.ROWID)),
  );

  // One pallet can hold many batches of the same order — collapse them into a
  // single row per order and sum the boxes, else the list repeats order numbers.
  const byPallet: Record<string, PalletOrder[]> = {};
  const seen = new Map<string, PalletOrder>();
  for (const b of batches.rows || []) {
    const palletId = str(b.pallet);
    const soId = str(b.sales_order);
    if (!palletId || !soId) continue;
    const key = `${palletId}|${soId}`;
    const hit = seen.get(key);
    if (hit) {
      hit.boxes += num(b.boxes_packed);
      continue;
    }
    const row: PalletOrder = {
      salesOrderId: soId,
      orderNo: orderNo.get(soId) || soId,
      boxes: num(b.boxes_packed),
    };
    seen.set(key, row);
    (byPallet[palletId] ||= []).push(row);
  }
  Object.values(byPallet).forEach((rows) => rows.sort((a, b) => a.orderNo.localeCompare(b.orderNo)));

  return { ok: true, byPallet };
}

export interface PalletInput {
  name: string;
  packing_details: string;
  size: string; // Size ROWID ("" = leave unset)
  pallet_type: string;
  pallet_size_label: string;
  // Snapshotted from the picked Size on save — never hand-entered. Kept on the
  // Pallet row so ZCQL reads need no join and historical pallets keep the
  // numbers they were costed with, even if the Size master is later corrected.
  coverage_sqm: number;
  coverage_sqft: number;
  box_weight_kg: number;
  boxes_per_pallet: number; // arrangement A
  pallets_per_container: number; // arrangement A
  empty_pallet_weight_kg: number; // arrangement A pallet weight
  b_boxes_per_pallet: number; // arrangement B
  b_pallets_per_container: number; // arrangement B
  b_pallet_weight: number; // arrangement B pallet weight
  remarks: string;
}

/** Drop empties so the FK column isn't sent blank (Catalyst FK rejects ""). */
function toPayload(input: PalletInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: input.name.trim(),
    packing_details: input.packing_details.trim(),
    pallet_type: input.pallet_type.trim(),
    pallet_size_label: input.pallet_size_label.trim(),
    coverage_sqm: input.coverage_sqm,
    coverage_sqft: input.coverage_sqft,
    box_weight_kg: input.box_weight_kg,
    boxes_per_pallet: input.boxes_per_pallet,
    pallets_per_container: input.pallets_per_container,
    empty_pallet_weight_kg: input.empty_pallet_weight_kg,
    b_boxes_per_pallet: input.b_boxes_per_pallet,
    b_pallets_per_container: input.b_pallets_per_container,
    b_pallet_weight: input.b_pallet_weight,
    remarks: input.remarks.trim(),
  };
  if (input.size) p.size = input.size; // FK only when chosen
  return p;
}

/* Mutations invalidate the cache so the next listPallets() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createPallet(input: PalletInput) {
  return bust(insert("Pallet", toPayload(input)));
}

export function updatePallet(rowid: string, input: PalletInput) {
  // On edit, always send size (allow clearing → null) so the FK can be unset.
  const patch = toPayload(input);
  if (!input.size) patch.size = null;
  return bust(update("Pallet", rowid, patch));
}

export function deletePallet(rowid: string) {
  return bust(remove("Pallet", rowid));
}

/* ---- Bulk ops (client-side fan-out; each row logged in OperationLog) ---- */

export interface BulkResult {
  ok: boolean;
  done: number;
  failed: number;
  firstError?: string;
}

async function fanOut(rowids: string[], fn: (id: string) => Promise<OpResult>): Promise<BulkResult> {
  const results = await Promise.all(rowids.map(fn));
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    done: results.length - failed.length,
    failed: failed.length,
    firstError: failed[0]?.error,
  };
}

export function bulkDeletePallets(rowids: string[]): Promise<BulkResult> {
  return bust(fanOut(rowids, (id) => remove("Pallet", id)));
}
