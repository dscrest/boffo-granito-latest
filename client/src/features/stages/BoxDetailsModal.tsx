/* ============================================================
   Box details — opened by clicking a box card on the Dispatch panel.
   Read-only: vehicle/driver meta, design-coloured fill bar and the loaded
   items, plus a Print button that downloads the Dispatch Copy PDF
   (lazy import, same pattern as the Palletization slip).
   ============================================================ */
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import type { LoadBox, PalPlan, PalPlanLine } from "./palPlansApi";

export function BoxDetailsModal({
  box,
  entries,
  onClose,
}: {
  box: LoadBox;
  entries: Array<{ p: PalPlan; l: PalPlanLine }>;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const label = box.vehicleNumber || `Box ${box.boxNumber}`;
  const open = box.status === "Open";
  const loaded = entries.reduce((s, { l }) => s + l.boxes, 0);
  // Stable colour per design (first-seen), same rule as the board's box cards.
  const colorByDesign = new Map<string, string>();
  entries.forEach(({ l }) => {
    if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
  });
  const meta = [
    ["Vehicle", box.vehicleNumber],
    ["Driver", box.driverName],
    ["Mobile", box.mobileNumber],
    ["Dispatch Date", box.dispatchDate ? box.dispatchDate.slice(0, 10) : ""],
  ].filter(([, v]) => v);

  const onPrint = () => {
    void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries));
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }} className="mono">{label}</div>
          </div>
          <span className={`chip palstatus ${open ? "p-loading" : "p-completed"}`}>{open ? "Loading" : "Dispatched"}</span>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {meta.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "var(--t-sm)", marginBottom: 10 }}>
              {meta.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="dim">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Fill bar — design-coloured segments, same as the board card. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{ flex: 1, display: "flex", height: 14, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
              title={`${fmt(loaded)} / ${fmt(box.capacity)} boxes`}
            >
              {entries.map(({ l }) => (
                <div key={l.id} style={{ width: `${(l.boxes / Math.max(1, box.capacity)) * 100}%`, background: colorByDesign.get(l.designId) }} title={`${l.designLabel}: ${fmt(l.boxes)} boxes`} />
              ))}
            </div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{fmt(loaded)} / {fmt(box.capacity)}</span>
          </div>

          {/* Loaded items. */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
            {entries.map(({ l }) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)", padding: "4px 0", borderTop: "1px solid var(--panel-2)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorByDesign.get(l.designId), flex: "0 0 auto" }} />
                <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.designLabel}</span>
                <span className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.customerName}</span>
                <span className="dim mono" style={{ flex: "0 0 auto" }}>{l.soNumber}</span>
                <span className="dim mono" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{fmt(l.boxes)}</span>
              </div>
            ))}
            {entries.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>Nothing loaded yet</div>}
          </div>
        </div>

        <div className="df-foot">
          <button className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={onPrint}>
            <Icon name="printer" size={13} /> Print
          </button>
          <div style={{ flex: 1 }} />
          <button className="hbtn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
