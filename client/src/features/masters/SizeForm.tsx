/* ============================================================
   Size master form — create / edit a Size spec. DB-backed
   (emits a SizeInput to the parent, which persists via sizesApi).
   Reuses the shared form/modal CSS (df-*, form-*).

   Three fields are formula-owned and read-only:
     Size (code)        = Width x Length
     Total SQM per Box  = (Width/1000) × (Length/1000) × Pcs. per Packing
     Total SQFT per Box = Total SQM per Box × 10.7639
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { sizeCodeOf, sqftPerBoxOf, sqmPerBoxOf, type SizeInput } from "./sizesApi";
import { NumberInput } from "../../ui/NumberInput";

// Tile body types (datalist seed). The live list is these merged with the
// distinct types already saved on Size rows — a new type typed here is created
// on save (it persists as the Size.tile_type column value).
// ponytail: no dedicated TileType master table; distinct column values are the
// "master", same pattern as Pallet.pallet_type. Add a table if types ever need
// their own attributes.
const TILE_TYPES = ["GVT"];

export interface SizeFormInitial extends Partial<SizeInput> {}

const blank: SizeInput = {
  width_mm: 0,
  length_mm: 0,
  seq_code: "",
  tile_type: "",
  thickness_mm: 0,
  pcs_per_packing: 0,
  box_weight_kg: 0,
  remark: "",
};

export function SizeForm({
  tileTypes = [],
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  /** Distinct tile types already in the DB — merged with the defaults. */
  tileTypes?: string[];
  initial?: SizeFormInitial;
  isEdit?: boolean;
  onSave: (input: SizeInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<SizeInput>({ ...blank, ...initial });
  const setStr = (k: keyof SizeInput, val: string) => setV((p) => ({ ...p, [k]: val }));
  const setNum = (k: keyof SizeInput, val: string) => setV((p) => ({ ...p, [k]: Number(val) || 0 }));

  const code = useMemo(() => sizeCodeOf(v.width_mm, v.length_mm), [v.width_mm, v.length_mm]);
  const sqmPerBox = useMemo(
    () => sqmPerBoxOf(v.width_mm, v.length_mm, v.pcs_per_packing),
    [v.width_mm, v.length_mm, v.pcs_per_packing],
  );
  const sqftPerBox = sqftPerBoxOf(sqmPerBox);

  const typeOptions = useMemo(
    () => [...new Set([...TILE_TYPES, ...tileTypes].filter(Boolean))],
    [tileTypes],
  );
  const isNewType = !!v.tile_type.trim() && !typeOptions.includes(v.tile_type.trim());

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;

  // Width and Length are the only hard requirements — they key the row.
  const canSave = v.width_mm > 0 && v.length_mm > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({ ...v, seq_code: v.seq_code.trim(), tile_type: v.tile_type.trim(), remark: v.remark.trim() });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Size" : "New Size"}</div>
            <div className="sub2">Size master</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Identity</div>
            <div className="form-grid">
              {/* Inputs first, derived Size after — you type Width & Length,
                  the name falls out. */}
              <label className="form-field">
                <span className="lbl">
                  Width (mm)<span className="req"> *</span>
                </span>
                <NumberInput
                  min={0}
                  value={v.width_mm || ""}
                  onChange={(e) => setNum("width_mm", e.target.value)}
                  placeholder="e.g. 600"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Length (mm)<span className="req"> *</span>
                </span>
                <NumberInput
                  min={0}
                  value={v.length_mm || ""}
                  onChange={(e) => setNum("length_mm", e.target.value)}
                  placeholder="e.g. 600"
                />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Size</span>
                <input
                  value={code}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  placeholder="Auto-generated from Width × Length"
                  title="Formula field: Width × Length — filled automatically"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Type</span>
                <Combobox
                  value={v.tile_type}
                  options={(isNewType ? [v.tile_type.trim()] : [])
                    .concat(typeOptions)
                    .map((t) => ({ value: t, label: t }))}
                  onChange={(val) => setStr("tile_type", val)}
                  onCreate={(name) => setStr("tile_type", name)}
                  placeholder="Select or create type…"
                />
                {isNewType && (
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    + New type — created when you save
                  </span>
                )}
              </label>
              <label className="form-field">
                <span className="lbl">Thickness (mm)</span>
                <NumberInput
                  min={0}
                  step="0.01"
                  value={v.thickness_mm || ""}
                  onChange={(e) => setNum("thickness_mm", e.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Packing (per box)</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Pcs. per Packing</span>
                <NumberInput
                  min={0}
                  value={v.pcs_per_packing || ""}
                  onChange={(e) => setNum("pcs_per_packing", e.target.value)}
                  placeholder="e.g. 4"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Box Weight (kg)</span>
                <NumberInput
                  min={0}
                  step="0.01"
                  value={v.box_weight_kg || ""}
                  onChange={(e) => setNum("box_weight_kg", e.target.value)}
                  placeholder="e.g. 26.5"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total SQFT per Box</span>
                <input
                  value={sqftPerBox > 0 ? String(r2(sqftPerBox)) : "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: Total SQM per Box × 10.7639"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total SQM per Box</span>
                <input
                  value={sqmPerBox > 0 ? String(r4(sqmPerBox)) : "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: (Width/1000) × (Length/1000) × Pcs. per Packing"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Notes</div>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Remark</span>
                <input
                  value={v.remark}
                  onChange={(e) => setStr("remark", e.target.value)}
                  placeholder="Optional notes"
                  maxLength={255}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            * Indicates a mandatory field
            <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit} disabled={!canSave}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
