/* Mock data, ported from prototype/data.jsx (ceramic tiles; real party/design/size names).
   Behaviour preserved exactly — same seed (42) and arithmetic so the generated orders
   match the prototype. Phase: visual/page designs only; real data arrives with the
   Data Store backend later. Globals (window.*) replaced with module exports + types. */

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

export const PARTIES: Party[] = [
  { code: "MRK", name: "Merkury Market", country: "Poland", flag: "🇵🇱" },
  { code: "FLB", name: "Fliba D.O.O.", country: "Poland", flag: "🇵🇱" },
  { code: "ABS", name: "AB Specializuota", country: "Lithuania", flag: "🇱🇹" },
  { code: "DDM", name: "S.C. Dedeman SRL", country: "Romania", flag: "🇷🇴" },
];

export const SIZES = ["600x1200", "600x600", "300x600", "200x1200", "800x1600", "75x600"];

export const FINISHES = ["Glossy", "Matt", "Carving", "High Glossy", "Hard Matt"];

export const DESIGNS: Design[] = [
  // 600x1200 Glossy
  { name: "Desert Beige", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Hawai Crema", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Hawai White", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Onyx Gris", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Onyx Prime", size: "600x1200", finish: "Matt", brand: "Bonza", category: "Marble" },
  { name: "Onyx Turquoise", size: "600x1200", finish: "High Glossy", brand: "Bonza", category: "Marble" },
  { name: "Pacyfic", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Pasionate", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Pietrasanta Legal", size: "600x1200", finish: "Matt", brand: "Bonza", category: "Marble" },
  { name: "Solace Beige", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  { name: "Streetline Antracyt", size: "600x1200", finish: "Matt", brand: "Bonza", category: "Stone" },
  { name: "Streetline Grey", size: "600x1200", finish: "Matt", brand: "Bonza", category: "Stone" },
  { name: "Etna Beige", size: "600x1200", finish: "Carving", brand: "Bonza", category: "Stone" },
  { name: "New Carrara", size: "600x1200", finish: "Glossy", brand: "Bonza", category: "Marble" },
  // 200x1200
  { name: "Chester Wood Natural", size: "200x1200", finish: "Carving", brand: "BIG", category: "Wood" },
  { name: "Elmi Wood Ash", size: "200x1200", finish: "Carving", brand: "BIG", category: "Wood" },
  { name: "Benito Wood Choco", size: "200x1200", finish: "Carving", brand: "BIG", category: "Wood" },
  { name: "Lamer Wood Sand", size: "200x1200", finish: "Carving", brand: "BIG", category: "Wood" },
  { name: "Balmo Wood Pearl", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Burl Wood Honey", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Lorien Wood Miel", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Taptik Wood Honey", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Aspen Wood Bianco", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Axial Wood Grey", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  { name: "Axial Wood Natural", size: "200x1200", finish: "Matt", brand: "BIG", category: "Wood" },
  // 75x600
  { name: "Purl Marfil", size: "75x600", finish: "Glossy", brand: "Bonza", category: "Marble" },
  // 600x600
  { name: "Earth", size: "600x600", finish: "Carving", brand: "Bonza", category: "Stone" },
  { name: "Gres Pine Beige", size: "600x600", finish: "Matt", brand: "BIG", category: "Stone" },
];

export const STAGES: Stage[] = [
  { id: "po", label: "Purchase Order", short: "PO", color: "amber" },
  { id: "prod", label: "In Production", short: "Production", color: "blue" },
  { id: "qc", label: "Quality Control", short: "QC", color: "teal" },
  { id: "packing", label: "Pallet Packing", short: "Packing", color: "violet" },
  { id: "loading", label: "Loading", short: "Loading", color: "cyan" },
  { id: "final", label: "Final Loading", short: "Final", color: "green" },
];

/** STAGES lookup that the prototype did inline via STAGES.find(...). */
export function stageOf(id: string): Stage {
  return STAGES.find((s) => s.id === id)!;
}

// Deterministic pseudo-random so re-renders are stable (matches prototype).
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const rand = seeded(42);
function int(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function buildOrders(): Order[] {
  const orders: Order[] = [];
  let id = 1000;
  const months = ["01", "02", "03", "04", "05", "06", "07"];

  const dist: Record<string, number> = { po: 8, prod: 14, packing: 11, loading: 6, final: 5 };

  Object.entries(dist).forEach(([stage, count]) => {
    for (let i = 0; i < count; i++) {
      const design = DESIGNS[Math.floor(rand() * DESIGNS.length)];
      const party = PARTIES[Math.floor(rand() * PARTIES.length)];
      const month = months[Math.floor(rand() * months.length)];
      const orderQty = [
        544, 928, 1456, 1742, 1856, 2800, 4762, 6272, 6890, 6033, 8772, 12484, 12724, 23847, 28662,
        47862,
      ][Math.floor(rand() * 16)];
      const boxesPerPallet = design.size === "200x1200" ? 38 : 32;
      const totalBoxes = Math.ceil(orderQty / 60);
      const pallets = Math.ceil(totalBoxes / boxesPerPallet);

      let produced = 0,
        palletized = 0,
        loaded = 0;
      if (stage === "po") {
        produced = 0;
        palletized = 0;
        loaded = 0;
      }
      if (stage === "prod") {
        produced = Math.floor(orderQty * (0.2 + rand() * 0.6));
        palletized = Math.floor(produced * (0.2 + rand() * 0.5));
      }
      if (stage === "packing") {
        produced = orderQty;
        palletized = Math.floor(orderQty * (0.6 + rand() * 0.35));
      }
      if (stage === "loading") {
        produced = orderQty;
        palletized = orderQty;
        loaded = Math.floor(orderQty * (0.3 + rand() * 0.5));
      }
      if (stage === "final") {
        produced = orderQty;
        palletized = orderQty;
        loaded = orderQty;
      }

      const day = int(1, 28);
      const orderDate = `${String(day).padStart(2, "0")}/04/2026`;
      const dueDay = ((day + 35) % 28) + 1;
      const dueDate = `${String(dueDay).padStart(2, "0")}/05/2026`;

      orders.push({
        id: "O" + id++,
        poNumber: `${month}/2026-27`,
        partyCode: party.code,
        party: party.name,
        country: party.country,
        flag: party.flag,
        design: design.name,
        size: design.size,
        finish: design.finish,
        brand: design.brand,
        orderQty,
        producedQty: produced,
        palletizedQty: palletized,
        loadedQty: loaded,
        boxesPerPallet,
        totalBoxes,
        pallets,
        stage,
        orderDate,
        dueDate,
        invoice: stage === "final" ? `EX-${10 + (id % 8)}/2026-27` : null,
        priority: rand() < 0.18 ? "high" : rand() < 0.5 ? "normal" : "low",
        daysFromPI: int(20, 60),
      });
    }
  });

  return orders;
}

export const ORDERS: Order[] = buildOrders();

/* Carve a QC stage out of production/packing so the new QC workflow has live
   work-in-flight. Mutated after generation to keep the seeded sequence intact.
   Pre-pallet QC = produced-but-not-yet-palletized; post-pallet = palletized,
   awaiting clearance before loading. */
ORDERS.filter((o) => o.stage === "packing")
  .slice(0, 5)
  .forEach((o) => {
    o.stage = "qc";
  });

export const ACTIVITY: Activity[] = [
  { time: "08:42", who: "Ramesh", action: "updated production", detail: "836 boxes — Etna Beige 600x1200", tag: "production" },
  { time: "08:21", who: "Priya", action: "closed pallet", detail: "[38x22] Etna Beige · 17-05 batch", tag: "packing" },
  { time: "07:58", who: "Anil", action: "loaded", detail: "EX-14/2026-27 — 25 pallets · Merkury Market", tag: "loading" },
  { time: "07:30", who: "Kavita", action: "created PO", detail: "06/2026-27 · Merkury Market · 47,862 sqm", tag: "po" },
  { time: "Yest.", who: "Suresh", action: "invoice issued", detail: "EX-13/2026-27 — Fliba D.O.O.", tag: "final" },
  { time: "Yest.", who: "Priya", action: "started packing", detail: "Onyx Turquoise · 928 boxes", tag: "packing" },
  { time: "Yest.", who: "Ramesh", action: "updated production", detail: "1,710 boxes — Etna Beige 600x1200", tag: "production" },
  { time: "2d", who: "Kavita", action: "created PO", detail: "04/2026-27 · AB Specializuota · 1,000 sqm", tag: "po" },
];

export const READY_TO_LOAD: Order[] = ORDERS.filter(
  (o) => o.stage === "loading" || (o.stage === "packing" && o.palletizedQty >= o.orderQty * 0.85),
).slice(0, 7);

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

const CUSTOMER_ADDR: Record<string, string> = {
  MRK: "ul. Czerwone Maki 65, 30-392 Kraków, Poland",
  FLB: "Obrtnička 5, 10000 Zagreb, Croatia",
  ABS: "Verkių g. 25C, 08223 Vilnius, Lithuania",
  DDM: "Str. Alexandru Vlahuță 1, Bacău 600310, Romania",
};

export const QUOTES: Quote[] = [
  {
    id: "Q1001",
    quoteNo: "QT/2026-27/001",
    customer: "Merkury Market",
    partyCode: "MRK",
    address: CUSTOMER_ADDR.MRK,
    quoteDate: "02/04/2026",
    paymentTerm: "Advance",
    portOfDischarge: "Mundra",
    status: "Accepted",
    currency: "EUR",
    remarks: "Container load — mixed sizes.",
    soNumber: null,
    lines: [
      { item: "Desert Beige", qty: 1280, rate: 4.85, discount: 3 },
      { item: "Onyx Gris", qty: 960, rate: 5.2, discount: 0 },
    ],
  },
  {
    id: "Q1002",
    quoteNo: "QT/2026-27/002",
    customer: "Fliba D.O.O.",
    partyCode: "FLB",
    address: CUSTOMER_ADDR.FLB,
    quoteDate: "05/04/2026",
    paymentTerm: "Net 30",
    portOfDischarge: "Nhava Sheva",
    status: "Sent",
    currency: "EUR",
    remarks: "",
    soNumber: null,
    lines: [{ item: "Chester Wood Natural", qty: 2400, rate: 6.1, discount: 5 }],
  },
  {
    id: "Q1003",
    quoteNo: "QT/2026-27/003",
    customer: "S.C. Dedeman SRL",
    partyCode: "DDM",
    address: CUSTOMER_ADDR.DDM,
    quoteDate: "09/04/2026",
    paymentTerm: "Net 45",
    portOfDischarge: "Pipavav",
    status: "Converted",
    currency: "EUR",
    remarks: "Repeat order.",
    soNumber: "07/2026-27",
    lines: [
      { item: "Streetline Grey", qty: 1856, rate: 4.95, discount: 2 },
      { item: "New Carrara", qty: 1456, rate: 5.4, discount: 2 },
    ],
  },
  {
    id: "Q1004",
    quoteNo: "QT/2026-27/004",
    customer: "AB Specializuota",
    partyCode: "ABS",
    address: CUSTOMER_ADDR.ABS,
    quoteDate: "14/04/2026",
    paymentTerm: "Net 60",
    portOfDischarge: "Mundra",
    status: "Draft",
    currency: "EUR",
    remarks: "Awaiting size confirmation.",
    soNumber: null,
    lines: [{ item: "Earth", qty: 928, rate: 3.9, discount: 0 }],
  },
];
