/* ============================================================
   Currency master — typed Data Store wrapper over lib/dataOps.

   Holds the currencies offered on customers / quotes / orders plus
   the exchange rate to the base currency (INR per 1 unit; INR = 1).
   Rates auto-refresh daily via the fx_refresh_daily cron hitting
   data-ops /cron/fx-refresh (frankfurter.dev); rows flagged
   manual_override keep their hand-entered rate.
   ============================================================ */
import { listAll, insert, update, remove } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { apiPost } from "@/lib/api";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface CurrencyRow {
  id: string; // ROWID
  code: string; // "INR"
  name: string; // "Indian Rupee"
  symbol: string; // "₹"
  exchangeRate: number; // INR per 1 unit
  manualOverride: boolean;
  rateUpdatedAt: string;
  createdTime: string;
  modifiedTime: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchCurrencies);

/** Last fetched currencies, or null if never fetched this session. */
export function cachedCurrencies(): CurrencyRow[] | null {
  return cache.cached()?.currencies ?? null;
}
/** Subscribe to currency cache changes. Returns an unsubscribe fn. */
export function subscribeCurrencies(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listCurrencies() hits the network. */
export function invalidateCurrencies(): void {
  cache.invalidate();
}

/** All currencies, hydrated. Cached + deduped. */
export function listCurrencies(): Promise<{ ok: boolean; currencies: CurrencyRow[]; error?: string }> {
  return cache.load();
}

async function fetchCurrencies(): Promise<{ ok: boolean; currencies: CurrencyRow[]; error?: string }> {
  const res = await listAll("Currency", { order: "code" });
  if (!res.ok) return { ok: false, currencies: [], error: res.error };
  const currencies: CurrencyRow[] = (res.rows || [])
    .filter((r) => !r.deleted_at)
    .map((r) => ({
      id: String(r.ROWID),
      code: str(r.code).toUpperCase(),
      name: str(r.name),
      symbol: str(r.symbol),
      exchangeRate: Number(r.exchange_rate) || 0,
      manualOverride: str(r.manual_override) === "true",
      rateUpdatedAt: str(r.rate_updated_at),
      createdTime: str(r.CREATEDTIME),
      modifiedTime: str(r.MODIFIEDTIME),
    }));
  return { ok: true, currencies };
}

export interface CurrencyInput {
  code: string;
  name: string;
  symbol: string;
  exchange_rate: number;
  manual_override: boolean;
}

function toPayload(input: CurrencyInput): Record<string, unknown> {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    symbol: input.symbol.trim(),
    exchange_rate: input.exchange_rate,
    manual_override: input.manual_override,
  };
}

/* Mutations invalidate the cache so the next listCurrencies() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createCurrency(input: CurrencyInput) {
  return bust(insert("Currency", toPayload(input)));
}

export function updateCurrency(rowid: string, input: CurrencyInput) {
  return bust(update("Currency", rowid, toPayload(input)));
}

export function deleteCurrency(rowid: string) {
  return bust(remove("Currency", rowid));
}

/** Re-fetch live rates now (admin button). Cron does the same daily. */
export function refreshRatesNow() {
  return bust(apiPost<{ ok: boolean; updated: string[]; skipped: string[] }>("data-ops/fx-refresh"));
}

/** Exchange rate for a code (INR per 1 unit). INR/unknown → 1. */
export function rateFor(rows: CurrencyRow[], code: string): number {
  const c = String(code || "").toUpperCase();
  if (!c || c === "INR") return 1;
  return rows.find((r) => r.code === c)?.exchangeRate || 1;
}

/** Pick-list codes for currency selects (DB-sourced, INR first). */
export function currencyCodes(rows: CurrencyRow[]): string[] {
  const codes = rows.map((r) => r.code);
  return codes.includes("INR") ? ["INR", ...codes.filter((c) => c !== "INR")] : codes;
}
