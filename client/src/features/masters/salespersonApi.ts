/* ============================================================
   SalesPerson master — typed Data Store wrapper over lib/dataOps.

   A SalesPerson is the named rep shown on Quotations / Sales Orders.
   Every SalesPerson is linked to an AppUser (app_user = AppUser ROWID,
   a logical FK stored as bigint) so access permissions flow through
   the user's role. Quote.sales_person / SalesOrder.sales_person point
   here. Every write is recorded server-side in OperationLog.
   ============================================================ */
import { listAll } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { storedAuth } from "@/lib/auth";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface SalesPersonRow {
  id: string; // ROWID
  name: string;
  email: string;
  phone: string;
  region: string;
  active: boolean;
  appUserId: string; // AppUser ROWID ("" if unset)
  createdTime: string;
  modifiedTime: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchSalesPersons);

/** Last fetched sales persons, or null if never fetched this session. */
export function cachedSalesPersons(): SalesPersonRow[] | null {
  return cache.cached()?.salesPersons ?? null;
}
/** Subscribe to sales-person cache changes. Returns an unsubscribe fn. */
export function subscribeSalesPersons(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listSalesPersons() hits the network. */
export function invalidateSalesPersons(): void {
  cache.invalidate();
}

/** All sales persons, hydrated. Cached + deduped. */
export function listSalesPersons(): Promise<{ ok: boolean; salesPersons: SalesPersonRow[]; error?: string }> {
  return cache.load();
}

async function fetchSalesPersons(): Promise<{ ok: boolean; salesPersons: SalesPersonRow[]; error?: string }> {
  const res = await listAll("SalesPerson", { order: "name" });
  if (!res.ok) return { ok: false, salesPersons: [], error: res.error };
  const salesPersons: SalesPersonRow[] = (res.rows || []).map((r) => ({
    id: String(r.ROWID),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    region: str(r.region),
    active: str(r.active) !== "false", // unset → active
    appUserId: str(r.app_user),
    createdTime: str(r.CREATEDTIME),
    modifiedTime: str(r.MODIFIEDTIME),
  }));
  return { ok: true, salesPersons };
}

/* Reps are read-only in the UI: auto-synced from AppUser on login (see
   functions/data-ops/lib/appauth.js syncSalesPersons). The Sales Persons admin
   page was removed 2026-07-20 — Users is the only rep master to maintain. */

/** Name of the active SalesPerson linked to the logged-in AppUser, or "" if none. */
export function currentSalespersonName(rows: SalesPersonRow[]): string {
  const uid = storedAuth()?.user.rowid;
  if (!uid) return "";
  return rows.find((s) => s.active && s.appUserId === uid)?.name ?? "";
}

/** Combobox options (value = name, since Quote/SO resolve salesperson by name). */
export function salesPersonOptions(rows: SalesPersonRow[]): { value: string; label: string; hint?: string }[] {
  return rows
    .filter((s) => s.active)
    .map((s) => ({ value: s.name, label: s.name, hint: s.region || s.email || undefined }));
}
