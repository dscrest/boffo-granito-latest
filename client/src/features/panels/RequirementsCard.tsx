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
import { NumberInput } from "@/ui/NumberInput";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { useModalA11y } from "@/ui/useModalA11y";
import { cachedBatchStock, listBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";
import { cachedSampleClaimEntries, listProductionLogs } from "@/features/stages/productionApi";
import { isFullKey, PANEL_ORDER_OPEN, SAMPLE_ORDER_OPEN, saveChecklist, type PanelOrderRow, type Requirement } from "./panelOrdersApi";
import { allocateSampleBoxes, allocateSampleOrder, type SampleOrderRow } from "./sampleOrdersApi";

/* CR-487: the sample order's Requirements card — the panel card's Need · In Stock · Allocated · Short
   columns + the same Allocate Stock modal, writing through /sample-order-allocate. No Panels column, no
   Available tick (a sample has no godown checklist). CR-488: Full-tile lines are BOX rows — figures in
   boxes, booked per batch from the row's own Book… (the SO Allocate Stock batch picker, absolute). */
export function SampleRequirementsCard({ order, reqs, onChanged }: { order: SampleOrderRow; reqs: Requirement[]; onChanged: () => void }) {
  const canEdit = can("panel_craft", "edit");
  const [allocating, setAllocating] = useState(false);
  const [boxing, setBoxing] = useState<Requirement | null>(null); // CR-488: the Full-tile row being booked
  const isOpen = SAMPLE_ORDER_OPEN.has(order.status);
  const openReason = isOpen ? "" : order.status === "Cancelled" ? "Order cancelled" : "Order supplied";
  const cutReqs = reqs.filter((r) => !isFullKey(r.key));
  const unbookedPcs = cutReqs.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  return (
    <div className="card">
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>Requirements</span>
        {canEdit && (
          <button
            className="hbtn primary"
            style={{ marginLeft: "auto" }}
            disabled={!isOpen || cutReqs.length === 0}
            title={openReason || (cutReqs.length === 0 ? (reqs.length ? "Full tiles book boxes per row — use Book… on the row" : "No cut pieces required") : unbookedPcs ? `Book free cut pieces to this order — ${fmt(unbookedPcs)} pcs still unbooked` : "Every piece is booked — open to release pieces")}
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
            {reqs.map((r) => {
              const full = isFullKey(r.key);
              const unit = full ? (r.need === 1 ? "box" : "boxes") : "pcs";
              return (
                <tr key={r.key}>
                  <td>
                    <Link className="linkish" to={`/design/${encodeURIComponent(r.designId)}`} title="Open item">
                      <span className="design-name">{r.designName}</span>
                    </Link>
                  </td>
                  <td className="mono">{full ? <>Full tile <span className="dim">· boxes</span></> : r.cutSizeName || <span className="dim">—</span>}</td>
                  <td className="num mono" title={full ? "Boxes that cover the pending pieces at the item's pieces per box" : undefined}>{fmt(r.need)}</td>
                  <td className="num mono" style={{ color: r.short ? "var(--c-red)" : undefined, fontWeight: r.short ? 600 : undefined }} title={r.short ? `Short by ${fmt(r.need - r.have)} ${unit}` : undefined}>
                    {fmt(r.have)}
                  </td>
                  <td className="num mono" style={{ color: r.allocated >= r.need ? "var(--c-green)" : undefined, whiteSpace: "nowrap" }} title={`Booked to this order · ${fmt(r.free)} free to book`}>
                    {fmt(r.allocated)}
                    {full && canEdit && (
                      <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, marginLeft: 8, cursor: isOpen ? "pointer" : "default", font: "inherit" }} disabled={!isOpen} title={openReason || "Book or release boxes of this item from its batches"} onClick={() => setBoxing(r)}>
                        Book…
                      </button>
                    )}
                  </td>
                  <td className="num mono" style={r.toCut > 0 ? { color: "var(--c-red)", fontWeight: 600 } : undefined} title={full ? "Need − allocated − free: boxes that must still be produced for this order" : "Need − allocated − free: pieces that must still be cut for this order"}>
                    {r.toCut > 0 ? fmt(r.toCut) : <span className="dim">—</span>}
                  </td>
                </tr>
              );
            })}
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
          reqs={cutReqs}
          save={allocateSampleOrder}
          onDone={onChanged}
          onClose={() => setAllocating(false)}
        />
      )}
      {boxing && <SampleBoxModal order={order} req={boxing} onDone={onChanged} onClose={() => setBoxing(null)} />}
    </div>
  );
}

