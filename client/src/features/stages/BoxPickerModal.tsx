/* ============================================================
   Box picker — the click-to-load flow. Opened from a Ready item's "Load"
   button (or by dropping the item on In Loading / a box card). Shows the open
   boxes as big pick-one rows with their fill, plus "New box"; count is
   pre-filled with the whole item so the common case is two clicks. A smaller
   count splits the line server-side (/pal-line-box with boxes).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import type { LoadBox, PalPlan, PalPlanLine } from "./palPlansApi";

export function BoxPickerModal({
  line,
  boxes,
  linesOfBox,
  presetBoxId,
  busy,
  onConfirm,
  onClose,
}: {
  line: PalPlanLine;
  boxes: LoadBox[]; // Open boxes only
  linesOfBox: (boxId: string) => Array<{ p: PalPlan; l: PalPlanLine }>;
  presetBoxId?: string;
  busy: boolean;
  onConfirm: (boxId: string | null, boxes: number) => void; // null = new box
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  // "" = New box; default: the dropped-on box, else the first open box, else New.
  const [sel, setSel] = useState<string>(presetBoxId ?? boxes[0]?.id ?? "");
  const [count, setCount] = useState(line.boxes);

  const selBox = boxes.find((b) => b.id === sel);
  const loadedOf = (b: LoadBox) => linesOfBox(b.id).reduce((s, { l }) => s + l.boxes, 0);
  const remainingOf = (b: LoadBox) => b.capacity - loadedOf(b);
  const overBy = selBox ? count - remainingOf(selBox) : 0;

  const boxRow = (b: LoadBox | null) => {
    const id = b?.id ?? "";
    const active = sel === id;
    const inBox = b ? linesOfBox(b.id) : [];
    const loaded = b ? loadedOf(b) : 0;
    // Stable colour per design (first-seen), same rule as the board's box cards.
    const colorByDesign = new Map<string, string>();
    inBox.forEach(({ l }) => {
      if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
    });
    return (
      <button
        key={id || "new"}
        type="button"
        onClick={() => setSel(id)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
          padding: "10px 12px", borderRadius: 8, cursor: "pointer", font: "inherit",
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "var(--accent-soft)" : "var(--bg)",
        }}
      >
        <Icon name={b ? "truck" : "plus"} size={16} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {b ? b.vehicleNumber || `Box ${b.boxNumber}` : "New box"}
            </span>
            {b && (
              <span className="dim" style={{ marginLeft: "auto", fontSize: "var(--t-sm)", flex: "0 0 auto" }}>
                {fmt(loaded)} / {fmt(b.capacity)} · {fmt(remainingOf(b))} free
              </span>
            )}
          </span>
          {b && (
            <span
              style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)", marginTop: 6 }}
              title={`${fmt(loaded)} / ${fmt(b.capacity)} boxes`}
            >
              {inBox.map(({ l }) => (
                <span key={l.id} style={{ width: `${(l.boxes / Math.max(1, b.capacity)) * 100}%`, background: colorByDesign.get(l.designId) }} />
              ))}
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{
            width: 16, height: 16, borderRadius: "50%", flex: "0 0 auto",
            border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
            background: active ? "var(--accent)" : "transparent",
            boxShadow: active ? "inset 0 0 0 3px var(--bg)" : undefined,
          }}
        />
      </button>
    );
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Load</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
              <span className="mono">{line.itemCode}</span> · {line.designLabel} — {fmt(line.boxes)} boxes
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {boxes.map((b) => boxRow(b))}
            {boxRow(null)}
          </div>

          <label className="form-field" style={{ marginTop: 12 }}>
            <span className="lbl">Boxes to load</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={1}
                max={line.boxes}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(line.boxes, Math.floor(Number(e.target.value)) || 1)))}
                style={{ width: 100, textAlign: "right" }}
              />
              <span className="dim" style={{ fontSize: "var(--t-sm)" }}>of {fmt(line.boxes)}</span>
            </span>
          </label>
          {count < line.boxes && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
              The other {fmt(line.boxes - count)} stay in Ready for Loading
            </div>
          )}
          {selBox && overBy > 0 && (
            <div style={{ fontSize: "var(--t-sm)", marginTop: 4, color: "var(--c-amber)", fontWeight: 600 }}>
              {fmt(overBy)} over this box's space
            </div>
          )}
        </div>

        <div className="df-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={() => onConfirm(sel || null, count)}>
            <Icon name="check" size={13} />
            {busy ? "Loading…" : `Add to ${selBox ? selBox.vehicleNumber || `Box ${selBox.boxNumber}` : "new box"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
