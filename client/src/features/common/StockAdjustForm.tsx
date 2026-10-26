/* ============================================================
   StockAdjustForm (CR-446) — the Zoho-Books-shaped stock adjustment behind
   BOTH modules: Inventory ▸ Stock Adjustments ▸ New (boxes, Item · Batch) and
   Panel Craft ▸ Stock ▸ Adjust (pcs, Item · Cut Piece Size). A FormPage with
   ONE line by default and "+ Add line" below; NO header fields — every line
   carries its own Location · Current stock (read-only) · Add / Remove · Qty ·
   Date · Reason · Remark. "+ Add line" copies the previous line's date,
   location and reason. The page supplies a `spec`: the items, what the second
   column is, the on-hand lookup, the warning, how to save. Validation lives in
   stockEntrySheetEdit.ts (resolveAdjustLines, pure). Add Stock / Transfers stay
   on the bulk StockEntrySheet — the adjustment looks different on purpose.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { listAdjustmentReasons } from "./adjustmentReasons";
import type { SheetHeader, StockEntrySpec } from "./StockEntrySheet";
import { blankAdjustRow, resolveAdjustLines, type AdjustCol, type AdjustLine, type AdjustRow } from "./stockEntrySheetEdit";

export type StockAdjustSpec = Pick<StockEntrySpec, "title" | "unit" | "items" | "second" | "warnFor" | "backTo"> & {
  /** On hand for (item, batch | cut size, location) — "" location = the plain total while warehouses are dormant; undefined = unknown → "—". */
  onHand: (designId: string, second: string, warehouse: string) => number | undefined;
  onSave: (lines: AdjustLine[]) => Promise<{ ok: boolean; error?: string }>;
  /** `?design=` prefill for the first line. */
  initialDesign?: string;
};

const DIR_OPTIONS: ComboOption[] = [
  { value: "out", label: "Remove" },
  { value: "in", label: "Add" },
];

