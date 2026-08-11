/* ============================================================
   Opening Stock (batch-tracked items) — capture opening stock as batch rows
   (batch · mfg date · qty · remark) via /opening-stock. Stored as
   entry_type="opening" ProductionLog rows, counted as on-hand once. The first
   entry is open; once opening rows exist, adding more needs admin + a reason
   (enforced server-side; the reason field appears here when locked).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { DateInput } from "@/ui/DateInput";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { saveOpeningBatches, type OpeningStockLine } from "@/features/stages/productionApi";

interface OpeningLine {
  batch: string;
  date: string;
  qty: string;
  note: string;
}
const emptyLine = (): OpeningLine => ({ batch: "", date: todayISO(), qty: "", note: "" });

export function OpeningStockForm({
  designId,
  designName,
  batchOptions = [],
  locked,
  onSaved,
  onClose,
}: {
  designId: string;
  designName: string;
  /** Prior batch numbers on this design (append instead of minting a new one). */
  batchOptions?: { value: string; label: string }[];
  /** True when opening rows already exist — a reason becomes mandatory. */
  locked: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<OpeningLine[]>([emptyLine()]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  const setLine = (i: number, k: keyof OpeningLine, v: string) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const validLines = lines.filter((l) => (parseInt(l.qty, 10) || 0) > 0);
  const total = validLines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
  const missing = validLines.length === 0 || (locked && !reason.trim());

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    const rows: OpeningStockLine[] = validLines.map((l) => ({
      qty_boxes: parseInt(l.qty, 10) || 0,
      batch_number: l.batch.trim() || undefined,
      mfg_date: l.date || undefined,
      note: l.note.trim() || undefined,
    }));
    const res = await saveOpeningBatches(designId, { rows, _reason: reason.trim() || undefined });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save opening stock");
      return;
    }
    toast.success(`Opening stock +${fmt(total)} boxes`);
    onSaved();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="box" size={18} /></div>
          <div>
            <div className="ttl">Opening Stock</div>
            <div className="sub2">{designName}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Opening batches</div>
            <table className="tbl" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th>Batch No. <span className="dim" title="ƒx — blank auto-generates B/FY/NNN">ƒx</span></th>
                  <th style={{ width: 150 }}>Mfg date</th>
                  <th className="num" style={{ width: 120, textAlign: "right" }}>Qty<span className="req"> *</span></th>
                  <th>Remark</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const last = i === lines.length - 1;
                  return (
                    <tr key={i}>
                      <td>
                        <Combobox
                          value={l.batch}
                          options={batchOptions}
                          onChange={(v) => setLine(i, "batch", v)}
                          onCreate={(label) => setLine(i, "batch", label.trim())}
                          placeholder="Blank = auto"
                          ariaLabel="Batch number"
                        />
                      </td>
                      <td><DateInput value={l.date} onChange={(e) => setLine(i, "date", e.target.value)} /></td>
                      <td className="num">
                        <NumberInput
                          min={0}
                          value={l.qty}
                          onChange={(e) => setLine(i, "qty", e.target.value)}
                          placeholder="0"
                          style={{ width: 100, textAlign: "right" }}
                          autoFocus={i === 0}
                        />
                      </td>
                      <td>
                        <input
                          value={l.note}
                          onChange={(e) => setLine(i, "note", e.target.value)}
                          placeholder="Optional"
                          onKeyDown={(e) => {
                            if (last && e.key === "Tab" && !e.shiftKey) {
                              e.preventDefault();
                              addLine();
                            }
                          }}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn x" onClick={() => removeLine(i)} disabled={lines.length === 1} tabIndex={-1} title="Remove">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn" onClick={addLine}><Icon name="plus" size={12} /> Add batch</button>

            {locked && (
              <label className="form-field" style={{ marginTop: 10 }}>
                <span className="lbl">Reason for change<span className="req"> *</span></span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is opening stock changing?" />
              </label>
            )}
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
