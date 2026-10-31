/* ============================================================
   Panel Craft pricing (CR-504) — pure, the one owner of the formula.
   A panel = Vinyl (vinyl sqft × the panel's Vinyl Rate/sqft) + MDF (board
   kg × the MDF row's Rate/kg) + Cut pieces (Σ piece sqft × the Item's
   Rate/sqft × pcs). A loose cut piece / sample piece = sqft × Item rate.
   The order form computes these DEFAULTS and the line stores them (frozen,
   editable); a master change never rewrites a saved line. A missing rate
   or an unparseable size prices at 0. No API import (self-check runs under tsx).
   Self-check: panelPrice.test.ts
   ============================================================ */
import { parseCutSize } from "./cutPieceWeight";

/** 1 sqft = 92 903.04 mm². */
const MM2_PER_SQFT = 92903.04;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PriceItem {
  ratePerSqft: number;
  widthMm: number;
  lengthMm: number;
  sizeLabel: string;
}

/** sqft of one piece named `name` ("600x300"); blank / the item's own size code = the full tile. null = unknown. */
export function pieceSqft(name: string, item?: PriceItem): number | null {
  const s = parseCutSize(name);
  if (s) return (s.w * s.h) / MM2_PER_SQFT;
  const full = !name.trim() || (!!item && name.trim() === item.sizeLabel.trim());
  return full && item && item.widthMm > 0 && item.lengthMm > 0 ? (item.widthMm * item.lengthMm) / MM2_PER_SQFT : null;
}

/** ₹ of ONE piece of `item` cut at `cutName` — 0 when the item has no rate or the size reads as nothing. */
export function piecePrice(item: PriceItem | undefined, cutName: string): number {
  const sq = pieceSqft(cutName, item);
  return item && sq != null ? round2(sq * (item.ratePerSqft || 0)) : 0;
}

export interface PricePanel {
  vinylSize: string;
  panelSize: string;
  vinylRateSqft: number;
  lines: { designId: string; cutSizeName: string; qty: number }[];
}

/** Vinyl Size sqft (Panel Size when blank) × the panel's Vinyl Rate/sqft. */
export function vinylPrice(p: PricePanel): number {
  const s = parseCutSize(p.vinylSize) ?? parseCutSize(p.panelSize);
  return s ? round2(((s.w * s.h) / MM2_PER_SQFT) * (p.vinylRateSqft || 0)) : 0;
}

/** One board: weight × Rate/kg. */
export function mdfPrice(m: { weightKg: number | null; ratePerKg: number } | undefined): number {
  return m ? round2((m.weightKg ?? 0) * (m.ratePerKg || 0)) : 0;
}

/** Every cut piece on one panel: Σ piece price × pcs. */
export function piecesPrice(p: PricePanel, itemOf: (designId: string) => PriceItem | undefined): number {
  return round2(p.lines.reduce((s, l) => s + piecePrice(itemOf(l.designId), l.cutSizeName) * l.qty, 0));
}

export type PriceParts = { vinyl: number; mdf: number; pieces: number };

/** The three defaults of ONE panel on a line (MDF = the thickness picked; none = 0). */
export function panelPriceParts(
  p: PricePanel,
  mdf: { weightKg: number | null; ratePerKg: number } | undefined,
  itemOf: (designId: string) => PriceItem | undefined,
): PriceParts {
  return { vinyl: vinylPrice(p), mdf: mdfPrice(mdf), pieces: piecesPrice(p, itemOf) };
}

/** A stored line: the three frozen parts (₹ per ONE panel / piece); all null = saved before pricing. */
export interface PricedLine {
  vinylPrice: number | null;
  mdfPrice: number | null;
  piecesPrice: number | null;
  qty: number;
}

/** ₹ per one panel / piece, or null when the line was never priced. */
export function lineRate(l: PricedLine): number | null {
  if (l.vinylPrice == null && l.mdfPrice == null && l.piecesPrice == null) return null;
  return round2((l.vinylPrice ?? 0) + (l.mdfPrice ?? 0) + (l.piecesPrice ?? 0));
}

export function lineAmount(l: PricedLine): number | null {
  const r = lineRate(l);
  return r == null ? null : round2(r * l.qty);
}

/** Σ line amounts; null when any line is unpriced (a legacy order reads "—", never a partial sum). */
export function orderAmount(lines: { amount: number | null }[]): number | null {
  if (!lines.length || lines.some((l) => l.amount == null)) return null;
  return round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
}
