/* ============================================================
   Stock entry — the pure half shared by the bulk sheets (cut-stock Add Stock
   = receipt, Transfer Orders) and, since CR-446, the Stock Adjustment FORM
   (both modules: one line by default, header date · reason over an Item Table, CR-457;
   Location Transfer mode CR-458). Row shape, validation and Excel paste mapping; no React.
   Self-check: stockEntrySheetEdit.test.ts. The design matcher + date
   parser are the production sheet's (productionLogSheetEdit).
   ============================================================ */

/** One sheet row. Everything is the typed string; "" = blank. */
export type EntryRow = {
  key: string;
  design: string; // Design ROWID
  unmatched: string; // pasted item text that matched no item — shown as the invalid placeholder
  second: string; // cut-piece size ROWID (cut sheets) or batch number text (box sheet); "" = blank
  qty: string;
  note: string;
  warehouse: string; // CR-438: Location (Warehouse node ROWID) for this row; "" = the bar's
};

/** Typed columns in sheet order — a paste fills them left to right from the focused one (CR-438: Location last). */
export const ENTRY_COLS = ["design", "second", "qty", "note", "warehouse"] as const;
export type EntryCol = (typeof ENTRY_COLS)[number];

/** A validated line: positive qty. `warehouse` "" = the bar's. */
export type EntryLine = { key: string; design: string; second: string; qty: number; note: string; warehouse: string };

let seq = 0;
export const blankRow = (): EntryRow => ({ key: `e${++seq}`, design: "", unmatched: "", second: "", qty: "", note: "", warehouse: "" });

const isActive = (r: EntryRow) => !!(r.design || r.unmatched || r.second.trim() || r.qty || r.note.trim() || r.warehouse);

export interface ResolveOpts {
  /** The second column (cut size) must be filled. Batch on the box sheet is optional. */
  secondRequired: boolean;
}

/** Blank rows are skipped. errors: row key → the columns at fault. */
export function resolveEntrySheet(rows: EntryRow[], opts: ResolveOpts): { lines: EntryLine[]; errors: Map<string, Set<EntryCol>>; total: number } {
  const errors = new Map<string, Set<EntryCol>>();
  const flag = (key: string, col: EntryCol) => (errors.get(key) ?? errors.set(key, new Set()).get(key)!).add(col);
  const lines: EntryLine[] = [];
  const seen = new Map<string, string>(); // design|second|warehouse → first row key (CR-438: one pair at two bays is fine)
  let total = 0;
  for (const r of rows.filter(isActive)) {
    const q = parseInt(r.qty, 10) || 0;
    if (!r.design) flag(r.key, "design");
    const second = r.second.trim();
    if (opts.secondRequired && !second) flag(r.key, "second");
    if (q <= 0) flag(r.key, "qty");
    if (r.design) {
      // The server merges duplicates, but two rows for one pair is almost always a typo.
      const k = `${r.design}|${second.toLowerCase()}|${r.warehouse}`;
      const first = seen.get(k);
      if (first) {
        flag(first, opts.secondRequired ? "second" : "design");
        flag(r.key, opts.secondRequired ? "second" : "design");
      } else seen.set(k, r.key);
    }
    total += q;
    lines.push({ key: r.key, design: r.design, second, qty: q, note: r.note.trim(), warehouse: r.warehouse });
  }
  return { lines, errors, total };
}

/* ---------- CR-446/457: the adjustment FORM — Zoho Books shape: ONE header (mode · date · reason · note, From → To
   in transfer mode) over an Item Table whose rows carry a SIGNED qty. No filler rows, every row counts. ---------- */

export type AdjustMode = "quantity" | "transfer";
/** The form's header — one date · reason · note for every line; `from` / `to` only in transfer mode (CR-458). */
export type AdjustHeader = { mode: AdjustMode; date: string; reason: string; note: string; from: string; to: string };
export type AdjustRow = {
  key: string;
  design: string;
  second: string; // batch number text (box) or cut-piece size ROWID (cut)
  warehouse: string; // Location node ROWID (quantity mode); "" only while warehouses are dormant
  qty: string; // SIGNED text — "+10" / "10" = add, "-10" / "−10" = remove; transfer mode: > 0
  note: string;
};
export type AdjustCol = "design" | "second" | "warehouse" | "qty";
export type AdjustHdrCol = "date" | "reason" | "from" | "to";
/** A validated line: `qty` SIGNED (quantity) or > 0 (transfer); date / reason copied from the header — the pages' save bodies are unchanged. */
export type AdjustLine = { key: string; design: string; second: string; warehouse: string; qty: number; date: string; reason: string; note: string };

