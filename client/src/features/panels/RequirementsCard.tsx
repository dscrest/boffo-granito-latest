/* ============================================================
   Requirements card (CR-288 / 312 / 382) — what a panel order needs, what is
   on hand, booked to it, short, and the godown's manual Available tick; the
   Allocate Stock button + modal in its head. CR-450: lives on the ACTIONS tab
   of the panel order (moved whole from Details, which is informative only).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { AllocateCutStockModal } from "./AllocateCutStockModal";
import { PANEL_ORDER_OPEN, SAMPLE_ORDER_OPEN, saveChecklist, type PanelOrderRow, type Requirement } from "./panelOrdersApi";
import { allocateSampleOrder, type SampleOrderRow } from "./sampleOrdersApi";

/* CR-487: the sample order's Requirements card — the panel card's Need · In Stock · Allocated · Short
   columns + the same Allocate Stock modal, writing through /sample-order-allocate. No Panels column, no
   Available tick (a sample has no godown checklist). CR-489: every line books Panel Craft sample stock — a Full
   tile on the item's full-size piece (user 2026-10-28: "no need for batch … sample stock … no batch / shade"). */
export function SampleRequirementsCard({ order, reqs, onChanged }: { order: SampleOrderRow; reqs: Requirement[]; onChanged: () => void }) {
  const canEdit = can("panel_craft", "edit");
  const [allocating, setAllocating] = useState(false);
  const isOpen = SAMPLE_ORDER_OPEN.has(order.status);
  const openReason = isOpen ? "" : order.status === "Cancelled" ? "Order cancelled" : "Order supplied";
  const unbookedPcs = reqs.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  return (
    <div className="card">
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>Requirements</span>
        {canEdit && (
          <button
            className="hbtn primary"
            style={{ marginLeft: "auto" }}
            disabled={!isOpen || reqs.length === 0}
            title={openReason || (reqs.length === 0 ? "Nothing pending to book" : unbookedPcs ? `Book free sample stock to this order — ${fmt(unbookedPcs)} pcs still unbooked` : "Every piece is booked — open to release pieces")}
            onClick={() => setAllocating(true)}
          >
            <Icon name="package" size={13} /> Allocate Stock
          </button>
        )}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Design</th>
              <th>Piece</th>
              <th className="num" style={{ textAlign: "right" }}>Need</th>
              <th className="num" style={{ textAlign: "right" }}>In Stock</th>
              <th className="num" style={{ textAlign: "right" }}>Allocated</th>
              <th className="num" style={{ textAlign: "right" }}>Short</th>
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.key}>
                <td>
                  <Link className="linkish" to={`/design/${encodeURIComponent(r.designId)}`} title="Open item">
                    <span className="design-name">{r.designName}</span>
                  </Link>
                </td>
                <td className="mono">{r.cutSizeName || <span className="dim">—</span>}</td>
                <td className="num mono">{fmt(r.need)}</td>
                <td className="num mono" style={{ color: r.short ? "var(--c-red)" : undefined, fontWeight: r.short ? 600 : undefined }} title={r.short ? `Short by ${fmt(r.need - r.have)}` : undefined}>
                  {fmt(r.have)}
                </td>
                <td className="num mono" style={{ color: r.allocated >= r.need ? "var(--c-green)" : undefined }} title={`Booked to this order · ${fmt(r.free)} free to book`}>
                  {fmt(r.allocated)}
                </td>
                <td className="num mono" style={r.toCut > 0 ? { color: "var(--c-red)", fontWeight: 600 } : undefined} title="Need − allocated − free: pieces that must still be cut for this order">
                  {r.toCut > 0 ? fmt(r.toCut) : <span className="dim">—</span>}
                </td>
              </tr>
            ))}
            {reqs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>Nothing pending to book.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {allocating && (
        <AllocateCutStockModal
          orderId={order.id}
          title={`${order.orderNumber || "Sample Order"} · ${order.customerName}`}
          reqs={reqs}
          save={allocateSampleOrder}
          onDone={onChanged}
          onClose={() => setAllocating(false)}
        />
      )}
    </div>
  );
}

