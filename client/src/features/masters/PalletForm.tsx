/* ============================================================
   Pallet master form — create / edit a Pallet spec. DB-backed
   (emits a PalletInput to the parent, which persists via palletsApi).
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Combobox } from "@/ui/Combobox";
import { FormPage, useFormSave } from "@/ui/FormPage";
import type { PalletInput, SizeOption } from "./palletsApi";
import { NumberInput } from "../../ui/NumberInput";

// Default pallet types (datalist seed). The live list is these merged with the
// distinct types already saved on Pallet rows — a new type typed here is
// created on save (it persists as the Pallet.pallet_type column value).
// ponytail: no dedicated PalletType master table; distinct column values are
// the "master". Add a real table if types ever need their own attributes.
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
  empty_pallet_weight_kg: 0,
  remarks: "",
};

export function PalletForm({
  palletTypes = [],
  sizeOptions = [],
  lockSize,
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  /** Distinct pallet types already in the DB — merged with the defaults. */
  palletTypes?: string[];
  /** Live Size master options (FK ROWID + label), from the DB. */
  sizeOptions?: SizeOption[];
  /** Locks the Size picker — used when the form is opened from a Size's detail page. */
  lockSize?: boolean;
  initial?: PalletFormInitial;
  isEdit?: boolean;
  onSave: (input: PalletInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const [v, setV] = useState<PalletInput>({ ...blank, ...initial });
  const form = useFormSave(onClose);
  const setStr = (k: keyof PalletInput, val: string) => {
    form.touch();
    setV((p) => ({ ...p, [k]: val }));
  };
  const setNum = (k: keyof PalletInput, val: string) => {
    form.touch();
    setV((p) => ({ ...p, [k]: Number(val) || 0 }));
  };

  // Size comes from the Size master (FK in v.size). The label drives the name +
  // pallet_size_label. Legacy rows with only a pallet_size_label (no FK) keep
  // that label as a fallback until the operator re-picks a Size.
  const picked = sizeOptions.find((o) => o.id === v.size);
  const sizeLabel = picked?.label || initial?.pallet_size_label || "";

  // Coverage is owned by the Size master. Once a Size is picked it mirrors it;
  // until then a legacy row keeps the values it was saved with.
  const coverageSqm = picked ? picked.sqmPerBox : v.coverage_sqm;
  const coverageSqft = picked ? picked.sqftPerBox : v.coverage_sqft;
  // Box weight: the Size value is only the DEFAULT — manually editable here
  // (CR 2026-09-10); picking a size re-fills it (see the Combobox onChange).
  const boxWeightKg = v.box_weight_kg || (picked ? picked.boxWeightKg : 0);

  // Packing detail is formula-owned → "32 boxes" (boxes per pallet). A pallet
  // is boxes only since CR-261; what a container holds is the Container Master's.
  const packing = useMemo(() => (v.boxes_per_pallet ? `${v.boxes_per_pallet} boxes` : ""), [v.boxes_per_pallet]);

  // 5.4: auto-name → "SIZE - Packing Detail - Type", e.g.
  // "800x1600 - 32 boxes - Junglee".
  const autoName = useMemo(
    () => [sizeLabel, packing, v.pallet_type.trim()].filter(Boolean).join(" - "),
    [sizeLabel, packing, v.pallet_type],
  );

  // Name is formula-owned: the field is read-only so typing can't break the
  // automation. Always mirrors "SIZE - Packing Detail - Type".
  useEffect(() => {
    setV((p) => (p.name === autoName ? p : { ...p, name: autoName }));
  }, [autoName]);

  const typeOptions = useMemo(
    () => [...new Set([...PALLET_TYPES, ...palletTypes].filter(Boolean))],
    [palletTypes],
  );
  const isNewType = !!v.pallet_type.trim() && !typeOptions.includes(v.pallet_type.trim());

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  // Per spec: one loaded pallet = (box wt × boxes/pallet) + empty pallet wt.
  const totalPalletWeight = boxWeightKg * v.boxes_per_pallet + v.empty_pallet_weight_kg;

  // Size is the one hard requirement — every pallet spec is a spec *for a
  // size*; without the FK the name, coverage and weight are all blank.
  const canSave = !!v.size;

  const submit = () => {
    if (!canSave) return;
    void form.run(() => onSave({
      ...v,
      name: v.name.trim(),
      packing_details: packing,
      pallet_size_label: sizeLabel,
      size: v.size,
      // Snapshot the Size master's per-box figures onto this pallet row.
      coverage_sqm: coverageSqm,
      coverage_sqft: coverageSqft,
      box_weight_kg: boxWeightKg,
    }));
  };

  return (
    <FormPage
      title={isEdit ? "Edit Pallet" : "New Pallet"}
      sub={isEdit ? initial?.name : ""}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note={
        <>
          * Indicates a mandatory field
          <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
        </>
      }
    >
          <div className="form-section">
            <div className="form-section-title">Identity</div>
            <div className="form-rows">
              {/* Inputs first, derived Name last — you pick Size & Type,
                  the name falls out. */}
              <label className="form-field">
                <span className="lbl">
                  Size<span className="req"> *</span>
                </span>
                {lockSize ? (
                  <input
                    value={sizeLabel || "—"}
                    readOnly
                    tabIndex={-1}
                    title="Size is fixed — opened from the Size master"
                  />
                ) : (
                  <Combobox
                    value={v.size}
                    options={sizeOptions.map((s) => ({ value: s.id, label: s.label }))}
                    onChange={(val) => {
                      // Explicit size pick re-fills the box weight from that size
                      // (the operator can still type over it afterwards).
                      const opt = sizeOptions.find((o) => o.id === val);
                      form.touch();
                      setV((p) => ({ ...p, size: val, box_weight_kg: opt?.boxWeightKg || 0 }));
                    }}
                    placeholder="Search size…"
                  />
                )}
              </label>
              <label className="form-field">
                <span className="lbl">Pallet Type</span>
                <Combobox
                  value={v.pallet_type}
                  options={(isNewType ? [v.pallet_type.trim()] : [])
                    .concat(typeOptions)
                    .map((t) => ({ value: t, label: t }))}
                  onChange={(val) => setStr("pallet_type", val)}
                  onCreate={(name) => setStr("pallet_type", name)}
                  placeholder="Select or create type…"
                />
                {isNewType && (
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    + New type — created when you save
                  </span>
                )}
              </label>
              <label className="form-field">
                <span className="lbl">Packing Details</span>
                <input
                  value={packing || "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: Boxes / Pallet"
                  placeholder="e.g. 32 boxes"
                />
              </label>
              <label className="form-field span2">
                <span className="lbl">Name</span>
                <input
                  value={v.name}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  placeholder="Auto-generated from Size, packing & type"
                  title="Formula field: Size - Packing Detail - Type"
                />
              </label>
            </div>
          </div>

          {/* Owned by the Size master — pick a Size above to fill these. */}
          <div className="form-section">
            <div className="form-section-title">Coverage / Weight (per box) · from Size Master</div>
            <div className="form-rows">
              <label className="form-field">
                <span className="lbl">Coverage (Sq.Ft.)</span>
                <input
                  value={coverageSqft > 0 ? String(r2(coverageSqft)) : "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: Total SQFT per Box, from the selected Size"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Coverage (Sq.M.)</span>
                <input
                  value={coverageSqm > 0 ? String(r4(coverageSqm)) : "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: Total SQM per Box, from the selected Size"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Box Weight (kg)</span>
                <NumberInput
                  value={v.box_weight_kg || ""}
                  onChange={(e) => setNum("box_weight_kg", e.target.value)}
                  placeholder={picked?.boxWeightKg ? String(r2(picked.boxWeightKg)) : "0"}
                  title="Defaults from the selected Size — type to override for this pallet"
                />
              </label>
            </div>
            {v.size && coverageSqm === 0 && (
              <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                This size has no packing data yet — set Pcs. per Packing and Box Weight in Size Master.
              </span>
            )}
          </div>

          <div className="form-section">
            <div className="form-section-title">Arrangement</div>
            <div className="form-rows">
              <label className="form-field">
                <span className="lbl">Boxes / Pallet</span>
                <NumberInput
                  value={v.boxes_per_pallet || ""}
                  onChange={(e) => setNum("boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 32"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Empty Pallet Weight (kg)</span>
                <NumberInput
                  step="0.01"
                  value={v.empty_pallet_weight_kg || ""}
                  onChange={(e) => setNum("empty_pallet_weight_kg", e.target.value)}
                  placeholder="e.g. 18.5"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Loaded Pallet Weight (kg)</span>
                <input
                  value={totalPalletWeight > 0 ? String(r2(totalPalletWeight)) : "—"}
                  readOnly
                  tabIndex={-1}
                  className="calc"
                  title="Formula field: (Box weight × Boxes/Pallet) + Empty pallet weight"
                />
              </label>
            </div>
            {/* Pallets per container moved to the Container Master (CR-261). */}
          </div>

          <div className="form-section">
            <div className="form-section-title">Notes</div>
            <div className="form-rows one">
              <label className="form-field">
                <span className="lbl">Remarks</span>
                <textarea value={v.remarks} onChange={(e) => setStr("remarks", e.target.value)} placeholder="Optional notes" />
              </label>
            </div>
          </div>
    </FormPage>
  );
}
