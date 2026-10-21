/* ============================================================
   Customer (Party) master — typed Data Store wrapper over lib/dataOps.

   The Customer table (Catalyst) holds the buyer list. `payment_term`
   is a real ForeignKey → PaymentTerm (stores the ROWID). Since CR-356
   it syncs with a Zoho customer source both ways — Zoho CRM Accounts
   since CR-359 (`crm_account_id`), Zoho Books before (`books_contact_id`,
   kept): Zoho → add-on on the server (lib/customerSync.js), add-on → Zoho
   by hand (Push). ZOHO in zohoApi.ts names the active one. Every write
   is recorded in OperationLog.
   ============================================================ */
import { list, listAll, insert, update, remove, type DSRow } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import type { Party } from "@/data";
import { ZOHO, zohoLinkOf, type ZohoLink } from "./zohoApi";

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
  email?: string; // SalesPerson options only — matches the logged-in user
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
  "company_name",
  "customer_type", // "business" | "individual" (stored lowercase)
  "overseas", // "true" | "" — overseas customer indicator
  "contact_salutation",
  "contact_first_name",
  "contact_last_name",
  "contact_email",
  "contact_work_phone",
  "contact_mobile",
  "contact_persons", // JSON array of ADDITIONAL contacts (primary = flat contact_* columns)
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
  "additional_addresses", // JSON array of ExtraAddress (extra ship-to/bill-to addresses)
  "books_contact_id", // Zoho Books contact this customer is mapped to (CR-325; "" = not mapped)
  // CR-356 Books-parity fields (same names as the Books contact object)
  "gst_no", // GSTIN
  "gst_treatment", // business_gst | business_none | consumer | overseas (GST_TREATMENTS)
  "place_of_contact", // Place of Supply — GST state code ("GJ")
  "pan_no",
  "website",
  "credit_limit", // text column; nothing sorts/sums it (ponytail: decimal if it ever does)
  "notes",
  "opening_balance", // pulled from Books, display-only here (never pushed)
  "crm_account_id", // CR-359: Zoho CRM Account this customer is linked to ("" = not linked)
] as const;
export type CustomerExtraField = (typeof CUSTOMER_EXTRA_FIELDS)[number];
export type CustomerExtras = Record<CustomerExtraField, string>;

/** Books GST treatment codes → labels (form select + detail page). */
export const GST_TREATMENTS: { value: string; label: string }[] = [
  { value: "business_gst", label: "Registered Business – Regular" },
  { value: "business_none", label: "Unregistered Business" },
  { value: "consumer", label: "Consumer" },
  { value: "overseas", label: "Overseas" },
];
export const gstTreatmentLabel = (v: string): string => GST_TREATMENTS.find((t) => t.value === v)?.label ?? v;

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

/* Extra addresses beyond the fixed billing/shipping column sets.
   Persisted as a JSON array in Customer.additional_addresses (text),
   mirroring the contact_persons pattern. Each one is typed billing or
   shipping so the detail page can group them and quote pickers can
   offer the right ones. */
export type ExtraAddressType = "billing" | "shipping";

