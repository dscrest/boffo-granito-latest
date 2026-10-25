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
   CR-313 adds the production checkpoints (four since CR-323; CR-376: mdf / vinyl /
   pasted per PANEL under `checkpoints.panels`, cut order-level); CR-367 derives ONE
   progress state from them + the booking + the loads (panelProgress) and CR-365
   says per line × material what is ready / missing (materialReadiness).
   Used by the form preview, the detail checklist, the board hints, the
   Pending Cut Stock page and the dashboard.
   ============================================================ */
import type { PanelRow } from "./panelsApi";

export const stockKey = (designId: string, cutSizeId: string) => `${designId}|${cutSizeId}`;

/** Lifecycle stages whose booking counts (mirrors the server PANEL_ORDER_OPEN). */
export const PANEL_ORDER_OPEN: ReadonlySet<string> = new Set(["NewRequest", "Received", "InCutting", "Ready"]); // CR-400: workable from birth

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
    // CR-346: a cut-piece line needs its own pieces; a panel line needs the pieces ON the panel;
    // CR-405: a panel line naming ONE piece kind (pendingNeedLines) needs that kind only, one per unit.
    const one = line.designId && line.cutSizeId ? [{ designId: line.designId, cutSizeId: line.cutSizeId, designName: line.designName || "", cutSizeName: line.cutSizeName || "", qty: 1 }] : [];
    const pieces = panelId && !one.length ? panel?.lines ?? [] : one;
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
    if (o.status === "Dispatched" || o.status === "Cancelled") continue; // CR-368: a cancelled order needs nothing
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
/** CR-376: MDF · Vinyl · Pasted are marked PER PANEL (`panels[panelId]`, a panel sits on one line
    per order); `cut` stays order-level. The order-level mdf/vinyl/pasted keys are legacy (CR-313…366)
    and act as the fallback for a panel without its own mark — no migration. */
export type LineCheckpointKey = Exclude<CheckpointKey, "cut">;
export const LINE_CHECKPOINT_KEYS: readonly LineCheckpointKey[] = ["mdf", "vinyl", "pasted"];
export type Checkpoints = Partial<Record<CheckpointKey, CheckpointMark>> & {
  panels?: Record<string, Partial<Record<LineCheckpointKey, CheckpointMark>>>;
};

export const checkpointStatus = (cp: Checkpoints, key: CheckpointKey): string => cp[key]?.status || "Pending";

/** CR-376: the mark for one panel — its own, else the legacy order-level one. */
export const lineCheckpointMark = (cp: Checkpoints, panelId: string, key: LineCheckpointKey): CheckpointMark | undefined => cp.panels?.[panelId]?.[key] ?? cp[key];
export const lineCheckpoint = (cp: Checkpoints, panelId: string, key: LineCheckpointKey): string => lineCheckpointMark(cp, panelId, key)?.status || "Pending";
/** CR-432: the optimistic copy the Actions tab shows while a mark is saving (by/at blank until the server answers). */
export const withLineMark = (cp: Checkpoints, panelId: string, key: LineCheckpointKey, status: string): Checkpoints => ({
  ...cp,
  panels: { ...cp.panels, [panelId]: { ...cp.panels?.[panelId], [key]: { status, by: "", at: "" } } },
});

/** CR-366: Vinyl Pasted on MDF may be Ready only once MDF and Vinyl Printing are (mirrors the server). CR-376: per panel. */
export const pastedAllowed = (cp: Checkpoints, panelId: string): boolean => lineCheckpoint(cp, panelId, "mdf") === "Ready" && lineCheckpoint(cp, panelId, "vinyl") === "Ready";
// CR-431: vinylAllowed (CR-401) is gone — MDF and Vinyl are marked independently; only Pasted waits for both.

/** CR-400: the ONE status a panel order shows — derived, never stored, no buttons.
    New = some panel still lacks MDF · Vinyl · Pasted; Ready = every panel pasted;
    Completed = Ready AND every cut piece booked; Dispatched / Cancelled = the stored stage.
    The lifecycle column (NewRequest … Ready) is dormant — only Dispatched / Cancelled matter. */
export type PanelProgress = "New" | "Ready" | "Completed" | "Dispatched" | "Cancelled";
export const PROGRESS_STATES: readonly PanelProgress[] = ["New", "Ready", "Completed", "Dispatched", "Cancelled"];