export function RequirementsCard({ order, reqs, onChanged }: { order: PanelOrderRow; reqs: Requirement[]; onChanged: () => void }) {
  const canEdit = can("panel_craft", "edit");
  const [allocating, setAllocating] = useState(false); // CR-312 modal
  // Local checklist so a tick shows at once; the save lands in the background.
  const [ticks, setTicks] = useState<Record<string, boolean> | null>(null);
  useEffect(() => setTicks(null), [order.id]); // new record → forget the previous order's ticks
  const checklist = ticks ?? order.checklist ?? {};
  const isOpen = PANEL_ORDER_OPEN.has(order.status);
  const openReason = isOpen ? "" : order.status === "Cancelled" ? "Order cancelled" : "Order dispatched"; // CR-400: open from birth
  const unbooked = reqs.filter((r) => r.allocated < r.need);
  const unbookedPcs = unbooked.reduce((s, r) => s + r.need - r.allocated, 0);
  // ponytail: band key = the row's panel set; rows are still one per design×cut (CR-303), never split. CR-382.
  const reqBands = useMemo(() => {
    const m = new Map<string, Requirement[]>();
    for (const r of reqs) {
      const k = r.panels.map((p) => p.panelCode).sort().join(" · ");
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [reqs]);

  const tick = async (key: string, on: boolean) => {
    const next = { ...checklist, [key]: on };
    if (!on) delete next[key];
    setTicks(next);
    const res = await saveChecklist(order.id, next);
    if (!res.ok) {
      setTicks(checklist); // revert
      toast.error(res.error || "Could not save the checklist");
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>Requirements</span>
        {/* CR-305: no "Short:" sentence here — the red In Stock figures say it. */}
        {/* CR-312: always visible for editors, greyed with the reason (house rule). */}
        {canEdit && (
          <button
            className="hbtn primary"
            style={{ marginLeft: "auto" }}
            disabled={!isOpen || reqs.length === 0}
            title={openReason || (reqs.length === 0 ? "No cut pieces required" : unbooked.length ? `Book free cut pieces to this order — ${fmt(unbookedPcs)} pcs still unbooked` : "Every piece is booked — open to release pieces")}
            onClick={() => setAllocating(true)}
          >
            <Icon name="package" size={13} /> Allocate Stock
          </button>
        )}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Design</th>
              <th>Cut Piece Size</th>
              <th>Panels</th>
              <th className="num" style={{ textAlign: "right" }}>Need</th>
              <th className="num" style={{ textAlign: "right" }}>In Stock</th>
              <th className="num" style={{ textAlign: "right" }}>Allocated</th>
              <th className="num" style={{ textAlign: "right" }}>Short</th>
              <th style={{ width: 90, textAlign: "center" }}>Available</th>
            </tr>
          </thead>
          <tbody>
            {reqBands.map(([band, group]) => [
              /* CR-382: one band per panel (a row shared by two panels bands under both codes). */
              <tr key={`band|${band}`} style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", fontWeight: 700 }}>
                <td colSpan={8} className="mono">
                  {group[0].panels.map((p, i) => (
                    <span key={p.panelId}>
                      {i > 0 && <span className="dim"> · </span>}
                      {p.panelId ? <Link className="linkish" to={`/panels/${encodeURIComponent(p.panelId)}`} title="Open panel">{p.panelCode}</Link> : p.panelCode}
                    </span>
                  ))}
                </td>
              </tr>,
              ...group.map((r) => (
                <tr key={r.key}>
                  <td>
                    <Link className="linkish" to={`/design/${encodeURIComponent(r.designId)}`} title="Open item">
                      <span className="design-name">{r.designName}</span>
                    </Link>
                  </td>
                  <td className="mono">{r.cutSizeName || <span className="dim">—</span>}</td>
                  <td className="mono dim" style={{ whiteSpace: "nowrap" }}>
                    {r.panels.map((p, i) => (
                      <span key={p.panelId}>
                        {i > 0 && " · "}
                        {p.panelCode} ×{fmt(p.qty)}
                      </span>
                    ))}
                  </td>
                  <td className="num mono">{fmt(r.need)}</td>
                  <td className="num mono" style={{ color: r.short ? "var(--c-red)" : undefined, fontWeight: r.short ? 600 : undefined }} title={r.short ? `Short by ${fmt(r.need - r.have)}` : undefined}>
                    {fmt(r.have)}
                  </td>
                  <td className="num mono" style={{ color: r.allocated >= r.need ? "var(--c-green)" : undefined }} title={`Booked to this order · ${fmt(r.free)} free to book`}>
                    {fmt(r.allocated)}
                  </td>
                  <td className="num mono" style={r.toCut > 0 ? { color: "var(--c-red)", fontWeight: 600 } : undefined} title="Need − allocated − free: pieces that must still be cut for this order">
                    {r.toCut > 0 ? fmt(r.toCut) : <span className="dim">—</span>}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      aria-label={`${r.designName} ${r.cutSizeName} available`}
                      checked={!!checklist[r.key]}
                      disabled={!canEdit}
                      onChange={(e) => void tick(r.key, e.target.checked)}
                    />
                  </td>
                </tr>
              )),
            ])}
            {reqs.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 18 }}>No cut pieces required — these panels have no designs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {allocating && (
        <AllocateCutStockModal
          orderId={order.id}
          title={`${order.orderNumber || "Panel Order"} · ${order.customerName}`}
          reqs={reqs}
          onDone={onChanged}
          onClose={() => setAllocating(false)}
        />
      )}
    </div>
  );
}
