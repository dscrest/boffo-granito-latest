/* ============================================================
   Bulk Record Production — /prod/record (CR-244; CR-469 Adjust Stock shape).
   Make-to-stock output logged the fast way, in the Zoho-Books form shape the
   Panel Craft Adjust Stock page uses (common/StockAdjustForm.tsx): a HEADER
   (Production date · Recorded by · Description) over an ITEM TABLE — one line
   by default, "+ Add line" below — Size · Item · Batch · Qty · Box Brand ·
   Location per line (CR-438; blank = the Production bay). No toolbar, no
   column picker: the header date is THE date, the description rides on every
   line. Each line ends as a Completed production whose output is in stock.
   Save is two requests for any number of lines: /production-log mints the
   jobs, /production-complete records every line's output (batches mint
   one by one inside the server loop, so the per-item counter cannot race).
   A line keeps its jobId once minted — a failed completion is retried with
   the same ids and the server records only what is still missing.
   Validation + Excel paste mapping are pure: productionLogSheetEdit.ts.
   ============================================================ */
import { useMemo, useState, type ClipboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { EmptyState } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { can } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useMasters } from "@/features/masters/useMasters";
import { useBoxBrands } from "@/features/masters/boxBrands";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { invalidateBatchStock } from "./batchStockApi";
import { completeProduction, requestProduction } from "./productionApi";
import { blankRow, designIndex, parsePaste, resolveLogSheet, warehouseIndex, type LogCol, type LogRow } from "./productionLogSheetEdit";

