/* ============================================================
   Production Kanban — four manual stages (New Request → In Production → QC →
   Completed). Cards are whole-order productions (groupProductionByOrder). Moved
   by hand-rolled HTML5 drag-and-drop (no dependency); dropping a card in a column
   sets that stage on every plan line of the production via setProductionStage.
   Recording output does NOT move a card — stages are manual.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { pct } from "@/lib/format";
import { PRODUCTION_STAGE_ORDER, PRODUCTION_STAGE_META, type ProductionRequestGroup, type ProductionStage } from "./productionApi";

export function ProductionKanban({
  groups,
  canEdit,
  onMove,
}: {
  groups: ProductionRequestGroup[];
  canEdit: boolean;
  onMove: (group: ProductionRequestGroup, stage: ProductionStage) => void;
}) {
  const navigate = useNavigate();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<ProductionStage | null>(null);

  const byStage = (stage: ProductionStage) => groups.filter((g) => g.stage === stage);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRODUCTION_STAGE_ORDER.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
      {PRODUCTION_STAGE_ORDER.map((stage) => {
        const meta = PRODUCTION_STAGE_META[stage];
        const cards = byStage(stage);
        const isOver = overStage === stage;
        return (
          <div
            key={stage}
            onDragOver={(e) => {
              if (!canEdit || !dragKey) return;
              e.preventDefault();
              setOverStage(stage);
            }}
            onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOverStage(null);
              const g = groups.find((x) => x.group === dragKey);
              setDragKey(null);
              if (g && g.stage !== stage) onMove(g, stage);
            }}
            className="card"
            style={{ padding: 0, background: isOver ? "var(--accent-soft)" : undefined, transition: "background .12s" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
              <span style={{ fontWeight: 600 }}>{meta.label}</span>
              <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
              {cards.map((g) => (
                <div
                  key={g.group}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(g.group)}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverStage(null);
                  }}
                  onClick={() => navigate(`/prod/${encodeURIComponent(g.group)}`)}
                  title="Open production"
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    background: "var(--bg)",
                    cursor: canEdit ? "grab" : "pointer",
                    opacity: dragKey === g.group ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>{g.code}</span>
                    <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>
                      {g.independent ? `${pct(g.totalProduced, g.totalRequested)}%` : `${pct(g.produced, g.ordered)}%`}
                    </span>
                  </div>
                  <div className="design-name" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {g.designSummary}
                  </div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[g.independent ? "Independent" : g.orderNumber || g.poNumber, g.customer].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              ))}
              {cards.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