/** `reqs` = requirementsFor(pendingNeedLines(…)) with this order's allocation. */
export function panelProgress(o: { status: string; checkpoints: Checkpoints; lines: { panelId: string }[] }, reqs: Pick<Requirement, "need" | "allocated">[]): PanelProgress {
  if (o.status === "Cancelled") return "Cancelled";
  if (o.status === "Dispatched") return "Dispatched";
  // CR-376: mdf / vinyl / pasted are read per panel line (cut-piece lines carry none); the order-level `cut` mark is dormant.
  const pasted = o.lines.filter((l) => l.panelId).every((l) => LINE_CHECKPOINT_KEYS.every((k) => lineCheckpoint(o.checkpoints, l.panelId, k) === "Ready"));
  if (!pasted) return "New";
  return reqs.every((r) => r.allocated >= r.need) ? "Completed" : "Ready";
}

/** CR-365: is this line × material ready to ship, and if not, what is missing (Actions tab,
    Record Load, mirrored by the server /panel-load-save gate — CR-381).
    CR-403 (reverses the CR-380/383 pieces gate): an MDF board ships once the vinyl is PASTED
    on it (pasted implies mdf + vinyl); a panel's cut pieces and a loose cut piece ship once
    BOOKED — no mark gates them, so pieces, boards or both can go on any trip. */
export function materialReadiness(
  row: Pick<ProgressRow, "material"> & Partial<Pick<ProgressRow, "designId" | "cutSizeId">>,
  line: { panelId?: string; designId?: string; cutSizeId?: string },
  cp: Checkpoints,
  reqs: Requirement[],
): { ready: boolean; missing: string[] } {
  if (row.material === "Mdf") {
    const ok = lineCheckpoint(cp, line.panelId ?? "", "pasted") === "Ready"; // boards are not stock
    return { ready: ok, missing: ok ? [] : ["Not pasted on MDF"] };
  }
  const missing: string[] = [];
  // ponytail: Requirement.need is summed over the order's lines, so "book N more" is the
  // order-level gap for the pieces this row uses, not a per-line share.
  // CR-405: an Item row names its piece kind (a panel's piece row or a loose line); a legacy
  // whole-Panel row falls back to every piece the panel uses.
  const key = row.designId && row.cutSizeId ? stockKey(row.designId, row.cutSizeId) : line.designId && line.cutSizeId ? stockKey(line.designId, line.cutSizeId) : "";
  const mine = key ? reqs.filter((r) => r.key === key) : reqs.filter((r) => r.panels.some((p) => p.panelId === line.panelId));
  const toCut = mine.reduce((s, r) => s + r.toCut, 0);
  const unbooked = mine.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  if (toCut > 0) missing.push(`Cut ${toCut} more`);
  else if (unbooked > 0) missing.push(`Book ${unbooked} more pcs`);
  return { ready: missing.length === 0, missing };
}

/* ---- CR-404: per-line readiness stages (Readiness tab) ---- */
export const READINESS_STAGES = ["MDF", "Vinyl", "Pasted", "Cut pieces", "Weighed", "Loaded"] as const;
export interface ReadinessStage {
  name: string;
  done: boolean;
  /** false on a loose cut-piece line for the three panel marks (no board, no vinyl) — counted done. */
  applicable: boolean;
}
/** CR-404: the six stages of one panel-order line, in the order the godown works them.
    MDF · Vinyl · Pasted = that panel's marks (CR-376); Cut pieces = booked (`materialReadiness`, CR-403);
    Weighed = the page knows the line's kg (`lineWeight`); Loaded = every material of the line has left.
    A line is READY TO LOAD once the first five are done; Loaded is the sixth ring on the tab. */
export function lineStages(
  line: { id: string; qty: number; panelId: string; mdfId?: string; designId?: string; cutSizeId?: string },
  order: { checkpoints: Checkpoints; loads: LoadIn[] },
  reqs: Requirement[],
  weightKnown: boolean,
  panelsById: PanelPieces,
): ReadinessStage[] {
  const panel = !!line.panelId;
  const mark = (name: string, k: LineCheckpointKey): ReadinessStage => ({ name, done: !panel || lineCheckpoint(order.checkpoints, line.panelId, k) === "Ready", applicable: panel });
  const progress = loadProgress([line], order.loads, panelsById);
  // CR-405: every piece row of the line is either gone (loaded, booked or not) or ready to go.
  const piecesDone = progress.filter((r) => r.material === "Item").every((r) => r.pending === 0 || materialReadiness(r, line, order.checkpoints, reqs).ready);
  return [
    mark("MDF", "mdf"),
    mark("Vinyl", "vinyl"),
    mark("Pasted", "pasted"),
    { name: "Cut pieces", done: piecesDone, applicable: true },
    { name: "Weighed", done: weightKnown, applicable: true },
    { name: "Loaded", done: progress.every((r) => r.pending === 0), applicable: true },
  ];
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
   CR-405: a load line is ONE CUT PIECE KIND of a line (material "Item",
   keyed design|cutSize — a panel line has one row per piece kind on the
   panel, a loose cut-piece line one row) or the line's board ("Mdf" —
   CR-406: every panel line has one, thickness picked or not). Legacy load
   lines with material "Panel" (whole panels, CR-347…403) are READ as
   qty × pcs under every piece key of that panel; nothing new writes them.
   Progress per row is DERIVED from the loads; Loading Status and the
   Dispatched flip follow from it (never stored here).
   ============================================================ */
