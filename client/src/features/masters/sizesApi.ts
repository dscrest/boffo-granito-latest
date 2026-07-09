/* ============================================================
   Size master — typed Data Store wrapper over lib/dataOps.

   Size is the single source of truth for per-box packing data.
   Pallet (coverage/box weight) and Design (dims/pcs/box weight)
   snapshot their values from the Size picked on the form.

   Catalyst has no formula columns, so `code`, `sqm_per_box` and
   `sqft_per_box` are computed here and *stored*, letting ZCQL read
   them without a join. Every write is recorded in OperationLog.
   ============================================================ */
import { listAll, insert, update, remove, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const SQFT_PER_SQM = 10.7639;

export interface SizeRow {
  id: string; // ROWID
  code: string; // "600x600" — derived from width × length
  widthMm: number;
  lengthMm: number;
  seqCode: string;
  tileType: string;
  thicknessMm: number;
  pcsPerPacking: number;
  boxWeightKg: number;
  sqmPerBox: number;
  sqftPerBox: number;
  remark: string;
  createdTime: string;
  modifiedTime: string;
}

/** `code` mirrors the dimensions — "600x600". Blank until both are set. */
export function sizeCodeOf(widthMm: number, lengthMm: number): string {
  return widthMm && lengthMm ? `${widthMm}x${lengthMm}` : "";
}

/** Coverage of one packed box, in m². Zero unless all three inputs are set. */
export function sqmPerBoxOf(widthMm: number, lengthMm: number, pcsPerPacking: number): number {
  return (widthMm / 1000) * (lengthMm / 1000) * pcsPerPacking || 0;
}

/** Coverage of one packed box, in ft². */
export function sqftPerBoxOf(sqmPerBox: number): number {
  return sqmPerBox * SQFT_PER_SQM;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchSizes);

/** Last fetched sizes, or null if never fetched this session. */
export function cachedSizes(): SizeRow[] | null {
  return cache.cached()?.sizes ?? null;
}
/** Drop the cache so the next listSizes() hits the network. */
export function invalidateSizes(): void {
  cache.invalidate();
}

/** All sizes. Cached + deduped. */
export function listSizes(): Promise<{ ok: boolean; sizes: SizeRow[]; error?: string }> {
  return cache.load();
}

async function fetchSizes(): Promise<{ ok: boolean; sizes: SizeRow[]; error?: string }> {
  // listAll pages past ZCQL's 300-row cap.
  const res = await listAll("Size", { order: "ROWID desc" });
  if (!res.ok) return { ok: false, sizes: [], error: res.error };

  const sizes: SizeRow[] = (res.rows || []).map((r: DSRow) => ({
    id: String(r.ROWID),
    code: str(r.code),
    widthMm: num(r.width_mm),
    lengthMm: num(r.length_mm),
    seqCode: str(r.seq_code),
    tileType: str(r.tile_type),
    thicknessMm: num(r.thickness_mm),
    pcsPerPacking: num(r.pcs_per_packing),
    boxWeightKg: num(r.box_weight_kg),
    sqmPerBox: num(r.sqm_per_box),
    sqftPerBox: num(r.sqft_per_box),
    remark: str(r.remark),
    createdTime: str(r.CREATEDTIME),
    modifiedTime: str(r.MODIFIEDTIME),
  }));

  return { ok: true, sizes };
}

/** Operator-entered fields only — code/sqm/sqft are derived in toPayload(). */
export interface SizeInput {
  width_mm: number;
  length_mm: number;
  seq_code: string;
  tile_type: string;
  thickness_mm: number;
  pcs_per_packing: number;
  box_weight_kg: number;
  remark: string;
}

/** Add the three formula-owned columns. Kept out of SizeInput so no caller
    can persist a stale code/coverage by hand. */
function toPayload(input: SizeInput): Record<string, unknown> {
  const sqm = sqmPerBoxOf(input.width_mm, input.length_mm, input.pcs_per_packing);
  return {
    code: sizeCodeOf(input.width_mm, input.length_mm),
    width_mm: input.width_mm,
    length_mm: input.length_mm,
    seq_code: input.seq_code.trim(),
    tile_type: input.tile_type.trim(),
    thickness_mm: input.thickness_mm,
    pcs_per_packing: input.pcs_per_packing,
    box_weight_kg: input.box_weight_kg,
    sqm_per_box: sqm,
    sqft_per_box: sqftPerBoxOf(sqm),
    remark: input.remark.trim(),
  };
}

/* Mutations invalidate the cache so the next listSizes() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createSize(input: SizeInput) {
  return bust(insert("Size", toPayload(input)));
}

export function updateSize(rowid: string, input: SizeInput) {
  return bust(update("Size", rowid, toPayload(input)));
}

export function deleteSize(rowid: string) {
  return bust(remove("Size", rowid));
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

export function bulkDeleteSizes(rowids: string[]): Promise<BulkResult> {
  return bust(fanOut(rowids, (id) => remove("Size", id)));
}
