/* ============================================================
   Bulk Update (CR-505) — the ONE bulk-edit control app-wide: filter →
   tick → Bulk Update → pick a Field → set its Value → Update N. One
   field per update; the caller writes it through POST /bulk-update
   (lib/dataOps bulkUpdate), one server trip for every ticked row.
   ============================================================ */
import { useState } from "react";
import { Icon } from "./Icon";
import { Combobox } from "./Combobox";
import { NumberInput } from "./NumberInput";
import { useModalA11y } from "./useModalA11y";

export interface BulkField {
  key: string; // the column written
  label: string;
  type: "number" | "select";
  options?: { value: string; label: string }[]; // select
  decimals?: number; // number (default 2)
}

export function BulkUpdateModal({
  noun,
  count,
  fields,
  busy,
  onApply,
  onClose,
}: {
  noun: string; // "item" → "Bulk Update 12 items"
  count: number;
  fields: BulkField[];
  busy: boolean;
  onApply: (key: string, value: string | number) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [key, setKey] = useState(fields.length === 1 ? fields[0].key : "");
  const [value, setValue] = useState("");
  const field = fields.find((f) => f.key === key);
  const ready = !!field && value.trim() !== "" && (field.type === "select" || Number(value) >= 0);
  const plural = `${count} ${noun}${count === 1 ? "" : "s"}`;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} className="modal-panel card df-modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label={`Bulk Update ${plural}`} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="settings" size={18} />
          </div>
          <div>
            <div className="ttl">Bulk Update {plural}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="df-body">
          <div className="form-section">
            <div className="form-rows">
              <label className="form-field">
                <span className="lbl">Field</span>
                <Combobox
                  value={key}
                  options={fields.map((f) => ({ value: f.key, label: f.label }))}
                  onChange={(v) => {
                    setKey(v);
                    setValue("");
                  }}
                  placeholder="Pick the field to update…"
                  ariaLabel="Field"
                  clearable={false}
                />
              </label>
              <label className="form-field">
                <span className="lbl">Value</span>
                {field?.type === "select" ? (
                  <Combobox value={value} options={field.options ?? []} onChange={setValue} placeholder="Pick a value…" ariaLabel="Value" clearable={false} />
                ) : (
                  <NumberInput value={value} maxDecimals={field?.decimals ?? 2} onChange={(e) => setValue(e.target.value)} placeholder={field ? "0.00" : "Pick a field first"} disabled={!field} aria-label="Value" />
                )}
              </label>
            </div>
          </div>
        </div>
        <div className="df-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={!ready || busy} onClick={() => field && onApply(field.key, field.type === "number" ? Number(value) : value)}>
            <Icon name="check" size={13} />
            {busy ? "Updating…" : `Update ${plural}`}
          </button>
        </div>
      </div>
    </div>
  );
}
