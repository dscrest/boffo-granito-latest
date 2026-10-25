/* ============================================================
   Warehouses (CR-329) — the stock locations master. One cached list every
   stock sheet, the Locations panels and the report read; `defaultNode`
   is where every recording form preselects. No warehouses = the
   feature is dormant (pickers hide, panels say so). Marking a primary goes
   through /warehouse-primary (it pins history first) — never a generic PATCH.

   CR-409: a Warehouse holds LOCATIONS — rows of the same table with `parent`
   set (one level; codes like A1 … F12, 60–70 per warehouse). Stock rows keep
   their single `warehouse` id, which now points at the LEAF: a location, or
   the warehouse itself when it has none. Pickers offer leaves only; a warehouse
   that has locations still owns its pre-location history as "▸ Unassigned".
   ============================================================ */
import { listAll, insert, update, remove, op, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { ComboOption } from "@/ui/Combobox";
import { invalidateBatchStock } from "@/features/stages/batchStockApi";
import { invalidateCutStock } from "@/features/panels/panelOrdersApi";
import { codeCollator, primaryWarehouseId, toWarehouseIn, type WarehouseIn } from "@/lib/warehouseStock";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface WarehouseRow extends WarehouseIn {
  name: string;
  note: string;
  /** CR-409: the warehouse this location sits in; "" on a top-level warehouse. */
  parentId: string;
  createdTime: string;
  modifiedTime: string;
}

type Result = { ok: boolean; rows: WarehouseRow[]; error?: string };

async function fetchWarehouses(): Promise<Result> {
  const res = await listAll("Warehouse", { order: "ROWID asc" });
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const raw = res.rows || [];
  const ins = toWarehouseIn(raw as { ROWID: unknown; is_primary?: unknown; purposes?: unknown; parent?: unknown }[]);
  const rows: WarehouseRow[] = raw.map((r, i) => ({
    ...ins[i],
    name: str(r.name),
    note: str(r.note),
    parentId: str(r.parent),
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

/* ── Tree helpers (pure) ─────────────────────────────────────────────── */
export const isLocation = (w: WarehouseRow): boolean => !!w.parentId;
/** Top-level warehouses, creation order. */
export function topLevel(rows: WarehouseRow[]): WarehouseRow[] {
  return rows.filter((w) => !w.parentId);
}
/** A warehouse's locations in grid order (A1, A2, …, A10, B1). */
export function childrenOf(rows: WarehouseRow[], warehouseId: string): WarehouseRow[] {
  return rows.filter((w) => w.parentId === warehouseId).sort((a, b) => codeCollator.compare(a.name, b.name));
}
/** Every stock-holding node in display order: each warehouse, then its locations. */
export function stockNodes(rows: WarehouseRow[]): WarehouseRow[] {
  return topLevel(rows).flatMap((w) => [w, ...childrenOf(rows, w.id)]);
}
/** The primary warehouse (first top-level row when none is flagged), or null when there are none. */
export function primaryWarehouse(rows: WarehouseRow[]): WarehouseRow | null {
  const top = topLevel(rows);
  const id = primaryWarehouseId(top);
  return top.find((w) => w.id === id) ?? null;
}
/** Where new stock lands when nothing is picked: the primary's first location, else the primary itself. */
export function defaultNode(rows: WarehouseRow[]): WarehouseRow | null {
  const p = primaryWarehouse(rows);
  if (!p) return null;
  return childrenOf(rows, p.id)[0] ?? p;
}
/** CR-411: where stock lands for a PURPOSE ("Production" · "Palletization" · "Loading Bay"): the first
    leaf of the first warehouse carrying it, else `defaultNode`. Purposes are labels the master already
    keeps — this is the one place they steer a default. */
export function defaultNodeFor(rows: WarehouseRow[], purpose: string): WarehouseRow | null {
  const w = topLevel(rows).find((x) => x.purposes.includes(purpose));
  if (!w) return defaultNode(rows);
  return childrenOf(rows, w.id)[0] ?? w;
}
/** "Main Godown ▸ A1" · "Main Godown" (no locations) · "Main Godown ▸ Unassigned" (a warehouse that has locations). */
export function nodeLabel(rows: WarehouseRow[], id: string): string {
  const w = rows.find((x) => x.id === id);
  if (!w) return id ? "—" : "";
  if (w.parentId) return `${rows.find((x) => x.id === w.parentId)?.name ?? "—"} ▸ ${w.name}`;
  return rows.some((x) => x.parentId === w.id) ? `${w.name} ▸ Unassigned` : w.name;
}
/** Picker options = the leaves: a warehouse's locations, or the warehouse itself when it has none. */
export function leafOptions(rows: WarehouseRow[]): ComboOption[] {
  return topLevel(rows).flatMap((w) => {
    const kids = childrenOf(rows, w.id);
    return kids.length
      ? kids.map((l) => ({ value: l.id, label: `${w.name} ▸ ${l.name}` }))
      : [{ value: w.id, label: w.name, hint: w.isPrimary ? "Primary" : w.purposes.join(" · ") || undefined }];
  });
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
/** CR-409: one location (code uppercased) inside `warehouseId`. Purposes are inherited — none stored. */
export function createLocation(warehouseId: string, name: string, note = ""): Promise<OpResult> {
  return bust(insert("Warehouse", { name: name.trim().toUpperCase(), parent: warehouseId, note: note.trim() }));
}
/** CR-409: the whole grid in ONE insert call (the generic route takes `rows`) — 72 codes, one round trip. */
export function createLocations(warehouseId: string, codes: string[]): Promise<OpResult> {
  return bust(insert("Warehouse", { rows: codes.map((c) => ({ name: c.trim().toUpperCase(), parent: warehouseId, note: "" })) }));
}
export function updateLocation(id: string, input: { name: string; note?: string }): Promise<OpResult> {
  return bust(update("Warehouse", id, { name: input.name.trim().toUpperCase(), note: (input.note || "").trim() }));
}
export function deleteWarehouse(id: string, reason?: string): Promise<OpResult> {
  return bust(remove("Warehouse", id, reason));
}
/** Make `id` THE primary — the server stamps every null-warehouse stock row onto the old primary first. */
export function markPrimary(id: string): Promise<OpResult<{ stamped: number }>> {
  return bust(op<{ stamped: number }>(`warehouse-primary/${encodeURIComponent(id)}`, {}));
}
