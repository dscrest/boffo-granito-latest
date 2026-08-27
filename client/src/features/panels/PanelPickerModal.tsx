/* ============================================================
   Panel picker — search popup for choosing a showcase Panel.
   A plain dropdown can't carry a panel's identity (designs,
   sizes, cut pieces), so this modal lists every panel with its
   properties and one search box matching all of them: code,
   panel/vinyl size, design names, sizes and cut-piece sizes.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import type { PanelRow } from "./panelsApi";

export function PanelPickerModal({
  panels,
  selectedId,
  onSelect,
  onClose,
}: {
  panels: PanelRow[];
  selectedId: string;
  onSelect: (id: string) => void;
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

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="search" size={18} />
          </div>
          <div>
            <div className="ttl">Select Panel</div>
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
            <div style={{ maxHeight: 360, overflowY: "auto", overscrollBehavior: "contain" }}>
              {listed.map((p) => {
                const sel = p.id === selectedId;
                const designs = p.lines.map((l) => l.designName).join(", ");
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onSelect(p.id);
                      onClose();
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: sel ? "var(--accent-soft)" : "transparent",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                    title={p.panelCode}
                  >
                    <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.panelCode}
                    </div>
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                      {[
                        p.panelSize && `Panel: ${p.panelSize}`,
                        p.vinylSize && `Vinyl: ${p.vinylSize}`,
                        p.lines.length && `${p.lines.length} design${p.lines.length > 1 ? "s" : ""}`,
                      ]
                        .filter(Boolean)
                        .join("  ·  ") || "No details yet"}
                    </div>
                    {designs && (
                      <div
                        className="dim"
                        style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        title={designs}
                      >
                        {designs}
                      </div>
                    )}
                  </button>
                );
              })}
              {listed.length === 0 && (
                <div className="dim" style={{ padding: 12 }}>
                  No matching panels
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
