/* ============================================================
   Stock entry sheet (CR-307/308) — the pure half shared by the three bulk
   sheets: cut-stock Add Stock (receipt), cut-stock Adjust and box-stock
   Adjust. Row shape, validation and Excel paste mapping; no React.
   Self-check: stockEntrySheetEdit.test.ts. The design matcher + date
   parser are the production sheet's (productionLogSheetEdit).
   ============================================================ */
export type EntryDir = "in" | "out";

/** One sheet row. Everything is the typed string; "" = blank. */
export type EntryRow = {
  key: string;
  design: string; // Design ROWID
  unmatched: string; // pasted item text that matched no item — shown as the invalid placeholder
  second: string; // cut-piece size ROWID (cut sheets) or batch number text (box sheet); "" = blank
  dir: EntryDir; // adjustment sheets only: in = add, out = remove
  qty: string;
  note: string;
  warehouse: string; // CR-438: Location (Warehouse node ROWID) for this row; "" = the bar's
};

/** Typed columns in sheet order — a paste fills them left to right from the focused one (CR-438: Location last). */
export const ENTRY_COLS = ["design", "second", "dir", "qty", "note", "warehouse"] as const;
export type EntryCol = (typeof ENTRY_COLS)[number];

/** A validated line: `qty` is SIGNED on an adjustment sheet, positive on a receipt. `warehouse` "" = the bar's. */
export type EntryLine = { key: string; design: string; second: string; qty: number; note: string; warehouse: string };

let seq = 0;
export const blankRow = (): EntryRow => ({ key: `e${++seq}`, design: "", unmatched: "", second: "", dir: "in", qty: "", note: "", warehouse: "" });

const isActive = (r: EntryRow) => !!(r.design || r.unmatched || r.second.trim() || r.qty || r.note.trim() || r.warehouse);

export interface ResolveOpts {
  /** true = adjustment sheet: `dir` applies and lines come back signed. */
  signed: boolean;
  /** The second column (cut size) must be filled. Batch on the box sheet is optional. */
  secondRequired: boolean;
}

/** Blank rows are skipped. errors: row key → the columns at fault. */
export function resolveEntrySheet(rows: EntryRow[], opts: ResolveOpts): { lines: EntryLine[]; errors: Map<string, Set<EntryCol>>; totalIn: number; totalOut: number } {
  const errors = new Map<string, Set<EntryCol>>();
  const flag = (key: string, col: EntryCol) => (errors.get(key) ?? errors.set(key, new Set()).get(key)!).add(col);
  const lines: EntryLine[] = [];
  const seen = new Map<string, string>(); // design|second|warehouse → first row key (CR-438: one pair at two bays is fine)
  let totalIn = 0;
  let totalOut = 0;
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
    const qty = opts.signed && r.dir === "out" ? -q : q;
    if (qty > 0) totalIn += qty;
    else totalOut += -qty;
    lines.push({ key: r.key, design: r.design, second, qty, note: r.note.trim(), warehouse: r.warehouse });
  }
  return { lines, errors, totalIn, totalOut };
}

const DIR_WORDS: Record<string, EntryDir> = { in: "in", add: "in", "+": "in", plus: "in", out: "out", remove: "out", "-": "out", minus: "out", less: "out" };

/** A copied Excel block → one patch per pasted row, columns left to right from `startCol`.
    Unknown item text lands in `unmatched`; the second column maps through `secondByName`
    when given (cut sizes), else is kept as typed (batch numbers). A leading "-" on the
    qty flips the direction. */
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
        else if (col === "dir") patch.dir = DIR_WORDS[v.toLowerCase()] ?? "in";
        else if (col === "qty") {
          if (v.startsWith("-")) patch.dir = "out";
          patch.qty = v.replace(/[^\d]/g, "");
        } else if (col === "warehouse") patch.warehouse = lookups.warehouseByName?.get(v.toLowerCase()) ?? "";
        else patch.note = v;
      });
      return patch;
    });
}
