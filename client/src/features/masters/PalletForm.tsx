/* ============================================================
   Pallet master form — create / edit a Pallet spec. DB-backed
   (emits a PalletInput to the parent, which persists via palletsApi).
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import type { PalletInput, SizeOption } from "./palletsApi";

const PALLET_TYPES = ["Wooden", "Plastic", "Euro", "Custom"];

export interface PalletFormInitial extends Partial<PalletInput> {}

const blank: PalletInput = {
  name: "",
  size: "",
  pallet_type: "",
  pallet_size_label: "",
  boxes_per_pallet: 0,
  pallets_per_container: 0,
  empty_pallet_weight_kg: 0,
  remarks: "",
};

export function PalletForm({
  sizes,
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  sizes: SizeOption[];
  initial?: PalletFormInitial;
  isEdit?: boolean;
  onSave: (input: PalletInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<PalletInput>({ ...blank, ...initial });
  const setStr = (k: keyof PalletInput, val: string) => setV((p) => ({ ...p, [k]: val }));
  const setNum = (k: keyof PalletInput, val: string) => setV((p) => ({ ...p, [k]: Number(val) || 0 }));

  const missing = !v.name.trim() || v.boxes_per_pallet <= 0 || v.pallets_per_container <= 0;
  const boxesPerContainer = v.boxes_per_pallet * v.pallets_per_container;

  const submit = () => {
    if (missing) return;
    onSave({ ...v, name: v.name.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="palette" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Pallet" : "New Pallet"}</div>
            <div className="sub2">Pallet master · stored in Catalyst Data Store</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Identity</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Name<span className="req"> *</span>
                </span>
                <input value={v.name} onChange={(e) => setStr("name", e.target.value)} placeholder="e.g. Euro 600x1200" />
              </label>
              <label className="form-field">
                <span className="lbl">Size</span>
                <select value={v.size} onChange={(e) => setStr("size", e.target.value)}>
                  <option value="">—</option>
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Pallet Type</span>
                <select value={v.pallet_type} onChange={(e) => setStr("pallet_type", e.target.value)}>
                  <option value="">—</option>
                  {PALLET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Size Label</span>
                <input
                  value={v.pallet_size_label}
                  onChange={(e) => setStr("pallet_size_label", e.target.value)}
                  placeholder="e.g. 1.2m × 0.8m"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Capacity</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Boxes / Pallet<span className="req"> *</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={v.boxes_per_pallet || ""}
                  onChange={(e) => setNum("boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 48"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Pallets / Container<span className="req"> *</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={v.pallets_per_container || ""}
                  onChange={(e) => setNum("pallets_per_container", e.target.value)}
                  placeholder="e.g. 20"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Empty Pallet Weight (kg)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.empty_pallet_weight_kg || ""}
                  onChange={(e) => setNum("empty_pallet_weight_kg", e.target.value)}
                  placeholder="e.g. 18.5"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Boxes / Container</span>
                <input
                  value={boxesPerContainer > 0 ? String(boxesPerContainer) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="Computed: boxes/pallet × pallets/container"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Notes</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Remarks</span>
                <input value={v.remarks} onChange={(e) => setStr("remarks", e.target.value)} placeholder="Optional notes" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            {isEdit ? "Save changes" : "Save pallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
