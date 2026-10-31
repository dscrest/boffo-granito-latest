/* ============================================================
   EAN-13 (CR-502) — the customer's own item barcode on box labels.
   Pure + dependency-free so ean13.check.ts runs under plain Node;
   the pdfmake drawing lives in features/labels/labelLayouts.ts.
   ponytail: EAN-13 only. Batch-level scanning (GS1-128 (01)+(10))
   would need bwip-js — add it when an importer asks for it.
   ============================================================ */

/** L-set (odd parity) bit patterns, digit 0…9. R = complement of L, G = R reversed. */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));
/** Left-half parity per leading digit (L = odd, G = even). */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Check digit for the first 12 digits (weights 1,3,1,3… from the left). */
export function ean13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** 13 digits with a valid check digit. */
export function isEan13(s: string): boolean {
  return /^\d{13}$/.test(s) && ean13Check(s.slice(0, 12)) === Number(s[12]);
}

/** The 95 modules ("1" = bar) of a valid code: guard · 6 left · centre · 6 right · guard. */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new Error(`Not a valid EAN-13: ${code}`);
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let out = "101";
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === "L" ? L : G)[d[i]];
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R[d[i]];
  return out + "101";
}