export interface ExtraAddress {
  type: ExtraAddressType;
  attention: string;
  country: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

export const ADDRESS_FIELD_KEYS = ["attention", "country", "street1", "street2", "city", "state", "pincode", "phone"] as const;

export function emptyAddress(): ExtraAddress {
  return { type: "shipping", attention: "", country: "", street1: "", street2: "", city: "", state: "", pincode: "", phone: "" };
}

export function parseAddresses(json: string): ExtraAddress[] {
  try {
    const arr: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((a: Record<string, unknown>) => ({
      ...emptyAddress(),
      ...Object.fromEntries(ADDRESS_FIELD_KEYS.map((k) => [k, str(a[k])])),
      // Legacy untyped rows were extra ship-to's — default to shipping.
      type: a.type === "billing" ? ("billing" as const) : ("shipping" as const),
    }));
  } catch {
    return []; // corrupt/legacy value — treat as no extra addresses
  }
}

/** One-line address from an ExtraAddress (same field order as composeAddress). */
export function composeExtraAddress(a: ExtraAddress): string {
  const cityLine = [a.city, a.state, a.pincode].map((s) => s.trim()).filter(Boolean).join(" ");
  return [a.attention, a.street1, a.street2, cityLine, a.country]
    .map((s) => s.trim())
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
  boxBrandId: string; // Brand ROWID ("" if unset) — default carton brand for loadings
  boxBrandLabel: string;
  handlingPersonLabel: string; // SalesPerson name ("" if unset)
  /** Remote id in the active Zoho source (ZOHO.linkField) — "" = not linked. */
  zohoLinkId: string;
  /** CR-362: CRM & Books / CRM only / Books only / none — derived from both link ids. */
  zohoLink: ZohoLink;
  address: string;
  portOfDischarge: string;
  active: boolean;
  /** Contact person + structured billing/shipping address columns. */
  extras: CustomerExtras;
  createdTime: string; // Catalyst CREATEDTIME
  modifiedTime: string; // Catalyst MODIFIEDTIME
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
/** Last fetched payment-term options ([] if never fetched this session). */
export function cachedPaymentTerms(): PaymentTermOption[] {
  return cache.cached()?.paymentTerms ?? [];
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
  const [customers, terms, reps, brands] = await Promise.all([
    listAll("Customer", { order: "ROWID desc" }),
    list("PaymentTerm", { limit: 300, columns: ["name"] }),
    list("SalesPerson", { limit: 300, columns: ["name", "email"] }),
    list("Brand", { limit: 300, columns: ["name"] }),
  ]);
  if (!customers.ok)
    return { ok: false, customers: [], paymentTerms: [], salesPersons: [], error: customers.error };

  const toOptions = (rows: DSRow[] | undefined): PaymentTermOption[] =>
    (rows || [])
      .map((r) => ({ id: String(r.ROWID), label: str(r.name) || String(r.ROWID), email: str(r.email) }))
      .sort((a, b) => a.label.localeCompare(b.label));

  const termLabel = new Map<string, string>();
  (terms.rows || []).forEach((r) => termLabel.set(String(r.ROWID), str(r.name)));
  const repLabel = new Map<string, string>();
  (reps.rows || []).forEach((r) => repLabel.set(String(r.ROWID), str(r.name)));
  const brandLabel = new Map<string, string>();
  (brands.rows || []).forEach((r) => brandLabel.set(String(r.ROWID), str(r.name)));

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
      boxBrandId: str(c.box_brand),
      boxBrandLabel: brandLabel.get(str(c.box_brand)) || "",
      handlingPersonLabel: repLabel.get(str(c.handling_person)) || "",
      zohoLinkId: str(c[ZOHO.linkField]),
      zohoLink: zohoLinkOf({ crm_account_id: str(c.crm_account_id), books_contact_id: str(c.books_contact_id) }),
      address: str(c.address),
      portOfDischarge: str(c.port_of_discharge),
      active: str(c.active) !== "false", // unset → active
      extras: Object.fromEntries(
        CUSTOMER_EXTRA_FIELDS.map((k) => [k, str(c[k])]),
      ) as CustomerExtras,
      createdTime: str(c.CREATEDTIME),
      modifiedTime: str(c.MODIFIEDTIME),
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
  box_brand: string; // Brand ROWID ("" = leave unset)
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
  if (input.box_brand) p.box_brand = input.box_brand; // FK only when chosen
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
  if (!input.box_brand) patch.box_brand = null;
  return bust(update("Customer", rowid, patch));
}

export function deleteCustomer(rowid: string, reason?: string) {
  return bust(remove("Customer", rowid, reason));
}

/** Partial patch for the More-menu Active/Inactive toggle. */
export function setCustomerActive(rowid: string, active: boolean) {
  return bust(update("Customer", rowid, { active }));
}

/** Unmap from the active Zoho source (CR-325/359): clears the link only — the details stay. */
export function clearZohoLink(rowid: string) {
  return bust(update("Customer", rowid, { [ZOHO.linkField]: "" }));
}

/** Replace the customer's extra addresses (detail-screen Add/Remove). */
export function setAdditionalAddresses(rowid: string, addrs: ExtraAddress[]) {
  return bust(update("Customer", rowid, { additional_addresses: JSON.stringify(addrs) }));
}
