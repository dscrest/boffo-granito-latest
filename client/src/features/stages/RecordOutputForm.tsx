/* ============================================================
   Record Output — logs the ACTUAL boxes produced against an approved
   production line. One uniform line layout (mfg date · qty · remark, + Add
   line); batch-tracked items add a mandatory batch no. per line and save via
   /production-record-lines, singular items save one /production-record per
   line. Bumps OrderItem.produced (order-linked, capped at
   remaining). Reused by the Production grid + detail.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { ProductionEntry, ProductionRecordInput, ProductionRecordLine } from "./productionApi";
import { batchNumberExists } from "./productionApi";
import { cachedAllowDupBatches, loadAllowDupBatches } from "@/features/settings/settingsApi";
import { NumberInput } from "../../ui/NumberInput";

/** What the form emits — routed by the parent to the right endpoint. `total` is
    the summed boxes (for the completion check + toast). Non-batched items emit
    one single per line (parent loops /production-record). */
export type RecordOutputPayload =
  | { singles: ProductionRecordInput[] }
  | { batches: { rows: ProductionRecordLine[]; performed_by?: string } };

export function RecordOutputForm({
  entry,
  step,
  onSave,
  onClose,
}: {
  entry: ProductionEntry;
  /** When walking a Record-all queue: which line this is (1-based) of how many. */
  step?: { n: number; of: number };
  onSave: (payload: RecordOutputPayload, total: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  // Batched vs singular drives the whole form; load designs if the cache is cold.
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  useEffect(() => {
    if (!designs) void listDesigns().then((r) => r.ok && setDesigns(r.designs));
  }, [designs]);
  const isBatched = useMemo(
    () => (designs || []).find((d) => d.id === entry.designId)?.isBatched ?? false,
    [designs, entry.designId],
  );

  // Cap at what's still owed on THIS plan line (requested − produced-so-far). For
  // order-linked lines also respect the order's own remaining (ordered − produced).
  const lineRemaining = Math.max(0, entry.qtyRequested - entry.producedSoFar);
  const orderRemaining = entry.orderItemId ? Math.max(0, entry.ordered - entry.produced) : Infinity;
  const remaining = Math.min(lineRemaining, orderRemaining);
  const cap = remaining;

  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  // One rows array for both modes (mfg date · qty · remark each, + Add line,
  // like OrderForm); batch-tracked items add a mandatory batch no. per line.
  type BatchRow = { batch: string; date: string; qty: string; note: string };
  const emptyRow = (rowQty = ""): BatchRow => ({
    batch: "",
    date: entry.productionDate || todayISO(),
    qty: rowQty,
    note: "",
  });
  const [rows, setRows] = useState<BatchRow[]>(() => [emptyRow(String(remaining))]);
  const setRow = (i: number, k: keyof BatchRow, val: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const addLine = () => setRows((rs) => [...rs, emptyRow()]);
  const removeLine = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  // Duplicate-batch pre-check (server 409 is the source of truth): same batch
  // twice in this form, same item + same batch always blocked; cross-item reuse
  // only when the setting is off.
  const [allowDup, setAllowDup] = useState(cachedAllowDupBatches());
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
  }, []);
  const dupKind = (r: BatchRow, i: number): "form" | "item" | "global" | null => {
    const b = r.batch.trim().toLowerCase();
    if (!b) return null;
    if (rows.some((o, j) => j !== i && o.batch.trim().toLowerCase() === b)) return "form";
    if (batchNumberExists(r.batch, entry.design)) return "item";
    if (!allowDup && batchNumberExists(r.batch)) return "global";
    return null;
  };

  const total = rows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
  const over = total > cap;
  const missing =
    total <= 0 ||
    over ||
    rows.some((r, i) => (parseInt(r.qty, 10) || 0) <= 0 || (isBatched && (!r.batch.trim() || dupKind(r, i) !== null)));

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      if (isBatched) {
        const lines: ProductionRecordLine[] = rows.map((r) => ({
          qty_boxes: parseInt(r.qty, 10) || 0,
          batch_number: r.batch.trim(),
          mfg_date: r.date || undefined,
          note: r.note.trim() || undefined,
        }));
        await onSave({ batches: { rows: lines, performed_by: loggedBy } }, total);
      } else {
        const singles: ProductionRecordInput[] = rows.map((r) => ({
          qty_boxes: parseInt(r.qty, 10) || 0,
          production_date: r.date,
          performed_by: loggedBy,
          note: r.note.trim() || undefined,
        }));
        await onSave({ singles }, total);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="factory" size={18} /></div>
          <div>
            <div className="ttl">Record Output{step ? ` — Line ${step.n} of ${step.of}` : ""}</div>
            <div className="sub2">{entry.design}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Produced</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 8 }}>
              Requested {fmt(entry.qtyRequested)} · {fmt(remaining)} still to produce
              {entry.orderItemId ? " on this line" : " · make-to-stock"}
            </div>

            {rows.map((r, i) => {
              const dup = isBatched ? dupKind(r, i) : null;
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: i ? 10 : 0 }}>
                  {/* One line per record: wide batch/remark, narrow date/qty.
                      Non-batched items get the same line minus the Batch No. column. */}
                  <div
                    className="form-grid"
                    style={{ flex: 1, gridTemplateColumns: isBatched ? "1.5fr 0.8fr 0.6fr 1.1fr" : "0.8fr 0.6fr 1.1fr" }}
                  >
                    {isBatched && (
                      <label className="form-field">
                        <span className="lbl">Batch No.<span className="req"> *</span></span>
                        <input
                          value={r.batch}
                          onChange={(e) => setRow(i, "batch", e.target.value)}
                          placeholder="e.g. B/26-27/001"
                          autoFocus={i === 0}
                        />
                        {dup && (
                          <span className="field-err">
                            {dup === "form"
                              ? `Batch “${r.batch.trim()}” is entered twice`
                              : dup === "item"
                                ? `Batch “${r.batch.trim()}” is already used for this item`
                                : `Batch “${r.batch.trim()}” already exists — duplicate batch numbers are disabled in Settings`}
                          </span>
                        )}
                      </label>
                    )}
                    <label className="form-field">
                      <span className="lbl">Mfg date</span>
                      <DateInput value={r.date} onChange={(e) => setRow(i, "date", e.target.value)} />
                    </label>
                    <label className="form-field">
                      <span className="lbl">Qty (boxes)<span className="req"> *</span></span>
                      <NumberInput
                        min={0}
                        max={Number.isFinite(cap) ? cap : undefined}
                        value={r.qty}
                        onChange={(e) => setRow(i, "qty", e.target.value)}
                        placeholder="0"
                        autoFocus={!isBatched && i === 0}
                      />
                    </label>
                    <label className="form-field">
                      <span className="lbl">Remark</span>
                      <input value={r.note} onChange={(e) => setRow(i, "note", e.target.value)} placeholder="Optional" />
                    </label>
                  </div>
                  {rows.length > 1 && (
                    <button
                      className="btn ord-rm"
                      style={{ marginTop: 24 }}
                      onClick={() => removeLine(i)}
                      title="Remove line"
                      tabIndex={-1}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {over && (
              <div style={{ marginTop: 6 }}>
                <span className="field-err">Exceeds the {fmt(cap)} boxes still to produce</span>
              </div>
            )}
            <button className="btn" style={{ marginTop: 10 }} onClick={addLine}>
              <Icon name="plus" size={12} /> Add line
            </button>

            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>Logged by {loggedBy || "—"}</div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={missing || saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
