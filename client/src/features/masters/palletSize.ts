/* Pallet ↔ item size matching — pure, so palletSize.check.ts runs under node. */

/** Leading dimension of a size string ("300x600 - GVT…" / "300x300" → "300"). */
export const widthOf = (s: string): string => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

/** Full "WxH" of a size string ("600x1200 - GVT…" → "600x1200"); "" when it has no height. */
export const dimsOf = (s: string): string => {
  const m = String(s || "").match(/^\s*(\d+)\s*[x×]\s*(\d+)/i);
  return m ? `${m[1]}x${m[2]}` : "";
};

/** Pallet specs offered for an item = those of the item's exact size
    (600x1200 ≠ 600x600); falls back to the width when either side carries no
    height, and size-less pallets always match. Shared by the SO form, the plan
    form and the Palletise dialog. */
export function palletsForSize<P extends { sizeId: string; sizeLabel: string }>(pallets: P[], sizeCode: string): P[] {
  const w = widthOf(sizeCode);
  const d = dimsOf(sizeCode);
  return pallets.filter((p) => {
    if (!p.sizeId) return true;
    const pd = dimsOf(p.sizeLabel);
    if (d && pd) return pd === d;
    const pw = widthOf(p.sizeLabel);
    return !w || !pw || pw === w;
  });
}
