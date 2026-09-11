/* ============================================================
   App settings — tiny key/value store over the AppSetting table.
   One row per setting_key; a missing row means the default applies.

   Keys:
   - allow_duplicate_batches (default ON) — governs CROSS-item batch-number
     reuse only; same item + same batch is always blocked server-side
     regardless of this flag.
   - default_view (default "sheet") — which view the board pages open on.
   - batch_series_prefix / batch_series_separator / batch_series_start
     (defaults B, "/", 1) — the auto-minted batch format
     <prefix><sep>YYYY-MM<sep>NNN; read server-side by nextBatchNumber.
   ============================================================ */
import { listAll, insert, update, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

export const ALLOW_DUP_BATCHES = "allow_duplicate_batches";
export const DEFAULT_VIEW = "default_view";
// Batch series (Settings → Series): the server mints <prefix><sep>YYYY-MM<sep>NNN.
export const BATCH_PREFIX = "batch_series_prefix";
export const BATCH_SEPARATOR = "batch_series_separator";
export const BATCH_START = "batch_series_start";

export type DefaultView = "sheet" | "kanban";
/** Mirror of default_view, so a board can seed its view synchronously at mount. */
const VIEW_MIRROR = "pref.defaultView";

const cache = createListCache(fetchSettings);

async function fetchSettings(): Promise<{ ok: boolean; rows: DSRow[]; error?: string }> {
  const res = await listAll("AppSetting");
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  const rows = (res.rows || []).filter((r) => !r.deleted_at);
  mirrorView(readView(rows));
  return { ok: true, rows };
}

function rowFor(rows: DSRow[], key: string): DSRow | undefined {
  return rows.find((r) => String(r.setting_key) === key);
}

/** Upsert one key by setting_key, then refresh the cache. */
async function putSetting(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const rows = (await cache.load()).rows;
  const existing = rowFor(rows, key);
  const res = existing
    ? await update("AppSetting", String(existing.ROWID), { setting_value: value })
    : await insert("AppSetting", { setting_key: key, setting_value: value });
  cache.invalidate();
  return { ok: res.ok, error: res.error };
}

/* ---------- allow_duplicate_batches (default true) ---------- */

function readDup(rows: DSRow[] | undefined): boolean {
  const row = rows ? rowFor(rows, ALLOW_DUP_BATCHES) : undefined;
  return !row || String(row.setting_value) !== "false";
}

/** Last fetched value (default true), without hitting the network. */
export function cachedAllowDupBatches(): boolean {
  return readDup(cache.cached()?.rows);
}

/** Load (cached + deduped) and resolve the flag; default true when unset. */
export async function loadAllowDupBatches(): Promise<boolean> {
  const res = await cache.load();
  return readDup(res.ok ? res.rows : undefined);
}

/** Upsert the flag by setting_key, then refresh the cache. */
export function setAllowDupBatches(v: boolean): Promise<{ ok: boolean; error?: string }> {
  return putSetting(ALLOW_DUP_BATCHES, String(v));
}

/* ---------- default_view (default "sheet") ---------- */

function readView(rows: DSRow[] | undefined): DefaultView {
  const row = rows ? rowFor(rows, DEFAULT_VIEW) : undefined;
  return row && String(row.setting_value) === "kanban" ? "kanban" : "sheet";
}

function mirrorView(v: DefaultView) {
  try {
    localStorage.setItem(VIEW_MIRROR, v);
  } catch {
    /* storage blocked — the mirror is best-effort */
  }
}

/** Resolved default view, synchronously. Falls back to the last mirrored value
    so a cold tab seeds boards correctly before the settings fetch lands. */
export function cachedDefaultView(): DefaultView {
  const snap = cache.cached()?.rows;
  if (snap) return readView(snap);
  try {
    return localStorage.getItem(VIEW_MIRROR) === "kanban" ? "kanban" : "sheet";
  } catch {
    return "sheet";
  }
}

/** Load (cached + deduped) and resolve the default view; "sheet" when unset. */
export async function loadDefaultView(): Promise<DefaultView> {
  const res = await cache.load();
  return readView(res.ok ? res.rows : undefined);
}

/** Upsert the default view, refresh the cache and the synchronous mirror. */
export async function setDefaultView(v: DefaultView): Promise<{ ok: boolean; error?: string }> {
  const res = await putSetting(DEFAULT_VIEW, v);
  if (res.ok) mirrorView(v);
  return res;
}

/* ---------- batch series (defaults B / "/" / 1) ---------- */

export interface BatchSeries {
  prefix: string;
  separator: string;
  start: number;
}
// Same cleaning as the server: quotes and LIKE wildcards stripped, capped at 10.
const cleanSeriesPart = (s: string) => s.replace(/['%_]/g, "").slice(0, 10);

export function readBatchSeries(rows?: DSRow[]): BatchSeries {
  const val = (key: string) => {
    const row = rows ? rowFor(rows, key) : undefined;
    return row ? String(row.setting_value) : "";
  };
  return {
    prefix: cleanSeriesPart(val(BATCH_PREFIX)) || "B",
    separator: cleanSeriesPart(val(BATCH_SEPARATOR)) || "/",
    start: Math.max(1, parseInt(val(BATCH_START), 10) || 1),
  };
}

/** Load (cached + deduped) and resolve the batch series; defaults when unset. */
export async function loadBatchSeries(): Promise<BatchSeries> {
  const res = await cache.load();
  return readBatchSeries(res.ok ? res.rows : undefined);
}

/** Upsert the three series keys (only the changed ones hit the network). */
export async function setBatchSeries(v: BatchSeries): Promise<{ ok: boolean; error?: string }> {
  const cur = await loadBatchSeries();
  const writes: Array<[string, string]> = [];
  if (cleanSeriesPart(v.prefix) !== cur.prefix) writes.push([BATCH_PREFIX, cleanSeriesPart(v.prefix) || "B"]);
  if (cleanSeriesPart(v.separator) !== cur.separator) writes.push([BATCH_SEPARATOR, cleanSeriesPart(v.separator) || "/"]);
  if (Math.max(1, v.start || 1) !== cur.start) writes.push([BATCH_START, String(Math.max(1, v.start || 1))]);
  for (const [k, val] of writes) {
    const res = await putSetting(k, val);
    if (!res.ok) return res;
  }
  return { ok: true };
}
