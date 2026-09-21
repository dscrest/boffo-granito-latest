/* ============================================================
   Bulk Record Production sheet (CR-244) — the pure half: row shape, validation,
   Excel paste mapping. Also home of the item matcher + date parser the Excel
   import shares. No React here; self-check in productionLogSheetEdit.test.ts.
   ============================================================ */
import { todayISO } from "../../lib/dates";

/** One sheet row. Everything is the typed string; "" = blank. */
export type LogRow = {
  key: string;
  design: string; // Design ROWID
  unmatched: string; // pasted item text that matched no item — shown as the invalid placeholder
  batch: string; // blank = auto-numbered
  date: string; // blank = the sheet's Production date
  qty: string;
  brand: string; // Brand ROWID
  note: string;
  /** Set once the job exists (Save step 1) — a retry only re-sends the completion. */
  jobId?: string;
};

/** Typed columns in sheet order — a paste fills them left to right from the focused one. */
export const LOG_COLS = ["design", "batch", "date", "qty", "brand", "note"] as const;
export type LogCol = (typeof LOG_COLS)[number];

export type LogLine = { key: string; jobId?: string; design: string; qty: number; batch: string; date: string; brand: string; note: string };

let seq = 0;
export const blankRow = (): LogRow => ({ key: `r${++seq}`, design: "", unmatched: "", batch: "", date: "", qty: "", brand: "", note: "" });

const isActive = (r: LogRow) => !!(r.design || r.unmatched || r.batch.trim() || r.date || r.qty || r.brand || r.note.trim());

/** Blank rows are skipped. errors: row key → the columns at fault. */
export function resolveLogSheet(rows: LogRow[], defaultDate: string): { lines: LogLine[]; errors: Map<string, Set<LogCol>>; totalBoxes: number } {
  const errors = new Map<string, Set<LogCol>>();
  const flag = (key: string, col: LogCol) => (errors.get(key) ?? errors.set(key, new Set()).get(key)!).add(col);
  const lines: LogLine[] = [];
  const seen = new Map<string, string>(); // design|batch → first row key
  for (const r of rows.filter(isActive)) {
    const qty = parseInt(r.qty, 10) || 0;
    if (!r.design) flag(r.key, "design");
    if (qty <= 0) flag(r.key, "qty");
    const batch = r.batch.trim();
    if (r.design && batch) {
      // Same item + same batch twice would 409 on the second row server-side.
      const k = `${r.design}|${batch.toLowerCase()}`;
      const first = seen.get(k);
      if (first) {
        flag(first, "batch");
        flag(r.key, "batch");
      } else seen.set(k, r.key);
    }
    lines.push({ key: r.key, jobId: r.jobId, design: r.design, qty, batch, date: r.date || defaultDate, brand: r.brand, note: r.note.trim() });
  }
  return { lines, errors, totalBoxes: lines.reduce((s, l) => s + l.qty, 0) };
}

/** Item lookup by typed text: sku beats uniqueName beats designName (first writer wins). */
export function designIndex<D extends { sku: string; uniqueName: string; designName: string }>(designs: D[]): Map<string, D> {
  const m = new Map<string, D>();
  for (const keyOf of [(d: D) => d.sku, (d: D) => d.uniqueName, (d: D) => d.designName]) {
    for (const d of designs) {
      const k = keyOf(d).trim().toLowerCase();
      if (k && !m.has(k)) m.set(k, d);
    }
  }
  return m;
}

function localISO(d: Date): string {
  // Never toISOString — cellDates gives local dates; UTC shifts a day west.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "" → today; Date / Excel serial / yyyy-mm-dd / dd-mm-yyyy (day-first). null = unparseable. */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : localISO(v);
  if (typeof v === "number" && isFinite(v)) return localISO(new Date(Math.round((v - 25569) * 86400000)));
  const s = String(v ?? "").trim();
  if (!s) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** A copied Excel block (tabs + newlines) → one patch per pasted row, columns
    filled left to right from `startCol`. Unknown item text lands in `unmatched`;
    an unknown brand or unreadable date is left blank. */
export function parsePaste(
  text: string,
  startCol: LogCol,
  lookups: { designByKey: Map<string, { id: string }>; brandByName: Map<string, string> },
): Partial<LogRow>[] {
  const start = LOG_COLS.indexOf(startCol);
  return text
    .replace(/\r/g, "")
    .replace(/\n+$/, "")
    .split("\n")
    .map((ln) => {
      const patch: Partial<LogRow> = {};
      ln.split("\t").forEach((raw, i) => {
        const col = LOG_COLS[start + i];
        const v = raw.trim();
        if (!col) return;
        if (col === "design") {
          const hit = lookups.designByKey.get(v.toLowerCase());
          patch.design = hit?.id ?? "";
          patch.unmatched = hit ? "" : v;
        } else if (col === "date") patch.date = v ? parseDate(v) ?? "" : "";
        else if (col === "qty") patch.qty = v.replace(/[^\d]/g, "");
        else if (col === "brand") patch.brand = lookups.brandByName.get(v.toLowerCase()) ?? "";
        else patch[col] = v;
      });
      return patch;
    });
}
