/* ============================================================
   Import Production — bulk make-to-stock entry from an Excel/CSV file.

   Steps: pick file (sample template downloadable) → map columns →
   preview with per-row validation → import → per-row results.

   Each valid row becomes one independent plan line (requestProduction)
   immediately recorded in full (recordProduction), then flipped to
   Completed — mirroring what recording qty = requested does in the grid.
   SheetJS is loaded on demand so it stays out of the main bundle.
   ============================================================ */
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { toast } from "@/ui/Toast";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { invalidateBatchStock } from "@/features/stages/batchStockApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { DesignRow } from "@/features/masters/designsApi";
import { requestProduction, recordProduction, setProductionStage } from "./productionApi";

const FIELDS = [
  { key: "sku", label: "SKU / Item", required: true, synonyms: ["sku", "item", "item code", "itemcode", "design", "design name", "product"] },
  { key: "qty", label: "Qty (boxes)", required: true, synonyms: ["qty", "quantity", "boxes", "box", "qty boxes", "qty (boxes)"] },
  { key: "batch", label: "Batch Number", required: false, synonyms: ["batch", "batch no", "batch no.", "batch number"] },
  { key: "shade", label: "Shade", required: false, synonyms: ["shade", "tone"] },
  { key: "date", label: "Production Date", required: false, synonyms: ["date", "production date", "mfg date", "mfg. date", "prod date"] },
  { key: "shift", label: "Shift", required: false, synonyms: ["shift"] },
  { key: "note", label: "Note", required: false, synonyms: ["note", "notes", "remark", "remarks", "comment"] },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
type Mapping = Record<FieldKey, number>; // header index, -1 = skip

interface PreviewRow {
  rowNum: number; // 1-based data row (excludes header) for user-facing messages
  design: DesignRow | null;
  raw: string; // the SKU cell as typed
  qty: number;
  batch: string;
  shade: string;
  date: string;
  shift: string;
  note: string;
  error: string; // "" = valid
}
interface RowResult {
  rowNum: number;
  label: string; // item name
  ok: boolean;
  detail: string; // batch number or error message
}

function localISO(d: Date): string {
  // Never toISOString — cellDates gives local dates; UTC shifts a day west.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "" → today; Date / Excel serial / yyyy-mm-dd / dd-mm-yyyy (day-first). null = unparseable. */
function parseDate(v: unknown): string | null {
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

export function ProductionImport({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { designRows, salesPersons } = useMasters();
  const importedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  const panelRef = useModalA11y(onClose);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"file" | "map" | "preview" | "results">("file");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ sku: -1, qty: -1, batch: -1, shade: -1, date: -1, shift: -1, note: -1 });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  // SKU → design lookup: sku beats uniqueName beats designName (first writer wins).
  const designByKey = useMemo(() => {
    const m = new Map<string, DesignRow>();
    for (const keyOf of [(d: DesignRow) => d.sku, (d: DesignRow) => d.uniqueName, (d: DesignRow) => d.designName]) {
      for (const d of designRows) {
        const k = keyOf(d).trim().toLowerCase();
        if (k && !m.has(k)) m.set(k, d);
      }
    }
    return m;
  }, [designRows]);

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["SKU", "Qty (boxes)", "Batch Number", "Shade", "Production Date", "Shift", "Note"],
      [designRows[0]?.sku || "1001-600X1200-GL", 100, "", "A", todayISO(), "Day", "blank batch = auto-numbered"],
      [designRows[1]?.sku || "1002-600X1200-MT", 50, "B/26-27/001", "B", todayISO(), "Night", ""],
    ]);
    ws["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 15 }, { wch: 8 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Production");
    XLSX.writeFile(wb, "production-import-template.xlsx");
  };

  const parseFile = async (f: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const notBlank = (r: unknown[]) => r.some((c) => String(c ?? "").trim() !== "");
      const headIdx = aoa.findIndex(notBlank);
      if (headIdx < 0) throw new Error("The file is empty.");
      const heads = aoa[headIdx].map((h) => String(h ?? "").trim());
      const data = aoa.slice(headIdx + 1).filter(notBlank);
      if (data.length === 0) throw new Error("No data rows below the header row.");
      // Auto-map: exact synonym match first, then contains.
      const norm = heads.map((h) => h.toLowerCase());
      const next = { ...mapping };
      for (const f of FIELDS) {
        let idx = norm.findIndex((h) => (f.synonyms as readonly string[]).includes(h));
        if (idx < 0) idx = norm.findIndex((h) => h && f.synonyms.some((s) => h.includes(s)));
        next[f.key] = idx;
      }
      setFileName(f.name);
      setHeaders(heads);
      setRows(data);
      setMapping(next);
      setStep("map");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo<PreviewRow[]>(() => {
    const cell = (r: unknown[], k: FieldKey) => (mapping[k] >= 0 ? r[mapping[k]] : "");
    const str = (r: unknown[], k: FieldKey) => String(cell(r, k) ?? "").trim();
    return rows.map((r, i) => {
      const raw = str(r, "sku");
      const design = designByKey.get(raw.toLowerCase()) ?? null;
      const qty = Math.floor(Number(cell(r, "qty")));
      const date = parseDate(cell(r, "date"));
      const error = !raw
        ? "Item is blank"
        : !design
          ? `Item not found: ${raw}`
          : !(qty > 0) || qty !== Number(cell(r, "qty"))
            ? `Qty must be a whole number above 0`
            : date === null
              ? `Unrecognised date: ${str(r, "date")}`
              : "";
      return {
        rowNum: i + 1,
        design,
        raw,
        qty,
        batch: str(r, "batch"),
        shade: str(r, "shade"),
        date: date ?? "",
        shift: str(r, "shift"),
        note: str(r, "note"),
        error,
      };
    });
  }, [rows, mapping, designByKey]);
  const valid = useMemo(() => preview.filter((p) => !p.error), [preview]);

  const runImport = async () => {
    setImporting(true);
    try {
      const req = await requestProduction({
        lines: valid.map((r) => ({ design: r.design!.id, qty_requested: r.qty })),
        production_date: todayISO(),
        performed_by: importedBy,
        note: "Imported from Excel",
      });
      if (!req.ok || !req.data) {
        toast.error(req.error || "Import failed.");
        return;
      }
      const ids = req.data.ids;
      const done: string[] = [];
      const out: RowResult[] = [];
      // Sequential on purpose — parallel record calls race the B/FY/NNN batch counter.
      for (let i = 0; i < valid.length; i++) {
        const r = valid[i];
        const id = ids[i];
        const label = r.design!.uniqueName || r.design!.designName;
        if (!id) {
          out.push({ rowNum: r.rowNum, label, ok: false, detail: "Plan line was not created" });
          continue;
        }
        const res = await recordProduction(id, {
          qty_boxes: r.qty,
          production_date: r.date,
          shift: r.shift || undefined,
          performed_by: importedBy,
          note: r.note || undefined,
          batch_number: r.batch || undefined,
          shade: r.shade || undefined,
        });
        if (res.ok) {
          done.push(id);
          out.push({ rowNum: r.rowNum, label, ok: true, detail: res.data?.batch_number || r.batch || "" });
        } else {
          out.push({ rowNum: r.rowNum, label, ok: false, detail: res.error || "Failed" });
        }
      }
      if (done.length) await setProductionStage(done, "Completed");
      invalidateBatchStock(); // recordProduction's cache bust skips batch stock
      setResults(out);
      setStep("results");
      onDone();
    } finally {
      setImporting(false);
    }
  };

  const canContinue = mapping.sku >= 0 && mapping.qty >= 0;
  const errCount = preview.length - valid.length;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="upload" size={18} />
          </div>
          <div>
            <div className="ttl">Import Production</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          {step === "file" && (
            <div className="form-section">
              <div className="form-section-title">File</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseFile(f); e.target.value = ""; }} />
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="hbtn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} />
                  {busy ? "Reading…" : "Choose Excel / CSV file"}
                </button>
                <button className="btn" onClick={() => void downloadTemplate()}>
                  <Icon name="download" size={13} /> Download sample template
                </button>
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="form-section">
              <div className="form-section-title">Match columns — {fileName}</div>
              <div className="form-grid">
                {FIELDS.map((f) => (
                  <label className="form-field" key={f.key}>
                    <span className="lbl">
                      {f.label}
                      {f.required && <span className="req"> *</span>}
                    </span>
                    <select value={mapping[f.key]} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                      <option value={-1}>— skip —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="form-section">
              <div className="form-section-title">Preview — {fileName}</div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Item</th>
                    <th className="num" style={{ textAlign: "right" }}>Qty</th>
                    <th>Batch</th>
                    <th>Shade</th>
                    <th>Date</th>
                    <th>Shift</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.rowNum}>
                      <td className="mono dim">{p.rowNum}</td>
                      {p.error ? (
                        <td colSpan={7} style={{ color: "var(--c-red)" }}>{p.error}</td>
                      ) : (
                        <>
                          <td><span className="design-name">{p.design!.uniqueName || p.design!.designName}</span></td>
                          <td className="num mono">{fmt(p.qty)}</td>
                          <td className="mono">{p.batch || <span className="dim">auto</span>}</td>
                          <td>{p.shade}</td>
                          <td className="mono">{p.date}</td>
                          <td>{p.shift}</td>
                          <td>{p.note}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {step === "results" && (
            <div className="form-section">
              <div className="form-section-title">Result — do not re-upload this file</div>
              <table className="tbl">
                <tbody>
                  {results.map((r) => (
                    <tr key={r.rowNum}>
                      <td style={{ width: 30 }}>
                        <Icon name={r.ok ? "check" : "alert"} size={14} style={{ color: r.ok ? "var(--c-green)" : "var(--c-red)" }} />
                      </td>
                      <td><span className="design-name">{r.label}</span></td>
                      <td className="mono" style={r.ok ? undefined : { color: "var(--c-red)" }}>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {step === "map" && !canContinue && "Match the SKU and Qty columns to continue"}
            {step === "preview" &&
              `${fmt(valid.length)} valid${errCount ? ` · ${fmt(errCount)} with errors — only valid rows will be imported` : ""}`}
            {step === "results" && `${fmt(results.filter((r) => r.ok).length)} of ${fmt(results.length)} rows imported`}
          </span>
          {step === "results" ? (
            <button className="hbtn primary" onClick={onClose}>
              <Icon name="check" size={13} /> Done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              {step === "map" && (
                <button className="hbtn primary" disabled={!canContinue} onClick={() => setStep("preview")}>
                  <Icon name="arrow-r" size={13} /> Continue
                </button>
              )}
              {step === "preview" && (
                <>
                  <button className="btn" disabled={importing} onClick={() => setStep("map")}>Back</button>
                  <button className="hbtn primary" disabled={valid.length === 0 || importing} onClick={() => void runImport()}>
                    <Icon name="check" size={13} />
                    {importing ? "Importing…" : `Import ${fmt(valid.length)} row${valid.length === 1 ? "" : "s"}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
