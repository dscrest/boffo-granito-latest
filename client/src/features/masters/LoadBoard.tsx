/* ============================================================
   LoadBoard — P4 drag-and-drop pallet swap between containers.

   One column per non-dispatched container; each card is a loaded
   pallet batch (ContainerLoading row). Dragging a card to another
   column re-points ContainerLoading.container, so an underfilled
   container can be rebalanced without unloading. Capacity header
   shows boxes filled vs the container's box capacity.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { list, update, type DSRow } from "@/lib/dataOps";
import type { ContainerRow } from "./containersApi";

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

interface BoardCard {
  loadingId: string; // ContainerLoading ROWID (the row we re-point)
  containerId: string;
  batchId: string;
  design: string;
  boxes: number;
  orderNumber: string;
}

export function LoadBoard({ containers }: { containers: ContainerRow[] }) {
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cols = useMemo(() => containers.filter((c) => c.status !== "dispatched"), [containers]);

  const load = useCallback(async () => {
    setLoading(true);
    const loadings = await list("ContainerLoading", { limit: 300, columns: ["container", "batch"] });
    const rows = loadings.rows || [];
    if (rows.length === 0) {
      setCards([]);
      setLoading(false);
      return;
    }
    const batchIds = [...new Set(rows.map((r) => str(r.batch)).filter(Boolean))];
    const batches = await list("PalletisedBatch", {
      where: `ROWID IN (${batchIds.join(",")})`,
      limit: 300,
      columns: ["boxes_packed", "design", "sales_order"],
    });
    const batchById = new Map<string, DSRow>();
    (batches.rows || []).forEach((b) => batchById.set(str(b.ROWID), b));

    const designIds = [...new Set((batches.rows || []).map((b) => str(b.design)).filter(Boolean))];
    const soIds = [...new Set((batches.rows || []).map((b) => str(b.sales_order)).filter(Boolean))];
    const [designs, sos] = await Promise.all([
      designIds.length
        ? list("Design", { where: `ROWID IN (${designIds.join(",")})`, columns: ["design_name"] })
        : Promise.resolve({ ok: true as const, rows: [] as DSRow[] }),
      soIds.length
        ? list("SalesOrder", { where: `ROWID IN (${soIds.join(",")})`, columns: ["order_number"] })
        : Promise.resolve({ ok: true as const, rows: [] as DSRow[] }),
    ]);
    const designName = new Map((designs.rows || []).map((d) => [str(d.ROWID), str(d.design_name)]));
    const soNumber = new Map((sos.rows || []).map((s) => [str(s.ROWID), str(s.order_number)]));

    setCards(
      rows
        .map((r) => {
          const b = batchById.get(str(r.batch));
          return {
            loadingId: str(r.ROWID),
            containerId: str(r.container),
            batchId: str(r.batch),
            design: b ? designName.get(str(b.design)) || str(b.design) : str(r.batch),
            boxes: b ? num(b.boxes_packed) : 0,
            orderNumber: b ? soNumber.get(str(b.sales_order)) || "" : "",
          };
        })
        .filter((c) => c.batchId),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byContainer = useMemo(() => {
    const m = new Map<string, BoardCard[]>();
    cards.forEach((c) => {
      (m.get(c.containerId) || m.set(c.containerId, []).get(c.containerId)!).push(c);
    });
    return m;
  }, [cards]);

  const onDrop = async (targetId: string) => {
    setOverCol(null);
    const card = cards.find((c) => c.loadingId === dragId);
    setDragId(null);
    if (!card || card.containerId === targetId || busy) return;
    setBusy(true);
    const res = await update("ContainerLoading", card.loadingId, { container: targetId });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Move failed");
      return;
    }
    setCards((prev) => prev.map((c) => (c.loadingId === card.loadingId ? { ...c, containerId: targetId } : c)));
    const target = cols.find((c) => c.id === targetId);
    toast.success(`Pallet moved to ${target?.containerNumber || "container"}`);
  };

  if (cols.length === 0) return null;

  return (
    <div style={{ marginTop: 22 }}>
      <div className="sec-title">
        <h2>Load Board</h2>
        <span className="meta">
          {loading ? "Loading…" : `${cards.length} loaded pallet batches`} · drag a pallet card onto another container to
          swap
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
        {cols.map((c) => {
          const colCards = byContainer.get(c.id) || [];
          const filled = colCards.reduce((s, x) => s + x.boxes, 0);
          const pctFill = c.capacityBoxes > 0 ? Math.round((filled / c.capacityBoxes) * 100) : 0;
          return (
            <div
              key={c.id}
              className="card"
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(c.id);
              }}
              onDragLeave={() => setOverCol((cur) => (cur === c.id ? null : cur))}
              onDrop={() => void onDrop(c.id)}
              style={{
                minWidth: 230,
                flex: "0 0 230px",
                padding: 10,
                outline: overCol === c.id && dragId ? "2px dashed var(--c-cyan)" : "none",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <b className="mono" style={{ fontSize: 12 }}>{c.containerNumber}</b>
                <span className="chip">{c.containerType || "—"}</span>
              </div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                {fmt(filled)}{c.capacityBoxes > 0 ? ` / ${fmt(c.capacityBoxes)}` : ""} boxes
                {c.capacityBoxes > 0 ? ` · ${pctFill}%` : ""}
              </div>
              {colCards.map((card) => (
                <div
                  key={card.loadingId}
                  draggable
                  onDragStart={() => setDragId(card.loadingId)}
                  onDragEnd={() => setDragId(null)}
                  className="card"
                  style={{
                    padding: "7px 9px",
                    marginBottom: 6,
                    cursor: "grab",
                    opacity: dragId === card.loadingId ? 0.45 : 1,
                    border: "1px solid var(--line, #2a2a3a)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{card.design}</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    {fmt(card.boxes)} boxes{card.orderNumber ? ` · ${card.orderNumber}` : ""}
                  </div>
                </div>
              ))}
              {colCards.length === 0 && (
                <div className="dim" style={{ fontSize: 11, padding: "10px 4px", textAlign: "center" }}>
                  <Icon name="package" size={13} /> empty — drop a pallet here
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
