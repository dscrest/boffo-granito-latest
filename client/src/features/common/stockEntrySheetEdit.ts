/* ============================================================
   Stock entry — the pure half shared by the bulk sheets (cut-stock Add Stock
   = receipt, Transfer Orders) and, since CR-446, the Stock Adjustment FORM
   (both modules: one line by default, every line with its own date · location
   · reason). Row shape, validation and Excel paste mapping; no React.
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

/* ---------- CR-446: the adjustment FORM's rows (Zoho Books shape — no filler rows, every row counts) ---------- */

export type AdjustRow = {
  key: string;
  design: string;
  second: string; // batch number text (box) or cut-piece size ROWID (cut)
  warehouse: string; // Location node ROWID; "" only while warehouses are dormant
  out: boolean; // true = Remove (the default — breakage, theft, count…), false = Add
  qty: string;
  date: string; // yyyy-mm-dd
  reason: string; // AdjustmentReason name
  note: string;
};
export type AdjustCol = "design" | "second" | "warehouse" | "qty" | "date" | "reason";
/** A validated line: `qty` is SIGNED. */
export type AdjustLine = { key: string; design: string; second: string; warehouse: string; qty: number; date: string; reason: string; note: string };

export const blankAdjustRow = (seed?: Partial<Pick<AdjustRow, "design" | "date" | "warehouse" | "reason">>): AdjustRow => ({
  key: `a${++seq}`,
  design: "",
  second: "",
  warehouse: "",
  out: true,
  qty: "",
  date: "",
  reason: "",
  note: "",
  ...seed,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every row counts. errors: row key → the columns at fault. The same item · size/batch · location · date · reason
    twice is a typo (both rows flagged); the same pair with a DIFFERENT reason is a legitimate second line. */
export function resolveAdjustLines(
  rows: AdjustRow[],
  opts: { secondRequired: boolean; warehouseRequired: boolean },
): { lines: AdjustLine[]; errors: Map<string, Set<AdjustCol>>; totalIn: number; totalOut: number } {
  const errors = new Map<string, Set<AdjustCol>>();
  const flag = (key: string, col: AdjustCol) => (errors.get(key) ?? errors.set(key, new Set()).get(key)!).add(col);
  const lines: AdjustLine[] = [];
  const seen = new Map<string, string>();
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    const q = parseInt(r.qty, 10) || 0;
    const second = r.second.trim();
    const reason = r.reason.trim();
    if (!r.design) flag(r.key, "design");
    if (opts.secondRequired && !second) flag(r.key, "second");
    if (opts.warehouseRequired && !r.warehouse) flag(r.key, "warehouse");
    if (q <= 0) flag(r.key, "qty");
    if (!DATE_RE.test(r.date)) flag(r.key, "date");
    if (!reason) flag(r.key, "reason");
    if (r.design) {
      const k = `${r.design}|${second.toLowerCase()}|${r.warehouse}|${r.date}|${reason.toLowerCase()}`;
      const first = seen.get(k);
      if (first) {
        flag(first, opts.secondRequired ? "second" : "design");
        flag(r.key, opts.secondRequired ? "second" : "design");
      } else seen.set(k, r.key);
    }
    const qty = r.out ? -q : q;
    if (qty > 0) totalIn += qty;
    else totalOut += -qty;
    lines.push({ key: r.key, design: r.design, second, warehouse: r.warehouse, qty, date: r.date, reason, note: r.note.trim() });
  }
  return { lines, errors, totalIn, totalOut };
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
