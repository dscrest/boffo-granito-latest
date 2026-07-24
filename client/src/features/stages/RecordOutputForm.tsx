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
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import type { ProductionEntry, ProductionRecordInput } from "./productionApi";
import { NumberInput } from "../../ui/NumberInput";

export function RecordOutputForm({
  entry,
  step,
  onSave,
  onClose,
}: {
  entry: ProductionEntry;
  /** When walking a Record-all queue: which line this is (1-based) of how many. */
  step?: { n: number; of: number };
  onSave: (input: ProductionRecordInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  // Cap at what's still owed on THIS plan line (requested − produced-so-far). For
  // order-linked lines also respect the order's own remaining (ordered − produced).
  const lineRemaining = Math.max(0, entry.qtyRequested - entry.producedSoFar);
  const orderRemaining = entry.orderItemId ? Math.max(0, entry.ordered - entry.produced) : Infinity;
  const remaining = Math.min(lineRemaining, orderRemaining);
  const cap = remaining;

  const [qty, setQty] = useState(String(remaining));
  const [date, setDate] = useState(entry.productionDate || todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyNum = parseInt(qty, 10) || 0;
  const over = qtyNum > cap;
  const missing = qtyNum <= 0 || over;

  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    try {
      await onSave({
        qty_boxes: qtyNum,
        production_date: date,
        performed_by: loggedBy,
        note: note.trim() || undefined,
      });
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
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Boxes produced<span className="req"> *</span></span>
                <NumberInput
                  min={0}
                  max={Number.isFinite(cap) ? cap : undefined}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
                <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                  Requested {fmt(entry.qtyRequested)} · {fmt(remaining)} still to produce
                  {entry.orderItemId ? " on this line" : " · make-to-stock"}
                </span>
                {over && <span className="field-err">Exceeds the {fmt(cap)} boxes still to produce</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
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
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
