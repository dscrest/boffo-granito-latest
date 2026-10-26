/* ============================================================
   StockAdjustForm (CR-446, CR-457/458) — the Zoho-Books-shaped stock
   adjustment behind BOTH modules: Inventory ▸ Stock Adjustments ▸ New (boxes,
   Item · Batch) and Panel Craft ▸ Stock ▸ Adjust (pcs, Item · Cut Piece Size).
   A FormPage: HEADER (Mode of adjustment · Date · Reason · Description, plus
   From → To in transfer mode) over an ITEM TABLE — one line by default,
   "+ Add line" below. Quantity Adjustment: Item · Batch / Cut Size · Location ·
   Available · New on hand · signed Qty ("+10" / "-10") · Remark, saved through
   `spec.onSave` (every line stamped with the header date + reason). Location
   Transfer (CR-458): Item · Batch / Cut Size · Available at From · Qty to move ·
   Remark, saved as ONE Transfer Order through `spec.onTransfer` (TRF number,
   listed under Transfer Orders). `?mode=transfer` preselects the radio. The
   page supplies the items, the second column, the on-hand lookup, the warning
   and the two save calls; validation is pure (stockEntrySheetEdit.ts). The
   bulk sheets (Add Stock, Transfer Orders) stay on StockEntrySheet.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { toast } from "@/ui/Toast";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { listAdjustmentReasons } from "./adjustmentReasons";
import type { SheetHeader, StockEntrySpec } from "./StockEntrySheet";
import {
  blankAdjustRow,
  parseSignedQty,
  resolveAdjustLines,
  type AdjustCol,
  type AdjustHdrCol,
  type AdjustHeader,
  type AdjustLine,
  type AdjustMode,
  type AdjustRow,
} from "./stockEntrySheetEdit";

export type StockAdjustSpec = Pick<StockEntrySpec, "title" | "unit" | "items" | "second" | "warnFor" | "backTo"> & {
  /** On hand for (item, batch | cut size, location) — "" location = the plain total while warehouses are dormant; undefined = unknown → "—". */
  onHand: (designId: string, second: string, warehouse: string) => number | undefined;
  /** Quantity Adjustment — one signed adjust row per line; `date` / `reason` come from the header. */
  onSave: (lines: AdjustLine[]) => Promise<{ ok: boolean; error?: string }>;
  /** Location Transfer — ONE Transfer Order `h.from` → `h.to`; lines carry qty > 0. */
  onTransfer: (h: AdjustHeader, lines: AdjustLine[]) => Promise<{ ok: boolean; error?: string }>;
  /** `?design=` prefill for the first line. */
  initialDesign?: string;
};

