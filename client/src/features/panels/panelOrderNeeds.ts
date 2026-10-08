/* ============================================================
   Panel-order cut-piece requirements (CR-302) — pure, no React/network,
   so the self-check beside it runs with plain tsx. One order = several
   panel lines; the need per (design, cut size) is summed across them:
     need = Σ panelLine.qty × orderLine.qty
   and compared with on-hand CutPieceStock keyed stockKey(design, cutSize).
   CR-312 adds BOOKING: `allocation` (this order's booked pieces, a claim
   on on-hand) and `booked` (Σ every open order's booking) give
     free  = onHand − Σ booked          (what any order may still book)
     toCut = need − allocated − free    (what must still be cut for THIS order)
   CR-313 adds the three production checkpoints + derived readiness.
   Used by the form preview, the detail checklist, the board hints, the
   Pending Cut Stock page and the dashboard.
   ============================================================ */
import type { PanelRow } from "./panelsApi";

export const stockKey = (designId: string, cutSizeId: string) => `${designId}|${cutSizeId}`;

/** Lifecycle stages whose booking counts (mirrors the server PANEL_ORDER_OPEN). */
export const PANEL_ORDER_OPEN: ReadonlySet<string> = new Set(["Received", "InCutting", "Ready"]);

/** Pieces booked to an order, keyed stockKey(design, cutSize) (CR-312). */
export type Allocation = Record<string, number>;

/** One requirements-checklist row — also the checklist tick key (CR-288). */
export interface Requirement {
  key: string; // stockKey(design, cutSize)
  designId: string;
  cutSizeId: string;
  designName: string;
  cutSizeName: string;
  need: number;
  have: number; // on hand, module-wide
  short: boolean; // need > have (the pre-booking signal, still used by the chip title)
  /** CR-312: booked to THIS order. */
  allocated: number;
  /** CR-312: on hand not booked by ANY open order — what may still be booked. */
  free: number;
  /** CR-312: what must still be cut for this order = max(0, need − allocated − free). */
  toCut: number;
  /** CR-303: which panels this row serves and their share of `need`. */
  panels: { panelId: string; panelCode: string; qty: number }[];
}
export type Shortage = Requirement;

export interface NeedLine {
  panelId: string;
  qty: number;
}

export interface NeedOpts {
  /** This order's booking (PanelOrder.allocation). */
  allocation?: Allocation;
  /** Σ booking over every open order (allocatedByKey) — including this order's. */
  booked?: Map<string, number>;
}

/** Every cut-piece requirement of these lines vs stock (unknown panels are skipped). */
export function requirementsFor(lines: NeedLine[], panelsById: Map<string, PanelRow>, stock: Map<string, number>, opts: NeedOpts = {}): Requirement[] {
  const acc = new Map<string, Requirement>();
  for (const { panelId, qty } of lines) {
    const panel = panelsById.get(panelId);
    for (const l of panel?.lines ?? []) {
      const key = stockKey(l.designId, l.cutSizeId);
      const have = stock.get(key) ?? 0;
      const cur = acc.get(key) ?? {
        key,
        designId: l.designId,
        cutSizeId: l.cutSizeId,
        designName: l.designName,
        cutSizeName: l.cutSizeName,
        need: 0,
        have,
        short: false,
        allocated: opts.allocation?.[key] ?? 0,
        free: Math.max(0, have - (opts.booked?.get(key) ?? 0)),
        toCut: 0,
        panels: [],
      };
      cur.need += l.qty * qty;
      cur.short = cur.need > cur.have;
      cur.toCut = Math.max(0, cur.need - cur.allocated - cur.free);
      const share = cur.panels.find((p) => p.panelId === panelId);
      if (share) share.qty += l.qty * qty;
      else cur.panels.push({ panelId, panelCode: panel!.panelCode, qty: l.qty * qty });
      acc.set(key, cur);
    }
  }
  return [...acc.values()];
}

/** CR-312: Σ booking per key over every OPEN order (Dispatched rows drop out). */
export function allocatedByKey(orders: { status: string; allocation: Allocation }[]): Map<string, number> {
  const sum = new Map<string, number>();
  for (const o of orders) {
    if (!PANEL_ORDER_OPEN.has(o.status)) continue;
    for (const [k, q] of Object.entries(o.allocation)) if (q > 0) sum.set(k, (sum.get(k) ?? 0) + q);
  }
  return sum;
}

/** CR-312: the Pending Cut Stock row — module-wide demand vs stock per cut piece. */
export interface DemandRow {
  key: string;
  designId: string;
  cutSizeId: string;
  designName: string; // "" when no order names it (stock-only row)
  cutSizeName: string;
  required: number; // Σ need over open orders (every stage but Dispatched)
  onHand: number;
  allocated: number; // Σ booked by open orders
  free: number; // onHand − allocated
  shortage: number; // max(0, required − onHand) — what the godown must still cut
  orders: { id: string; orderNumber: string }[];
}

