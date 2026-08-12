/* ============================================================
   Opening Stock (batch-tracked items) — capture opening stock as ONE batch
   per save (mandatory batch no. · mfg date · qty · remark) via /opening-stock.
   Stored as entry_type="opening" ProductionLog rows, counted as on-hand once.
   The first entry is open; once opening rows exist, adding more needs admin +
   a reason (enforced server-side; the reason field appears here when locked).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { DateInput } from "@/ui/DateInput";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { saveOpeningBatches, batchNumberExists, type OpeningStockLine } from "@/features/stages/productionApi";
import { cachedAllowDupBatches, loadAllowDupBatches } from "@/features/settings/settingsApi";

export function OpeningStockForm({
  designId,
  designName,
  locked,
  onSaved,
  onClose,
}: {
  designId: string;
  designName: string;
  /** True when opening rows already exist — a reason becomes mandatory. */
  locked: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [batch, setBatch] = useState("");
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

  // Duplicate-batch pre-check (server 409 is the source of truth): same item +
  // same batch is always blocked; cross-item reuse only when the setting is off.
  const [allowDup, setAllowDup] = useState(cachedAllowDupBatches());
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
  }, []);
  const dupItem = batchNumberExists(batch, designName);
  const dup = dupItem || (!allowDup && batchNumberExists(batch));

  const total = parseInt(qty, 10) || 0;
  const missing = total <= 0 || !batch.trim() || dup || (locked && !reason.trim());

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    const rows: OpeningStockLine[] = [{
      qty_boxes: total,
      batch_number: batch.trim(),
      mfg_date: date || undefined,
      note: note.trim() || undefined,
    }];
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
            <div className="form-section-title">Opening batch</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Batch No.<span className="req"> *</span></span>
                <input
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder="e.g. B/26-27/001"
                  autoFocus
                />
                {dup && (
                  <span className="field-err">
                    {dupItem
                      ? `Batch “${batch.trim()}” is already used for this item`
                      : `Batch “${batch.trim()}” already exists — duplicate batch numbers are disabled in Settings`}
                  </span>
                )}
              </label>
              <label className="form-field">
                <span className="lbl">Mfg date</span>
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Qty (boxes)<span className="req"> *</span></span>
                <NumberInput min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
              </label>
              <label className="form-field">
                <span className="lbl">Remark</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </label>
            </div>

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
