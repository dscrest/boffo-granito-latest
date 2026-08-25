/* ============================================================
   quoteTemplate — shared constants + helpers for the branded
   quotation document (claude.ai/design "Quotation Template").
   Used by both renderings: QuotePrint.tsx (HTML sheet) and
   quotePdf.ts (pdfmake), so copy and palette never drift apart.
   ============================================================ */
import boffoLogo from "@/assets/boffo-logo.png";

/** Template palette. */
export const QP = {
  ink: "#17181B",
  orange: "#E8821E",
  line: "#E4E2DE",
  body: "#4A4B4E",
  dim: "#8A8B8E",
  paper: "#FAFAF8",
  band: "#F1EFEA",
};

/** Group quote lines by base design name (first-appearance order) for the
    banded items table. Lines whose design lookup fails group under their raw
    item string; single-line designs still get a band (uniform layout). */
export function groupQuoteLines<L extends { item: string }>(
  lines: L[],
  baseNameOf: (item: string) => string | undefined,
): { design: string; lines: L[] }[] {
  const m = new Map<string, L[]>();
  for (const l of lines) {
    const key = baseNameOf(l.item) || l.item || "—";
    (m.get(key) || m.set(key, []).get(key)!).push(l);
  }
  return [...m].map(([design, lines]) => ({ design, lines }));
}

/** unique_name ("Design - Size - Finish…") minus the band's "Design - " prefix,
    for rows that must not repeat the design name. Falls back to the full item. */
export function itemSuffix(item: string, base: string): string {
  return item.startsWith(`${base} - `) ? item.slice(base.length + 3) : item;
}

/** Printed when the quote carries no Terms & Conditions of its own. */
export const DEFAULT_TERMS = [
  "Prices are ex-works Morbi, Gujarat. Taxes, freight and insurance are charged extra as applicable.",
  "This quotation is valid for 15 days from the date of issue.",
  "50% advance with confirmed order; balance before dispatch.",
  "Delivery within 2–3 weeks of order confirmation, subject to stock.",
  "Breakage tolerance of up to 3% in transit is considered normal for vitrified tiles.",
  "Shade, size and finish may vary marginally from samples; inherent to the product.",
  "All disputes are subject to Morbi jurisdiction only.",
];

// ponytail: bank details are static template copy from the design — swap in
// the real account before customer-facing use.
export const BANK: [string, string][] = [
  ["Beneficiary", "Boffo Granito LLP"],
  ["Bank", "HDFC Bank, Morbi Branch"],
  ["A/C No.", "5020 0045 6789 01"],
  ["IFSC", "HDFC0001234"],
  ["SWIFT", "HDFCINBB"],
];

export const COMPANY = {
  name: "BOFFO GRANITO LLP",
  address: "8-A National Highway, Morbi, Gujarat, India",
  contact: "+91 99256 45674 · info@boffogranito.com · boffogranito.com",
};

export const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€" };

/** Currency formatter — symbol + locale grouping (Indian for INR). */
export function moneyFor(currency: string): (n: number) => string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const sym = SYMBOL[currency] ?? `${currency} `;
  return (n) => sym + n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Whole-number → words; Indian units (crore/lakh) for INR, western otherwise. */
export function amountInWords(n: number, currency: string): string {
  const two = (x: number): string => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? ` ${ONES[x % 10]}` : ""));
  const three = (x: number): string =>
    (x >= 100 ? `${ONES[Math.floor(x / 100)]} Hundred${x % 100 ? " " : ""}` : "") + (x % 100 ? two(x % 100) : "");
  const indian = currency === "INR";
  const units: [number, string][] = indian
    ? [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]]
    : [[1000000000, "Billion"], [1000000, "Million"], [1000, "Thousand"]];
  const parts: string[] = [];
  let rem = Math.abs(Math.round(n));
  if (rem === 0) return "Zero";
  for (const [div, name] of units) {
    const q = Math.floor(rem / div);
    if (q) {
      parts.push(`${three(q)} ${name}`);
      rem %= div;
    }
  }
  if (rem) parts.push(three(rem));
  const word = currency === "INR" ? "Rupees" : currency === "USD" ? "US Dollars" : currency === "EUR" ? "Euros" : currency;
  return `${parts.join(" ")} ${word} Only`;
}

/** "2026-07-09" → "09 July 2026" (falls back to the raw value). */
export function prettyDate(v?: string): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

/** Quote terms split into list items (typed numbering stripped — the list numbers). */
export function termsList(terms?: string): string[] {
  const own = (terms || "")
    .split("\n")
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
  return own.length ? own : DEFAULT_TERMS;
}

/* Logo as a data URL for pdfmake (fetched once, cached). Chunked btoa keeps
   the 90KB PNG off the call stack. */
let logoPromise: Promise<string> | null = null;
export function logoDataUrl(): Promise<string> {
  if (!logoPromise) {
    logoPromise = fetch(boffoLogo)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return `data:image/png;base64,${btoa(bin)}`;
      });
  }
  return logoPromise;
}
