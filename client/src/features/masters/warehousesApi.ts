/* ============================================================
   Warehouses (CR-329) — the stock locations master. One cached list every
   stock sheet, the Locations panels and the report read; `primaryWarehouse`
   is the default every recording form preselects. No warehouses = the
   feature is dormant (pickers hide, panels say so). Marking a primary goes
   through /warehouse-primary (it pins history first) — never a generic PATCH.
   ============================================================ */
import { listAll, insert, update, remove, op, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { ComboOption } from "@/ui/Combobox";
import { invalidateBatchStock } from "@/features/stages/batchStockApi";
import { invalidateCutStock } from "@/features/panels/panelOrdersApi";
import { parsePurposes, primaryWarehouseId, type WarehouseIn } from "@/lib/warehouseStock";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface WarehouseRow extends WarehouseIn {
  name: string;
  note: string;
  createdTime: string;
  modifiedTime: string;
}

type Result = { ok: boolean; rows: WarehouseRow[]; error?: string };

async function fetchWarehouses(): Promise<Result> {
  const res = await listAll("Warehouse", { order: "ROWID asc" });
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const rows: WarehouseRow[] = (res.rows || []).map((r) => ({
    id: String(r.ROWID),
    name: str(r.name),
    isPrimary: r.is_primary === true || str(r.is_primary) === "true",
    purposes: parsePurposes(str(r.purposes)),
    note: str(r.note),
    createdTime: str(r.CREATEDTIME),
    modifiedTime: str(r.MODIFIEDTIME),
  }));
  return { ok: true, rows };
}

const cache = createListCache(fetchWarehouses, 60_000);

export function listWarehouses(): Promise<Result> {
  return cache.load();
}
export function cachedWarehouses(): WarehouseRow[] | null {
  return cache.cached()?.rows ?? null;
}
export function invalidateWarehouses(): void {
  cache.invalidate();
}
/** The primary (first row when none is flagged), or null when there are no warehouses. */
export function primaryWarehouse(rows: WarehouseRow[]): WarehouseRow | null {
  const id = primaryWarehouseId(rows);
  return rows.find((w) => w.id === id) ?? null;
}
export function warehouseOptions(rows: WarehouseRow[]): ComboOption[] {
  return rows.map((w) => ({ value: w.id, label: w.name, hint: w.isPrimary ? "Primary" : w.purposes.join(" · ") || undefined }));
}
export function warehouseName(rows: WarehouseRow[], id: string): string {
  return rows.find((w) => w.id === id)?.name ?? (id ? "—" : "");
}

/** Any warehouse change moves where stock is attributed — bust both stock caches. */
function bust<T extends OpResult>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    invalidateBatchStock();
    invalidateCutStock();
    return r;
  });
}
export function createWarehouse(input: { name: string; purposes: string[]; note?: string }): Promise<OpResult> {
  return bust(insert("Warehouse", { name: input.name.trim(), purposes: input.purposes.join(","), note: (input.note || "").trim() }));
}
export function updateWarehouse(id: string, input: { name: string; purposes: string[]; note?: string }): Promise<OpResult> {
  return bust(update("Warehouse", id, { name: input.name.trim(), purposes: input.purposes.join(","), note: (input.note || "").trim() }));
}
export function deleteWarehouse(id: string, reason?: string): Promise<OpResult> {
  return bust(remove("Warehouse", id, reason));
}
/** Make `id` THE primary — the server stamps every null-warehouse stock row onto the old primary first. */
export function markPrimary(id: string): Promise<OpResult<{ stamped: number }>> {
  return bust(op<{ stamped: number }>(`warehouse-primary/${encodeURIComponent(id)}`, {}));
}
