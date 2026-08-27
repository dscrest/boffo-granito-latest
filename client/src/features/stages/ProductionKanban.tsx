/* ============================================================
   Production Kanban — item-wise board. One production LINE ITEM per card, split
   by output: the produced portion shows in Completed (available immediately), the
   remaining portion stays in its In Production / New lane — so a partly-produced
   line appears in BOTH lanes. Stages: New Request → In Production → Completed
   (QC hidden 2026-07). Cards move by hand-rolled HTML5 drag-and-drop; the `+`
   button on a remaining card logs output. Grouping is an ordered list of
   dimensions (Item / Customer / Order / Size) → nested swimlanes; empty = flat.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { fmt } from "@/lib/format";
import {
  PRODUCTION_STAGE_ORDER,
  PRODUCTION_STAGE_META,
  productionDetailKey,
  type ProductionEntry,
  type ProductionRequestGroup,
  type ProductionStage,
} from "./productionApi";

export type ProductionGroupBy = "item" | "customer" | "order" | "size";

interface Card {
  key: string;
  g: ProductionRequestGroup;
  e: ProductionEntry;
  kind: "remaining" | "done";
  qty: number;
  stage: ProductionStage; // which lane the card sits in
}

/** Split each item group into up to two cards: produced → Completed, remaining
    → its working stage. A line with both appears in both lanes. */
function buildCards(groups: ProductionRequestGroup[]): Card[] {
  const cards: Card[] = [];
  for (const g of groups) {
    const e = g.entries[0];
    if (!e) continue;
    const remaining = Math.max(0, e.qtyRequested - e.producedSoFar);
    const done = e.producedSoFar;
    if (done > 0) cards.push({ key: `${g.group}:done`, g, e, kind: "done", qty: done, stage: "Completed" });
    if (remaining > 0 || done === 0) {
      const stage = e.stage === "Completed" && remaining > 0 ? "InProduction" : e.stage;
      cards.push({ key: `${g.group}:rem`, g, e, kind: "remaining", qty: remaining, stage });
    }
  }
  return cards;
}

function laneKey(e: ProductionEntry, groupBy: ProductionGroupBy): string {
  switch (groupBy) {
    case "item": return e.design || "—";
    case "customer": return e.customer || "—";
    case "order": return e.independent ? "Independent" : e.orderNumber || e.poNumber || "—";
    case "size": return e.size || "—";
    default: return "";
  }
}

