/* ============================================================
   Production QC — captured when a card moves In Production → QC. Records an
   item-wise QC remark per plan line plus an overall note, so the checker's
   findings are visible before the batch is completed. Remarks ride along on the
   stage transition (persisted in the Activity feed) — no new columns.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { todayISO } from "@/lib/dates";
import type { ProductionRequestGroup } from "./productionApi";

export interface ProductionQCResult {
  notes: Record<string, string>; // plan-line id → remark
  note: string; // overall QC note
  date: string;
}

export function ProductionQCForm({
  group,
  onSave,
  onClose,
}: {
  group: ProductionRequestGroup;
  onSave: (result: ProductionQCResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const lines = useMemo(() => group.entries, [group]);
  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const notes: Record<string, string> = {};
      for (const e of lines) {
        const r = (remarks[e.id] || "").trim();
        if (r) notes[e.id] = r;
      }
      await onSave({ notes, note: note.trim(), date });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="check" size={18} /></div>
          <div>
            <div className="ttl">QC Check — {group.code}</div>
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
                  <th style={{ width: "55%" }}>QC Remark</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((e) => (
                  <tr key={e.id}>
                    <td><span className="design-name">{e.design || "—"}</span></td>
                    <td>
                      <input
                        value={remarks[e.id] || ""}
                        onChange={(ev) => setRemarks((p) => ({ ...p, [e.id]: ev.target.value }))}
                        placeholder="Pass / defect / hold…"
                        style={{ width: "100%" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-section">
            <div className="form-section-title">Overall</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">QC Date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Notes</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional overall QC note" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
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
