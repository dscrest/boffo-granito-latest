/* ============================================================
   Requirements card (CR-288 / 312 / 382) — what a panel order needs, what is
   on hand, booked to it, short, and the godown's manual Available tick; the
   Allocate Stock button + modal in its head. CR-450: lives on the ACTIONS tab
   of the panel order (moved whole from Details, which is informative only).
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { isFullKey, PANEL_ORDER_OPEN, SAMPLE_ORDER_OPEN, saveChecklist, type Allocation, type PanelOrderRow, type Requirement } from "./panelOrdersApi";
import { allocateSample, type SampleOrderRow } from "./sampleOrdersApi";

/* CR-487: the sample order's Requirements card — the panel card's Need · In Stock · Allocated · Short
   columns + ONE Allocate Stock window writing through /sample-order-allocate. No Panels column, no
   Available tick (a sample has no godown checklist). CR-488: Full-tile lines are BOX rows (figures in
   boxes); the same window books them per batch (user 2026-10-28: "Allocate stock is enough" — no per-row Book…). */
export function SampleRequirementsCard({ order, reqs, onChanged }: { order: SampleOrderRow; reqs: Requirement[]; onChanged: () => void }) {
  const canEdit = can("panel_craft", "edit");
  const [allocating, setAllocating] = useState(false);
  const isOpen = SAMPLE_ORDER_OPEN.has(order.status);
  const openReason = isOpen ? "" : order.status === "Cancelled" ? "Order cancelled" : "Order supplied";
  const unbooked = reqs.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  return (
    <div className="card">
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>Requirements</span>
        {canEdit && (
          <button
            className="hbtn primary"
            style={{ marginLeft: "auto" }}
            disabled={!isOpen || reqs.length === 0}
            title={openReason || (reqs.length === 0 ? "Nothing pending to book" : unbooked ? `Book free stock to this order — ${fmt(unbooked)} still unbooked` : "Everything is booked — open to release")}
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
                  <td className="num mono" style={{ color: r.allocated >= r.need ? "var(--c-green)" : undefined }} title={`Booked to this order · ${fmt(r.free)} free to book`}>
                    {fmt(r.allocated)}
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
      {allocating && <SampleAllocateModal order={order} reqs={reqs} onDone={onChanged} onClose={() => setAllocating(false)} />}
    </div>
  );
}

/* CR-487/488: the sample order's ONE Allocate Stock window — cut-piece rows (pcs, the cut modal's rule:
   cap = min(need, booked + free)) and full-tile items with their batches oldest first (boxes, the SO picker's
   rule made ABSOLUTE: each batch row shows what this order already holds there; cap per batch = held + free,
   cap per item = its need). Higher books, lower releases, 0 releases all. ONE save → /sample-order-allocate
   with `allocation` (cut) + `boxes` (full); the server re-checks need + free for both. */
const byAge = (a: BatchStockRow, b: BatchStockRow) => a.mfgDate.localeCompare(b.mfgDate) || a.batchNumber.localeCompare(b.batchNumber);
const clampInt = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, Math.floor(v) || 0));
function SampleAllocateModal({ order, reqs, onDone, onClose }: { order: SampleOrderRow; reqs: Requirement[]; onDone: () => void; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const cutReqs = reqs.filter((r) => !isFullKey(r.key));
  const fullReqs = reqs.filter((r) => isFullKey(r.key));
  /** This order's box claims per `design|batch` from the production log (the per-batch split the JSON mirror lacks). */
  const ownOf = (claims: { sampleOrderId: string; designId: string; batchNumber: string; qtyBoxes: number }[]) => {
    const m = new Map<string, number>();
    for (const c of claims) if (c.sampleOrderId === order.id) m.set(`${c.designId}|${c.batchNumber}`, (m.get(`${c.designId}|${c.batchNumber}`) ?? 0) + c.qtyBoxes);
    return m;
  };
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [held, setHeld] = useState<Map<string, number>>(() => ownOf(cachedSampleClaimEntries()));
  const [pcs, setPcs] = useState<Allocation>(() => Object.fromEntries(cutReqs.map((r) => [r.key, r.allocated])));
  const [boxes, setBoxes] = useState<Map<string, number>>(() => ownOf(cachedSampleClaimEntries()));
  const [loaded, setLoaded] = useState(fullReqs.length === 0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!fullReqs.length) return;
    void Promise.all([listBatchStock(), listProductionLogs()]).then(([s, p]) => {
      if (s.ok) setStock(s.rows);
      if (p.ok) {
        const h = ownOf(p.sampleClaimEntries);
        setHeld(h);
        setBoxes(h);
      }
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const bkey = (r: Requirement, b: BatchStockRow) => `${r.designId}|${b.batchNumber}`;
  // Batches of an item: anything free, plus anything this order already holds (even when nothing else is free).
  const batchesOf = (r: Requirement) => stock.filter((b) => b.designId === r.designId && (b.free > 0 || (held.get(bkey(r, b)) ?? 0) > 0)).sort(byAge);
  const capBatch = (r: Requirement, b: BatchStockRow) => b.free + (held.get(bkey(r, b)) ?? 0);
  const bookedBoxes = (r: Requirement) => batchesOf(r).reduce((s, b) => s + (boxes.get(bkey(r, b)) ?? 0), 0);
  const capCut = (r: Requirement) => Math.min(r.need, r.allocated + r.free);
  const setCut = (r: Requirement, v: number) => setPcs((p) => ({ ...p, [r.key]: clampInt(0, capCut(r), v) }));
  const setBox = (r: Requirement, b: BatchStockRow, v: number) => {
    const others = bookedBoxes(r) - (boxes.get(bkey(r, b)) ?? 0);
    setBoxes((p) => new Map(p).set(bkey(r, b), clampInt(0, Math.max(0, Math.min(capBatch(r, b), r.need - others)), v)));
  };
  const bookAll = () => {
    setPcs(Object.fromEntries(cutReqs.map((r) => [r.key, capCut(r)])));
    const next = new Map<string, number>();
    for (const r of fullReqs) {
      let left = r.need;
      for (const b of batchesOf(r)) {
        const take = Math.min(capBatch(r, b), left);
        if (take > 0) next.set(bkey(r, b), take);
        left -= take;
      }
    }
    setBoxes(next);
  };
  const releaseAll = () => {
    setPcs(Object.fromEntries(cutReqs.map((r) => [r.key, 0])));
    setBoxes(new Map());
  };
  const totalPcs = cutReqs.reduce((s, r) => s + (pcs[r.key] ?? 0), 0);
  const needPcs = cutReqs.reduce((s, r) => s + r.need, 0);
  const totalBoxes = fullReqs.reduce((s, r) => s + bookedBoxes(r), 0);
  const needBoxes = fullReqs.reduce((s, r) => s + r.need, 0);
  const changed =
    cutReqs.some((r) => (pcs[r.key] ?? 0) !== r.allocated) ||
    fullReqs.some((r) => batchesOf(r).some((b) => (boxes.get(bkey(r, b)) ?? 0) !== (held.get(bkey(r, b)) ?? 0)));
  const summary = [cutReqs.length ? `${fmt(totalPcs)} of ${fmt(needPcs)} pcs` : "", fullReqs.length ? `${fmt(totalBoxes)} of ${fmt(needBoxes)} box${needBoxes === 1 ? "" : "es"}` : ""].filter(Boolean).join(" · ");

  const submit = async () => {
    if (saving || !changed) return;
    setSaving(true);
    const body: Parameters<typeof allocateSample>[1] = {};
    if (cutReqs.length) body.allocation = pcs;
    if (fullReqs.length)
      body.boxes = Object.fromEntries(fullReqs.map((r) => [r.designId, batchesOf(r).map((b) => ({ batch_number: b.batchNumber, qty_boxes: boxes.get(bkey(r, b)) ?? 0 }))]));
    const res = await allocateSample(order.id, body);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not update the booking");
      return;
    }
    toast.success(`${summary} booked to this order`);
    onDone();
    onClose();
  };

  const num = (v: number) => <td className="num mono">{fmt(v)}</td>;
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Allocate Stock</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{order.orderNumber || "Sample Order"} · {order.customerName}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          {reqs.length === 0 && <div className="dim" style={{ padding: 8 }}>Nothing pending to book.</div>}
          {reqs.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: "var(--t-sm)" }}>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={bookAll} disabled={saving || !loaded}>Book all available</button>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={releaseAll} disabled={saving}>Release all</button>
                <span className="dim" style={{ marginLeft: "auto" }}>Free = stock no order holds</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Piece / Batch</th>
                    <th className="num" style={{ textAlign: "right" }}>Need</th>
                    <th className="num" style={{ textAlign: "right" }}>Free</th>
                    <th className="num" style={{ textAlign: "right", width: 120 }}>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {cutReqs.map((r) => (
                    <tr key={r.key}>
                      <td><span className="design-name">{r.designName}</span></td>
                      <td className="mono">{r.cutSizeName || <span className="dim">—</span>}</td>
                      {num(r.need)}
                      <td className="num mono" style={r.free === 0 && r.allocated < r.need ? { color: "var(--c-red)" } : undefined} title={capCut(r) < r.need ? `Only ${fmt(capCut(r))} of ${fmt(r.need)} can be booked — cut ${fmt(r.need - capCut(r))} more` : undefined}>
                        {fmt(r.free)}
                      </td>
                      <td className="num">
                        <NumberInput min={0} value={pcs[r.key] ?? 0} onChange={(e) => setCut(r, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${r.designName} ${r.cutSizeName} pieces booked`} disabled={saving} />
                      </td>
                    </tr>
                  ))}
                  {fullReqs.map((r) => {
                    const rows = batchesOf(r);
                    const got = bookedBoxes(r);
                    return (
                      <Fragment key={r.key}>
                        <tr style={{ background: "var(--panel-2)" }}>
                          <td style={{ fontWeight: 600 }}><span className="design-name">{r.designName}</span></td>
                          <td className="mono">Full tile <span className="dim">· boxes</span></td>
                          {num(r.need)}
                          <td className="num mono" style={r.free === 0 && r.allocated < r.need ? { color: "var(--c-red)" } : undefined}>{fmt(r.free)}</td>
                          <td className="num mono" title="Boxes booked to this order across its batches">{fmt(got)} <span className="dim">of {fmt(r.need)}</span></td>
                        </tr>
                        {!loaded && rows.length === 0 && (
                          <tr><td colSpan={5} style={{ paddingLeft: 28 }}><BoffoLoader size="sm" /></td></tr>
                        )}
                        {loaded && rows.length === 0 && (
                          <tr><td colSpan={5} style={{ paddingLeft: 28, color: "var(--c-red)" }}>No stock available — needs production</td></tr>
                        )}
                        {rows.map((b) => (
                          <tr key={bkey(r, b)}>
                            <td />
                            <td className="mono" style={{ paddingLeft: 28 }}>{b.batchNumber || "—"}{b.mfgDate ? <span className="dim"> · {b.mfgDate}</span> : null}</td>
                            <td />
                            <td className="num mono">{fmt(b.free)}</td>
                            <td className="num">
                              <NumberInput min={0} value={boxes.get(bkey(r, b)) ?? 0} onChange={(e) => setBox(r, b, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${r.designName} batch ${b.batchNumber || "unbatched"} boxes booked`} disabled={saving} />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="df-foot">
          <span className="df-req-note">{reqs.length ? `${summary} booked` : ""}</span>
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
