/* ============================================================
   Send to Loading — order items straight to the loading board, skipping
   palletization (server mints ReadyToLoad lines on the SO's open plan via
   /send-to-loading). Two entry points share this modal:
   - Order detail "Send to Loading" (presetSalesOrderId, SO picker hidden)
   - Loading detail "Add Items" (presetBoxId → lines land in that loading)
   Per item the send is capped at ordered − palletized, mirroring the server.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { cachedOrders, listOrders, soStatusLabel } from "@/features/orders/ordersApi";
import { sendToLoading } from "./palPlansApi";

const remainingOf = (o: Order) => Math.max(0, o.orderQty - o.palletizedQty);

export function SendToLoadingModal({
  presetSalesOrderId,
  presetBoxId,
  boxName,
  onDone,
  onClose,
}: {
  presetSalesOrderId?: string;
  /** When set, the sent items are allocated into this Open loading. */
  presetBoxId?: string;
  /** Display label of the preset loading (shown on the confirm button). */
  boxName?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [soId, setSoId] = useState(presetSalesOrderId || "");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listOrders().then((r) => r.ok && setOrders(r.orders));
  }, []);

  // Pickable SOs: past approval, not terminal, with boxes left to send.
  const soOptions = useMemo(() => {
    const heads = new Map<string, { o: Order; remaining: number }>();
    for (const o of orders) {
      if (!o.salesOrderId) continue;
      if (["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(o.status || "")) continue;
      const cur = heads.get(o.salesOrderId) || { o, remaining: 0 };
      cur.remaining += remainingOf(o);
      heads.set(o.salesOrderId, cur);
    }
    return [...heads.entries()]
      .filter(([, v]) => v.remaining > 0)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([id, v]) => ({
        value: id,
        label: v.o.orderNumber || v.o.poNumber || id,
        hint: [v.o.party, soStatusLabel(v.o.status || "Confirmed")].filter(Boolean).join(" · "),
        badge: `${fmt(v.remaining)} boxes left`,
      }));
  }, [orders]);

  const items = useMemo(
    () => orders.filter((o) => o.salesOrderId === soId && remainingOf(o) > 0),
    [orders, soId],
  );

  const toggle = (o: Order) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(o.id) ? next.delete(o.id) : next.add(o.id);
      return next;
    });
  const qtyOf = (o: Order) => Math.min(qty.get(o.id) ?? remainingOf(o), remainingOf(o));
  const totalSend = items.filter((o) => checked.has(o.id)).reduce((s, o) => s + qtyOf(o), 0);

  const onConfirm = async () => {
    if (busy || !soId || totalSend === 0) return;
    setBusy(true);
    const res = await sendToLoading({
      sales_order: soId,
      ...(presetBoxId ? { box: presetBoxId } : {}),
      lines: items
        .filter((o) => checked.has(o.id))
        .map((o) => ({ order_item: o.id, boxes: qtyOf(o) })),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not send to loading");
      return;
    }
    toast.success(
      presetBoxId
        ? `${fmt(totalSend)} boxes added to ${boxName || "the loading"}`
        : `${fmt(totalSend)} boxes sent to Ready for Loading`,
    );
    onDone();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{presetBoxId ? "Add Items" : "Send to Loading"}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {!presetSalesOrderId && (
            <label className="form-field" style={{ marginBottom: 10 }}>
              <span className="lbl">Sales Order<span className="req"> *</span></span>
              <Combobox
                value={soId}
                options={soOptions}
                onChange={(v) => { setSoId(v); setChecked(new Set()); setQty(new Map()); }}
                placeholder="Pick a sales order…"
                ariaLabel="Sales Order"
              />
            </label>
          )}

          {soId && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
              {items.map((o) => {
                const rem = remainingOf(o);
                const isSel = checked.has(o.id);
                return (
                  <label
                    key={o.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
                      background: isSel ? "var(--accent-soft)" : "var(--bg)",
                    }}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => toggle(o)} style={{ margin: 0, flex: "0 0 auto" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="design-name" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.design}</span>
                      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{fmt(rem)} of {fmt(o.orderQty)} boxes left to send</span>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={rem}
                      value={qtyOf(o)}
                      disabled={!isSel}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(e) =>
                        setQty((prev) => new Map(prev).set(o.id, Math.max(1, Math.min(rem, Math.floor(Number(e.target.value)) || 1))))
                      }
                      style={{ width: 90, textAlign: "right" }}
                    />
                  </label>
                );
              })}
              {items.length === 0 && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>
                  Every item on this order is already palletised or sent to loading.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="df-foot">
          {totalSend > 0 && <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{fmt(totalSend)} boxes</span>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy || !soId || totalSend === 0} onClick={() => void onConfirm()}>
            <Icon name="check" size={13} />
            {busy ? "Sending…" : presetBoxId ? `Add to ${boxName || "loading"}` : "Send to Loading"}
          </button>
        </div>
      </div>
    </div>
  );
}