/** Every open order's demand per cut piece, plus every stock key in `allKeys` (zero-stock items show up too). */
export function demandByKey(
  orders: { id: string; orderNumber: string; status: string; lines: NeedLine[]; allocation: Allocation }[],
  panelsById: Map<string, PanelRow>,
  stock: Map<string, number>,
  allKeys: Iterable<string> = [],
): DemandRow[] {
  const booked = allocatedByKey(orders);
  const rows = new Map<string, DemandRow>();
  const blank = (key: string): DemandRow => {
    const [designId, cutSizeId] = key.split("|");
    const onHand = stock.get(key) ?? 0;
    const allocated = booked.get(key) ?? 0;
    return { key, designId, cutSizeId, designName: "", cutSizeName: "", required: 0, onHand, allocated, free: Math.max(0, onHand - allocated), shortage: 0, orders: [] };
  };
  for (const o of orders) {
    if (o.status === "Dispatched") continue;
    for (const r of requirementsFor(o.lines, panelsById, stock)) {
      const cur = rows.get(r.key) ?? blank(r.key);
      cur.designName = r.designName;
      cur.cutSizeName = r.cutSizeName;
      cur.required += r.need;
      cur.orders.push({ id: o.id, orderNumber: o.orderNumber });
      rows.set(r.key, cur);
    }
  }
  for (const k of allKeys) if (!rows.has(k)) rows.set(k, blank(k));
  for (const r of rows.values()) r.shortage = Math.max(0, r.required - r.onHand);
  return [...rows.values()];
}

/* ---- CR-313: production checkpoints ---- */
export type CheckpointKey = "mdf" | "vinyl" | "cut";
export const CHECKPOINT_KEYS: readonly CheckpointKey[] = ["mdf", "vinyl", "cut"];
export const CHECKPOINT_LABEL: Record<CheckpointKey, string> = { mdf: "MDF", vinyl: "Vinyl Printing", cut: "Cut Pieces" };
/** Mirrors the server CHECKPOINTS — any direction, the spec's exact words. */
export const CHECKPOINT_STATUSES: Record<CheckpointKey, readonly string[]> = {
  mdf: ["Pending", "Ordered", "Received", "Ready"],
  vinyl: ["Pending", "Printing", "Ready"],
  cut: ["Pending", "Ready"],
};
export interface CheckpointMark {
  status: string;
  by: string;
  at: string; // "yyyy-MM-dd HH:mm:ss"
}
export type Checkpoints = Partial<Record<CheckpointKey, CheckpointMark>>;
export type Readiness = "Pending" | "In Progress" | "Ready for Production" | "—";

export const checkpointStatus = (cp: Checkpoints, key: CheckpointKey): string => cp[key]?.status || "Pending";

/** Overall readiness — derived, never stored: all Ready → Ready for Production; any mark → In Progress. */
export function readiness(cp: Checkpoints, orderStatus: string): Readiness {
  if (orderStatus === "Dispatched") return "—";
  const sts = CHECKPOINT_KEYS.map((k) => checkpointStatus(cp, k));
  if (sts.every((s) => s === "Ready")) return "Ready for Production";
  if (sts.some((s) => s !== "Pending")) return "In Progress";
  return "Pending";
}

/** CR-309: one panel's weight (kg) = Σ cut-piece weight × pieces on it + the MDF it
    is mounted on. `weightOf` is keyed stockKey(design, cutSize) with the stored
    weight_kg; null/undefined for any piece = unknown → the whole panel is unknown
    (the form says "set weight on Panel Items" rather than under-reporting). */
export function panelWeight(
  panel: { lines: { designId: string; cutSizeId: string; qty: number }[] },
  weightOf: Map<string, number | null | undefined>,
  mdfWeightKg: number | null | undefined,
): number | null {
  let total = 0;
  for (const l of panel.lines) {
    const w = weightOf.get(stockKey(l.designId, l.cutSizeId));
    if (w == null) return null;
    total += w * l.qty;
  }
  if (mdfWeightKg != null) total += mdfWeightKg;
  return Math.round(total * 1000) / 1000;
}

/** Cut pieces these lines still lack — [] means stock fully covers them. */
export function shortagesFor(lines: NeedLine[], panelsById: Map<string, PanelRow>, stock: Map<string, number>, opts: NeedOpts = {}): Shortage[] {
  return requirementsFor(lines, panelsById, stock, opts).filter((r) => r.short);
}
