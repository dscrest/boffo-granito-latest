/* ============================================================
   MDF master (CR-309) — the boards showcase panels are mounted on:
   Size · Thickness · Weight (kg) · Rate/kg (CR-504). Edited in Masters ▸ Panel Master; read
   here for the panel-order line pick list and the auto weight.
   ============================================================ */
import { listAll } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface MdfRow {
  id: string;
  size: string;
  thickness: string;
  weightKg: number | null;
  ratePerKg: number; // CR-504: ₹/kg (0 = not priced)
  label: string; // "1200x2100 · 12mm"
}

const cache = createListCache(fetchMdfs);

export function cachedMdfs(): MdfRow[] {
  return cache.cached()?.rows ?? [];
}
export function invalidateMdfs(): void {
  cache.invalidate();
}
export function listMdfs(): Promise<{ ok: boolean; rows: MdfRow[]; error?: string }> {
  return cache.load();
}

async function fetchMdfs(): Promise<{ ok: boolean; rows: MdfRow[]; error?: string }> {
  const res = await listAll("Mdf", { order: "size" });
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const rows = (res.rows || []).map((r) => {
    const size = str(r.size);
    const thickness = str(r.thickness);
    const w = r.weight_kg == null || r.weight_kg === "" ? null : Number(r.weight_kg);
    return { id: String(r.ROWID), size, thickness, weightKg: w != null && isFinite(w) ? w : null, ratePerKg: Number(r.rate_per_kg) || 0, label: [size, thickness].filter(Boolean).join(" · ") || "MDF" };
  });
  return { ok: true, rows };
}
