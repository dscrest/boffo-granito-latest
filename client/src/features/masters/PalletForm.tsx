/* ============================================================
   Pallet master form — create / edit a Pallet spec. DB-backed
   (emits a PalletInput to the parent, which persists via palletsApi).
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import type { PalletInput, SizeOption } from "./palletsApi";

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

const readOnlyStyle = { background: "var(--bg-2, transparent)", color: "var(--dim)" };

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
  onSave: (input: PalletInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<PalletInput>({ ...blank, ...initial });
  const setStr = (k: keyof PalletInput, val: string) => setV((p) => ({ ...p, [k]: val }));
  const setNum = (k: keyof PalletInput, val: string) => setV((p) => ({ ...p, [k]: Number(val) || 0 }));

  // Size comes from the Size master (FK in v.size). The label drives the name +
  // pallet_size_label. Legacy rows with only a pallet_size_label (no FK) keep
  // that label as a fallback until the operator re-picks a Size.
  const picked = sizeOptions.find((o) => o.id === v.size);
  const sizeLabel = picked?.label || initial?.pallet_size_label || "";

  // Coverage + box weight are owned by the Size master. Once a Size is picked
  // they mirror it; until then a legacy row keeps the values it was saved with.
  const coverageSqm = picked ? picked.sqmPerBox : v.coverage_sqm;
  const coverageSqft = picked ? picked.sqftPerBox : v.coverage_sqft;
  const boxWeightKg = picked ? picked.boxWeightKg : v.box_weight_kg;

  // Packing detail auto-computes from arrangement A → "[30 * 18] = 540".
  const packing = useMemo(() => {
    const product = v.boxes_per_pallet * v.pallets_per_container;
    return v.boxes_per_pallet && v.pallets_per_container
      ? `[${v.boxes_per_pallet} * ${v.pallets_per_container}] = ${product}`
      : "";
  }, [v.boxes_per_pallet, v.pallets_per_container]);

  // 5.4: auto-name → "SIZE - Packing Detail - Type", e.g.
  // "800x1600 - [30 * 18] = 540 - Junglee".
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
  const totalBoxes =
    v.boxes_per_pallet * v.pallets_per_container + v.b_boxes_per_pallet * v.b_pallets_per_container;
  const totalPallets = v.pallets_per_container + v.b_pallets_per_container;
  // Per spec: one loaded pallet = (box wt × boxes/pallet) + empty pallet wt.
  const totalPalletWeight = boxWeightKg * v.boxes_per_pallet + v.empty_pallet_weight_kg;
  const totalSqm = totalBoxes * coverageSqm;
  const totalSqft = totalBoxes * coverageSqft;
  const totalBoxWeight = totalBoxes * boxWeightKg;

  // 5.5: nothing is mandatory — submit always proceeds.
  const submit = () => {
    onSave({
      ...v,
      name: v.name.trim(),
      packing_details: packing,
      pallet_size_label: sizeLabel,
      size: v.size,
      // Snapshot the Size master's per-box figures onto this pallet row.
      coverage_sqm: coverageSqm,
      coverage_sqft: coverageSqft,
      box_weight_kg: boxWeightKg,
    });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
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
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Name</span>
                <input
                  value={v.name}
                  readOnly
                  disabled
                  placeholder="Auto-generated from Size, packing & type"
                  title="Auto-generated — fill Size, packing & type below"
                />
                <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                  Auto-generated from the fields below — not editable
                </span>
              </label>
              <label className="form-field">
                <span className="lbl">Size</span>
                {lockSize ? (
                  <input
                    value={sizeLabel || "—"}
                    readOnly
                    tabIndex={-1}
                    style={readOnlyStyle}
                    title="Size is fixed — opened from the Size master"
                  />
                ) : (
                  <Combobox
                    value={v.size}
                    options={[{ value: "", label: "" }, ...sizeOptions.map((s) => ({ value: s.id, label: s.label }))]}
                    onChange={(val) => setStr("size", val)}
                    placeholder="Search size…"
                  />
                )}
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
                  {typeOptions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                {isNewType && (
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    + New type — created when you save
                  </span>
                )}
              </label>
              <label className="form-field">
                <span className="lbl">Packing Details</span>
                {/* ponytail: auto from Boxes/Pallet × Pallets/Container; add an
                    override only if operators ever need custom packing notes. */}
                <input
                  value={packing || "—"}
                  readOnly
                  tabIndex={-1}
                  title="Boxes/Pallet × Pallets/Container"
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  placeholder="e.g. [32 * 30] = 960"
                />
              </label>
            </div>
          </div>

          {/* Owned by the Size master — pick a Size above to fill these. */}
          <div className="form-section">
            <div className="form-section-title">Coverage / Weight (per box) · from Size Master</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Coverage (Sq.M.)</span>
                <input
                  value={coverageSqm > 0 ? String(r4(coverageSqm)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={readOnlyStyle}
                  title="Total SQM per Box, from the selected Size"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Coverage (Sq.Ft.)</span>
                <input
                  value={coverageSqft > 0 ? String(r2(coverageSqft)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={readOnlyStyle}
                  title="Total SQFT per Box, from the selected Size"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Box Weight (kg)</span>
                <input
                  value={boxWeightKg > 0 ? String(r2(boxWeightKg)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={readOnlyStyle}
                  title="Box Weight, from the selected Size"
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
            <div className="form-section-title">Arrangement A</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Boxes / Pallet</span>
                <input
                  type="number" min={0}
                  value={v.boxes_per_pallet || ""}
                  onChange={(e) => setNum("boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 32"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Pallets / Container</span>
                <input
                  type="number" min={0}
                  value={v.pallets_per_container || ""}
                  onChange={(e) => setNum("pallets_per_container", e.target.value)}
                  placeholder="e.g. 30"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Empty Pallet Weight (kg)</span>
                <input
                  type="number" min={0}
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
                  type="number" min={0}
                  value={v.b_boxes_per_pallet || ""}
                  onChange={(e) => setNum("b_boxes_per_pallet", e.target.value)}
                  placeholder="e.g. 32"
                />
              </label>
              <label className="form-field">
                <span className="lbl">B · Pallets / Container</span>
                <input
                  type="number" min={0}
                  value={v.b_pallets_per_container || ""}
                  onChange={(e) => setNum("b_pallets_per_container", e.target.value)}
                  placeholder="e.g. 5"
                />
              </label>
              <label className="form-field">
                <span className="lbl">B · Pallet Weight (kg)</span>
                <input
                  type="number" min={0}
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
              <label className="form-field">
                <span className="lbl">Total Pallet Weight (kg)</span>
                <input
                  value={totalPalletWeight > 0 ? String(r2(totalPalletWeight)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="(Box weight × Boxes/Pallet) + Empty pallet weight"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total Sq.M / Container</span>
                <input
                  value={totalSqm > 0 ? String(r2(totalSqm)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="Total Boxes × Coverage Sq.M"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total Sq.Ft / Container</span>
                <input
                  value={totalSqft > 0 ? String(r2(totalSqft)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="Total Boxes × Coverage Sq.Ft"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Total Box Weight / Container (kg)</span>
                <input
                  value={totalBoxWeight > 0 ? String(r2(totalBoxWeight)) : "—"}
                  readOnly
                  tabIndex={-1}
                  style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                  title="Total Boxes × Box weight"
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
          <span className="df-req-note">Name auto-generates — no required fields</span>
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