/* CR-488: book boxes of ONE item to a sample order — the SO Allocate Stock picker (batches oldest first,
   Available = free boxes nobody holds) made ABSOLUTE like the cut modal: each row shows what this order
   already holds from that batch; type higher to book, lower to release, 0 to release all. Cap per batch =
   held + free, cap overall = the row's need; the server re-checks both. */
const byAge = (a: BatchStockRow, b: BatchStockRow) => a.mfgDate.localeCompare(b.mfgDate) || a.batchNumber.localeCompare(b.batchNumber);
function SampleBoxModal({ order, req, onDone, onClose }: { order: SampleOrderRow; req: Requirement; onDone: () => void; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const own = (claims: { sampleOrderId: string; designId: string; batchNumber: string; qtyBoxes: number }[]) => {
    const m = new Map<string, number>();
    for (const c of claims) if (c.sampleOrderId === order.id && c.designId === req.designId) m.set(c.batchNumber, (m.get(c.batchNumber) ?? 0) + c.qtyBoxes);
    return m;
  };
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [held, setHeld] = useState<Map<string, number>>(() => own(cachedSampleClaimEntries()));
  const [booked, setBooked] = useState<Map<string, number>>(() => own(cachedSampleClaimEntries()));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void Promise.all([listBatchStock(), listProductionLogs()]).then(([s, p]) => {
      if (s.ok) setStock(s.rows);
      if (p.ok) {
        const h = own(p.sampleClaimEntries);
        setHeld(h);
        setBooked(h);
      }
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, req.designId]);
  // Batches of this item: anything free, plus anything this order already holds (even if nothing else is free).
  const rows = stock.filter((r) => r.designId === req.designId && (r.free > 0 || (held.get(r.batchNumber) ?? 0) > 0)).sort(byAge);
  const capOf = (r: BatchStockRow) => r.free + (held.get(r.batchNumber) ?? 0);
  const total = [...booked.values()].reduce((s, n) => s + n, 0);
  const set = (r: BatchStockRow, v: number) => {
    const others = total - (booked.get(r.batchNumber) ?? 0);
    const cap = Math.max(0, Math.min(capOf(r), req.need - others));
    setBooked((prev) => new Map(prev).set(r.batchNumber, Math.max(0, Math.min(cap, Math.floor(v) || 0))));
  };
  const bookAll = () => {
    let left = req.need;
    const next = new Map<string, number>();
    for (const r of rows) {
      const take = Math.min(capOf(r), left);
      if (take > 0) next.set(r.batchNumber, take);
      left -= take;
    }
    setBooked(next);
  };
  const releaseAll = () => setBooked(new Map());
  const changed = rows.some((r) => (booked.get(r.batchNumber) ?? 0) !== (held.get(r.batchNumber) ?? 0));
  const submit = async () => {
    if (saving || !changed) return;
    setSaving(true);
    const res = await allocateSampleBoxes(order.id, req.designId, rows.map((r) => ({ batch_number: r.batchNumber, qty_boxes: booked.get(r.batchNumber) ?? 0 })));
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not update the booking");
      return;
    }
    toast.success(`${fmt(total)} of ${fmt(req.need)} box${req.need === 1 ? "" : "es"} booked to this order`);
    onDone();
    onClose();
  };
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Allocate Stock</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{order.orderNumber || "Sample Order"} · {req.designName} · Full tile</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          {!loaded && rows.length === 0 && <div style={{ padding: 8 }}><BoffoLoader size="sm" /></div>}
          {loaded && rows.length === 0 && <div style={{ padding: 8, color: "var(--c-red)" }}>No stock available — needs production.</div>}
          {rows.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: "var(--t-sm)" }}>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={bookAll} disabled={saving}>Book all available</button>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={releaseAll} disabled={saving}>Release all</button>
                <span className="dim" style={{ marginLeft: "auto" }}>Free = boxes no order holds</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th className="num" style={{ textAlign: "right" }}>Free</th>
                    <th className="num" style={{ textAlign: "right", width: 120 }}>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.batchNumber}>
                      <td className="mono">{r.batchNumber || "—"}{r.mfgDate ? <span className="dim"> · {r.mfgDate}</span> : null}</td>
                      <td className="num mono">{fmt(r.free)}</td>
                      <td className="num">
                        <NumberInput min={0} value={booked.get(r.batchNumber) ?? 0} onChange={(e) => set(r, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${req.designName} batch ${r.batchNumber || "unbatched"} boxes booked`} disabled={saving} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="df-foot">
          <span className="df-req-note">{rows.length ? `${fmt(total)} of ${fmt(req.need)} box${req.need === 1 ? "" : "es"} booked` : ""}</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving || !changed} onClick={() => void submit()}>
            {saving ? <BoffoLoader size="sm" /> : <><Icon name="check" size={13} /> Save</>}
          </button>
        </div>
      </div>
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
