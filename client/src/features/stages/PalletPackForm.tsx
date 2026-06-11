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
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listPalletizable, type ClosePalletInput, type PalletizableOrder } from "./palletisationApi";

export function PalletPackForm({
  onSave,
  onClose,
  presetOrderId,
  preselectItemIds,
  autoFillAll,
}: {
  onSave: (input: ClosePalletInput) => void | Promise<void>;
  onClose: () => void;
  /** When set, scope the form to one confirmed Master Order (locked select). */
  presetOrderId?: string;
  /** OrderItem ROWIDs to pre-fill to their full available qty on open. */
  preselectItemIds?: string[];
  /** Pre-fill every ready line to its available qty on open (full palletize). */
  autoFillAll?: boolean;
}) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PalletizableOrder[]>([]);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderId, setOrderId] = useState("");
  const [palletId, setPalletId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [boxesByItem, setBoxesByItem] = useState<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      const [po, pl] = await Promise.all([
        listPalletizable(presetOrderId ? { includeOrderId: presetOrderId } : undefined),
        listPallets(),
      ]);
      setLoading(false);
      if (!po.ok) {
        setError(po.error || "Failed to load palletizable items");
        return;
      }
      setOrders(po.orders);
      setPallets(pl.ok ? pl.pallets : []);
      // Auto-select the preset order, or the only order when there's just one.
      if (presetOrderId && po.orders.some((o) => o.salesOrderId === presetOrderId)) {
        setOrderId(presetOrderId);
      } else if (po.orders.length === 1) {
        setOrderId(po.orders[0].salesOrderId);
      }
    })();
  }, [presetOrderId]);

  const order = useMemo(() => orders.find((o) => o.salesOrderId === orderId) || null, [orders, orderId]);

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
  // Lines with nothing ready to palletize but still owed production.
  const needProduction = useMemo(
    () => (order?.items || []).filter((it) => it.available <= 0 && it.toProduce > 0).length,
    [order],
  );
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
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
                      <select className={orderErr ? "error" : ""} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                        <option value="">— select —</option>
                        {orders.map((o) => (
                          <option key={o.salesOrderId} value={o.salesOrderId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {orderErr && <span className="field-err">{orderErr}</span>}
                  </label>
                  <label className="form-field">
                    <span className="lbl">
                      Pallet<span className="req"> *</span>
                    </span>
                    <select className={palletErr ? "error" : ""} value={palletId} onChange={(e) => setPalletId(e.target.value)}>
                      <option value="">— select —</option>
                      {pallets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.boxesPerPallet > 0 ? ` (${p.boxesPerPallet}/pallet)` : ""}
                        </option>
                      ))}
                    </select>
                    {palletErr && <span className="field-err">{palletErr}</span>}
                  </label>
                  <label className="form-field">
                    <span className="lbl">Delivery Date</span>
                    <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
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
                                  type="number"
                                  min={0}
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