export function ProductionKanban({
  groups,
  groupBy,
  canEdit,
  onMove,
  onRecord,
}: {
  groups: ProductionRequestGroup[];
  groupBy: ProductionGroupBy[];
  canEdit: boolean;
  onMove: (group: ProductionRequestGroup, stage: ProductionStage) => void;
  onRecord: (group: ProductionRequestGroup) => void;
}) {
  const navigate = useNavigate();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Click a card → quick planning popup (Customer / SO / SO qty) so orders can
  // be prepone/postponed at a glance (user mandate 2026-07-20).
  const [info, setInfo] = useState<ProductionEntry | null>(null);

  const allCards = buildCards(groups);

  const stageGrid = (laneCards: Card[], laneKey: string) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRODUCTION_STAGE_ORDER.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
      {PRODUCTION_STAGE_ORDER.map((stage) => {
        const meta = PRODUCTION_STAGE_META[stage];
        const cards = laneCards.filter((c) => c.stage === stage);
        const overId = `${laneKey}|${stage}`;
        const isOver = overStage === overId;
        return (
          <div
            key={stage}
            onDragOver={(e) => {
              if (!canEdit || !dragKey) return;
              e.preventDefault();
              setOverStage(overId);
            }}
            onDragLeave={() => setOverStage((s) => (s === overId ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOverStage(null);
              const c = allCards.find((x) => x.key === dragKey);
              setDragKey(null);
              if (c && c.stage !== stage) onMove(c.g, stage);
            }}
            className="card"
            style={{ padding: 0, background: isOver ? "var(--accent-soft)" : undefined, transition: "background .12s" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
              <span style={{ fontWeight: 600 }}>{meta.label}</span>
              <span className="muted" style={{ fontSize: 14, marginLeft: "auto" }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
              {cards.map((c) => {
                const e = c.e;
                const draggable = canEdit && c.kind === "remaining";
                return (
                  <div
                    key={c.key}
                    draggable={draggable}
                    onDragStart={() => draggable && setDragKey(c.key)}
                    onDragEnd={() => { setDragKey(null); setOverStage(null); }}
                    onClick={() => setInfo(e)}
                    title="Order details (customer · SO · qty)"
                    style={{
                      position: "relative",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 10,
                      background: "var(--bg)",
                      cursor: draggable ? "grab" : "pointer",
                      opacity: dragKey === c.key ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{c.g.code}</span>
                      <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{fmt(c.qty)} box</span>
                      {c.kind === "remaining" && canEdit && (
                        <button
                          type="button"
                          className="btn x"
                          title="Log production"
                          aria-label="Log production"
                          style={{ padding: 2, height: 20, width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onRecord(c.g); }}
                        >
                          <Icon name="plus" size={12} />
                        </button>
                      )}
                      {/* Completed boxes → hand off to palletization (order-linked only). */}
                      {c.kind === "done" && canEdit && !e.independent && c.g.salesOrderId && (
                        <button
                          type="button"
                          className="btn x"
                          title="Send to Palletization"
                          aria-label="Send to Palletization"
                          style={{ padding: 2, height: 20, width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); navigate(`/packing?fromOrder=${encodeURIComponent(c.g.salesOrderId)}`); }}
                        >
                          <Icon name="truck" size={12} />
                        </button>
                      )}
                    </div>
                    <div className="design-name" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.design || "—"}
                    </div>
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {[e.size, e.independent ? "Independent" : e.orderNumber || e.poNumber, e.customer].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar value={e.producedSoFar} max={e.qtyRequested} color={meta.color} height={5} />
                      <div className="dim" style={{ display: "flex", gap: 8, fontSize: "var(--t-sm)", marginTop: 3 }}>
                        <span>{c.kind === "done" ? "Produced" : "Remaining"} {fmt(c.qty)}</span>
                        <span style={{ marginLeft: "auto" }}>{fmt(e.producedSoFar)} / {fmt(e.qtyRequested)} boxes</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Nested swimlanes: partition by dims[0], recurse on the rest; at the leaf
  // (no dims left) render the stage columns. Empty groupBy → flat board (today's
  // default). keyPrefix composes the lane path so each leaf grid's drop targets
  // stay unique across the tree (drag/onMove stay scoped per lane).
  const renderLevel = (cards: Card[], dims: ProductionGroupBy[], depth: number, keyPrefix: string): JSX.Element => {
    if (dims.length === 0) return stageGrid(cards, keyPrefix);
    const by = new Map<string, Card[]>();
    for (const c of cards) {
      const k = laneKey(c.e, dims[0]);
      (by.get(k) ?? by.set(k, []).get(k)!).push(c);
    }
    // Top-level lanes get the bordered "section" box (like the item form's
    // sections) so two lanes read as clearly separate; nested lanes just indent.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: depth === 0 ? 0 : 16 }}>
        {[...by.entries()]
          // In-progress lanes (any card in InProduction) float to the top; then A→Z.
          .sort((a, b) => {
            const ap = a[1].some((c) => c.stage === "InProduction") ? 0 : 1;
            const bp = b[1].some((c) => c.stage === "InProduction") ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return a[0] < b[0] ? -1 : 1;
          })
          .map(([k, sub]) => (
            <div key={k} className={depth === 0 ? "form-section" : undefined} style={depth === 0 ? undefined : { marginLeft: depth * 16 }}>
              {depth === 0 ? (
                <div className="form-section-title">
                  <span style={{ flex: 1 }}>{k}</span>
                  <span className="muted" style={{ fontSize: 14, fontWeight: 400, letterSpacing: 0 }}>{sub.length}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: "var(--muted)" }}>{k}</span>
                  <span className="muted" style={{ fontSize: 14 }}>{sub.length}</span>
                </div>
              )}
              {renderLevel(sub, dims.slice(1), depth + 1, `${keyPrefix}/${dims[0]}=${k}`)}
            </div>
          ))}
      </div>
    );
  };

  return (
    <>
      {renderLevel(allCards, groupBy, 0, "")}
      {info && (
        <div className="modal-backdrop" onClick={() => setInfo(null)}>
          <div className="modal-panel card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="df-head">
              <div className="ico"><Icon name="factory" size={16} /></div>
              <div>
                <div className="ttl">{info.design || "—"}</div>
                <div className="sub2">{[info.size, info.finish].filter(Boolean).join(" · ") || "Production order"}</div>
              </div>
              <button className="btn x" onClick={() => setInfo(null)} title="Close" tabIndex={-1}>✕</button>
            </div>
            <div className="df-body">
              <div className="form-grid">
                <div className="form-field">
                  <span className="lbl">Customer</span>
                  <span>{info.independent ? "Independent (make-to-stock)" : info.customer || "—"}</span>
                </div>
                <div className="form-field">
                  <span className="lbl">Sales Order</span>
                  <span>{info.independent ? "—" : info.orderNumber || info.poNumber || "—"}</span>
                </div>
                <div className="form-field">
                  <span className="lbl">SO Qty (ordered)</span>
                  <span className="mono">{info.independent ? "—" : fmt(info.ordered)}</span>
                </div>
                <div className="form-field">
                  <span className="lbl">In this production</span>
                  <span className="mono">{fmt(info.producedSoFar)} / {fmt(info.qtyRequested)} boxes</span>
                </div>
              </div>
            </div>
            <div className="df-foot">
              <button className="btn" onClick={() => setInfo(null)}>Close</button>
              <button className="hbtn primary" onClick={() => navigate(`/prod/${encodeURIComponent(productionDetailKey(info))}`)}>
                Open production
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
