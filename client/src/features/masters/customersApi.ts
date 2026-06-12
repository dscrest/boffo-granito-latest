/* ============================================================
   Customer (Party) master — typed Data Store wrapper over lib/dataOps.

   The Customer table (Catalyst) holds the buyer list. `payment_term`
   is a real ForeignKey → PaymentTerm (stores the ROWID). The table is
   populated in-app for now and will be synced FROM Zoho Books later
   (books_contact_id is the sync key). Every write is recorded
   server-side in OperationLog.
   ============================================================ */
import { list, listAll, insert, update, remove, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { Party } from "@/data";

const str = (v: unknown) => (v == null ? "" : String(v));

/* Data Store stores ISO country codes (no emoji — 4-byte UTF-8 is
   mangled to "?"). The UI maps ISO → display name + flag. */
const ISO_INFO: Record<string, { country: string; flag: string }> = {
  PL: { country: "Poland", flag: "🇵🇱" },
  LT: { country: "Lithuania", flag: "🇱🇹" },
  RO: { country: "Romania", flag: "🇷🇴" },
  HR: { country: "Croatia", flag: "🇭🇷" },
  GR: { country: "Greece", flag: "🇬🇷" },
  IN: { country: "India", flag: "🇮🇳" },
};

export function isoInfo(iso: string): { country: string; flag: string } {
  return ISO_INFO[iso] || { country: iso, flag: "" };
}

export interface PaymentTermOption {
  id: string; // PaymentTerm ROWID
  label: string;
}

export interface CustomerRow {
  id: string; // ROWID
  code: string;
  name: string;
  countryCode: string; // ISO ("PL")
  country: string; // display name ("Poland")
  flag: string;
  currency: string;
  paymentTermId: string; // PaymentTerm ROWID ("" if unset)
  paymentTermLabel: string;
  booksContactId: string;
  address: string;
  portOfDischarge: string;
  active: boolean;
}

/** Mock-shaped view for screens still typed against data.ts Party. */
export function toParty(c: CustomerRow): Party {
  return { code: c.code, name: c.name, country: c.country, flag: c.flag };
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchCustomers);

/** Last fetched customers, or null if never fetched this session. */
export function cachedCustomers(): CustomerRow[] | null {
  return cache.cached()?.customers ?? null;
}
/** Subscribe to customer-cache changes. Returns an unsubscribe fn. */
export function subscribeCustomers(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listCustomers() hits the network. */
export function invalidateCustomers(): void {
  cache.invalidate();
}

/** All customers (payment-term label hydrated) + PaymentTerm options. */
export function listCustomers(): Promise<{
  ok: boolean;
  customers: CustomerRow[];
  paymentTerms: PaymentTermOption[];
  error?: string;
}> {
  return cache.load();
}

async function fetchCustomers(): Promise<{
  ok: boolean;
  customers: CustomerRow[];
  paymentTerms: PaymentTermOption[];
  error?: string;
}> {
  // listAll pages past ZCQL's 300-row cap; PaymentTerm projects its label.
  const [customers, terms] = await Promise.all([
    listAll("Customer", { order: "ROWID desc" }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
  ]);
  if (!customers.ok)
    return { ok: false, customers: [], paymentTerms: [], error: customers.error };

  const termLabel = new Map<string, string>();
  (terms.rows || []).forEach((r) => termLabel.set(String(r.ROWID), str(r.name)));

  const paymentTerms: PaymentTermOption[] = (terms.rows || [])
    .map((r) => ({ id: String(r.ROWID), label: str(r.name) || String(r.ROWID) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows: CustomerRow[] = (customers.rows || []).map((c) => {
    const iso = str(c.country_code);
    const termId = str(c.payment_term);
    const { country, flag } = isoInfo(iso);
    return {
      id: String(c.ROWID),
      code: str(c.code),
      name: str(c.name),
      countryCode: iso,
      country,
      flag,
      currency: str(c.currency),
      paymentTermId: termId,
      paymentTermLabel: termLabel.get(termId) || "",
      booksContactId: str(c.books_contact_id),
      address: str(c.address),
      portOfDischarge: str(c.port_of_discharge),
      active: str(c.active) !== "false", // unset → active
    };
  });

  return { ok: true, customers: rows, paymentTerms };
}

export interface CustomerInput {
  code: string;
  name: string;
  country_code: string; // ISO ("PL"), never the emoji
  currency: string;
  payment_term: string; // PaymentTerm ROWID ("" = leave unset)
  address: string;
  port_of_discharge: string;
  active: boolean;
}

/** Drop the empty FK so Catalyst doesn't reject a blank ForeignKey. */
function toPayload(input: CustomerInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    country_code: input.country_code.trim().toUpperCase(),
    currency: input.currency.trim(),
    address: input.address.trim(),
    port_of_discharge: input.port_of_discharge.trim(),
    active: input.active,
  };
  if (input.payment_term) p.payment_term = input.payment_term; // FK only when chosen
  return p;
}

/* Mutations invalidate the cache so the next listCustomers() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createCustomer(input: CustomerInput) {
  return bust(insert("Customer", toPayload(input)));
}

export function updateCustomer(rowid: string, input: CustomerInput) {
  // On edit, always send payment_term (allow clearing → null) to unset the FK.
  const patch = toPayload(input);
  if (!input.payment_term) patch.payment_term = null;
  return bust(update("Customer", rowid, patch));
}

export function deleteCustomer(rowid: string) {
  return bust(remove("Customer", rowid));
}
