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
  name: string; // designName — the stored/matched key
  uniqueName: string; // the human-facing unique item name (shown in pickers)
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
  orderNumber?: string; // SalesOrder.order_number (SO/FY/NNN) — the primary display identifier
  poNumber: string;
  partyCode: string;
  party: string;
  country: string;
  flag: string;
  design: string;
  /** Plain design_name (matches the picker's option value); `design` above is
      the full unique label for display. Used to re-hydrate the edit/clone form. */
  designName: string;
  size: string;
  finish: string;
  brand: string;
  orderQty: number;
  producedQty: number;
  palletizedQty: number;
  loadedQty: number;
  dispatchedQty: number;
  /** OrderItem.pallet — the pallet spec chosen at SO creation (Pallet ROWID; "" if unset). */
  palletId: string;
  boxesPerPallet: number;
  totalBoxes: number;
  pallets: number;
  stage: string;
  /** SalesOrder.status — Draft | PendingApproval | Confirmed | InProgress |
      Cancelled | Rejected (state machine in /so-status; status bar on OrderDetail). */
  status?: string;
  /** Reason captured when the order was rejected (shown on the status hover). */
  rejectReason?: string;
  orderDate: string;
  dueDate: string;
  invoice: string | null;
  priority: "high" | "normal" | "low";
  daysFromPI: number;
  /** Per-line pricing (Data Store OrderItem). */
  rate?: number;
  discount?: number;
  subTotal?: number;
  description?: string;
  /** SalesOrder header fields (repeated per line on hydrate). */
  paymentTerm?: string;
  currency?: string;
  exchangeRate?: number;
  remarks?: string;
  portOfDischarge?: string;
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
  /** Catalyst row timestamps (SalesOrder header). */
  createdTime?: string;
  modifiedTime?: string;
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
  | "PendingApproval"
  | "Approved"
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
  /** Free-text line description shown under the item name (form + PDF). */
  description?: string;
  /** Boxes already converted to Sales Orders (caps further conversion). */
  converted?: number;
}

export interface Quote {
  id: string;
  quoteNo: string;
  customer: string;
  partyCode: string;
  /** Billing address (legacy column `address` — read by PDF/print/lists). */
  address: string;
  /** Shipping address; picked separately from the customer's addresses. */
  shippingAddress?: string;
  quoteDate: string;
  /** Quote validity / expiry date. */
  expiryDate?: string;
  paymentTerm: string;
  portOfDischarge: string;
  status: QuoteStatus;
  currency: string;
  /** Exchange rate to INR (INR per 1 unit of `currency`; INR = 1). */
  exchangeRate?: number;
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
  /** SalesOrder ROWID for the linked SO (for navigation); null until converted. */
  soId?: string | null;
  /** All SalesOrders converted from this quote (partial conversions can create several). */
  sos?: Array<{ id: string; number: string; date: string; status: string; total: number }>;
  /** Public share-link token ("" until first shared). */
  shareToken?: string;
  /** Raw Catalyst CREATEDTIME / MODIFIEDTIME (for the Created/Modified grid columns). */
  createdTime?: string;
  modifiedTime?: string;
  /** Reason captured when the quote was rejected (shown on the status hover). */
  rejectReason?: string;
  /** JSON container-plan snapshot from Plan Containerisation ("" until planned). */
  containerPlan?: string;
}

/* ---- Container-plan snapshot (Quote.container_plan JSON) ---- */
export interface ContainerPlanLine {
  design: string; // design_name — the key the rest of the client joins on
  palletId: string;
  palletName: string;
  pallets: number;
  boxes: number;
}
export interface ContainerPlanContainer {
  no: number; // C1..Cn
  fillPct: number;
  pallets: number;
  boxes: number;
  tonnes?: number; // gross container weight (boxes * box weight); optional (older plans omit)
  tonCapacity?: number; // this container's weight cap (per-container override; falls back to plan default)
  lines: ContainerPlanLine[];
}
export interface ContainerPlan {
  v: 1;
  tonCapacity?: number; // per-container weight cap the plan was packed at (default 28); optional for older plans
  containers: ContainerPlanContainer[];
}
/** Parse a Quote.containerPlan JSON string; null when absent/invalid. */
export function parseContainerPlan(raw: string | undefined | null): ContainerPlan | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ContainerPlan;
    return Array.isArray(p?.containers) && p.containers.length > 0 ? p : null;
  } catch {
    return null;
  }
}

// Payment terms now come from the live PaymentTerm master (useMasters().paymentTerms).
export const PORTS = ["Mundra", "Nhava Sheva", "Pipavav", "Hazira", "Kandla"];
// CURRENCIES static list removed 2026-07-13 — currency pick lists are
// DB-sourced from the Currency master (currenciesApi.currencyCodes).

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
      acc.qty += l.qty || 0;
      return acc;
    },
    { gross: 0, discount: 0, final: 0, qty: 0 },
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
