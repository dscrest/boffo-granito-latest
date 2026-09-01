/* ============================================================
   Send to Loading — order items straight to the loading board, skipping
   palletization (server mints ReadyToLoad lines on the SO's open plan via
   /send-to-loading). Two entry points share this modal:
   - Order detail "Send to Loading" (presetSalesOrderId, SO picker hidden)
   - Loading detail "Add Items" (presetBoxId → lines land in that loading)
   Container-first like the load modal: the shared ContainerPicker chooses an
   open container (or mints a new one with its details) so the items land in a
   real container, not a nameless box. With presetBoxId the target is fixed.
   Per item the send is capped at ordered − palletized, mirroring the server.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { listVehicles, type VehicleRow } from "@/features/masters/vehiclesApi";
import { cachedOrders, listOrders, soStatusLabel } from "@/features/orders/ordersApi";
import {
  ContainerPicker,
  NO_CONTAINER,
  draftMissing,
  draftToCreateInput,
  newContainerDraft,
  type ContainerDraft,
} from "./LoadContainerModal";
import {
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
  listPalPlans,
  sendToLoading,
  type LoadBox,
  type PalPlan,
} from "./palPlansApi";

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
  // Container target. With presetBoxId the loading is fixed; otherwise the
  // shared picker chooses an open container or mints a new one.
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [loadBoxes, setLoadBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [sel, setSel] = useState<string>(presetBoxId || NO_CONTAINER);
  const [draft, setDraft] = useState<ContainerDraft>(newContainerDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);

  useEffect(() => {
    void listOrders().then((r) => r.ok && setOrders(r.orders));
    void listPalPlans().then((r) => {
      if (!r.ok) return;
      setPlans(r.plans);
      setLoadBoxes(r.boxes);
    });
    void listVehicles().then((r) => r.ok && setVehicles(r.vehicles));
  }, []);

  const openBoxes = loadBoxes.filter((b) => b.status === "Open");
  const lockedBox = presetBoxId ? loadBoxes.find((b) => b.id === presetBoxId) : undefined;
  const linesOfBox = (boxId: string) =>
    plans.flatMap((p) => p.lines.filter((l) => l.loadBoxId === boxId).map((l) => ({ p, l })));
  // Without a preset the container is OPTIONAL: "Ready for Loading" is the
  // default and behaves exactly as before (items wait, no container).
  const newContainer = sel !== NO_CONTAINER && !presetBoxId && !openBoxes.some((b) => b.id === sel);
  const invalidContainer = newContainer && draftMissing(draft);

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
    if (invalidContainer) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    // Resolve the container first: an existing one, a new one minted from the
    // details form, or none at all (items just wait in Ready for Loading).
    let box = presetBoxId || (sel === NO_CONTAINER ? "" : sel);
    let label = boxName || "";
    if (newContainer) {
      const details = await draftToCreateInput(draft, vehicles);
      const created = details ? await createLoadBox(details) : null;
      if (!created?.ok || !created.data?.ROWID) {
        setBusy(false);
        toast.error(created?.error || "Could not create the container");
        return;
      }
      box = String(created.data.ROWID);
      label = draft.container_number.trim() || `Container ${created.data.box_number ?? ""}`.trim();
    } else if (box && !label) {
      const b = loadBoxes.find((x) => x.id === box);
      label = b ? b.containerNumber || `Container ${b.boxNumber}` : "the loading";
    }
    const res = await sendToLoading({
      sales_order: soId,
      ...(box ? { box } : {}),
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
      box
        ? `${fmt(totalSend)} boxes added to ${label || "the loading"}`
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

          <ContainerPicker
            boxes={openBoxes}
            linesOfBox={linesOfBox}
            selected={sel}
            onSelect={setSel}
            draft={draft}
            onDraft={setDraft}
            showErrors={showErrors}
            adding={totalSend}
            lockedTo={lockedBox}
            allowNone={!presetBoxId}
          />

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
          <span style={{ flex: 1, fontSize: "var(--t-sm)", color: invalidContainer ? "var(--c-amber)" : "var(--dim)" }} className={invalidContainer ? undefined : "mono"}>
            {invalidContainer
              ? "Fill container no., vehicle no., driver, e-seal"
              : totalSend > 0 ? `${fmt(totalSend)} boxes` : ""}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy || !soId || totalSend === 0 || invalidContainer} onClick={() => void onConfirm()}>
            <Icon name="check" size={13} />
            {busy ? "Sending…" : presetBoxId ? `Add to ${boxName || "loading"}` : "Send to Loading"}
          </button>
        </div>
      </div>
    </div>
  );
}
