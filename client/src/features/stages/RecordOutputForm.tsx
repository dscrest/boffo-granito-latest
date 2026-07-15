/* ============================================================
   Record Output — logs the ACTUAL boxes produced against an approved
   production line via /production-record. Bumps OrderItem.produced
   (order-linked, capped at remaining) and marks the entry Produced.
   Small focused modal, reused by the Production grid + detail.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { fmt } from "@/lib/format";
import type { ProductionEntry, ProductionRecordInput } from "./productionApi";

const SHIFTS = ["A (07:00–15:00)", "B (15:00–23:00)", "C (23:00–07:00)"];

export function RecordOutputForm({
  entry,
  onSave,
  onClose,
}: {
  entry: ProductionEntry;
  onSave: (input: ProductionRecordInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  // Order-linked lines cap at remaining (ordered − produced); independent: free.
  const remaining = entry.orderItemId ? Math.max(0, entry.ordered - entry.produced) : 0;
  const cap = entry.orderItemId ? remaining : Infinity;

  const [qty, setQty] = useState(String(entry.orderItemId ? Math.min(entry.qtyRequested, remaining) : entry.qtyRequested));
  const [date, setDate] = useState(entry.productionDate || "");
  const [shift, setShift] = useState(entry.shift || SHIFTS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyNum = parseInt(qty, 10) || 0;
  const over = entry.orderItemId && qtyNum > cap;
  const missing = qtyNum <= 0 || over;

  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      await onSave({
        qty_boxes: qtyNum,
        production_date: date,
        shift,
        performed_by: loggedBy,
        note: note.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="factory" size={18} /></div>
          <div>
            <div className="ttl">Record Output</div>
            <div className="sub2">Actual boxes produced · {entry.design}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Produced</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Boxes produced<span className="req"> *</span></span>
                <input
                  type="number"
                  min={0}
                  max={entry.orderItemId ? cap : undefined}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
                <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                  Requested {fmt(entry.qtyRequested)}
                  {entry.orderItemId ? ` · ${fmt(remaining)} still owed on the order` : " · make-to-stock"}
                </span>
                {over && <span className="field-err">Exceeds the {fmt(cap)} boxes still owed on this order line</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Shift</span>
                <select value={shift} onChange={(e) => setShift(e.target.value)}>
                  {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Logged by</span>
                <input value={loggedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional remark (defects, hold, etc.)" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={missing || saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Record output"}
          </button>
        </div>
      </div>
    </div>
  );
}
