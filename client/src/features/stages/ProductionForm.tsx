/* ============================================================
   Log Production form — records a production update against an
   active order/job. Maps to the Catalyst `OrderItemEvent`
   (event_type=production_update, qty_delta) + bumps
   `OrderItem.produced_qty_boxes`. FRONTEND-ONLY: emits a
   ProductionLog to Production's local state (no DB writes yet).
   Reuses shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import type { Order } from "@/data";

export interface ProductionLog {
  _id: string;
  order: string; // order id
  orderLabel: string;
  design: string;
  qty_delta: string; // boxes produced this entry
  production_date: string;
  shift: string;
  performed_by: string;
  note: string;
}

const SHIFTS = ["A (07:00–15:00)", "B (15:00–23:00)", "C (23:00–07:00)"];

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `pl${++_seq}`;

export function ProductionForm({
  jobs,
  onSave,
  onClose,
}: {
  /** Live active jobs (stage prod/packing) passed down from Production. */
  jobs: Order[];
  onSave: (l: ProductionLog) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    order: "",
    qty_delta: "",
    production_date: "",
    shift: SHIFTS[0],
    performed_by: "",
    note: "",
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const job = jobs.find((o) => o.id === v.order);
  const missing = !v.order || !v.qty_delta.trim() || (parseInt(v.qty_delta, 10) || 0) <= 0;

  const submit = () => {
    if (missing || !job) return;
    onSave({
      ...v,
      _id: newId(),
      orderLabel: `${job.poNumber} · ${job.party}`,
      design: job.design,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="factory" size={18} />
          </div>
          <div>
            <div className="ttl">Log Production</div>
            <div className="sub2">Production update · local draft — not yet saved to database</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Job</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">
                  Order / Job<span className="req"> *</span>
                </span>
                <select value={v.order} onChange={(e) => set("order", e.target.value)}>
                  <option value="">Select active job…</option>
                  {jobs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.poNumber} · {o.design} · {o.party}
                    </option>
                  ))}
                </select>
                {job && (
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    {job.size} · {job.finish} · ordered {job.orderQty} · produced {job.producedQty}
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Entry</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Produced<span className="hint"> (boxes)</span>
                  <span className="req"> *</span>
                </span>
                <input type="number" value={v.qty_delta} onChange={(e) => set("qty_delta", e.target.value)} placeholder="0" />
              </label>
              <label className="form-field">
                <span className="lbl">Date</span>
                <DateInput value={v.production_date} onChange={(e) => set("production_date", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Shift</span>
                <select value={v.shift} onChange={(e) => set("shift", e.target.value)}>
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Logged by</span>
                <input value={v.performed_by} onChange={(e) => set("performed_by", e.target.value)} placeholder="Operator / supervisor" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Note</span>
                <input value={v.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional remark (defects, hold, etc.)" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            Log production
          </button>
        </div>
      </div>
    </div>
  );
}
