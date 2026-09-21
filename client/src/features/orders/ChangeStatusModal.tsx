/* ============================================================
   Change Status (CR-231) — set a Sales Order to ANY status by hand, with a
   mandatory reason (lands in the status history as "manual — …"). The
   status otherwise follows the boxes automatically (CR-230); the auto
   roll-up only ever promotes, so a manual Completed on a partial order sticks.
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { setOrderStatus, soStatusLabel, SO_STATUSES } from "./ordersApi";

export function ChangeStatusModal({
  title,
  salesOrderId,
  current,
  onDone,
  onClose,
}: {
  /** Record identity under the title (SO number · customer). */
  title: string;
  salesOrderId: string;
  current: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!status || !reason.trim()) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    const res = await setOrderStatus(salesOrderId, status, reason.trim(), true);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Status update failed");
      return;
    }
    toast.success(`Order marked ${soStatusLabel(status)}`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="check" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Change Status</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{title}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Status<span className="req"> *</span></span>
                <Combobox
                  value={status}
                  options={SO_STATUSES.filter((s) => s !== current).map((s) => ({ value: s, label: soStatusLabel(s) }))}
                  onChange={setStatus}
                  placeholder={`Currently ${soStatusLabel(current)}`}
                  invalid={showErrors && !status}
                  ariaLabel="New status"
                  maxVisible={SO_STATUSES.length}
                />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Reason<span className="req"> *</span></span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={showErrors && !reason.trim() ? "error" : undefined}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note"><span className="req">*</span> Required</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving} onClick={() => void submit()}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
