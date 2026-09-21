/* ============================================================
   Record Production — /prod/record (CR-244). Make-to-stock output logged
   the fast way: one ruled sheet (the Loading Plan sheet's .psheet skin), a
   row per item — Design · Batch · Date · Qty (+ Box Brand, Remark) — and ONE
   Save. Each row ends as a Completed production whose output is in stock.
   Save is two requests for any number of rows: /production-log mints the
   jobs, /production-complete records every row's output (batches mint
   one by one inside the server loop, so the per-item counter cannot race).
   A row keeps its jobId once minted — a failed completion is retried with
   the same ids and the server records only what is still missing.
   Validation + Excel paste mapping are pure: productionLogSheetEdit.ts.
   ============================================================ */
import { useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { useFormSave } from "@/ui/FormPage";
import { EmptyState } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { can } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useMasters } from "@/features/masters/useMasters";
import { useBoxBrands } from "@/features/masters/boxBrands";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { invalidateBatchStock } from "./batchStockApi";
import { completeProduction, requestProduction } from "./productionApi";
import { blankRow, designIndex, parsePaste, resolveLogSheet, type LogCol, type LogRow } from "./productionLogSheetEdit";

const START_ROWS = 20;
const GROW_BY = 10;
const blanks = (n: number) => Array.from({ length: n }, blankRow);

// Only the optional columns are pickable — Design / Batch / Date / Qty always show.
const OPTIONAL: ColumnDef<LogRow>[] = [
  { key: "size", label: "Size" },
  { key: "brand", label: "Box Brand" },
  { key: "note", label: "Remark" },
];

/** Enter / ↓ / ↑ walk the same column. Comboboxes keep their own keys (option list). */
const walkColumn = (e: KeyboardEvent<HTMLTableSectionElement>) => {
  const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  const t = e.target;
  if (!step || !(t instanceof HTMLInputElement) || t.closest(".combo")) return;
  const col = t.closest("td")?.dataset.col;
  const tr = t.closest("tr");
  const next = (step > 0 ? tr?.nextElementSibling : tr?.previousElementSibling)?.querySelector<HTMLInputElement>(`td[data-col="${col}"] input`);
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.select();
};

