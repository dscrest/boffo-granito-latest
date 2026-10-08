/* Sample Orders (CR-315/316) — the pure maths behind a sample order:
   what remains to supply per line and the header status DERIVED from the
   lines. Mirrors the server `sampleStatus` in /sample-order-supply — keep
   the two together. */
export const SAMPLE_STATUSES = ["New", "PartiallySupplied", "Supplied"] as const;
export type SampleOrderStatus = (typeof SAMPLE_STATUSES)[number];

export interface SupplyLine {
  qty: number; // requested
  suppliedQty: number; // supplied so far
}

/** Pieces still to supply on one line (never negative). */
export const remaining = (l: SupplyLine): number => Math.max(0, (l.qty || 0) - (l.suppliedQty || 0));

/** Every line fully supplied → Supplied; any piece supplied → PartiallySupplied; else New. */
export function deriveSampleStatus(lines: SupplyLine[]): SampleOrderStatus {
  let any = false;
  let all = lines.length > 0;
  for (const l of lines) {
    if ((l.suppliedQty || 0) > 0) any = true;
    if ((l.suppliedQty || 0) < (l.qty || 0)) all = false;
  }
  return all ? "Supplied" : any ? "PartiallySupplied" : "New";
}
