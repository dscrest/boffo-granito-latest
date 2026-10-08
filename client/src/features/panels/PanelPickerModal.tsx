/* ============================================================
   Panel picker — search popup for choosing showcase Panels.
   A plain dropdown can't carry a panel's identity (image, designs,
   sizes, cut pieces), so this modal shows every panel as an
   e-commerce tile (CR-192) with one search box matching all of
   them: code, panel/vinyl size, design names, sizes and cut-piece
   sizes. Multi-select (CR-193): a click toggles a tile, Done closes.
   CR-310: Design · Panel Size · Cut Piece Size filters + "In stock only"
   (every cut piece the panel needs is on hand) narrow the tiles with the search.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { FilterSelect, PanelTile } from "./pcBits";
import type { PanelRow } from "./panelsApi";
import { shortagesFor } from "./panelOrderNeeds";

export function PanelPickerModal({
  panels,
  selectedIds,
  onToggle,
  onClose,
  stock,
}: {
  panels: PanelRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  /** On-hand cut pieces keyed stockKey(design, cutSize) — enables "In stock only". */
  stock?: Map<string, number>;
}) {
  const [q, setQ] = useState("");
  const [design, setDesign] = useState("");
  const [panelSize, setPanelSize] = useState("");
  const [cutSize, setCutSize] = useState("");
  const [inStock, setInStock] = useState(false);

  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  const designOptions = useMemo(() => uniq(panels.flatMap((p) => p.lines.map((l) => l.designName))), [panels]);
  const sizeOptions = useMemo(() => uniq(panels.map((p) => p.panelSize)), [panels]);
  const cutOptions = useMemo(() => uniq(panels.flatMap((p) => p.lines.map((l) => l.cutSizeName))), [panels]);
  const panelsById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  const listed = useMemo(() => {
    const t = q.trim().toLowerCase();
    return panels.filter(
      (p) =>
        (!design || p.lines.some((l) => l.designName === design)) &&
        (!panelSize || p.panelSize === panelSize) &&
        (!cutSize || p.lines.some((l) => l.cutSizeName === cutSize)) &&
        (!inStock || !stock || shortagesFor([{ panelId: p.id, qty: 1 }], panelsById, stock).length === 0) &&
        (!t ||
          [p.panelCode, p.panelSize, p.vinylSize, ...p.lines.flatMap((l) => [l.designName, l.sizeLabel, l.cutSizeName])].some(
            (s) => s && s.toLowerCase().includes(t),
          )),
    );
  }, [panels, q, design, panelSize, cutSize, inStock, stock, panelsById]);

  const panelRef = useModalA11y(onClose);
  const selected = new Set(selectedIds);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="search" size={18} />
          </div>
          <div>
            <div className="ttl">Select Panels</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
            <div className="lp-search">
              <Icon name="search" size={13} />
              <input
                type="text"
                placeholder="Search by code, design, size…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search panels"
              />
            </div>
            {/* CR-310: column filters, the /panels fbar style. */}
            <div className="fbar" style={{ margin: 0, padding: "6px 10px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <FilterSelect label="Design" value={design} onChange={setDesign} options={designOptions} />
              <FilterSelect label="Panel Size" value={panelSize} onChange={setPanelSize} options={sizeOptions} />
              <FilterSelect label="Cut Piece Size" value={cutSize} onChange={setCutSize} options={cutOptions} />
              {stock && (
                <label className="row" style={{ gap: 6, fontSize: "var(--t-sm)", cursor: "pointer" }} title="Only panels whose cut pieces are all on hand">
                  <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock only
                </label>
              )}
              <span style={{ flex: 1 }} />
              <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{listed.length} of {panels.length}</span>
            </div>
            {/* CR-192: e-commerce tiles (PanelTile, shared with the /panels Photo view). */}
            <div
              style={{
                maxHeight: "calc(100vh - 260px)",
                overflowY: "auto",
                overscrollBehavior: "contain",
                padding: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
                alignContent: "start",
              }}
            >
              {listed.map((p) => {
                const sel = selected.has(p.id);
                return <PanelTile key={p.id} panel={p} selected={sel} onClick={() => onToggle(p.id)} title={sel ? `${p.panelCode} — click to remove` : p.panelCode} />;
              })}
              {listed.length === 0 && (
                <div className="dim" style={{ padding: 12, gridColumn: "1 / -1" }}>
                  No matching panels
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
            {selectedIds.length === 0 ? "No panels selected" : `${selectedIds.length} panel${selectedIds.length > 1 ? "s" : ""} selected`}
          </span>
          <span className="spacer" />
          <button className="hbtn primary" onClick={onClose}>
            <Icon name="check" size={13} />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