// A seed value of undefined must NOT override the "" (a spread would) — downstream code treats design as a string.
export const blankAdjustRow = (seed?: Partial<Pick<AdjustRow, "design" | "warehouse">>): AdjustRow => ({
  key: `a${++seq}`,
  design: seed?.design ?? "",
  second: "",
  warehouse: seed?.warehouse ?? "",
  qty: "",
  note: "",
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "+10" / "10" → 10 · "-10" / "−10" (unicode minus) → -10 · anything else → NaN. */
export const parseSignedQty = (s: string): number => {
  const m = /^\s*([+\-−]?)\s*(\d+)\s*$/.exec(s);
  return m ? (m[1] === "-" || m[1] === "−" ? -1 : 1) * parseInt(m[2], 10) : NaN;
};

/** Every row counts. errors: row key → the columns at fault; hdrErrors: header fields at fault. The same item ·
    size/batch · location twice is a typo (both rows flagged). Transfer lines are POSITIVE and sit at `hdr.from`. */
export function resolveAdjustLines(
  rows: AdjustRow[],
  hdr: AdjustHeader,
  opts: { secondRequired: boolean; warehouseRequired: boolean },
): { lines: AdjustLine[]; errors: Map<string, Set<AdjustCol>>; hdrErrors: Set<AdjustHdrCol>; totalIn: number; totalOut: number } {
  const transfer = hdr.mode === "transfer";
  const errors = new Map<string, Set<AdjustCol>>();
  const flag = (key: string, col: AdjustCol) => (errors.get(key) ?? errors.set(key, new Set()).get(key)!).add(col);
  const hdrErrors = new Set<AdjustHdrCol>();
  const reason = hdr.reason.trim();
  if (!DATE_RE.test(hdr.date)) hdrErrors.add("date");
  if (!reason) hdrErrors.add("reason");
  if (transfer) {
    if (!hdr.from) hdrErrors.add("from");
    if (!hdr.to || hdr.to === hdr.from) hdrErrors.add("to");
  }
  const lines: AdjustLine[] = [];
  const seen = new Map<string, string>();
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    const q = parseSignedQty(r.qty);
    const second = r.second.trim();
    const warehouse = transfer ? hdr.from : r.warehouse;
    if (!r.design) flag(r.key, "design");
    if (opts.secondRequired && !second) flag(r.key, "second");
    if (!transfer && opts.warehouseRequired && !r.warehouse) flag(r.key, "warehouse");
    if (!Number.isFinite(q) || q === 0 || (transfer && q < 0)) flag(r.key, "qty");
    if (r.design) {
      const k = `${r.design}|${second.toLowerCase()}|${warehouse}`;
      const first = seen.get(k);
      if (first) {
        flag(first, opts.secondRequired ? "second" : "design");
        flag(r.key, opts.secondRequired ? "second" : "design");
      } else seen.set(k, r.key);
    }
    const qty = Number.isFinite(q) ? q : 0;
    if (qty > 0 && !transfer) totalIn += qty;
    else totalOut += Math.abs(qty);
    lines.push({ key: r.key, design: r.design, second, warehouse, qty, date: hdr.date, reason, note: r.note.trim() });
  }
  return { lines, errors, hdrErrors, totalIn, totalOut };
}

/** A copied Excel block → one patch per pasted row, columns left to right from `startCol`.
    Unknown item text lands in `unmatched`; the second column maps through `secondByName`
    when given (cut sizes), else is kept as typed (batch numbers). */
export function parseEntryPaste(
  text: string,
  startCol: EntryCol,
  lookups: { designByKey: Map<string, { id: string }>; secondByName?: Map<string, string>; warehouseByName?: Map<string, string> },
): Partial<EntryRow>[] {
  const start = ENTRY_COLS.indexOf(startCol);
  return text
    .replace(/\r/g, "")
    .replace(/\n+$/, "")
    .split("\n")
    .map((ln) => {
      const patch: Partial<EntryRow> = {};
      ln.split("\t").forEach((raw, i) => {
        const col = ENTRY_COLS[start + i];
        const v = raw.trim();
        if (!col) return;
        if (col === "design") {
          const hit = lookups.designByKey.get(v.toLowerCase());
          patch.design = hit?.id ?? "";
          patch.unmatched = hit ? "" : v;
        } else if (col === "second") patch.second = lookups.secondByName ? (lookups.secondByName.get(v.toLowerCase()) ?? "") : v;
        else if (col === "qty") patch.qty = v.replace(/[^\d]/g, "");
        else if (col === "warehouse") patch.warehouse = lookups.warehouseByName?.get(v.toLowerCase()) ?? "";
        else patch.note = v;
      });
      return patch;
    });
}
