/* ============================================================
   Masters lookup CRUD — generic wrapper over lib/dataOps for the
   config-driven Masters page (Size, Finish, Category, Glaze, Brand,
   Grade, PaymentTerm). Each table's columns are named by the form's
   field keys, so values pass straight through. Every write is
   recorded server-side in OperationLog.
   ============================================================ */
import { list, insert, update, remove, type OpResult } from "@/lib/dataOps";

export interface MasterRow {
  _id: string; // ROWID
  [col: string]: string;
}

/** Field keys that are numeric columns — coerced to Number on save. */
const NUMERIC = new Set(["width_mm", "length_mm"]);

const str = (v: unknown) => (v == null ? "" : String(v));

/** List a lookup table's rows, projected to string-valued fields + _id (ROWID). */
export async function listMaster(
  table: string,
  fieldKeys: string[],
): Promise<{ ok: boolean; rows: MasterRow[]; error?: string }> {
  const res = await list(table, { limit: 300, order: "ROWID desc" });
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const rows: MasterRow[] = (res.rows || []).map((r) => {
    const row: MasterRow = { _id: String(r.ROWID) };
    for (const k of fieldKeys) row[k] = str(r[k]);
    return row;
  });
  return { ok: true, rows };
}

/** Coerce form values to a Catalyst payload: trim strings, numbers for NUMERIC,
    drop blanks so optional columns aren't sent empty. */
function toPayload(vals: Record<string, string>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(vals)) {
    const v = (raw ?? "").trim();
    if (v === "") continue;
    p[k] = NUMERIC.has(k) ? Number(v) || 0 : v;
  }
  return p;
}

export function createMaster(table: string, vals: Record<string, string>): Promise<OpResult> {
  return insert(table, toPayload(vals));
}

export function updateMaster(
  table: string,
  rowid: string,
  vals: Record<string, string>,
): Promise<OpResult> {
  return update(table, rowid, toPayload(vals));
}

export function deleteMaster(table: string, rowid: string): Promise<OpResult> {
  return remove(table, rowid);
}
