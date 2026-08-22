/* ============================================================
   Pallet picker — opened when a pallet-less line is dropped on the board's
   Palletization column. One Combobox of pallet specs whose size WIDTH matches
   the item's (same rule as PalPlanForm); Save sets pallet + status in one
   /pal-line-status call.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import type { PalPlanLine } from "./palPlansApi";

// Leading dimension of a size string ("300x600 - GVT…" → "300"), as in PalPlanForm.
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

export function PalletPickerModal({
  line,
  busy,
  onConfirm,
  onClose,
}: {
  line: PalPlanLine;
  busy: boolean;
  onConfirm: (palletId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [sel, setSel] = useState("");
  useEffect(() => {
    let alive = true;
    void listPallets().then((r) => {
      if (alive && r.ok) setPallets(r.pallets);
    });
    return () => {
      alive = false;
    };
  }, []);

  const w = widthOf(line.sizeCode);
  const opts = pallets.filter((p) => {
    if (!p.sizeId) return true;
    const pw = widthOf(p.sizeLabel);
    return !w || !pw || pw === w;
  });

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Choose pallet</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
              <span className="mono">{line.itemCode}</span> · {line.designLabel}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <label className="form-field">
            <span className="lbl">Pallet<span className="req"> *</span></span>
            <Combobox
              value={sel}
              options={opts.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setSel}
              placeholder={opts.length ? "Choose pallet…" : "No matching pallet"}
            />
          </label>
        </div>

        <div className="df-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy || !sel} onClick={() => onConfirm(sel)}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