export function ProductionLogSheet() {
  const navigate = useNavigate();
  const { designRows, salesPersons } = useMasters();
  const { brands, options: brandOptions } = useBoxBrands();
  const recordedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  const form = useFormSave(() => navigate("/prod"));

  const [rows, setRows] = useState<LogRow[]>(() => blanks(START_ROWS));
  const [prodDate, setProdDate] = useState(todayISO());
  const [showErrors, setShowErrors] = useState(false);
  // Save errors show in the foot, not as a toast — a sticky error toast sits on top of Save.
  const [saveError, setSaveError] = useState("");
  const cols = useColumns("productionLogSheetColumns", OPTIONAL);
  const shows = (key: string) => cols.visible.some((c) => c.key === key);

  const designById = useMemo(() => new Map(designRows.map((d) => [d.id, d])), [designRows]);
  const designOptions = useMemo<ComboOption[]>(
    () =>
      designRows
        .filter((d) => d.status !== "Inactive" && d.status !== "Discontinued")
        .map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined })),
    [designRows],
  );
  const lookups = useMemo(
    () => ({ designByKey: designIndex(designRows), brandByName: new Map(brands.map((b) => [b.name.trim().toLowerCase(), b._id])) }),
    [designRows, brands],
  );

  /** Patch rows from index `at` on; the sheet grows so there is always a blank tail. */
  const patchRows = (at: number, patches: Partial<LogRow>[]) => {
    form.touch();
    setRows((prev) => {
      const need = at + patches.length + 1 - prev.length;
      const next = need > 0 ? [...prev, ...blanks(Math.max(need, GROW_BY))] : [...prev];
      // A row whose job already exists keeps its item — the job was minted for it.
      patches.forEach((p, i) => {
        const cur = next[at + i];
        next[at + i] = cur.jobId ? { ...cur, ...p, design: cur.design, unmatched: "" } : { ...cur, ...p };
      });
      return next;
    });
  };
  const setCell = (i: number, patch: Partial<LogRow>) => patchRows(i, [patch]);
  const removeRow = (i: number) => {
    form.touch();
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : blanks(1)));
  };

  const onPaste = (e: ClipboardEvent<HTMLTableSectionElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return; // a single value pastes into the cell as usual
    const td = (e.target as HTMLElement).closest<HTMLElement>("td[data-col]");
    const at = Number(td?.closest<HTMLElement>("tr")?.dataset.i);
    if (!td || !Number.isInteger(at)) return;
    e.preventDefault();
    patchRows(at, parsePaste(text, td.dataset.col as LogCol, lookups));
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
      // 2 · record every row's output + complete (one request). Re-sent as is on a retry:
      // the server records qty − already recorded, so finished rows are no-ops.
      const done = await completeProduction({
        lines: lines
          .filter((l) => jobOf.has(l.key))
          .map((l) => ({
            id: jobOf.get(l.key)!,
            qty_boxes: l.qty,
            batch_number: l.batch || undefined,
            production_date: l.date,
            box_brand: l.brand || undefined,
            note: l.note,
          })),
        production_date: prodDate,
        performed_by: recordedBy,
      });
      invalidateBatchStock(); // rows before a failure are already in stock
      if (!done.ok) {
        setSaveError(`${done.error || "Save failed"} — fix and Save again; rows already recorded are not repeated`);
        return;
      }
      toast.success(`${lines.length} item${lines.length === 1 ? "" : "s"} recorded · ${fmt(totalBoxes)} boxes`);
      navigate("/prod", { replace: true });
    });

  if (!can("stages", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Record Production</div>
        </div>
      </div>

      <div className="card session-fill psheet">
        <div className="psheet-bar tools">
          <label className="dim nw" htmlFor="pls-date">Production date</label>
          <DateInput id="pls-date" value={prodDate} max={todayISO()} style={{ width: 150 }} onChange={(e) => setProdDate(e.target.value || todayISO())} />
          <span className="dim nw">Recorded by <b>{recordedBy || "—"}</b></span>
          <span style={{ flex: 1 }} />
          <span className="dim nw"><span className="req">*</span> Required</span>
          <ColumnPicker columns={cols.ordered} hidden={cols.hidden} onToggle={cols.toggle} onMove={cols.move} />
        </div>

        <div className="pane-scroll" style={{ overflowX: "auto" }}>
          <table className="psheet-tbl">
            <thead>
              <tr>
                <th className="rn" />
                <th className="cust">Design <span className="req">*</span></th>
                {shows("size") && <th>Size</th>}
                <th>Batch No.</th>
                <th>Date</th>
                <th className="num qtyh">Qty (boxes) <span className="req">*</span></th>
                {shows("brand") && <th>Box Brand</th>}
                {shows("note") && <th>Remark</th>}
                <th className="rm" />
              </tr>
            </thead>
            <tbody onKeyDown={walkColumn} onPaste={onPaste}>
              {rows.map((r, i) => {
                const d = designById.get(r.design);
                const filled = !!r.design && (parseInt(r.qty, 10) || 0) > 0;
                const rowBad = showErrors && errors.has(r.key);
                return (
                  <tr key={r.key} data-i={i} className={filled ? "on" : undefined}>
                    <td className={`rn mono ${rowBad ? "err" : ""}`}>{i + 1}</td>
                    <td className={`cust cellin ${bad(r, "design") ? "bad" : ""}`} data-col="design" style={{ minWidth: 300 }}>
                      <Combobox
                        value={r.design}
                        options={designOptions}
                        placeholder={r.unmatched || "Item…"}
                        invalid={bad(r, "design")}
                        disabled={!!r.jobId}
                        ariaLabel={`Design, row ${i + 1}`}
                        onChange={(v) => setCell(i, { design: v, unmatched: "" })}
                      />
                    </td>
                    {shows("size") && <td className="auto nw">{d?.sizeLabel || ""}</td>}
                    <td className={`cellin ${bad(r, "batch") ? "bad" : ""}`} data-col="batch" style={{ width: 150 }}>
                      <input className="mono" value={r.batch} placeholder="auto" aria-label={`Batch number, row ${i + 1}`} onChange={(e) => setCell(i, { batch: e.target.value })} />
                    </td>
                    <td className="cellin" data-col="date" style={{ width: 140 }}>
                      <DateInput value={r.date} max={todayISO()} style={{ width: "100%" }} aria-label={`Production date, row ${i + 1}`} onChange={(e) => setCell(i, { date: e.target.value })} />
                    </td>
                    <td className={`qty ${bad(r, "qty") ? "bad" : ""}`} data-col="qty">
                      <NumberInput maxDecimals={0} value={r.qty} placeholder="0" aria-label={`Boxes produced, row ${i + 1}`} onChange={(e) => setCell(i, { qty: e.target.value })} />
                    </td>
                    {shows("brand") && (
                      <td className="cellin" data-col="brand" style={{ minWidth: 170 }}>
                        <Combobox value={r.brand} options={brandOptions} placeholder="" ariaLabel={`Box brand, row ${i + 1}`} onChange={(v) => setCell(i, { brand: v })} />
                      </td>
                    )}
                    {shows("note") && (
                      <td className="cellin" data-col="note" style={{ minWidth: 200 }}>
                        <input value={r.note} aria-label={`Remark, row ${i + 1}`} onChange={(e) => setCell(i, { note: e.target.value })} />
                      </td>
                    )}
                    <td className="rm">
                      {/* A minted job is not dropped from here — delete it on /prod. */}
                      {!r.jobId && (
                        <button className="rm-x" tabIndex={-1} onClick={() => removeRow(i)} aria-label={`Remove row ${i + 1}`}>
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="rn" />
                <td className="cust">Total <span className="dim" style={{ fontWeight: 400 }}>· {lines.length} item{lines.length === 1 ? "" : "s"}</span></td>
                <td colSpan={shows("size") ? 3 : 2} />
                <td className="num mono">{fmt(totalBoxes)}</td>
                <td colSpan={cols.visible.filter((c) => c.key !== "size").length + 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="session-foot">
        <div className="psheet-stats">
          <span><i>Items</i><b className="mono">{lines.length}</b></span>
          <span><i>Boxes</i><b className="mono">{fmt(totalBoxes)}</b></span>
        </div>
        <span role="alert" style={{ color: "var(--c-red)" }}>
          {showErrors && errors.size > 0 ? `${errors.size} row${errors.size === 1 ? "" : "s"} to fix` : saveError}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => void form.cancel()} disabled={form.busy}>Cancel</button>
        <button className="hbtn primary" onClick={() => void save()} disabled={form.busy || lines.length === 0}>
          <Icon name="check" size={13} />
          {form.busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
