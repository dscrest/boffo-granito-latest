/* ============================================================
   Close Pallet form — commits a PalletisedBatch via the close-pallet
   saga. Operator picks a sales order, a pallet spec, and the boxes to
   palletize per order item (capped at produced − already-palletized).
   The server enforces palletized ≤ produced and compensates on any
   mid-write failure. Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listPalletizable, type ClosePalletInput, type PalletizableOrder } from "./palletisationApi";

export function PalletPackForm({
  onSave,
  onClose,
}: {
  onSave: (input: ClosePalletInput) => void;
  onClose: () => void;
}) {
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
      const [po, pl] = await Promise.all([listPalletizable(), listPallets()]);
      setLoading(false);
      if (!po.ok) {
        setError(po.error || "Failed to load palletizable items");
        return;
      }
      setOrders(po.orders);
      setPallets(pl.ok ? pl.pallets : []);
      if (po.orders.length === 1) setOrderId(po.orders[0].salesOrderId);
    })();
  }, []);

  const order = useMemo(() => orders.find((o) => o.salesOrderId === orderId) || null, [orders, orderId]);

  // Reset per-item boxes whenever the chosen order changes.
  useEffect(() => {
    setBoxesByItem({});
  }, [orderId]);

  const setBoxes = (itemId: string, raw: string, max: number) => {
    const n = Math.max(0, Math.min(Number(raw) || 0, max));
    setBoxesByItem((p) => ({ ...p, [itemId]: n }));
  };

  const lines = useMemo(
    () =>
      (order?.items || [])
        .map((it) => ({ order_item: it.orderItemId, boxes: boxesByItem[it.orderItemId] || 0 }))
        .filter((l) => l.boxes > 0),
    [order, boxesByItem],
  );
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  const missing = !orderId || !palletId || lines.length === 0;

  const submit = () => {
    if (missing) return;
    onSave({
      sales_order: orderId,
      pallet: palletId,
      delivery_date: deliveryDate || undefined,
      remarks: remarks.trim() || undefined,
      lines,
    });
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
                    <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— select —</option>
                      {orders.map((o) => (
                        <option key={o.salesOrderId} value={o.salesOrderId}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span className="lbl">
                      Pallet<span className="req"> *</span>
                    </span>
                    <select value={palletId} onChange={(e) => setPalletId(e.target.value)}>
                      <option value="">— select —</option>
                      {pallets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.boxesPerPallet > 0 ? ` (${p.boxesPerPallet}/pallet)` : ""}
                        </option>
                      ))}
                    </select>
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
                  <div className="form-section-title">Boxes to palletize</div>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        <th className="num" style={{ textAlign: "right", width: 120 }}>Boxes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => (
                        <tr key={it.orderItemId}>
                          <td>
                            <span className="design-name">{it.designLabel}</span>
                            <span className="muted mono" style={{ fontSize: 10, marginLeft: 6 }}>
                              {it.palletized}/{it.produced}
                            </span>
                          </td>
                          <td className="num mono">{it.available}</td>
                          <td className="num">
                            <input
                              type="number"
                              min={0}
                              max={it.available}
                              value={boxesByItem[it.orderItemId] || ""}
                              onChange={(e) => setBoxes(it.orderItemId, e.target.value, it.available)}
                              placeholder="0"
                              style={{ width: 100, textAlign: "right" }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {totalBoxes > 0 ? `${totalBoxes} boxes · ${lines.length} item${lines.length > 1 ? "s" : ""}` : "* required"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            Close pallet
          </button>
        </div>
      </div>
    </div>
  );
}
