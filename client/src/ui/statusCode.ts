/* Grid Status columns render codeOf(label) with title={label} — short codes
   keep the column narrow; hover shows the full name. Detail-page HEADER chips
   keep full labels (codes are a grid-density thing). Codes are unique within
   any one grid's value set; reuse across unrelated grids is fine. */
const CODE: Record<string, string> = {
  // Quotes / Sales Orders
  draft: "DR",
  "pending approval": "PA",
  approved: "AP",
  sent: "ST",
  accepted: "AC",
  rejected: "RJ",
  converted: "CV",
  partial: "PC", // PartiallyConverted display label
  "in progress": "IP",
  cancelled: "CN",
  // Shipping stage / palletization / loading
  dispatched: "DSP",
  "partially dispatched": "PD",
  "partially completed": "PCO", // PC is PartiallyConverted
  "in loading": "IL",
  "ready for loading": "RFL",
  "partially palletized": "PP",
  "ready for palletization": "RFP",
  "in palletization": "INP",
  "palletization completed": "PCM",
  "in dispatch": "IND",
  "ready for dispatch": "RFD",
  empty: "EMP",
  planned: "PL",
  loading: "LDG",
  sealed: "SL",
  palletised: "PLT",
  loaded: "LD",
  "on hand": "OH",
  // Supply (production-first, CR-200)
  allocated: "ALC",
  "stock ready": "SR",
  "partial stock": "PSK",
  "need production": "NP",
  // Production
  "new request": "NR",
  "in production": "IPR",
  qc: "QC",
  completed: "CMP",
  produced: "PRD",
  // Panels
  received: "RCV",
  "in cutting": "IC",
  ready: "RDY",
  // Masters / admin / ops / QC
  active: "ACT",
  inactive: "INA",
  disabled: "DIS",
  success: "OK",
  error: "ERR",
  pass: "PS",
  passed: "PS",
  fail: "FL",
  failed: "FL",
  pending: "PN",
};

/** Short grid code for a status label; render with title={label}. */
export function codeOf(label: string): string {
  const base = String(label || "").split(" — ")[0].trim(); // "Partially Dispatched — 40 left" → base
  const hit = CODE[base.toLowerCase()];
  if (hit) return hit;
  const words = base.split(/\s+/).filter(Boolean); // ponytail: auto-initials fallback for unmapped vocab
  return (words.length > 1 ? words.map((w) => w[0]).join("") : base.slice(0, 3)).toUpperCase();
}
