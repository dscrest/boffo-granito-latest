/* ============================================================
   Pallet master — typed Data Store wrapper over lib/dataOps.

   The Pallet table (Catalyst) holds the pallet specs that Phase 4
   (palletisation + container fit) depends on. `size` is a real
   ForeignKey → Size (stores the Size ROWID). Every write is recorded
   server-side in OperationLog.
   ============================================================ */
import { list, insert, update, remove, type DSRow } from "@/lib/dataOps";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface SizeOption {
  id: string; // Size ROWID
  label: string; // human label (code, falling back to name)
}

export interface PalletRow {
  id: string; // ROWID
  name: string;
  sizeId: string; // Size ROWID ("" if unset)
  sizeLabel: string;
  palletType: string;
  palletSizeLabel: string;
  boxesPerPallet: number;
  palletsPerContainer: number;
  emptyWeightKg: number;
  remarks: string;
  boxesPerContainer: number; // computed: boxesPerPallet * palletsPerContainer
}

function sizeLabelOf(r: DSRow): string {
  return str(r.code) || str(r.name) || str(r.ROWID);
}

/** Fetch all pallets (hydrated with size label) + the Size options for the picker. */
export async function listPallets(): Promise<{
  ok: boolean;
  pallets: PalletRow[];
  sizes: SizeOption[];
  error?: string;
}> {
  // ZCQL caps LIMIT at 300 rows/query. (Pagination TODO when any table grows past 300.)
  const [pallets, sizes] = await Promise.all([
    list("Pallet", { order: "ROWID desc", limit: 300 }),
    list("Size", { limit: 300 }),
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
    const sizeId = str(p.size);
    return {
      id: String(p.ROWID),
      name: str(p.name),
      sizeId,
      sizeLabel: sizeLabel.get(sizeId) || "",
      palletType: str(p.pallet_type),
      palletSizeLabel: str(p.pallet_size_label),
      boxesPerPallet,
      palletsPerContainer,
      emptyWeightKg: num(p.empty_pallet_weight_kg),
      remarks: str(p.remarks),
      boxesPerContainer: boxesPerPallet * palletsPerContainer,
    };
  });

  return { ok: true, pallets: rows, sizes: sizeOptions };
}

export interface PalletInput {
  name: string;
  size: string; // Size ROWID ("" = leave unset)
  pallet_type: string;
  pallet_size_label: string;
  boxes_per_pallet: number;
  pallets_per_container: number;
  empty_pallet_weight_kg: number;
  remarks: string;
}

/** Drop empties so the FK column isn't sent blank (Catalyst FK rejects ""). */
function toPayload(input: PalletInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: input.name.trim(),
    pallet_type: input.pallet_type.trim(),
    pallet_size_label: input.pallet_size_label.trim(),
    boxes_per_pallet: input.boxes_per_pallet,
    pallets_per_container: input.pallets_per_container,
    empty_pallet_weight_kg: input.empty_pallet_weight_kg,
    remarks: input.remarks.trim(),
  };
  if (input.size) p.size = input.size; // FK only when chosen
  return p;
}

export function createPallet(input: PalletInput) {
  return insert("Pallet", toPayload(input));
}

export function updatePallet(rowid: string, input: PalletInput) {
  // On edit, always send size (allow clearing → null) so the FK can be unset.
  const patch = toPayload(input);
  if (!input.size) patch.size = null;
  return update("Pallet", rowid, patch);
}

export function deletePallet(rowid: string) {
  return remove("Pallet", rowid);
}
