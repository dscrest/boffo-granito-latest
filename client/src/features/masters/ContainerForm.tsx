/* ============================================================
   Container master form — create / edit a Container spec. DB-backed
   (emits a ContainerInput to the parent, which persists via
   containersApi). Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { CONTAINER_STATUSES, CONTAINER_TYPES, type ContainerInput } from "./containersApi";

export interface ContainerFormInitial extends Partial<ContainerInput> {}

const blank: ContainerInput = {
  container_number: "",
  container_type: "",
  capacity_boxes: 0,
  capacity_pallets: 0,
  capacity_area_sqm: 0,
  max_weight_kg: 0,
  vessel_name: "",
  etd: "",
  eta: "",
  port_of_loading: "",
  port_of_discharge: "",
  status: "planned",
};

export function ContainerForm({
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  initial?: ContainerFormInitial;
  isEdit?: boolean;
  onSave: (input: ContainerInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<ContainerInput>({ ...blank, ...initial });
  const setStr = (k: keyof ContainerInput, val: string) => setV((p) => ({ ...p, [k]: val }));
  const setNum = (k: keyof ContainerInput, val: string) => setV((p) => ({ ...p, [k]: Number(val) || 0 }));

  const missing = !v.container_number.trim() || v.capacity_boxes <= 0;

  const submit = () => {
    if (missing) return;
    onSave({ ...v, container_number: v.container_number.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="truck" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Container" : "New Container"}</div>
            <div className="sub2">Container master · stored in Catalyst Data Store</div>
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
                  Container No.<span className="req"> *</span>
                </span>
                <input
                  value={v.container_number}
                  onChange={(e) => setStr("container_number", e.target.value)}
                  placeholder="e.g. MSKU-1234567"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Type</span>
                <select value={v.container_type} onChange={(e) => setStr("container_type", e.target.value)}>
                  <option value="">—</option>
                  {CONTAINER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Status</span>
                <select value={v.status} onChange={(e) => setStr("status", e.target.value)}>
                  {CONTAINER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Vessel</span>
                <input value={v.vessel_name} onChange={(e) => setStr("vessel_name", e.target.value)} placeholder="e.g. Maersk Hangzhou" />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Capacity</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Capacity (boxes)<span className="req"> *</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={v.capacity_boxes || ""}
                  onChange={(e) => setNum("capacity_boxes", e.target.value)}
                  placeholder="e.g. 1200"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Capacity (pallets)</span>
                <input
                  type="number"
                  min={0}
                  value={v.capacity_pallets || ""}
                  onChange={(e) => setNum("capacity_pallets", e.target.value)}
                  placeholder="e.g. 20"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Capacity area<span className="hint"> (m²)</span>
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.capacity_area_sqm || ""}
                  onChange={(e) => setNum("capacity_area_sqm", e.target.value)}
                  placeholder="e.g. 1310.40"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Max weight<span className="hint"> (kg)</span>
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.max_weight_kg || ""}
                  onChange={(e) => setNum("max_weight_kg", e.target.value)}
                  placeholder="optional — leave blank if unknown"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Shipping</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">ETD</span>
                <input type="date" value={v.etd} onChange={(e) => setStr("etd", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">ETA</span>
                <input type="date" value={v.eta} onChange={(e) => setStr("eta", e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Port of Loading</span>
                <input
                  value={v.port_of_loading}
                  onChange={(e) => setStr("port_of_loading", e.target.value)}
                  placeholder="e.g. Mundra"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <input
                  value={v.port_of_discharge}
                  onChange={(e) => setStr("port_of_discharge", e.target.value)}
                  placeholder="e.g. Gdynia"
                />
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
            {isEdit ? "Save changes" : "Save container"}
          </button>
        </div>
      </div>
    </div>
  );
}
