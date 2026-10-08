/* ============================================================
   Cut-piece weight (CR-306) — pure. A cut piece's default weight is the
   item's weight per piece (box weight ÷ pcs per box, the CR-190 formula)
   scaled by the cut's share of the full tile face when the cut size name
   reads as "W x H" (mm) and the Size has dimensions. Anything unparseable
   = the full piece. It is only a DEFAULT — the stored weight_kg wins.
   Self-check: cutPieceWeight.test.ts
   ============================================================ */
export interface WeightSource {
  boxWeightKg: number;
  pcsPerBox: number;
  widthMm: number;
  lengthMm: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** kg per full piece, or null when the item has no box weight / pcs per box. */
export function weightPerPc(d: WeightSource): number | null {
  return d.boxWeightKg > 0 && d.pcsPerBox > 0 ? round3(d.boxWeightKg / d.pcsPerBox) : null;
}

/** "600x600", "600 X 300", "300×600" → { w, h } in mm; null otherwise. */
export function parseCutSize(name: string): { w: number; h: number } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*$/.exec(name || "");
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Default weight (kg) of one cut piece of `d` at `cutName`; null when the item carries no weight. */
export function cutPieceWeight(d: WeightSource, cutName: string): number | null {
  const pc = weightPerPc(d);
  if (pc == null) return null;
  const cut = parseCutSize(cutName);
  const full = d.widthMm * d.lengthMm;
  if (!cut || !(full > 0)) return pc;
  // Orientation-free: 600x300 and 300x600 are the same piece. Never above a full tile.
  const ratio = Math.min(1, (cut.w * cut.h) / full);
  return round3(pc * ratio);
}
