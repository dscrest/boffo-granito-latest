/* ============================================================
   Edit Production — adjust the requested boxes per plan line (and a shared note)
   before any output is recorded. Small focused modal, mirrors RecordOutputForm.
   Only offered while nothing has been produced (guarded server-side too).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { updateProductionLine, type ProductionRequestGroup } from "./productionApi";
import { NumberInput } from "../../ui/NumberInput";

export function ProductionEditForm({
  group,
  onSaved,
  onClose,
}: {
  group: ProductionRequestGroup;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(group.entries.map((e) => [e.id, String(e.qtyRequested)])),
  );
  const [note, setNote] = useState(group.entries[0]?.note || "");
  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    let failed = 0;
    for (const e of group.entries) {
      const next = parseInt(qty[e.id], 10) || 0;
      const changedQty = next > 0 && next !== e.qtyRequested;
      const changedNote = note !== (e.note || "");
      if (!changedQty && !changedNote) continue;
      const res = await updateProductionLine(e.id, {
        ...(changedQty ? { qty_requested: next } : {}),
        ...(changedNote ? { note } : {}),
      });
      if (!res.ok) {
        failed += 1;
        toast.error(res.error || "Update failed");
      }
    }
    setSaving(false);
    if (!failed) toast.success("Production updated");
    await onSaved();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="factory" size={18} /></div>
          <div>
            <div className="ttl">Edit Production</div>
            <div className="sub2">{group.code}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Size / Finish</th>
                  <th className="num" style={{ textAlign: "right", width: 140 }}>Requested (boxes)</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((e) => (
                  <tr key={e.id}>
                    <td><span className="design-name">{e.design}</span></td>
                    <td className="dim">{[e.size, e.finish].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="num">
                      <NumberInput
                        min={1}
                        value={qty[e.id] ?? ""}
                        onChange={(ev) => setQty((p) => ({ ...p, [e.id]: ev.target.value }))}
                        style={{ width: 110, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-section">
            <label className="form-field">
              <span className="lbl">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — priority, target date, remarks…" />
            </label>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">{fmt(group.entries.reduce((s, e) => s + (parseInt(qty[e.id], 10) || 0), 0))} boxes requested</span>
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
