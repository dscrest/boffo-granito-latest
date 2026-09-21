/* ============================================================
   Panel picker — search popup for choosing showcase Panels.
   A plain dropdown can't carry a panel's identity (image, designs,
   sizes, cut pieces), so this modal shows every panel as an
   e-commerce tile (CR-192) with one search box matching all of
   them: code, panel/vinyl size, design names, sizes and cut-piece
   sizes. Multi-select (CR-193): a click toggles a tile, Done closes.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { designImageUrl } from "@/lib/api";
import type { PanelRow } from "./panelsApi";

export function PanelPickerModal({
  panels,
  selectedIds,
  onToggle,
  onClose,
}: {
  panels: PanelRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const listed = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return panels;
    return panels.filter((p) =>
      [p.panelCode, p.panelSize, p.vinylSize, ...p.lines.flatMap((l) => [l.designName, l.sizeLabel, l.cutSizeName])].some(
        (s) => s && s.toLowerCase().includes(t),
      ),
    );
  }, [panels, q]);

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
            {/* CR-192: e-commerce tiles — the showcase image IS the panel's identity for a rep. */}
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
                const designs = p.lines.map((l) => l.designName).join(", ");
                const meta =
                  [
                    p.panelSize && `Panel: ${p.panelSize}`,
                    p.vinylSize && `Vinyl: ${p.vinylSize}`,
                    p.lines.length && `${p.lines.length} design${p.lines.length > 1 ? "s" : ""}`,
                  ]
                    .filter(Boolean)
                    .join("  ·  ") || "No details yet";
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`panel-card${sel ? " sel" : ""}`}
                    aria-pressed={sel}
                    onClick={() => onToggle(p.id)}
                    title={sel ? `${p.panelCode} — click to remove` : p.panelCode}
                  >
                    {p.images[0] ? (
                      <img className="img" src={designImageUrl(p.images[0].id)} alt={p.panelCode} loading="lazy" />
                    ) : (
                      <div className="img none">No image</div>
                    )}
                    <div className="code">
                      {sel && <Icon name="check" size={12} />} {p.panelCode}
                    </div>
                    <div className="meta" title={meta}>{meta}</div>
                    {designs && (
                      <div className="meta" title={designs}>
                        {designs}
                      </div>
                    )}
                  </button>
                );
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
