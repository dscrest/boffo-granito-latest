/* Shared domain types + UI constants + document math (Books parity).
   The mock data that used to live here (PARTIES/DESIGNS/ORDERS/QUOTES/
   ACTIVITY/READY_TO_LOAD) was removed once every screen migrated to the
   live Data Store APIs — see the *Api.ts modules under features/. Only types, stage
   config, picker constants and the totals helpers remain. */

export interface Party {
  code: string;
  name: string;
  country: string;
  flag: string;
}

export interface Design {
  name: string;
  size: string;
  finish: string;
  brand: string;
  category: string;
}

/** Item categories (shared by the quote/order item filters + Design master). */
export const CATEGORIES = ["Marble", "Wood", "Stone", "Cement", "Concrete"];

export interface Stage {
  id: string;
  label: string;
  short: string;
  color: string;
}

export interface Order {
  id: string;
  salesOrderId?: string; // SalesOrder ROWID (real data); used to scope palletization
  poNumber: string;
  partyCode: string;
  party: string;
  country: string;
  flag: string;
  design: string;
  size: string;
  finish: string;
  brand: string;
  orderQty: number;
  producedQty: number;
  palletizedQty: number;
  loadedQty: number;
  boxesPerPallet: number;
  totalBoxes: number;
  pallets: number;
  stage: string;
  orderDate: string;
  dueDate: string;
  invoice: string | null;
  priority: "high" | "normal" | "low";
  daysFromPI: number;
  /** Per-line pricing (Data Store OrderItem). */
  rate?: number;
  discount?: number;
  subTotal?: number;
  /** SalesOrder header fields (repeated per line on hydrate). */
  salesperson?: string;
  /** Branding printed on the boxes — our brand or the customer's own. */
  boxBranding?: string;
  shipmentDate?: string;
  customerNotes?: string;
  terms?: string;
  totalAmount?: number;
  /** Doc-level charges (SalesOrder header). */
  docDiscount?: number;
  adjustment?: number;
  taxType?: TaxType;
  taxPct?: number;
  taxAmount?: number;
}

export interface Activity {
  time: string;
  who: string;
  action: string;
  detail: string;
  tag: string;
}

/* Mock PARTIES / SIZES / FINISHES / DESIGNS removed — live data comes from
   customersApi (Customer) and designsApi (Design + lookups). */

export const STAGES: Stage[] = [
  { id: "po", label: "Purchase Order", short: "PO", color: "amber" },
  { id: "prod", label: "In Production", short: "Production", color: "blue" },
  { id: "qc", label: "Quality Control", short: "QC", color: "teal" },
  { id: "packing", label: "Pallet Packing", short: "Packing", color: "violet" },
  { id: "loading", label: "Loading", short: "Loading", color: "cyan" },
  { id: "final", label: "Final Loading", short: "Final", color: "green" },
];

/** STAGES lookup that the prototype did inline via STAGES.find(...).
    Total: live rows can carry stage values outside STAGES (legacy/seed data),
    so unknown ids fall back to a neutral badge instead of crashing the page. */
export function stageOf(id: string): Stage {
  return (
    STAGES.find((s) => s.id === id) ?? {
      id,
      label: id || "Unknown",
      short: id ? id.charAt(0).toUpperCase() + id.slice(1) : "—",
      color: "amber",
    }
  );
}

/* ============================================================
   QUOTES — sales process step before a Sales Order. A quote is
   raised, shared with the party, and on acceptance converted
   (fully or partially) into a Sales Order. Field keys mirror the
   Export Tracker reference for 1:1 Data Store wiring later.
   ============================================================ */

export type QuoteStatus =
  | "Draft"
  | "Sent"
  | "Accepted"
  | "Rejected"
  | "Converted"
  | "PartiallyConverted";

/** Withholding-tax mode (Books parity). TDS subtracts, TCS adds. */
export type TaxType = "None" | "TDS" | "TCS";

export interface QuoteLine {
  /** Design/item name — resolves against DESIGNS for size/finish/brand. */
  item: string;
  qty: number; // boxes
  rate: number; // per box
  discount: number; // percent
}

export interface Quote {
  id: string;
  quoteNo: string;
  customer: string;
  partyCode: string;
  address: string;
  quoteDate: string;
  /** Quote validity / expiry date. */
  expiryDate?: string;
  paymentTerm: string;
  portOfDischarge: string;
  status: QuoteStatus;
  currency: string;
  remarks: string;
  /** Salesperson owning the quote. */
  salesperson?: string;
  /** Customer-facing reference / PO ref. */
  referenceNo?: string;
  /** Notes shown to the customer (on print). */
  customerNotes?: string;
  /** Terms & conditions text. */
  terms?: string;
  /** Doc-level discount amount (off line subtotal). */
  docDiscount?: number;
  /** Manual +/- adjustment to the total. */
  adjustment?: number;
  /** Tax mode: None | TDS | TCS. */
  taxType?: TaxType;
  /** Tax percentage applied to the taxable amount. */
  taxPct?: number;
  /** Computed tax amount (positive). */
  taxAmount?: number;
  lines: QuoteLine[];
  /** SO number once converted (full or partial). */
  soNumber: string | null;
  /** Public share-link token ("" until first shared). */
  shareToken?: string;
}

export const PAYMENT_TERMS = ["Advance", "Credit 30", "Net 15", "Net 30", "Net 45", "Net 60"];
export const PORTS = ["Mundra", "Nhava Sheva", "Pipavav", "Hazira", "Kandla"];
export const CURRENCIES = ["INR", "USD", "EUR"];

export interface QuoteLineTotals {
  gross: number; // qty * rate
  discountAmt: number;
  subTotal: number; // gross - discount
}

export function lineTotals(l: QuoteLine): QuoteLineTotals {
  const gross = (l.qty || 0) * (l.rate || 0);
  const discountAmt = gross * ((l.discount || 0) / 100);
  return { gross, discountAmt, subTotal: gross - discountAmt };
}

export function quoteTotals(q: { lines: QuoteLine[] }) {
  return q.lines.reduce(
    (acc, l) => {
      const t = lineTotals(l);
      acc.gross += t.gross;
      acc.discount += t.discountAmt;
      acc.final += t.subTotal;
      return acc;
    },
    { gross: 0, discount: 0, final: 0 },
  );
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface DocCharges {
  /** Doc-level discount amount, off the line subtotal. */
  docDiscount?: number;
  /** Manual +/- adjustment. */
  adjustment?: number;
  /** Tax mode. */
  taxType?: TaxType;
  /** Tax percentage. */
  taxPct?: number;
}

/**
 * Full document totals: line subtotal → doc discount → adjustment → tax → net.
 * TDS reduces the net (tax withheld); TCS increases it (tax collected).
 * Single source of truth — backend `docCompute` in data-ops mirrors this.
 */
export function docTotals(lines: QuoteLine[], c: DocCharges = {}) {
  const base = quoteTotals({ lines }); // gross, discount (line-level), final
  const docDiscount = c.docDiscount || 0;
  const adjustment = c.adjustment || 0;
  const taxable = round2(base.final - docDiscount + adjustment);
  const taxPct = c.taxPct || 0;
  const taxType: TaxType = c.taxType || "None";
  const taxAmt = round2(taxable * (taxPct / 100));
  const signedTax = taxType === "TDS" ? -taxAmt : taxType === "TCS" ? taxAmt : 0;
  const net = round2(taxable + signedTax);
  return { ...base, docDiscount, adjustment, taxable, taxType, taxPct, taxAmt, signedTax, net };
}

/* Mock QUOTES removed — live quotes come from quotesApi. */