const radio = { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" } as const;

export function StockAdjustForm({ spec }: { spec: StockAdjustSpec }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useFormSave(() => navigate(spec.backTo));
  const { options: whOptions, primary, enabled: whEnabled, nameOf } = useWarehouses();
  const [reasons, setReasons] = useState<ComboOption[]>([]);
  const [mode, setMode] = useState<AdjustMode>(() => (params.get("mode") === "transfer" ? "transfer" : "quantity"));
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AdjustRow[]>(() => [blankAdjustRow({ design: spec.initialDesign })]);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Dormant warehouses → nothing to move between; the radio is hidden and the form is a plain quantity adjustment.
  const transfer = mode === "transfer" && whEnabled;

  useEffect(() => {
    void listAdjustmentReasons().then(setReasons);
  }, []);
  // Lines (and the transfer's From) left without a location take the primary bay once it is known.
  useEffect(() => {
    if (!primary) return;
    setFrom((v) => v || primary.id);
    setRows((rs) => rs.map((r) => (r.warehouse ? r : { ...r, warehouse: primary.id })));
  }, [primary]);

  const itemOptions = useMemo<ComboOption[]>(
    () => spec.items.map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.hint })),
    [spec.items],
  );
  const header = useMemo<AdjustHeader>(
    () => ({ mode: transfer ? "transfer" : "quantity", date, reason, note: note.trim(), from: transfer ? from : "", to: transfer ? to : "" }),
    [transfer, date, reason, note, from, to],
  );
  /** The header the page's closures expect (optionsFor / warnFor) — the line's location, or From while transferring. */
  const hdr = (r: AdjustRow): SheetHeader => ({ date, reason, note, warehouse: transfer ? from : whEnabled ? r.warehouse : "", from: header.from, to: header.to });

  const set = <T,>(setter: (v: T) => void) => (v: T) => {
    form.touch();
    setter(v);
  };
  const setLine = (i: number, patch: Partial<AdjustRow>) => {
    form.touch();
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const addLine = () => {
    form.touch();
    setRows((rs) => [...rs, blankAdjustRow({ warehouse: rs[rs.length - 1].warehouse })]);
  };
  const removeLine = (i: number) => {
    form.touch();
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  };

  const { lines, errors, hdrErrors, totalIn, totalOut } = useMemo(
    () => resolveAdjustLines(rows, header, { secondRequired: spec.second.required, warehouseRequired: whEnabled }),
    [rows, header, spec.second.required, whEnabled],
  );
  const bad = (r: AdjustRow, col: AdjustCol) => showErrors && !!errors.get(r.key)?.has(col);
  const hdrBad = (col: AdjustHdrCol) => showErrors && hdrErrors.has(col);
  const lineByKey = useMemo(() => new Map(lines.map((l) => [l.key, l])), [lines]);

  const save = () =>
    form.run(async () => {
      if (errors.size > 0 || hdrErrors.size > 0) {
        setShowErrors(true);
        return;
      }
      setSaveError("");
      const res = transfer ? await spec.onTransfer(header, lines) : await spec.onSave(lines);
      if (!res.ok) {
        setSaveError(res.error || "Save failed");
        return;
      }
      toast.success(`${lines.length} line${lines.length === 1 ? "" : "s"} ${transfer ? "moved" : "saved"}`);
      navigate(spec.backTo, { replace: true });
    });

  const onCreateSecond = async (i: number, designId: string, text: string) => {
    if (!spec.second.onCreate) return;
    const v = await spec.second.onCreate(designId, text);
    if (v) setLine(i, { second: v });
  };

  const n = lines.length;
  const footNote =
    showErrors && errors.size + hdrErrors.size > 0 ? (
      <span style={{ color: "var(--c-red)" }}>
        {[errors.size ? `${errors.size} line${errors.size === 1 ? "" : "s"} to fix` : "", hdrErrors.size ? "header fields to fix" : ""].filter(Boolean).join(" · ")}
      </span>
    ) : saveError ? (
      <span role="alert" style={{ color: "var(--c-red)" }}>{saveError}</span>
    ) : transfer ? (
      <>
        <span className="req">*</span> indicates a mandatory field · {n} line{n === 1 ? "" : "s"} · <span className="mono">{fmt(totalOut)}</span> {spec.unit} {from ? nameOf(from) : "From"} → {to ? nameOf(to) : "To"}
      </>
    ) : (
      <>
        <span className="req">*</span> indicates a mandatory field · {n} line{n === 1 ? "" : "s"} · <span className="mono">+{fmt(totalIn)} / −{fmt(totalOut)}</span> {spec.unit}
      </>
    );

  const lineCls = `ord-line adj-line${transfer ? " xfer" : whEnabled ? " wh" : ""}`;

  return (
    <FormPage title={spec.title} note={footNote} busy={form.busy} onCancel={() => void form.cancel()} onSave={() => void save()}>
      <div className="form-section">
        <div className="form-section-title">Adjustment</div>
        <div className="form-rows">
          {whEnabled && (
            <div className="form-field span2">
              <span className="lbl">Mode of adjustment</span>
              <div className="ctl-row" role="radiogroup" aria-label="Mode of adjustment" style={{ gap: 16 }}>
                <label style={radio}>
                  <input type="radio" name="adj-mode" checked={!transfer} onChange={() => set(setMode)("quantity")} /> Quantity Adjustment
                </label>
                <label style={radio}>
                  <input type="radio" name="adj-mode" checked={transfer} onChange={() => set(setMode)("transfer")} /> Location Transfer
                </label>
              </div>
            </div>
          )}
          <label className="form-field">
            <span className="lbl">Date<span className="req"> *</span></span>
            <DateInput value={date} max={todayISO()} className={hdrBad("date") ? "error" : undefined} onChange={(e) => set(setDate)(e.target.value || todayISO())} />
          </label>
          <label className="form-field">
            <span className="lbl">Reason<span className="req"> *</span></span>
            <Combobox value={reason} options={reasons} placeholder="Reason…" invalid={hdrBad("reason")} ariaLabel="Reason" onChange={set(setReason)} />
          </label>
          {transfer && (
            <>
              <label className="form-field">
                <span className="lbl">From location<span className="req"> *</span></span>
                <Combobox value={from} options={whOptions} clearable={false} maxVisible={120} invalid={hdrBad("from")} ariaLabel="From location" onChange={set(setFrom)} />
              </label>
              <label className="form-field">
                <span className="lbl">To location<span className="req"> *</span></span>
                <Combobox value={to} options={whOptions.filter((o) => o.value !== from)} maxVisible={120} invalid={hdrBad("to")} ariaLabel="To location" onChange={set(setTo)} />
              </label>
            </>
          )}
          <label className="form-field span2">
            <span className="lbl">Description</span>
            <textarea value={note} placeholder="Optional" onChange={(e) => set(setNote)(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Item Table</div>
        <div className="ord-lines">
          <div className={`${lineCls} ord-line-head`}>
            <span>Item<span className="req"> *</span></span>
            <span>{spec.second.label}{spec.second.required && <span className="req"> *</span>}</span>
            {!transfer && whEnabled && <span>Location<span className="req"> *</span></span>}
            <span>{transfer ? "Available at From" : "Available"}</span>
            {!transfer && <span>New on hand</span>}
            <span>{transfer ? "Qty to move" : "Qty adjusted"}<span className="req"> *</span></span>
            <span>Remark</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const secondDisabled = !r.design || !!spec.second.disabledFor?.(r.design);
            const second = secondDisabled ? "" : r.second;
            const have = r.design && (second || secondDisabled || !spec.second.required) ? spec.onHand(r.design, second, hdr(r).warehouse) : undefined;
            const delta = parseSignedQty(r.qty);
            const after = have == null ? "—" : fmt(have + (Number.isFinite(delta) ? delta : 0));
            const line = lineByKey.get(r.key);
            // A transfer takes stock OUT of From — the pages' warnFor already read a negative qty as a removal at `h.warehouse`.
            const warn = line && spec.warnFor ? spec.warnFor(transfer ? { ...line, qty: -line.qty } : line, hdr(r)) : undefined;
            return (
              <div key={r.key} className={lineCls}>
                <Combobox
                  value={r.design}
                  options={itemOptions}
                  placeholder="Item…"
                  invalid={bad(r, "design")}
                  ariaLabel={`Item, line ${i + 1}`}
                  onChange={(v) => setLine(i, { design: v, ...(v !== r.design ? { second: "" } : {}) })}
                />
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
                {!transfer && whEnabled && (
                  <Combobox value={r.warehouse} options={whOptions} clearable={false} maxVisible={120} invalid={bad(r, "warehouse")} ariaLabel={`Location, line ${i + 1}`} onChange={(v) => setLine(i, { warehouse: v })} />
                )}
                {/* .form-field wrappers: the read-only / error input skins are scoped to it. */}
                <div className="form-field">
                  <input readOnly tabIndex={-1} className="mono" value={have == null ? "—" : fmt(have)} aria-label={`Available, line ${i + 1}`} title="On hand before this entry" />
                </div>
                {!transfer && (
                  <div className="form-field">
                    <input readOnly tabIndex={-1} className="mono" value={after} aria-label={`New on hand, line ${i + 1}`} />
                  </div>
                )}
                <div className="form-field">
                  <input
                    className={`mono${bad(r, "qty") ? " error" : ""}`}
                    inputMode="numeric"
                    value={r.qty}
                    placeholder={transfer ? "0" : "Eg. +10, -10"}
                    aria-label={`Quantity, line ${i + 1}`}
                    onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d+\-−]/g, "") })}
                  />
                </div>
                <input value={r.note} placeholder="Optional" aria-label={`Remark, line ${i + 1}`} onChange={(e) => setLine(i, { note: e.target.value })} />
                <button type="button" className="btn ord-rm" disabled={rows.length === 1 || form.busy} onClick={() => removeLine(i)} title="Remove line" aria-label={`Remove line ${i + 1}`} tabIndex={-1}>
                  ✕
                </button>
                {warn && <span className="warn">{warn}</span>}
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
