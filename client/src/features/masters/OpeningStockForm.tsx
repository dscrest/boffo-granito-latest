/* ============================================================
   Opening Stock (batch-tracked items) — capture opening stock as one or more
   batch lines per save (mandatory batch no. · mfg date · qty · remark,
   + Add line) via /opening-stock. Stored as entry_type="opening"
   ProductionLog rows, counted as on-hand once. The first entry is open; once
   opening rows exist, adding more needs admin + a reason (enforced
   server-side; the reason field appears here when locked).
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
  type BatchRow = { batch: string; date: string; qty: string; note: string };
  const emptyRow = (): BatchRow => ({ batch: "", date: todayISO(), qty: "", note: "" });
  const [rows, setRows] = useState<BatchRow[]>(() => [emptyRow()]);
  const setRow = (i: number, k: keyof BatchRow, val: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const addLine = () => setRows((rs) => [...rs, emptyRow()]);
  const removeLine = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const panelRef = useModalA11y(onClose);

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
    if (batchNumberExists(r.batch, designName)) return "item";
    if (!allowDup && batchNumberExists(r.batch)) return "global";
    return null;
  };

  const total = rows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
  const missing =
    total <= 0 ||
    rows.some((r, i) => (parseInt(r.qty, 10) || 0) <= 0 || !r.batch.trim() || dupKind(r, i) !== null) ||
    (locked && !reason.trim());

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    const lines: OpeningStockLine[] = rows.map((r) => ({
      qty_boxes: parseInt(r.qty, 10) || 0,
      batch_number: r.batch.trim(),
      mfg_date: r.date || undefined,
      note: r.note.trim() || undefined,
    }));
    const res = await saveOpeningBatches(designId, { rows: lines, _reason: reason.trim() || undefined });
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
            {rows.map((r, i) => {
              const dup = dupKind(r, i);
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: i ? 10 : 0 }}>
                  {/* One line per batch: wide batch/remark, narrow date/qty. */}
                  <div className="form-grid" style={{ flex: 1, gridTemplateColumns: "1.5fr 0.8fr 0.6fr 1.1fr" }}>
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
                    <label className="form-field">
                      <span className="lbl">Mfg date</span>
                      <DateInput value={r.date} onChange={(e) => setRow(i, "date", e.target.value)} />
                    </label>
                    <label className="form-field">
                      <span className="lbl">Qty (boxes)<span className="req"> *</span></span>
                      <NumberInput min={0} value={r.qty} onChange={(e) => setRow(i, "qty", e.target.value)} placeholder="0" />
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
            <button className="btn" style={{ marginTop: 10 }} onClick={addLine}>
              <Icon name="plus" size={12} /> Add line
            </button>

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
