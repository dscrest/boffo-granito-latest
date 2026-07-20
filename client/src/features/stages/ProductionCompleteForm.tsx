/* ============================================================
   Production Completion — the final stage (QC → Completed). Captures the ACTUAL
   boxes produced per plan line (may be less OR more than requested), which is the
   single moment available stock moves. Requested is shown for reference; Produced
   defaults to it and is editable up or down.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { NumberInput } from "@/ui/NumberInput";
import type { ProductionRequestGroup } from "./productionApi";

export interface ProductionCompleteResult {
  lines: { id: string; qty_boxes: number }[];
  production_date: string;
  performed_by: string;
  note: string;
}

export function ProductionCompleteForm({
  group,
  onSave,
  onClose,
}: {
  group: ProductionRequestGroup;
  onSave: (result: ProductionCompleteResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  const lines = useMemo(() => group.entries, [group]);
  // Produced defaults to the requested qty per line; keyed by plan-line id.
  const [produced, setProduced] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((e) => [e.id, String(e.qtyRequested)])),
  );
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const panelRef = useModalA11y(onClose);

  const totalProduced = lines.reduce((s, e) => s + (parseInt(produced[e.id], 10) || 0), 0);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        lines: lines.map((e) => ({ id: e.id, qty_boxes: parseInt(produced[e.id], 10) || 0 })),
        production_date: date,
        performed_by: loggedBy,
        note: note.trim(),
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
            <div className="ttl">Production Completion — {group.code}</div>
            <div className="sub2">Actual boxes produced · updates available stock</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Items</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Design</th>
                  <th className="num" style={{ textAlign: "right" }}>Requested</th>
                  <th className="num" style={{ textAlign: "right", width: 120 }}>Produced</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((e) => (
                  <tr key={e.id}>
                    <td><span className="design-name">{e.design || "—"}</span></td>
                    <td className="num mono">{fmt(e.qtyRequested)}</td>
                    <td className="num">
                      <NumberInput
                        min={0}
                        value={produced[e.id] ?? ""}
                        onChange={(ev) => setProduced((p) => ({ ...p, [e.id]: ev.target.value }))}
                        placeholder="0"
                        style={{ width: 100, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-section">
            <div className="form-section-title">Completion</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Completion Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Logged by</span>
                <input value={loggedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Notes</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional completion note" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="dim" style={{ marginRight: "auto", fontSize: "var(--t-sm)" }}>{fmt(totalProduced)} boxes total</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
