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
  /** listAll only: true when the table exceeded the page cap — `rows` is
      incomplete. Aggregating callers must treat this as a failure, never as a
      small table. */
  truncated?: boolean;
}

export interface ListOpts {
  where?: string;
  order?: string; // e.g. "ROWID desc"
  limit?: number;
  offset?: number; // ZCQL pages via "LIMIT offset, count"
  columns?: string[]; // projection; ROWID always included server-side
  all?: boolean; // CR-478: whole table in one response (server pages ZCQL in parallel)
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
    if (opts.all) qs.set("all", "1");
    const q = qs.toString();
    const res = await apiGet<{ ok: boolean; rows: DSRow[]; truncated?: boolean }>(`${FN}/${table}${q ? `?${q}` : ""}`);
    return res.truncated ? { ok: true, rows: res.rows, truncated: true } : { ok: true, rows: res.rows };
  } catch (e) {
    return fail(e);
  }
}

/** Fetch ALL rows of a table in ONE request (CR-478). The server pages past
    ZCQL's 300-row cap itself, in parallel, and dedupes by ROWID — the client
    used to walk the pages serially at ~1 s per round trip, which made every
    list page wait ~10 s for the 2,800-row Customer table alone. `truncated`
    is set when the table exceeds the server's ~10k-row safety valve. */
export function listAll(
  table: string,
  opts: Omit<ListOpts, "limit" | "offset" | "all"> = {},
): Promise<OpResult> {
  return list(table, { ...opts, all: true });
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

/** `reason` (CR-270) is what the user typed in the delete confirm — required
    server-side for every role but Admin, logged on the OperationLog row. */
export async function remove(table: string, rowid: string, reason?: string): Promise<OpResult> {
  try {
    const res = await apiDelete<{ ok: boolean; rowid: string }>(`${FN}/${table}/${rowid}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`);
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
