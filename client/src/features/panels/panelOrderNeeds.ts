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
   CR-313 adds the production checkpoints + derived readiness (four since CR-323).
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
  panelId: string; // "" = a loose cut-piece line (CR-346)
  qty: number;
  /** CR-346: loose cut-piece line — design + cut size, no panel, one piece per unit. */
  designId?: string;
  cutSizeId?: string;
  designName?: string;
  cutSizeName?: string;
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
  for (const line of lines) {
    const { panelId, qty } = line;
    const panel = panelsById.get(panelId);
    // CR-346: a cut-piece line needs its own pieces; a panel line needs the pieces ON the panel.
    const pieces = panelId
      ? panel?.lines ?? []
      : line.designId && line.cutSizeId
        ? [{ designId: line.designId, cutSizeId: line.cutSizeId, designName: line.designName || "", cutSizeName: line.cutSizeName || "", qty: 1 }]
        : [];
    for (const l of pieces) {
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
      else cur.panels.push({ panelId, panelCode: panel?.panelCode ?? "Cut piece", qty: l.qty * qty });
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
  orders: { id: string; orderNumber: string; need: number }[]; // need = this order's pieces of this cut piece
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
      cur.orders.push({ id: o.id, orderNumber: o.orderNumber, need: r.need });
      rows.set(r.key, cur);
    }
  }
  for (const k of allKeys) if (!rows.has(k)) rows.set(k, blank(k));
  for (const r of rows.values()) r.shortage = Math.max(0, r.required - r.onHand);
  return [...rows.values()];
}

