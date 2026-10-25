/* CR-410 / CR-412: Set Location — one Location Combobox ("Warehouse ▸ A1"), Save.
   Shared by the panel order detail (where the order's panels sit) and the
   palletization / loading boards (where a pallet stands). Manual placement
   only — a tag on the record, never a stock movement (CR-329 "manual transfers"). */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { confirmDiscard } from "@/ui/ConfirmDialog";
import { useModalA11y } from "@/ui/useModalA11y";
import { useWarehouses } from "@/features/masters/useWarehouses";

export function SetLocationModal({
  value,
  title = "Set Location",
  note = "Where this order's panels sit. Clear it to unset.",
  onSave,
  onClose,
}: {
  value: string;
  title?: string;
  note?: string;
  onSave: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { options } = useWarehouses();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const close = async () => {
    if (draft !== value && !(await confirmDiscard())) return;
    onClose();
  };
  const panelRef = useModalA11y(() => void close());
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div><div className="ttl">{title}</div></div>
          <button className="btn x" onClick={() => void close()} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <label className="form-field">
            <span className="lbl">Location</span>
            <Combobox value={draft} options={options} maxVisible={120} placeholder="Type a code, e.g. B7…" ariaLabel="Location" onChange={setDraft} />
          </label>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>{note}</div>
        </div>
        <div className="df-foot">
          <button className="btn" onClick={() => void close()}>Cancel</button>
          <button className="hbtn primary" disabled={saving || draft === value} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); }}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
