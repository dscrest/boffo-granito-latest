/* ============================================================
   Pallet master — typed Data Store wrapper over lib/dataOps.

   The Pallet table (Catalyst) holds the pallet specs that Phase 4
   (palletisation + container fit) depends on. `size` is a real
   ForeignKey → Size (stores the Size ROWID). Every write is recorded
   server-side in OperationLog.
   ============================================================ */
import { list, listAll, insert, update, remove, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface SizeOption {
  id: string; // Size ROWID
  label: string; // human label (code, falling back to name)
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
}

function sizeLabelOf(r: DSRow): string {
  return str(r.code) || str(r.name) || str(r.ROWID);
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
  // listAll pages past ZCQL's 300-row cap; Size projects its label columns.
  const [pallets, sizes] = await Promise.all([
    listAll("Pallet", { order: "ROWID desc" }),
    list("Size", { limit: 300, columns: ["code", "name"] }),
  ]);
  if (!pallets.ok) return { ok: false, pallets: [], sizes: [], error: pallets.error };

  const sizeLabel = new Map<string, string>();
  (sizes.rows || []).forEach((r) => sizeLabel.set(String(r.ROWID), sizeLabelOf(r)));

  const sizeOptions: SizeOption[] = (sizes.rows || [])
    .map((r) => ({ id: String(r.ROWID), label: sizeLabelOf(r) }))
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
    };
  });

  return { ok: true, pallets: rows, sizes: sizeOptions };
}

export interface PalletInput {
  name: string;
  packing_details: string;
  size: string; // Size ROWID ("" = leave unset)
  pallet_type: string;
  pallet_size_label: string;
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