/* ---- CR-313: production checkpoints ---- */
export type CheckpointKey = "mdf" | "vinyl" | "cut" | "pasted";
export const CHECKPOINT_KEYS: readonly CheckpointKey[] = ["mdf", "vinyl", "cut", "pasted"];
export const CHECKPOINT_LABEL: Record<CheckpointKey, string> = { mdf: "MDF", vinyl: "Vinyl Printing", cut: "Cut Pieces", pasted: "Vinyl Pasted on MDF" };
/** Mirrors the server CHECKPOINTS — any direction, the spec's exact words. CR-323 adds `pasted`. */
export const CHECKPOINT_STATUSES: Record<CheckpointKey, readonly string[]> = {
  mdf: ["Pending", "Ordered", "Received", "Ready"],
  vinyl: ["Pending", "Printing", "Ready"],
  cut: ["Pending", "Ready"],
  pasted: ["Pending", "Ready"],
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
/** CR-344: "1200x2400 · 8 mm" for the MDF master row a line picked, "" when none. */
export function mdfLabel(m: { label: string } | undefined): string {
  return m?.label ?? "";
}

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

/* ============================================================
   CR-347: LOADING ENTRIES — an order ships in parts on several vehicles.
   Materials: a Panel line ships its "Panel" (the cut pieces) and, when a
   board is picked, its "Mdf"; a cut-piece line (CR-346) and a sample line
   ship as "Item". Progress per line × material is DERIVED from the loads;
   Loading Status and the Dispatched flip follow from it (never stored here).
   ============================================================ */
export type Material = "Panel" | "Mdf" | "Item";
export const MATERIAL_LABEL: Record<Material, string> = { Panel: "Panel", Mdf: "MDF", Item: "Cut piece" };
export interface LoadLineIn {
  lineId: string; // PanelOrderLine / SampleOrderLine ROWID
  material: Material;
  qty: number;
  /** CR-349: kg stamped when it left — null when the master had no weight then. */
  weightKg: number | null;
}
export interface LoadIn {
  id: string;
  lines: LoadLineIn[];
}
export interface ProgressRow {
  lineId: string;
  material: Material;
  ordered: number;
  loaded: number;
  pending: number;
}
export type LoadingStatus = "Not loaded" | "Partially loaded" | "Loaded";
export const LOADING_STATUSES: readonly LoadingStatus[] = ["Not loaded", "Partially loaded", "Loaded"];

type LoadableLine = { id: string; qty: number; panelId?: string; mdfId?: string };

/** Which materials a line ships — mirrors the server panelLineMaterials. */
export function lineMaterials(l: { panelId?: string; mdfId?: string }): Material[] {
  if (l.panelId) return l.mdfId ? ["Panel", "Mdf"] : ["Panel"];
  return ["Item"];
}

/** Σ loaded per line × material over the given loads. */
function loadedMap(loads: LoadIn[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const ld of loads) for (const l of ld.lines) m.set(`${l.lineId}|${l.material}`, (m.get(`${l.lineId}|${l.material}`) ?? 0) + l.qty);
  return m;
}

/** One row per line × material: ordered · loaded · pending. */
export function loadProgress(lines: LoadableLine[], loads: LoadIn[]): ProgressRow[] {
  const loaded = loadedMap(loads);
  const rows: ProgressRow[] = [];
  for (const l of lines)
    for (const material of lineMaterials(l)) {
      const got = loaded.get(`${l.id}|${material}`) ?? 0;
      rows.push({ lineId: l.id, material, ordered: l.qty, loaded: got, pending: Math.max(0, l.qty - got) });
    }
  return rows;
}

/** Derived, never stored. A legacy Dispatched / Supplied order with no loads counts as Loaded. */
export function loadingStatus(rows: ProgressRow[], orderStatus = ""): LoadingStatus {
  if (orderStatus === "Dispatched" || orderStatus === "Supplied") return "Loaded";
  if (rows.length > 0 && rows.every((r) => r.pending === 0)) return "Loaded";
  if (rows.some((r) => r.loaded > 0)) return "Partially loaded";
  return "Not loaded";
}

/** "3 panels · 2 MDF · 5 pcs" — what is still pending; "" when nothing. */
export function pendingText(rows: ProgressRow[]): string {
  const sum = (m: Material) => rows.filter((r) => r.material === m).reduce((s, r) => s + r.pending, 0);
  const p = sum("Panel");
  const b = sum("Mdf");
  const i = sum("Item");
  return [p > 0 && `${p} panel${p === 1 ? "" : "s"}`, b > 0 && `${b} MDF`, i > 0 && `${i} pcs`].filter(Boolean).join(" · ");
}

/** The need lines with qty = what is still PENDING (Panel / Item material) — feed these to
    requirementsFor / demandByKey so a partial load shrinks the need instead of raising toCut. */
export function pendingNeedLines<T extends NeedLine & { id: string; mdfId?: string }>(lines: T[], loads: LoadIn[]): NeedLine[] {
  const loaded = loadedMap(loads);
  return lines.map((l) => {
    const m: Material = l.panelId ? "Panel" : "Item";
    return { ...l, qty: Math.max(0, l.qty - (loaded.get(`${l.id}|${m}`) ?? 0)) };
  });
}

/** CR-349: one panel's weight split — cut pieces vs the board; null parts stay null. */
export function panelWeightSplit(
  panel: { lines: { designId: string; cutSizeId: string; qty: number }[] },
  weightOf: Map<string, number | null | undefined>,
  mdfWeightKg: number | null | undefined,
): { pieces: number | null; mdf: number | null } {
  let pieces: number | null = 0;
  for (const l of panel.lines) {
    const w = weightOf.get(stockKey(l.designId, l.cutSizeId));
    if (w == null) {
      pieces = null;
      break;
    }
    pieces += w * l.qty;
  }
  return { pieces: pieces == null ? null : Math.round(pieces * 1000) / 1000, mdf: mdfWeightKg ?? null };
}

/** CR-349: a line's weight = what already SHIPPED (stamped on its load lines, frozen) + what is
    still pending × the LIVE unit weight. A legacy Dispatched order with no loads reads live. */
export function lineWeightSplit(
  line: LoadableLine,
  loads: LoadIn[],
  liveUnit: { pieces: number | null; mdf: number | null },
): { pieces: number | null; mdf: number | null } {
  const part = (material: Material, unit: number | null): number | null => {
    let shipped = 0;
    let shippedQty = 0;
    for (const ld of loads)
      for (const l of ld.lines) {
        if (l.lineId !== line.id || l.material !== material) continue;
        if (l.weightKg == null) return null;
        shipped += l.weightKg;
        shippedQty += l.qty;
      }
    const pending = Math.max(0, line.qty - shippedQty);
    if (pending > 0 && unit == null) return null;
    return Math.round((shipped + pending * (unit ?? 0)) * 1000) / 1000;
  };
  const mats = lineMaterials(line);
  return {
    pieces: part(mats.includes("Panel") ? "Panel" : "Item", liveUnit.pieces),
    mdf: mats.includes("Mdf") ? part("Mdf", liveUnit.mdf) : null,
  };
}
