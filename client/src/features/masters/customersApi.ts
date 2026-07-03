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
   mangled to "?"). Display name comes from Intl, flag from the ISO
   letters (regional-indicator codepoints) — no hand-kept map. */
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function isoInfo(iso: string): { country: string; flag: string } {
  if (!/^[A-Z]{2}$/.test(iso)) return { country: iso, flag: "" };
  let country = iso;
  try {
    country = regionNames.of(iso) || iso;
  } catch {
    /* invalid region code — show the raw value */
  }
  const flag = iso.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  return { country, flag };
}

export interface PaymentTermOption {
  id: string; // PaymentTerm ROWID
  label: string;
}

/* Books-parity extras: contact person + structured billing/shipping
   address, plus Party List master fields (main_party_name /
   working_status / handling_person, created 2026-07-02).
   handling_person holds a SalesPerson ROWID (logical FK, bigint).
   All optional columns on Customer (snake_case = live column names). */
export const CUSTOMER_EXTRA_FIELDS = [
  "main_party_name",
  "working_status",
  "handling_person",
  "contact_salutation",
  "contact_first_name",
  "contact_last_name",
  "contact_email",
  "contact_work_phone",
  "contact_mobile",
  "billing_attention",
  "billing_country",
  "billing_street1",
  "billing_street2",
  "billing_city",
  "billing_state",
  "billing_pincode",
  "billing_phone",
  "shipping_attention",
  "shipping_country",
  "shipping_street1",
  "shipping_street2",
  "shipping_city",
  "shipping_state",
  "shipping_pincode",
  "shipping_phone",
] as const;
export type CustomerExtraField = (typeof CUSTOMER_EXTRA_FIELDS)[number];
export type CustomerExtras = Record<CustomerExtraField, string>;

export function emptyExtras(): CustomerExtras {
  return Object.fromEntries(CUSTOMER_EXTRA_FIELDS.map((k) => [k, ""])) as CustomerExtras;
}

/** "Mr. Jan Kowalski" from the contact person parts ("" when unset). */
export function contactName(x: Partial<CustomerExtras>): string {
  return [x.contact_salutation, x.contact_first_name, x.contact_last_name]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
}

/** One-line address from the billing_* or shipping_* parts ("" when unset). */
export function composeAddress(x: Partial<CustomerExtras>, prefix: "billing" | "shipping"): string {
  const f = (k: string) => ((x as Record<string, string | undefined>)[`${prefix}_${k}`] || "").trim();
  const cityLine = [f("city"), f("state"), f("pincode")].filter(Boolean).join(" ");
  return [f("attention"), f("street1"), f("street2"), cityLine, f("country")]
    .filter(Boolean)
    .join(", ");
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
  handlingPersonLabel: string; // SalesPerson name ("" if unset)
  booksContactId: string;
  address: string;
  portOfDischarge: string;
  active: boolean;
  /** Contact person + structured billing/shipping address columns. */
  extras: CustomerExtras;
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

/** All customers (payment-term + handling-person labels hydrated),
    plus PaymentTerm and SalesPerson pick-list options. */
export function listCustomers(): Promise<{
  ok: boolean;
  customers: CustomerRow[];
  paymentTerms: PaymentTermOption[];
  salesPersons: PaymentTermOption[];
  error?: string;
}> {
  return cache.load();
}

async function fetchCustomers(): Promise<{
  ok: boolean;
  customers: CustomerRow[];
  paymentTerms: PaymentTermOption[];
  salesPersons: PaymentTermOption[];
  error?: string;
}> {
  // listAll pages past ZCQL's 300-row cap; lookups project their label.
  const [customers, terms, reps] = await Promise.all([
    listAll("Customer", { order: "ROWID desc" }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
    list("SalesPerson", { limit: 300, columns: ["name"] }),
  ]);
  if (!customers.ok)
    return { ok: false, customers: [], paymentTerms: [], salesPersons: [], error: customers.error };

  const toOptions = (rows: DSRow[] | undefined): PaymentTermOption[] =>
    (rows || [])
      .map((r) => ({ id: String(r.ROWID), label: str(r.name) || String(r.ROWID) }))
      .sort((a, b) => a.label.localeCompare(b.label));

  const termLabel = new Map<string, string>();
  (terms.rows || []).forEach((r) => termLabel.set(String(r.ROWID), str(r.name)));
  const repLabel = new Map<string, string>();
  (reps.rows || []).forEach((r) => repLabel.set(String(r.ROWID), str(r.name)));

  const paymentTerms = toOptions(terms.rows);
  const salesPersons = toOptions(reps.rows);

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
      handlingPersonLabel: repLabel.get(str(c.handling_person)) || "",
      booksContactId: str(c.books_contact_id),
      address: str(c.address),
      portOfDischarge: str(c.port_of_discharge),
      active: str(c.active) !== "false", // unset → active
      extras: Object.fromEntries(
        CUSTOMER_EXTRA_FIELDS.map((k) => [k, str(c[k])]),
      ) as CustomerExtras,
    };
  });

  return { ok: true, customers: rows, paymentTerms, salesPersons };
}

export interface CustomerInput extends Partial<CustomerExtras> {
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
  for (const k of CUSTOMER_EXTRA_FIELDS) {
    if (input[k] !== undefined) p[k] = String(input[k]).trim();
  }
  // handling_person is a bigint column — "" is rejected, use null to clear.
  if (p.handling_person === "") p.handling_person = null;
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