export function ProductionLogSheet() {
  const navigate = useNavigate();
  const { designRows, salesPersons } = useMasters();
  const { brands, options: brandOptions } = useBoxBrands();
  const recordedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  const form = useFormSave(() => navigate("/prod"));

  const [rows, setRows] = useState<LogRow[]>(() => [blankRow()]);
  const [prodDate, setProdDate] = useState(todayISO());
  const [note, setNote] = useState("");
  // CR-411/438: a line without a Location goes to the Production bay (shown as the placeholder).
  const { options: whOptions, primaryFor, enabled: whEnabled } = useWarehouses();
  const whDefault = primaryFor("Production")?.id ?? "";
  const whDefaultLabel = whOptions.find((o) => o.value === whDefault)?.label || "";
  const [showErrors, setShowErrors] = useState(false);
  // Save errors show in the foot, not as a toast — a sticky error toast sits on top of Save.
  const [saveError, setSaveError] = useState("");

  const designById = useMemo(() => new Map(designRows.map((d) => [d.id, d])), [designRows]);
  const activeDesigns = useMemo(() => designRows.filter((d) => d.status !== "Inactive" && d.status !== "Discontinued"), [designRows]);
  // Size pick list = the distinct sizes of the active items (no extra fetch).
  const sizeOptions = useMemo<ComboOption[]>(() => {
    const m = new Map<string, string>();
    activeDesigns.forEach((d) => d.sizeId && !m.has(d.sizeId) && m.set(d.sizeId, d.sizeLabel));
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [activeDesigns]);
  const designOptions = useMemo<ComboOption[]>(
    () => activeDesigns.map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined })),
    [activeDesigns],
  );
  // A picked Size narrows the line's Item list; no Size = every item.
  const designOptionsFor = (sizeId: string) => (sizeId ? designOptions.filter((o) => designById.get(o.value)?.sizeId === sizeId) : designOptions);
  const lookups = useMemo(
    () => ({
      designByKey: designIndex(designRows),
      brandByName: new Map(brands.map((b) => [b.name.trim().toLowerCase(), b._id])),
      sizeByLabel: new Map(sizeOptions.map((s) => [s.label.trim().toLowerCase(), s.value])),
      warehouseByName: warehouseIndex(whOptions),
    }),
    [designRows, brands, sizeOptions, whOptions],
  );

  /** Patch lines from index `at` on; a pasted block appends the lines it needs. */
  const patchRows = (at: number, patches: Partial<LogRow>[]) => {
    form.touch();
    setRows((prev) => {
      const need = at + patches.length - prev.length;
      const next = need > 0 ? [...prev, ...Array.from({ length: need }, blankRow)] : [...prev];
      // A line whose job already exists keeps its item — the job was minted for it.
      patches.forEach((p, i) => {
        const cur = next[at + i];
        next[at + i] = cur.jobId ? { ...cur, ...p, design: cur.design, unmatched: "" } : { ...cur, ...p };
      });
      return next;
    });
  };
  const setCell = (i: number, patch: Partial<LogRow>) => patchRows(i, [patch]);
  const addLine = () => {
    form.touch();
    setRows((prev) => [...prev, blankRow()]);
  };
  const removeRow = (i: number) => {
    form.touch();
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  };

  // Excel paste: a tab/newline block fills lines left-to-right from the focused column (LOG_COLS order).
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return; // a single value pastes into the cell as usual
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    const at = Number(cell?.closest<HTMLElement>("[data-i]")?.dataset.i);
    if (!cell || !Number.isInteger(at)) return;
    e.preventDefault();
    patchRows(at, parsePaste(text, cell.dataset.col as LogCol, lookups));
  };

  const { lines, errors, totalBoxes } = useMemo(() => resolveLogSheet(rows, prodDate), [rows, prodDate]);
  const bad = (r: LogRow, col: LogCol) => showErrors && !!errors.get(r.key)?.has(col);

  const save = () =>
    form.run(async () => {
      if (errors.size > 0 || lines.length === 0) {
        setShowErrors(true);
        return;
      }
      setSaveError("");
      // 1 · mint the jobs still missing (one request, ids come back in order)
      const jobOf = new Map(lines.filter((l) => l.jobId).map((l) => [l.key, l.jobId!]));
      const fresh = lines.filter((l) => !l.jobId);
      if (fresh.length) {
        const req = await requestProduction({
          lines: fresh.map((l) => ({ design: l.design, qty_requested: l.qty })),
          production_date: prodDate,
          performed_by: recordedBy,
          stage: "InProduction",
        });
        if (!req.ok || !req.data) {
          setSaveError(req.error || "Save failed");
          return;
        }
        fresh.forEach((l, i) => req.data!.ids[i] && jobOf.set(l.key, req.data!.ids[i]));
        setRows((prev) => prev.map((r) => (jobOf.has(r.key) ? { ...r, jobId: jobOf.get(r.key) } : r)));
      }
      // 2 · record every line's output + complete (one request). Re-sent as is on a retry:
      // the server records qty − already recorded, so finished lines are no-ops.
      const done = await completeProduction({
        lines: lines
          .filter((l) => jobOf.has(l.key))
          .map((l) => ({
            id: jobOf.get(l.key)!,
            qty_boxes: l.qty,
            batch_number: l.batch || undefined,
            production_date: l.date,
            box_brand: l.brand || undefined,
            note: note.trim(), // CR-469: the header Description rides on every line
            warehouse: (whEnabled && l.warehouse) || undefined, // CR-438: the line's own; blank → the default below
          })),
        production_date: prodDate,
        performed_by: recordedBy,
        warehouse: (whEnabled && whDefault) || undefined,
      });
      invalidateBatchStock(); // lines before a failure are already in stock
      if (!done.ok) {
        setSaveError(`${done.error || "Save failed"} — fix and Save again; lines already recorded are not repeated`);
        return;
      }
      toast.success(`${lines.length} item${lines.length === 1 ? "" : "s"} recorded · ${fmt(totalBoxes)} boxes`);
      navigate("/prod", { replace: true });
    });

  if (!can("stages", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;

  const n = lines.length;
  const footNote =
    showErrors && errors.size > 0 ? (
      <span style={{ color: "var(--c-red)" }}>{errors.size} line{errors.size === 1 ? "" : "s"} to fix</span>
    ) : saveError ? (
      <span role="alert" style={{ color: "var(--c-red)" }}>{saveError}</span>
    ) : (
      <>
        <span className="req">*</span> indicates a mandatory field · {n} item{n === 1 ? "" : "s"} · <span className="mono">{fmt(totalBoxes)}</span> boxes
      </>
    );

  // Same grid as StockAdjustForm: Size · Item · Batch · Qty · Box Brand · [Location] · ✕.
  const cols = { gridTemplateColumns: ["1.1fr", "2.4fr", "1fr", "0.8fr", "1.2fr", whEnabled && "1.4fr", "26px"].filter(Boolean).join(" ") };

  return (
    <FormPage title="Bulk Record Production" note={footNote} busy={form.busy} saveDisabled={lines.length === 0} onCancel={() => void form.cancel()} onSave={() => void save()}>
      <div className="form-section">
        <div className="form-section-title">Production</div>
        <div className="form-rows">
          <label className="form-field">
            <span className="lbl">Production date<span className="req"> *</span></span>
            <DateInput value={prodDate} max={todayISO()} onChange={(e) => { form.touch(); setProdDate(e.target.value || todayISO()); }} />
          </label>
          <div className="form-field">
            <span className="lbl">Recorded by</span>
            <input readOnly tabIndex={-1} value={recordedBy || "—"} aria-label="Recorded by" />
          </div>
          <label className="form-field span2">
            <span className="lbl">Description</span>
            <textarea value={note} placeholder="Optional — saved on every line" onChange={(e) => { form.touch(); setNote(e.target.value); }} />
          </label>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Item Table</div>
        <div className="ord-lines" onPaste={onPaste}>
          <div className="ord-line adj-line ord-line-head" style={cols}>
            <span>Size</span>
            <span>Item<span className="req"> *</span></span>
            <span>Batch No.</span>
            <span>Qty (boxes)<span className="req"> *</span></span>
            <span>Box Brand</span>
            {whEnabled && <span>Location</span>}
            <span />
          </div>
          {rows.map((r, i) => {
            const d = designById.get(r.design);
            return (
              <div key={r.key} data-i={i} className="ord-line adj-line" style={cols}>
                {/* Size first (CR-264): narrows the item list; picking an item fills it back. */}
                <div data-col="size">
                  <Combobox
                    value={r.size}
                    options={sizeOptions}
                    placeholder="Size…"
                    disabled={!!r.jobId}
                    ariaLabel={`Size, line ${i + 1}`}
                    onChange={(v) => setCell(i, { size: v, ...(r.design && d?.sizeId !== v ? { design: "", unmatched: "" } : {}) })}
                  />
                </div>
                <div data-col="design">
                  <Combobox
                    value={r.design}
                    options={designOptionsFor(r.size)}
                    placeholder={r.unmatched || "Item…"}
                    invalid={bad(r, "design")}
                    disabled={!!r.jobId}
                    ariaLabel={`Item, line ${i + 1}`}
                    onChange={(v) => setCell(i, { design: v, unmatched: "", size: designById.get(v)?.sizeId || r.size })}
                  />
                </div>
                <div className="form-field" data-col="batch">
                  <input className={`mono${bad(r, "batch") ? " error" : ""}`} value={r.batch} placeholder="auto" aria-label={`Batch number, line ${i + 1}`} onChange={(e) => setCell(i, { batch: e.target.value })} />
                </div>
                <div className="form-field" data-col="qty">
                  <NumberInput maxDecimals={0} className={`mono${bad(r, "qty") ? " error" : ""}`} value={r.qty} placeholder="0" aria-label={`Boxes produced, line ${i + 1}`} onChange={(e) => setCell(i, { qty: e.target.value })} />
                </div>
                <div data-col="brand">
                  <Combobox value={r.brand} options={brandOptions} placeholder="" ariaLabel={`Box brand, line ${i + 1}`} onChange={(v) => setCell(i, { brand: v })} />
                </div>
                {whEnabled && (
                  <div data-col="warehouse">
                    <Combobox value={r.warehouse} options={whOptions} maxVisible={120} placeholder={whDefaultLabel} ariaLabel={`Location, line ${i + 1}`} onChange={(v) => setCell(i, { warehouse: v })} />
                  </div>
                )}
                {/* A minted job is not dropped from here — delete it on /prod. */}
                <button type="button" className="btn ord-rm" disabled={rows.length === 1 || !!r.jobId || form.busy} onClick={() => removeRow(i)} title="Remove line" aria-label={`Remove line ${i + 1}`} tabIndex={-1}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={addLine} disabled={form.busy}>
          <Icon name="plus" size={12} /> Add line
        </button>
      </div>
    </FormPage>
  );
}