export function StockAdjustForm({ spec }: { spec: StockAdjustSpec }) {
  const navigate = useNavigate();
  const form = useFormSave(() => navigate(spec.backTo));
  const { options: whOptions, primary, enabled: whEnabled } = useWarehouses();
  const [reasons, setReasons] = useState<ComboOption[]>([]);
  const [rows, setRows] = useState<AdjustRow[]>(() => [blankAdjustRow({ date: todayISO(), design: spec.initialDesign })]);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    void listAdjustmentReasons().then(setReasons);
  }, []);
  // Lines left without a location take the primary bay once it is known (the sheet's rule).
  useEffect(() => {
    if (!primary) return;
    setRows((rs) => rs.map((r) => (r.warehouse ? r : { ...r, warehouse: primary.id })));
  }, [primary]);

  const itemOptions = useMemo<ComboOption[]>(
    () => spec.items.map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.hint })),
    [spec.items],
  );
  /** The header the page's closures expect — fabricated from the LINE (CR-446: every bar field is per line). */
  const hdr = (r: AdjustRow): SheetHeader => ({ date: r.date, reason: r.reason, note: r.note, warehouse: whEnabled ? r.warehouse : "", from: "", to: "" });

  const setLine = (i: number, patch: Partial<AdjustRow>) => {
    form.touch();
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const addLine = () => {
    form.touch();
    setRows((rs) => {
      const last = rs[rs.length - 1];
      return [...rs, blankAdjustRow({ date: last.date, warehouse: last.warehouse, reason: last.reason })];
    });
  };
  const removeLine = (i: number) => {
    form.touch();
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  };

  const { lines, errors, totalIn, totalOut } = useMemo(
    () => resolveAdjustLines(rows, { secondRequired: spec.second.required, warehouseRequired: whEnabled }),
    [rows, spec.second.required, whEnabled],
  );
  const bad = (r: AdjustRow, col: AdjustCol) => showErrors && !!errors.get(r.key)?.has(col);
  const lineByKey = useMemo(() => new Map(lines.map((l) => [l.key, l])), [lines]);

  const save = () =>
    form.run(async () => {
      if (errors.size > 0) {
        setShowErrors(true);
        return;
      }
      setSaveError("");
      const res = await spec.onSave(lines);
      if (!res.ok) {
        setSaveError(res.error || "Save failed");
        return;
      }
      toast.success(`${lines.length} line${lines.length === 1 ? "" : "s"} saved`);
      navigate(spec.backTo, { replace: true });
    });

  const onCreateSecond = async (i: number, designId: string, text: string) => {
    if (!spec.second.onCreate) return;
    const v = await spec.second.onCreate(designId, text);
    if (v) setLine(i, { second: v });
  };

  const note =
    showErrors && errors.size > 0 ? (
      <span style={{ color: "var(--c-red)" }}>{errors.size} line{errors.size === 1 ? "" : "s"} to fix</span>
    ) : saveError ? (
      <span role="alert" style={{ color: "var(--c-red)" }}>{saveError}</span>
    ) : (
      <>
        <span className="req">*</span> indicates a mandatory field · {lines.length} line{lines.length === 1 ? "" : "s"} · <span className="mono">+{fmt(totalIn)} / −{fmt(totalOut)}</span> {spec.unit}
      </>
    );

  return (
    <FormPage title={spec.title} note={note} busy={form.busy} onCancel={() => void form.cancel()} onSave={() => void save()}>
      <div className="form-section">
        <div className="form-section-title">Lines</div>
        {rows.map((r, i) => {
          const secondDisabled = !r.design || !!spec.second.disabledFor?.(r.design);
          const second = secondDisabled ? "" : r.second;
          const have = r.design && (second || secondDisabled || !spec.second.required) ? spec.onHand(r.design, second, hdr(r).warehouse) : undefined;
          const line = lineByKey.get(r.key);
          const warn = line && spec.warnFor ? spec.warnFor(line, hdr(r)) : undefined;
          return (
            <div key={r.key} className="adj-line">
              <label className="form-field">
                <span className="lbl">Item<span className="req"> *</span></span>
                <Combobox
                  value={r.design}
                  options={itemOptions}
                  placeholder="Item…"
                  invalid={bad(r, "design")}
                  ariaLabel={`Item, line ${i + 1}`}
                  onChange={(v) => setLine(i, { design: v, ...(v !== r.design ? { second: "" } : {}) })}
                />
              </label>
              <label className="form-field">
                <span className="lbl">{spec.second.label}{spec.second.required && <span className="req"> *</span>}</span>
                {spec.second.optionsFor ? (
                  <Combobox
                    value={r.second}
                    options={r.design ? spec.second.optionsFor(r.design, hdr(r)) : []}
                    placeholder={secondDisabled ? "" : spec.second.placeholder || `${spec.second.label}…`}
                    invalid={bad(r, "second")}
                    disabled={secondDisabled}
                    ariaLabel={`${spec.second.label}, line ${i + 1}`}
                    onCreate={spec.second.onCreate ? (text) => void onCreateSecond(i, r.design, text) : undefined}
                    onChange={(v) => setLine(i, { second: v })}
                  />
                ) : (
                  <input
                    className={`mono${bad(r, "second") ? " error" : ""}`}
                    value={r.second}
                    placeholder={secondDisabled ? "" : spec.second.placeholder}
                    disabled={secondDisabled}
                    aria-label={`${spec.second.label}, line ${i + 1}`}
                    onChange={(e) => setLine(i, { second: e.target.value })}
                  />
                )}
              </label>
              {whEnabled && (
                <label className="form-field">
                  <span className="lbl">Location<span className="req"> *</span></span>
                  <Combobox value={r.warehouse} options={whOptions} clearable={false} maxVisible={120} invalid={bad(r, "warehouse")} ariaLabel={`Location, line ${i + 1}`} onChange={(v) => setLine(i, { warehouse: v })} />
                </label>
              )}
              <label className="form-field">
                <span className="lbl">Current stock</span>
                <input readOnly tabIndex={-1} value={have == null ? "—" : `${fmt(have)} ${spec.unit}`} aria-label={`Current stock, line ${i + 1}`} title="On hand at that location before this adjustment" />
              </label>
              <label className="form-field">
                <span className="lbl">Add / Remove</span>
                <Combobox value={r.out ? "out" : "in"} options={DIR_OPTIONS} clearable={false} ariaLabel={`Add or remove, line ${i + 1}`} onChange={(v) => setLine(i, { out: v !== "in" })} />
              </label>
              <label className="form-field">
                <span className="lbl">Qty ({spec.unit})<span className="req"> *</span></span>
                <NumberInput maxDecimals={0} value={r.qty} placeholder="0" className={bad(r, "qty") ? "error" : undefined} aria-label={`Quantity, line ${i + 1}`} onChange={(e) => setLine(i, { qty: e.target.value })} />
              </label>
              <label className="form-field date">
                <span className="lbl">Date<span className="req"> *</span></span>
                <DateInput value={r.date} max={todayISO()} className={bad(r, "date") ? "error" : undefined} onChange={(e) => setLine(i, { date: e.target.value || todayISO() })} />
              </label>
              <label className="form-field reason">
                <span className="lbl">Reason<span className="req"> *</span></span>
                <Combobox value={r.reason} options={reasons} placeholder="Reason…" invalid={bad(r, "reason")} ariaLabel={`Reason, line ${i + 1}`} onChange={(v) => setLine(i, { reason: v })} />
              </label>
              <label className="form-field remark">
                <span className="lbl">Remark</span>
                <input value={r.note} placeholder="Optional" aria-label={`Remark, line ${i + 1}`} onChange={(e) => setLine(i, { note: e.target.value })} />
              </label>
              <button type="button" className="btn ord-rm rm" disabled={rows.length === 1 || form.busy} onClick={() => removeLine(i)} title="Remove line" aria-label={`Remove line ${i + 1}`} tabIndex={-1}>
                ✕
              </button>
              {warn && <span className="warn">{warn}</span>}
            </div>
          );
        })}
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={addLine} disabled={form.busy}>
          <Icon name="plus" size={12} /> Add line
        </button>
      </div>
    </FormPage>
  );
}
