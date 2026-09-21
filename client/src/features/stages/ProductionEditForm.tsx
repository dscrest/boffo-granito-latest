/* ============================================================
   Edit Production — adjust the requested boxes per plan line (and a shared note)
   before any output is recorded. A narrow form page (/prod/:id/edit, CR-220).
   Only offered while nothing has been produced (guarded server-side too).
   ============================================================ */
import { useState } from "react";
import { toast } from "@/ui/Toast";
import { FormPage, useFormSave } from "@/ui/FormPage";
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
  const form = useFormSave(onClose);

  const save = async () => {
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
    if (failed) return; // stay on the form — the toast says which line was refused
    toast.success("Production updated");
    await onSaved();
  };

  return (
    <FormPage
      narrow
      title="Edit Production"
      sub={group.code}
      busy={form.busy}
      onCancel={() => void form.cancel()}
      onSave={() => void form.run(save)}
      note={
        <span className="dim">{fmt(group.entries.reduce((s, e) => s + (parseInt(qty[e.id], 10) || 0), 0))} boxes requested</span>
      }
    >
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
                        onChange={(ev) => {
                          form.touch();
                          setQty((p) => ({ ...p, [e.id]: ev.target.value }));
                        }}
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
              <input value={note} onChange={(e) => {
                  form.touch();
                  setNote(e.target.value);
                }}
                placeholder="Optional — priority, target date, remarks…" />
            </label>
          </div>
    </FormPage>
  );
}
