/* ============================================================
   Modular Data Store operation layer.

   Thin, generic insert / update / delete / list / getOne over the
   `data-ops` Catalyst function. Every mutating call's outcome is
   recorded server-side in the OperationLog table (see /ops page).

   Friendly return shape: { ok, rowid?, rows?, row?, data?, error }.
   Callers never throw — they branch on `ok`. Typed per-entity wrappers
   (features/<x>/<x>Api.ts) build on top of these.
   ============================================================ */
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";

const FN = "data-ops";

/** A Data Store row — system columns + arbitrary user columns. */
export interface DSRow {
  ROWID: string;
  CREATEDTIME?: string;
  MODIFIEDTIME?: string;
  [col: string]: unknown;
}

export interface OpResult<T = unknown> {
  ok: boolean;
  rowid?: string;
  rows?: DSRow[];
  row?: DSRow;
  data?: T;
  error?: string;
}

export interface ListOpts {
  where?: string;
  order?: string; // e.g. "ROWID desc"
  limit?: number;
  offset?: number; // ZCQL pages via "LIMIT offset, count"
  columns?: string[]; // projection; ROWID always included server-side
}

function fail(e: unknown): OpResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export async function list(table: string, opts: ListOpts = {}): Promise<OpResult> {
  try {
    const qs = new URLSearchParams();
    if (opts.where) qs.set("where", opts.where);
    if (opts.order) qs.set("order", opts.order);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.offset) qs.set("offset", String(opts.offset));
    if (opts.columns?.length) qs.set("columns", opts.columns.join(","));
    const q = qs.toString();
    const res = await apiGet<{ ok: boolean; rows: DSRow[] }>(`${FN}/${table}${q ? `?${q}` : ""}`);
    return { ok: true, rows: res.rows };
  } catch (e) {
    return fail(e);
  }
}

/** Fetch ALL rows of a table by paging through ZCQL's 300-row cap.
    One request for tables under 300 rows (same cost as before); larger
    tables transparently page until a short page arrives. Guards against
    servers that ignore `offset` (would echo page 1 forever). */
export async function listAll(
  table: string,
  opts: Omit<ListOpts, "limit" | "offset"> = {},
): Promise<OpResult> {
  const PAGE = 300;
  const MAX_PAGES = 34; // ~10k rows safety valve
  const all: DSRow[] = [];
  let prevFirstId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await list(table, { ...opts, limit: PAGE, offset: page * PAGE });
    if (!res.ok) return res;
    const rows = res.rows || [];
    const firstId = rows.length ? String(rows[0].ROWID) : null;
    if (page > 0 && firstId !== null && firstId === prevFirstId) break; // offset unsupported
    prevFirstId = firstId;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { ok: true, rows: all };
}

export async function getOne(table: string, rowid: string): Promise<OpResult> {
  try {
    const res = await apiGet<{ ok: boolean; row: DSRow }>(`${FN}/${table}/${rowid}`);
    return { ok: true, row: res.row };
  } catch (e) {
    return fail(e);
  }
}

export async function insert(table: string, payload: Record<string, unknown>): Promise<OpResult> {
  try {
    const res = await apiPost<{ ok: boolean; rowid: string; data: unknown }>(`${FN}/${table}`, payload);
    return { ok: true, rowid: res.rowid, data: res.data };
  } catch (e) {
    return fail(e);
  }
}

export async function update(
  table: string,
  rowid: string,
  patch: Record<string, unknown>,
): Promise<OpResult> {
  try {
    const res = await apiPatch<{ ok: boolean; rowid: string; data: unknown }>(`${FN}/${table}/${rowid}`, patch);
    return { ok: true, rowid: res.rowid, data: res.data };
  } catch (e) {
    return fail(e);
  }
}

export async function remove(table: string, rowid: string): Promise<OpResult> {
  try {
    const res = await apiDelete<{ ok: boolean; rowid: string }>(`${FN}/${table}/${rowid}`);
    return { ok: true, rowid: res.rowid };
  } catch (e) {
    return fail(e);
  }
}

/** POST a business operation (multi-row / rules) on the data-ops function. */
export async function op<T = unknown>(path: string, body: unknown): Promise<OpResult<T>> {
  try {
    const res = await apiPost<{ ok: boolean; rowid?: string; data?: T }>(`${FN}/${path}`, body);
    return { ok: true, rowid: res.rowid, data: res.data };
  } catch (e) {
    return fail(e) as OpResult<T>;
  }
}
