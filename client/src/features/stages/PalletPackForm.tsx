/* ============================================================
   Close Pallet form — commits a PalletisedBatch via the close-pallet
   saga. Operator picks a sales order, a pallet spec, and the boxes to
   palletize per order item (capped at produced − already-palletized).
   The server enforces palletized ≤ produced and compensates on any
   mid-write failure. Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listContainers, listContainerFill, type ContainerRow } from "@/features/masters/containersApi";
import { listPalletizable, type ClosePalletInput, type PalletizableOrder } from "./palletisationApi";

export function PalletPackForm({
  onSave,
  onClose,
  presetOrderId,
  presetPalletId,
  preselectItemIds,
  autoFillAll,
}: {
  onSave: (input: ClosePalletInput) => void | Promise<void>;
  onClose: () => void;
  /** When set, scope the form to one confirmed Master Order (locked select). */
  presetOrderId?: string;
  /** When set, scope the form to one Pallet spec (locked select). */
  presetPalletId?: string;
  /** OrderItem ROWIDs to pre-fill to their full available qty on open. */
  preselectItemIds?: string[];
  /** Pre-fill every ready line to its available qty on open (full palletize). */
  autoFillAll?: boolean;
}) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PalletizableOrder[]>([]);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [fill, setFill] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderId, setOrderId] = useState("");
  const [palletId, setPalletId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [boxesByItem, setBoxesByItem] = useState<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      const [po, pl, cs, cf] = await Promise.all([
        listPalletizable(presetOrderId ? { includeOrderId: presetOrderId } : undefined),
        listPallets(),
        listContainers(),
        listContainerFill(),
      ]);
      setLoading(false);
      if (!po.ok) {
        setError(po.error || "Failed to load palletizable items");
        return;
      }
      setOrders(po.orders);
      setPallets(pl.ok ? pl.pallets : []);
      // Advisory only — a failed container read just hides the fill hint.
      setContainers(cs.ok ? cs.containers : []);
      setFill(cf.ok ? cf.loadedBoxes : new Map());
      // Auto-select the preset order, or the only order when there's just one.
      if (presetOrderId && po.orders.some((o) => o.salesOrderId === presetOrderId)) {
        setOrderId(presetOrderId);
      } else if (po.orders.length === 1) {
        setOrderId(po.orders[0].salesOrderId);
      }
      // Launched from a Pallet's detail page — that spec is the batch's pallet.
      if (presetPalletId && pl.ok && pl.pallets.some((p) => p.id === presetPalletId)) {
        setPalletId(presetPalletId);
      }
    })();
  }, [presetOrderId, presetPalletId]);

  const order = useMemo(() => orders.find((o) => o.salesOrderId === orderId) || null, [orders, orderId]);

  // Pallet specs offered = those matching the sizes being palletized (a batch
  // has ONE spec). Before boxes are typed: any size on the order; once boxes
  // are entered: only those lines' sizes. Size-less specs/items don't constrain.
  const filteredPallets = useMemo(() => {
    if (!order) return pallets;
    const sizes = new Set<string>();
    for (const it of order.items) {
      if (it.sizeId && (boxesByItem[it.orderItemId] || 0) > 0) sizes.add(it.sizeId);
    }
    if (sizes.size === 0) {
      for (const it of order.items) if (it.sizeId && it.available > 0) sizes.add(it.sizeId);
    }
    if (sizes.size === 0) return pallets;
    return pallets.filter((p) => !p.sizeId || sizes.has(p.sizeId));
  }, [order, pallets, boxesByItem]);

  // A previously chosen pallet that no longer matches the entered sizes clears.
  // A locked pallet is exempt — the operator picked the spec, not the sizes.
  useEffect(() => {
    if (presetPalletId) return;
    if (palletId && !filteredPallets.some((p) => p.id === palletId)) setPalletId("");
  }, [filteredPallets, palletId, presetPalletId]);

  // Reset per-item boxes whenever the chosen order changes, then apply any
  // preselect / auto-fill-all requested by the launch point (Order detail).
  useEffect(() => {
    if (!order) {
      setBoxesByItem({});
      return;
    }
    const pre: Record<string, number> = {};
    const wanted = preselectItemIds ? new Set(preselectItemIds) : null;
    for (const it of order.items) {
      if (it.available <= 0) continue;
      if (autoFillAll || (wanted && wanted.has(it.orderItemId))) pre[it.orderItemId] = it.available;
    }
    setBoxesByItem(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order, autoFillAll]);

  const setBoxes = (itemId: string, raw: string, max: number) => {
    const n = Math.max(0, Math.min(Number(raw) || 0, max));
    setBoxesByItem((p) => ({ ...p, [itemId]: n }));
  };

  /** Fill every ready line to its full available qty (manual "full palletize"). */
  const fillAll = () => {
    const next: Record<string, number> = {};
    for (const it of order?.items || []) if (it.available > 0) next[it.orderItemId] = it.available;
    setBoxesByItem(next);
  };
  const readyCount = (order?.items || []).filter((it) => it.available > 0).length;

  const lines = useMemo(
    () =>
      (order?.items || [])
        .map((it) => ({ order_item: it.orderItemId, boxes: boxesByItem[it.orderItemId] || 0 }))
        .filter((l) => l.boxes > 0),
    [order, boxesByItem],
  );
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  /* Advisory container-fill math (arrangement A). Hint only — the batch is
     still assigned to a container later, in the Loading stage. */
  const pallet = useMemo(() => pallets.find((p) => p.id === palletId) || null, [pallets, palletId]);
  const bpc = pallet?.boxesPerContainer || 0; // boxes_per_pallet × pallets_per_container
  const palletsNeeded = pallet && pallet.boxesPerPallet > 0 ? Math.ceil(totalBoxes / pallet.boxesPerPallet) : 0;
  const containersNeeded = bpc > 0 ? Math.ceil(totalBoxes / bpc) : 0;
  const pctOfContainer = bpc > 0 ? Math.round((totalBoxes / bpc) * 100) : 0;

  // Partially-full, undispatched containers headed to the order's destination
  // (spec 8.1). POD is free text on both tables → case-insensitive trim match.
  const podMatches = useMemo(() => {
    const pod = (order?.portOfDischarge || "").trim().toLowerCase();
    if (!pod) return [];
    return containers
      .filter((c) => c.status !== "dispatched" && c.capacityBoxes > 0)
      .filter((c) => c.portOfDischarge.trim().toLowerCase() === pod)
      .map((c) => ({ ...c, loaded: fill.get(c.id) || 0 }))
      .filter((c) => c.loaded > 0 && c.loaded < c.capacityBoxes);
  }, [containers, fill, order]);
  // Lines with nothing ready to palletize but still owed production.
  const needProduction = useMemo(
    () => (order?.items || []).filter((it) => it.available <= 0 && it.toProduce > 0).length,
    [order],
  );
  // With the pallet locked the size filter can't narrow it to the boxed lines,
  // so a mismatch is possible. Say so — but don't block: the operator chose this spec.
  const sizeMismatch = useMemo(() => {
    if (!presetPalletId || !pallet?.sizeId) return 0;
    return (order?.items || []).filter(
      (it) => (boxesByItem[it.orderItemId] || 0) > 0 && it.sizeId && it.sizeId !== pallet.sizeId,
    ).length;
  }, [presetPalletId, pallet, order, boxesByItem]);
  const missing = !orderId || !palletId || lines.length === 0;

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const orderErr = showErrors && !orderId ? "Master Order is required" : null;
  const palletErr = showErrors && !palletId ? "Pallet is required" : null;

  const submit = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        sales_order: orderId,
        pallet: palletId,
        delivery_date: deliveryDate || undefined,
        remarks: remarks.trim() || undefined,
        lines,
      });
    } finally {
      setSaving(false);
    }
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="palette" size={18} />
          </div>
          <div>
            <div className="ttl">Close Pallet</div>
            <div className="sub2">Commits a palletised batch · produced → palletized</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          {loading && <div className="muted" style={{ padding: 8 }}>Loading palletizable items…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>
              {error}
            </div>
          )}
          {!loading && !error && orders.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No produced boxes are waiting to be palletized. Log production first.
            </div>
          )}

          {!loading && orders.length > 0 && (
            <>
              <div className="form-section">
                <div className="form-section-title">Batch</div>
                <div className="form-grid">
                  <label className="form-field">
                    <span className="lbl">
                      Master Order<span className="req"> *</span>
                    </span>
                    {presetOrderId ? (
                      <input value={order?.label || presetOrderId} readOnly disabled />
                    ) : (
                      <Combobox
                        value={orderId}
                        options={orders.map((o) => ({ value: o.salesOrderId, label: o.label }))}
                        onChange={setOrderId}
                        placeholder="Search master orders…"
                        invalid={!!orderErr}
                      />
                    )}
                    {orderErr && <span className="field-err">{orderErr}</span>}
                  </label>
                  <label className="form-field">
                    <span className="lbl">
                      Pallet<span className="req"> *</span>
                    </span>
                    {presetPalletId ? (
                      <input value={pallet?.name || presetPalletId} readOnly disabled />
                    ) : (
                      <Combobox
                        value={palletId}
                        options={filteredPallets.map((p) => ({
                          value: p.id,
                          label: p.name + (p.boxesPerPallet > 0 ? ` (${p.boxesPerPallet}/pallet)` : ""),
                          hint: p.sizeLabel,
                        }))}
                        onChange={setPalletId}
                        placeholder="Search pallets…"
                        invalid={!!palletErr}
                      />
                    )}
                    {palletErr && <span className="field-err">{palletErr}</span>}
                  </label>
                  <label className="form-field">
                    <span className="lbl">Delivery Date</span>
                    <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span className="lbl">Remarks</span>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                  </label>
                </div>
              </div>

              {order && (
                <div className="form-section">
                  <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Items from this Master Order</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={readyCount === 0}
                        title="Palletize every produced box across all items"
                        onClick={fillAll}
                        style={{ padding: "3px 8px" }}
                      >
                        Fill all available
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={totalBoxes === 0}
                        onClick={() => setBoxesByItem({})}
                        style={{ padding: "3px 8px" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                        <th className="num" style={{ textAlign: "right" }}>Produced</th>
                        <th className="num" style={{ textAlign: "right" }}>Palletized</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        <th className="num" style={{ textAlign: "right", width: 120 }}>Boxes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => {
                        const ready = it.available > 0;
                        return (
                          <tr key={it.orderItemId}>
                            <td>
                              <span className="design-name">{it.designLabel}</span>
                            </td>
                            <td className="num mono">{it.ordered}</td>
                            <td className="num mono">{it.produced}</td>
                            <td className="num mono">{it.palletized}</td>
                            <td className="num mono">{it.available}</td>
                            <td className="num">
                              {ready ? (
                                <input
                                  type="number" min={0}
                                  max={it.available}
                                  value={boxesByItem[it.orderItemId] || ""}
                                  onChange={(e) => setBoxes(it.orderItemId, e.target.value, it.available)}
                                  placeholder="0"
                                  style={{ width: 100, textAlign: "right" }}
                                />
                              ) : (
                                <span
                                  className="chip"
                                  title={`${it.toProduce} boxes still to produce`}
                                  style={{ background: "var(--c-amber-bg, rgba(245,158,11,.12))", color: "var(--c-amber)" }}
                                >
                                  → Production
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {needProduction > 0 && (
                    <div
                      className="muted"
                      style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12 }}
                    >
                      <span>
                        {needProduction} item{needProduction > 1 ? "s" : ""} not yet produced.
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          onClose();
                          navigate("/prod");
                        }}
                      >
                        Send to production →
                      </button>
                    </div>
                  )}
                  {sizeMismatch > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12, color: "var(--c-amber)" }}>
                      <span>
                        {sizeMismatch} boxed item{sizeMismatch > 1 ? "s are" : " is"} a different size than this pallet
                        {pallet?.sizeLabel ? ` (${pallet.sizeLabel})` : ""}.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {pallet && totalBoxes > 0 && bpc > 0 && (
                <div className="form-section">
                  <div className="form-section-title">Container fill (estimate)</div>
                  <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>
                      <b className="mono">{palletsNeeded}</b> pallet{palletsNeeded !== 1 ? "s" : ""} ·{" "}
                      <b className="mono">{pctOfContainer}%</b> of one container ({pallet.boxesPerPallet} boxes ×{" "}
                      {pallet.palletsPerContainer} pallets = {bpc} boxes)
                    </span>
                    {totalBoxes <= bpc ? (
                      <span className="muted">Space left in this container: {bpc - totalBoxes} boxes</span>
                    ) : (
                      <span className="muted">
                        Needs {containersNeeded} containers ({totalBoxes - bpc * (containersNeeded - 1)} boxes in the
                        last one)
                      </span>
                    )}
                    {podMatches.length > 0 && (
                      <>
                        <span className="muted" style={{ marginTop: 4 }}>
                          Partially full containers to {order?.portOfDischarge}:
                        </span>
                        {podMatches.map((c) => (
                          <span key={c.id} className="mono muted">
                            {c.containerNumber} · {c.capacityBoxes - c.loaded} boxes free ·{" "}
                            {Math.round((c.loaded / c.capacityBoxes) * 100)}% full
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {lines.length === 0 ? "Enter boxes for at least one item" : "Fill the required fields above"}
              </span>
            ) : totalBoxes > 0 ? (
              `${totalBoxes} boxes · ${lines.length} item${lines.length > 1 ? "s" : ""}`
            ) : (
              "* required"
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Close pallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