export type Material = "Panel" | "Mdf" | "Item";
export const MATERIAL_LABEL: Record<Material, string> = { Panel: "Panel", Mdf: "MDF", Item: "Cut piece" };
export interface LoadLineIn {
  lineId: string; // PanelOrderLine / SampleOrderLine ROWID
  material: Material;
  qty: number;
  /** CR-349: kg stamped when it left — null when the master had no weight then. */
  weightKg: number | null;
  /** CR-405: the piece kind on an Item line of a panel ("" on Mdf / legacy Panel / sample lines). */
  designId?: string;
  cutSizeId?: string;
  designName?: string;
  cutSizeName?: string;
}
export interface LoadIn {
  id: string;
  lines: LoadLineIn[];
}
export interface ProgressRow {
  lineId: string;
  material: Material;
  /** CR-405: the piece kind of an Item row ("" on Mdf). */
  designId: string;
  cutSizeId: string;
  designName: string;
  cutSizeName: string;
  ordered: number;
  loaded: number;
  pending: number;
}
/** CR-405: the identity of a load row — line × material × piece kind. */
export const rowKey = (r: Pick<ProgressRow, "lineId" | "material" | "designId" | "cutSizeId">) => `${r.lineId}|${r.material}|${r.designId}|${r.cutSizeId}`;
type LabelRow = { material: Material; designName?: string; cutSizeName?: string };
/** Full text — "Grey · 300x300" for a piece row, "MDF" for the board, "Panel" for a legacy whole-panel line.
    For paper and lists that have no (i) card (load PDF, Loads table). */
export const pieceLabel = (r: LabelRow) =>
  r.material === "Mdf" ? "MDF" : r.material === "Panel" ? "Panel" : [r.designName, r.cutSizeName].filter(Boolean).join(" · ") || "Cut piece";
/** CR-415: the on-screen Material cell — cut size only; the design sits in the Line (i) card. */
export const rowLabel = (r: LabelRow) =>
  r.material === "Mdf" ? "MDF" : r.material === "Panel" ? "Panel" : r.cutSizeName || r.designName || "Cut piece";
export type LoadingStatus = "Not loaded" | "Partially loaded" | "Loaded";
export const LOADING_STATUSES: readonly LoadingStatus[] = ["Not loaded", "Partially loaded", "Loaded"];

type LoadableLine = { id: string; qty: number; panelId?: string; mdfId?: string; designId?: string; cutSizeId?: string; designName?: string; cutSizeName?: string };
/** The panel master rows the maths needs — the pieces on each panel. */
export type PanelPieces = Map<string, Pick<PanelRow, "lines">>;

/** CR-405: the load rows a line ships, with nothing loaded yet — mirrors the server panelLineRows.
    Panel line → one Item row per piece kind on the panel (pcs × qty) + ONE Mdf row (CR-406, always);
    loose cut-piece line → one Item row; a panel missing from the map → the Mdf row only. */
export function lineLoadRows(l: LoadableLine, panelsById: PanelPieces): ProgressRow[] {
  const blank = { loaded: 0, pending: 0 };
  if (l.panelId) {
    const pieces = (panelsById.get(l.panelId)?.lines ?? []).map((p) => ({
      lineId: l.id, material: "Item" as const, designId: p.designId, cutSizeId: p.cutSizeId, designName: p.designName, cutSizeName: p.cutSizeName, ordered: p.qty * l.qty, ...blank,
    }));
    return [...pieces, { lineId: l.id, material: "Mdf", designId: "", cutSizeId: "", designName: "", cutSizeName: "", ordered: l.qty, ...blank }];
  }
  return [{ lineId: l.id, material: "Item", designId: l.designId ?? "", cutSizeId: l.cutSizeId ?? "", designName: l.designName ?? "", cutSizeName: l.cutSizeName ?? "", ordered: l.qty, ...blank }];
}

