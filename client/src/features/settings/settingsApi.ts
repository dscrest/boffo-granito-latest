/* ============================================================
   App settings — tiny key/value store over the AppSetting table.
   One row per setting_key; a missing row means the default applies.
   Currently the only setting: allow_duplicate_batches (default ON) —
   governs CROSS-item batch-number reuse only; same item + same batch
   is always blocked server-side regardless of this flag.
   ============================================================ */
import { listAll, insert, update, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

export const ALLOW_DUP_BATCHES = "allow_duplicate_batches";

const cache = createListCache(fetchSettings);

async function fetchSettings(): Promise<{ ok: boolean; rows: DSRow[]; error?: string }> {
  const res = await listAll("AppSetting");
  if (!res.ok) return { ok: false, rows: [], error: res.error };
  return { ok: true, rows: (res.rows || []).filter((r) => !r.deleted_at) };
}

function rowFor(rows: DSRow[], key: string): DSRow | undefined {
  return rows.find((r) => String(r.setting_key) === key);
}

/** Last fetched value (default true), without hitting the network. */
export function cachedAllowDupBatches(): boolean {
  const rows = cache.cached()?.rows;
  const row = rows ? rowFor(rows, ALLOW_DUP_BATCHES) : undefined;
  return !row || String(row.setting_value) !== "false";
}

/** Load (cached + deduped) and resolve the flag; default true when unset. */
export async function loadAllowDupBatches(): Promise<boolean> {
  const res = await cache.load();
  const row = res.ok ? rowFor(res.rows, ALLOW_DUP_BATCHES) : undefined;
  return !row || String(row.setting_value) !== "false";
}

/** Upsert the flag by setting_key, then refresh the cache. */
export async function setAllowDupBatches(v: boolean): Promise<{ ok: boolean; error?: string }> {
  const rows = (await cache.load()).rows;
  const existing = rowFor(rows, ALLOW_DUP_BATCHES);
  const res = existing
    ? await update("AppSetting", String(existing.ROWID), { setting_value: String(v) })
    : await insert("AppSetting", { setting_key: ALLOW_DUP_BATCHES, setting_value: String(v) });
  cache.invalidate();
  return { ok: res.ok, error: res.error };
}
