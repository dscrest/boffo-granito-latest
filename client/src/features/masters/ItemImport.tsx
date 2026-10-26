/* ============================================================
   Bulk Upload Items (CR-451) — create many Item master rows from an
   Excel / CSV file. Same four steps as Import Production: pick file
   (sample template downloadable) → match columns → preview with per-row
   errors → import → per-row results. Create-only: a row whose unique
   name (Design - Size - Finish[ - Party Brand]) already exists is
   flagged and skipped. Lookups are matched by name, case-insensitive.
   Row → DesignInput goes through the very same helpers the Item form
   uses (blankDesign / computeUniqueName / toDesignInput), so SKU,
   unique name and coverage come out identical to a hand-typed item.
   SheetJS is loaded on demand so it stays out of the main bundle.
   ============================================================ */
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { toast } from "@/ui/Toast";
import { fmt, titleCase } from "@/lib/format";
import { blankDesign, computeUniqueName, toDesignInput, type DesignValues } from "./DesignForm";
import { createDesigns, type DesignLookups, type DesignRow, type LookupOption } from "./designsApi";

const FIELDS = [
  { key: "design_name", label: "Design Name", required: true, synonyms: ["design name", "design", "item", "item name", "name"] },
  { key: "size", label: "Size", required: true, synonyms: ["size", "tile size"] },
  { key: "finish", label: "Finish", required: true, synonyms: ["finish", "surface"] },
  { key: "category", label: "Category", required: false, synonyms: ["category", "body"] },
  { key: "glaze", label: "Glaze", required: false, synonyms: ["glaze"] },
  { key: "grade", label: "Grade", required: false, synonyms: ["grade", "quality"] },
  { key: "party_brand", label: "Party Brand", required: false, synonyms: ["party brand", "customer brand", "buyer brand", "brand"] },
  { key: "collection", label: "Collection", required: false, synonyms: ["collection", "collection name"] },
  { key: "pcs_per_box", label: "Pcs Per Box", required: false, synonyms: ["pcs per box", "pcs/box", "pcs", "pieces per box", "pcs per packing"] },
  { key: "box_weight_kg", label: "Box Weight (kg)", required: false, synonyms: ["box weight", "box weight (kg)", "weight", "weight kg", "kg"] },
  { key: "width_mm", label: "Width (mm)", required: false, synonyms: ["width", "width mm", "width (mm)"] },
  { key: "length_mm", label: "Length (mm)", required: false, synonyms: ["length", "length mm", "length (mm)"] },
  { key: "rate_per_sqft", label: "Rate / sqft", required: false, synonyms: ["rate / sqft", "rate per sqft", "rate sqft", "rate/sqft", "rate ft2"] },
  { key: "rate_per_sqmt", label: "Rate / sqm", required: false, synonyms: ["rate / sqm", "rate per sqm", "rate sqm", "rate/sqm", "rate per sqmt", "rate m2"] },
  { key: "status", label: "Status", required: false, synonyms: ["status", "active"] },
  { key: "seq_code", label: "Short Code", required: false, synonyms: ["short code", "design code", "seq code", "code"] },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
type Mapping = Record<FieldKey, number>; // header index, -1 = skip
const SKIP_ALL = Object.fromEntries(FIELDS.map((f) => [f.key, -1])) as Mapping;
const STATUSES = ["Active", "Inactive"];

interface PreviewRow {
  rowNum: number; // 1-based data row (excludes header) for user-facing messages
  values: DesignValues | null;
  uniqueName: string;
  sizeLabel: string;
  finishLabel: string;
  error: string; // "" = valid
}
interface RowResult {
  rowNum: number;
  label: string;
  ok: boolean;
  detail: string;
}

/** label (and a Size's raw code like "600x1200") → option, lower-cased. */
function indexOf(opts: LookupOption[]): Map<string, LookupOption> {
  const m = new Map<string, LookupOption>();
  for (const o of opts) {
    m.set(o.label.trim().toLowerCase(), o);
    if (o.code) m.set(o.code.trim().toLowerCase(), o);
  }
  return m;
}

export function ItemImport({ designs, lookups, onDone, onClose }: { designs: DesignRow[]; lookups: DesignLookups; onDone: () => void; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"file" | "map" | "preview" | "results">("file");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(SKIP_ALL);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  const idx = useMemo(
    () => ({
      size: indexOf(lookups.sizes),
      finish: indexOf(lookups.finishes),
      category: indexOf(lookups.categories),
      glaze: indexOf(lookups.glazes),
      grade: indexOf(lookups.grades),
      partyBrand: new Map(lookups.partyBrands.map((b) => [b.name.trim().toLowerCase(), b.name])),
      existing: new Set(designs.map((d) => d.uniqueName.trim().toLowerCase())),
    }),
    [lookups, designs],
  );

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const size = lookups.sizes[0];
    const ws = XLSX.utils.aoa_to_sheet([
      FIELDS.map((f) => f.label),
      ["Carrara Bianco", size?.label || "600x1200", lookups.finishes[0]?.label || "Glossy", lookups.categories[0]?.label || "", lookups.glazes[0]?.label || "", lookups.grades[0]?.label || "", "", "Marble Series", size?.pcsPerPacking || 2, size?.boxWeightKg || 28.8, size?.widthMm || 600, size?.lengthMm || 1200, 45, 484, "Active", ""],
      ["Nero Marquina", lookups.sizes[1]?.label || size?.label || "600x600", lookups.finishes[1]?.label || lookups.finishes[0]?.label || "Matt", "", "", "", lookups.partyBrands[0]?.name || "", "", "", "", "", "", "", "", "Active", ""],
    ]);
    ws["!cols"] = FIELDS.map((f) => ({ wch: Math.max(12, f.label.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "item-import-template.xlsx");
  };

  const parseFile = async (f: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer());
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
      const next = { ...SKIP_ALL };
      for (const fd of FIELDS) {
        let i = norm.findIndex((h) => (fd.synonyms as readonly string[]).includes(h));
        if (i < 0) i = norm.findIndex((h) => h && fd.synonyms.some((s) => h.includes(s)));
        next[fd.key] = i;
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
    const seen = new Map<string, number>(); // unique name → first row in this file
    return rows.map((r, i): PreviewRow => {
      const rowNum = i + 1;
      const fail = (error: string): PreviewRow => ({ rowNum, values: null, uniqueName: "", sizeLabel: "", finishLabel: "", error });
      const name = titleCase(str(r, "design_name")); // CR-429: the master stores Title Case
      if (!name) return fail("Design Name is blank");
      const look = (k: "size" | "finish" | "category" | "glaze" | "grade") => {
        const raw = str(r, k);
        if (!raw) return { id: "", opt: undefined as LookupOption | undefined, err: "" };
        const opt = idx[k].get(raw.toLowerCase());
        return { id: opt?.id ?? "", opt, err: opt ? "" : `${FIELDS.find((f) => f.key === k)!.label} not found: ${raw}` };
      };
      const size = look("size");
      if (!size.id) return fail(size.err || "Size is blank");
      const finish = look("finish");
      if (!finish.id) return fail(finish.err || "Finish is blank");
      for (const k of ["category", "glaze", "grade"] as const) {
        const e = look(k).err;
        if (e) return fail(e);
      }
      const pbRaw = str(r, "party_brand");
      const partyBrand = pbRaw ? idx.partyBrand.get(pbRaw.toLowerCase()) : "";
      if (pbRaw && !partyBrand) return fail(`Party Brand not found: ${pbRaw}`);
      const statusRaw = str(r, "status");
      const status = statusRaw ? STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) : "Active";
      if (!status) return fail(`Status must be Active or Inactive: ${statusRaw}`);
      // Numbers: blank = the picked Size's own default (the same prefill the Item form does).
      const num = (k: FieldKey, dflt?: number) => {
        const raw = str(r, k);
        if (!raw) return { v: dflt ? String(dflt) : "", err: "" };
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? { v: String(n), err: "" } : { v: "", err: `${FIELDS.find((f) => f.key === k)!.label} must be a number: ${raw}` };
      };
      const nums = {
        pcs_per_box: num("pcs_per_box", size.opt?.pcsPerPacking),
        box_weight_kg: num("box_weight_kg", size.opt?.boxWeightKg),
        width_mm: num("width_mm", size.opt?.widthMm),
        length_mm: num("length_mm", size.opt?.lengthMm),
        rate_per_sqft: num("rate_per_sqft"),
        rate_per_sqmt: num("rate_per_sqmt"),
      };
      const bad = Object.values(nums).find((x) => x.err);
      if (bad) return fail(bad.err);
      const values: DesignValues = {
        ...blankDesign(),
        design_name: name,
        base_design_name: name, // CR-437: defaults to the design name
        seq_code: str(r, "seq_code"),
        size: size.id,
        finish: finish.id,
        category: look("category").id,
        glaze: look("glaze").id,
        grade: look("grade").id,
        party_brand_name: partyBrand || "",
        collection_name: titleCase(str(r, "collection")),
        status,
        pcs_per_box: nums.pcs_per_box.v,
        box_weight_kg: nums.box_weight_kg.v,
        width_mm: nums.width_mm.v,
        length_mm: nums.length_mm.v,
        rate_per_sqft: nums.rate_per_sqft.v,
        rate_per_sqmt: nums.rate_per_sqmt.v,
      };
      const uniqueName = computeUniqueName(values, lookups);
      const key = uniqueName.toLowerCase();
      const dupOf = seen.get(key);
      if (dupOf) return { ...fail(`Duplicate of row ${dupOf}: ${uniqueName}`), uniqueName };
      seen.set(key, rowNum);
      if (idx.existing.has(key)) return { ...fail(`Already exists: ${uniqueName}`), uniqueName };
      return { rowNum, values, uniqueName, sizeLabel: size.opt?.label ?? "", finishLabel: finish.opt?.label ?? "", error: "" };
    });
  }, [rows, mapping, idx, lookups]);
  const valid = useMemo(() => preview.filter((p) => !p.error), [preview]);

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await createDesigns(valid.map((p) => toDesignInput(p.values!, lookups)));
      // A chunk is all-or-nothing: the first `done` rows are in, the rest carry the error.
      setResults(valid.map((p, i) => ({ rowNum: p.rowNum, label: p.uniqueName, ok: i < res.done, detail: i < res.done ? "Created" : res.error || "Failed" })));
      setStep("results");
      if (res.done) onDone();
    } finally {
      setImporting(false);
    }
  };

  const canContinue = mapping.design_name >= 0 && mapping.size >= 0 && mapping.finish >= 0;
  const errCount = preview.length - valid.length;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="upload" size={18} />
          </div>
          <div>
            <div className="ttl">Bulk Upload Items</div>
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
                    <th>Unique Name</th>
                    <th>Size</th>
                    <th>Finish</th>
                    <th className="num" style={{ textAlign: "right" }}>Pcs/Box</th>
                    <th className="num" style={{ textAlign: "right" }}>Box kg</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.rowNum}>
                      <td className="mono dim">{p.rowNum}</td>
                      {p.error ? (
                        <td colSpan={6} style={{ color: "var(--c-red)" }}>{p.error}</td>
                      ) : (
                        <>
                          <td><span className="design-name">{p.uniqueName}</span></td>
                          <td>{p.sizeLabel}</td>
                          <td>{p.finishLabel}</td>
                          <td className="num mono">{p.values!.pcs_per_box || <span className="dim">—</span>}</td>
                          <td className="num mono">{p.values!.box_weight_kg || <span className="dim">—</span>}</td>
                          <td>{p.values!.status}</td>
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
            {step === "map" && !canContinue && "Match the Design Name, Size and Finish columns to continue"}
            {step === "preview" &&
              `${fmt(valid.length)} valid${errCount ? ` · ${fmt(errCount)} with errors — only valid rows will be created` : ""}`}
            {step === "results" && `${fmt(results.filter((r) => r.ok).length)} of ${fmt(results.length)} items created`}
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
                    {importing ? "Creating…" : `Create ${fmt(valid.length)} item${valid.length === 1 ? "" : "s"}`}
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
