/* ============================================================
   Pallet master form — create / edit a Pallet spec. DB-backed
   (emits a PalletInput to the parent, which persists via palletsApi).
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import type { PalletInput, SizeOption } from "./palletsApi";

// Known pallet types (datalist suggestions; field stays free text).
const PALLET_TYPES = [
  "Junglee",
  "Pine Euro",
  "Nilgiri Euro",
  "Jungle Euro",
  "Wooden",
  "Plastic",
  "Euro",
];

export interface PalletFormInitial extends Partial<PalletInput> {}

const blank: PalletInput = {
  name: "",
  packing_details: "",
  size: "",
  pallet_type: "",
  pallet_size_label: "",
  coverage_sqm: 0,
  coverage_sqft: 0,
  box_weight_kg: 0,
  boxes_per_pallet: 0,
  pallets_per_container: 0,
  empty_pallet_weight_kg: 0,
  b_boxes_per_pallet: 0,
  b_pallets_per_container: 0,
  b_pallet_weight: 0,
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

  const missing = !v.name.trim();
  const totalBoxes =
    v.boxes_per_pallet * v.pallets_per_container + v.b_boxes_per_pallet * v.b_pallets_per_container;
  const totalPallets = v.pallets_per_container + v.b_pallets_per_container;

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const nameErr = showErrors && !v.name.trim() ? "Name is required" : null;

  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    onSave({ ...v, name: v.name.trim() });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
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
                <input
                  className={nameErr ? "error" : ""}
                  value={v.name}
                  onChange={(e) => setStr("name", e.target.value)}
                  placeholder="e.g. 600x1200 - [32 * 30] = 960 - Pine Euro"
                />
                {nameErr && <span className="field-err">{nameErr}</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Packing Details</span>
                <input
                  value={v.packing_details}
                  onChange={(e) => setStr("packing_details", e.target.value)}
                  placeholder="e.g. [32 * 30] = 960"
                />
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
                <input
                  list="pallet-type-list"
                  value={v.pallet_type}
                  onChange={(e) => setStr("pallet_type", e.target.value)}
                  placeholder="e.g. Junglee"
                />
                <datalist id="pallet-type-list">
                  {PALLET_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="form-field">
                <span className="lbl">Pallet Size</span>
                <input
                  value={v.pallet_size_label}
                  onChange={(e) => setStr("pallet_size_label", e.target.value)}
                  placeholder={`e.g. 30"x48"`}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Coverage / Weight (per box)</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Coverage (Sq.M.)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.coverage_sqm || ""}
                  onChange={(e) => setNum("coverage_sqm", e.target.value)}
                  placeholder="e.g. 1.44"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Coverage (Sq.Ft.)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.coverage_sqft || ""}
                  onChange={(e) => setNum("coverage_sqft", e.target.value)}
                  placeholder="e.g. 15.50"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Box Weight (kg)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.box_weight_kg || ""}
                  onChange={(e) => setNum("box_weight_kg", e.target.value)}
                  placeholder="e.g. 27.5"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Arrangement A</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Boxes / Pallet</span>
                <input
                  type="number"
                  min={0}
                  value={v.boxes_per_pallet || ""}
                  onChange={(e) => setNum("boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 32"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Pallets / Container</span>
                <input
                  type="number"
                  min={0}
                  value={v.pallets_per_container || ""}
                  onChange={(e) => setNum("pallets_per_container", e.target.value)}
                  placeholder="e.g. 30"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Pallet Weight (kg)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.empty_pallet_weight_kg || ""}
                  onChange={(e) => setNum("empty_pallet_weight_kg", e.target.value)}
                  placeholder="e.g. 18.5"
                />
              </label>
            </div>
          </div>

          {/* #15: Arrangement B (mixed loads) hidden for now — fields keep their
              defaults (0/blank) so saves still succeed. Uncomment to restore.
          <div className="form-section">
            <div className="form-section-title">Arrangement B (mixed loads — optional)</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">B · Boxes / Pallet</span>
                <input
                  type="number"
                  min={0}
                  value={v.b_boxes_per_pallet || ""}
                  onChange={(e) => setNum("b_boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 32"
                />
              </label>
              <label className="form-field">
                <span className="lbl">B · Pallets / Container</span>
                <input
                  type="number"
                  min={0}
                  value={v.b_pallets_per_container || ""}
                  onChange={(e) => setNum("b_pallets_per_container", e.target.value)}
                  placeholder="e.g. 5"
                />
              </label>
              <label className="form-field">
                <span className="lbl">B · Pallet Weight (kg)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.b_pallet_weight || ""}
                  onChange={(e) => setNum("b_pallet_weight", e.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
          </div>
          */}

          <div className="form-section">
            <div className="form-section-title">Per Container (computed)</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Total Boxes</span>
                <input
                  value={totalBoxes > 0 ? String(totalBoxes) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="A boxes×pallets + B boxes×pallets"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total Pallets</span>
                <input
                  value={totalPallets > 0 ? String(totalPallets) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="A pallets + B pallets"
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
          <span className="df-req-note">
            {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* required"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit}>
            <Icon name="check" size={13} />
            {isEdit ? "Save changes" : "Save pallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