/** Σ loaded per rowKey over the given loads; a legacy "Panel" load line spreads qty × pcs over the panel's piece keys. */
function loadedMap(loads: LoadIn[], lines: LoadableLine[], panelsById: PanelPieces): Map<string, number> {
  const m = new Map<string, number>();
  const add = (k: string, q: number) => m.set(k, (m.get(k) ?? 0) + q);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const ld of loads)
    for (const l of ld.lines) {
      if (l.material === "Panel") {
        const panelId = lineById.get(l.lineId)?.panelId ?? "";
        for (const p of panelsById.get(panelId)?.lines ?? []) add(rowKey({ lineId: l.lineId, material: "Item", designId: p.designId, cutSizeId: p.cutSizeId }), l.qty * p.qty);
        continue;
      }
      add(rowKey({ lineId: l.lineId, material: l.material, designId: l.designId ?? "", cutSizeId: l.cutSizeId ?? "" }), l.qty);
    }
  return m;
}

/** One row per line × material × piece kind: ordered · loaded · pending. */
export function loadProgress(lines: LoadableLine[], loads: LoadIn[], panelsById: PanelPieces): ProgressRow[] {
  const loaded = loadedMap(loads, lines, panelsById);
  return lines.flatMap((l) =>
    lineLoadRows(l, panelsById).map((r) => {
      const got = loaded.get(rowKey(r)) ?? 0;
      return { ...r, loaded: got, pending: Math.max(0, r.ordered - got) };
    }),
  );
}

/** Derived, never stored. A legacy Dispatched / Supplied order with no loads counts as Loaded. */
export function loadingStatus(rows: ProgressRow[], orderStatus = ""): LoadingStatus {
  if (orderStatus === "Dispatched" || orderStatus === "Supplied") return "Loaded";
  if (rows.length > 0 && rows.every((r) => r.pending === 0)) return "Loaded";
  if (rows.some((r) => r.loaded > 0)) return "Partially loaded";
  return "Not loaded";
}

/** "12 pcs · 2 MDF" — what is still pending; "" when nothing. */
export function pendingText(rows: ProgressRow[]): string {
  const sum = (m: Material) => rows.filter((r) => r.material === m).reduce((s, r) => s + r.pending, 0);
  const i = sum("Item") + sum("Panel");
  const b = sum("Mdf");
  return [i > 0 && `${i} pcs`, b > 0 && `${b} MDF`].filter(Boolean).join(" · ");
}

/** CR-405: the need lines with qty = the PIECES still pending, one per line × piece kind — feed
    these to requirementsFor / demandByKey so a partial load shrinks the need instead of raising toCut. */
export function pendingNeedLines(lines: LoadableLine[], loads: LoadIn[], panelsById: PanelPieces): NeedLine[] {
  return loadProgress(lines, loads, panelsById)
    .filter((r) => r.material === "Item")
    .map((r) => {
      const l = lines.find((x) => x.id === r.lineId);
      return { panelId: l?.panelId ?? "", designId: r.designId, cutSizeId: r.cutSizeId, designName: r.designName, cutSizeName: r.cutSizeName, qty: r.pending };
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
    still pending × the LIVE unit weight (CR-405: per load row — `unitOf(row)` = kg of one piece of
    that kind, or of one board). A legacy Dispatched order with no loads reads live. */
export function lineWeightSplit(
  lineId: string,
  loads: LoadIn[],
  rows: ProgressRow[],
  unitOf: (row: ProgressRow) => number | null,
): { pieces: number | null; mdf: number | null } {
  const part = (isMdf: boolean): number | null => {
    let shipped = 0;
    for (const ld of loads)
      for (const l of ld.lines) {
        if (l.lineId !== lineId || (l.material === "Mdf") !== isMdf) continue;
        if (l.weightKg == null) return null;
        shipped += l.weightKg;
      }
    let pending = 0;
    for (const r of rows) {
      if (r.lineId !== lineId || (r.material === "Mdf") !== isMdf || r.pending === 0) continue;
      const u = unitOf(r);
      if (u == null) return null;
      pending += r.pending * u;
    }
    return Math.round((shipped + pending) * 1000) / 1000;
  };
  const hasMdf = rows.some((r) => r.lineId === lineId && r.material === "Mdf");
  return { pieces: part(false), mdf: hasMdf ? part(true) : null };
}
