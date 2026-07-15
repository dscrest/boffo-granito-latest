/* ============================================================
   Send for Production — builds a production REQUEST (not actual output).

   Item-wise like the Close-Pallet form: pick a confirmed Sales Order, then
   enter a desired qty per line (capped at ordered − produced). The whole
   batch is submitted as one request (shared request_group) and goes to the
   Approvals inbox — nothing is produced or counted until an approver
   authorizes it and someone records the actual output.

   Independent (make-to-stock) mode requests a single Design + desired qty;
   it also goes through approval. `Requested by` is auto-stamped from the
   signed-in user. Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "@/features/masters/useMasters";
import { useOrders } from "@/features/orders/useOrders";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { fmt } from "@/lib/format";
import { listPalletizable, type PalletizableItem } from "./palletisationApi";
import type { ProductionRequestInput } from "./productionApi";

export function ProductionForm({
  presetSalesOrderId,
  presetDesignId,
  onSave,
  onClose,
}: {
  /** Scope to one confirmed Sales Order (locked select), item-wise. */
  presetSalesOrderId?: string;
  /** Preselect a Design → independent mode (clone from an independent entry). */
  presetDesignId?: string;
  onSave: (input: ProductionRequestInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const { designRows, salesPersons } = useMasters();
  const { orders } = useOrders();
  const requestedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  const [mode, setMode] = useState<"order" | "independent">(presetDesignId && !presetSalesOrderId ? "independent" : "order");
  const [orderId, setOrderId] = useState(presetSalesOrderId || "");
  const [items, setItems] = useState<PalletizableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});

  // Independent mode
  const [designId, setDesignId] = useState(presetDesignId || "");
  const [indepQty, setIndepQty] = useState("");

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Available stock in hand per design = opening + produced − loaded (finished goods
  // not yet shipped). Used to default Desired qty to only what stock can't cover.
  const availByDesign = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of designRows) {
      const forD = orders.filter((o) => o.design === d.designName);
      const produced = forD.reduce((s, o) => s + o.producedQty, 0);
      const loaded = forD.reduce((s, o) => s + o.loadedQty, 0);
      m.set(d.id, (d.accountingStock ?? 0) + produced - loaded);
    }
    return m;
  }, [designRows, orders]);
  const inHandFor = (it: PalletizableItem) => Math.max(0, availByDesign.get(it.designId) ?? 0);
  const recommendedQty = (it: PalletizableItem) => Math.max(0, it.toProduce - inHandFor(it));

  // Sales Orders still owing production (ordered > produced). Collapsed to one
  // option per SO from the per-line orders list.
  const soOptions = useMemo<ComboOption[]>(() => {
    const seen = new Map<string, ComboOption>();
    for (const o of orders) {
      if (!o.salesOrderId || o.producedQty >= o.orderQty) continue;
      if (["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(o.status || "")) continue;
      if (!seen.has(o.salesOrderId))
        seen.set(o.salesOrderId, {
          value: o.salesOrderId,
          label: o.orderNumber || o.poNumber || o.salesOrderId,
          hint: o.party || undefined,
        });
    }
    return [...seen.values()];
  }, [orders]);

  // Load the chosen SO's line items (ordered / produced / remaining).
  useEffect(() => {
    if (mode !== "order" || !orderId) {
      setItems([]);
      return;
    }
    let live = true;
    setLoadingItems(true);
    void listPalletizable({ includeOrderId: orderId }).then((res) => {
      if (!live) return;
      setLoadingItems(false);
      const order = res.ok ? res.orders.find((o) => o.salesOrderId === orderId) : null;
      const its = order?.items ?? [];
      setItems(its);
      // Default Desired qty = remaining − stock in hand (produce only the shortfall).
      setQtyByItem(
        Object.fromEntries(
          its
            .filter((it) => it.toProduce > 0)
            .map((it) => [it.orderItemId, Math.max(0, it.toProduce - Math.max(0, availByDesign.get(it.designId) ?? 0))]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [orderId, mode, availByDesign]);

  const owing = useMemo(() => items.filter((it) => it.toProduce > 0), [items]);

  const setQty = (itemId: string, raw: string, max: number) =>
    setQtyByItem((p) => ({ ...p, [itemId]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  const fillAll = () =>
    setQtyByItem(Object.fromEntries(owing.map((it) => [it.orderItemId, it.toProduce])));
  const clearAll = () => setQtyByItem({});

  const designOptions = useMemo<ComboOption[]>(
    () =>
      designRows.map((d) => ({
        value: d.id,
        label: d.designName,
        hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined,
      })),
    [designRows],
  );

  const orderLines = useMemo(
    () =>
      items
        .map((it) => ({ order_item: it.orderItemId, qty_requested: qtyByItem[it.orderItemId] || 0 }))
        .filter((l) => l.qty_requested > 0),
    [items, qtyByItem],
  );
  const indepQtyNum = parseInt(indepQty, 10) || 0;
  const totalRequested =
    mode === "order" ? orderLines.reduce((s, l) => s + l.qty_requested, 0) : indepQtyNum;
  const missing =
    mode === "order" ? !orderId || orderLines.length === 0 : !designId || indepQtyNum <= 0;

  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        lines:
          mode === "order"
            ? orderLines
            : [{ design: designId, qty_requested: indepQtyNum }],
        performed_by: requestedBy,
        note: note.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="factory" size={18} />
          </div>
          <div>
            <div className="ttl">Send for Production</div>
            <div className="sub2">Production request · submitted for approval before it counts</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">What to produce?</div>
            {/* Locked to one SO when launched from an order; otherwise pick. */}
            {!presetSalesOrderId && (
              <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                {(["order", "independent"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    style={{
                      background: mode === m ? "var(--accent-soft)" : "transparent",
                      color: mode === m ? "var(--fg)" : "var(--muted)",
                      fontWeight: mode === m ? 600 : 400,
                      border: 0,
                      padding: "5px 14px",
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: "var(--t-sm)",
                    }}
                  >
                    {m === "order" ? "Against Order" : "Independent (stock)"}
                  </button>
                ))}
              </div>
            )}

            <div className="form-grid">
              {mode === "order" ? (
                <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lbl">
                    Sales Order<span className="req"> *</span>
                  </span>
                  {presetSalesOrderId ? (
                    <input value={soOptions.find((o) => o.value === orderId)?.label || orderId} readOnly disabled />
                  ) : (
                    <Combobox
                      value={orderId}
                      options={soOptions}
                      onChange={setOrderId}
                      placeholder="Search confirmed orders…"
                      ariaLabel="Sales Order"
                      invalid={showErrors && !orderId}
                    />
                  )}
                </label>
              ) : (
                <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lbl">
                    Design / Item<span className="req"> *</span>
                  </span>
                  <Combobox
                    value={designId}
                    options={designOptions}
                    onChange={setDesignId}
                    placeholder="Search an item…"
                    ariaLabel="Design / Item"
                    invalid={showErrors && !designId}
                  />
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    No order — requested as make-to-stock production.
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Order mode — item-wise desired qty table. */}
          {mode === "order" && orderId && (
            <div className="form-section">
              <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Items on this Sales Order</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" className="btn" disabled={owing.length === 0} onClick={fillAll} style={{ padding: "3px 8px" }} title="Request the full remaining qty on every line">
                    Fill remaining
                  </button>
                  <button type="button" className="btn" disabled={totalRequested === 0} onClick={clearAll} style={{ padding: "3px 8px" }}>
                    Clear
                  </button>
                </div>
              </div>
              {loadingItems ? (
                <div className="muted" style={{ padding: 8 }}>Loading items…</div>
              ) : items.length === 0 ? (
                <div className="muted" style={{ padding: 8 }}>No line items on this order.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Design</th>
                      <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                      <th className="num" style={{ textAlign: "right" }}>Produced</th>
                      <th className="num" style={{ textAlign: "right" }}>In hand</th>
                      <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                      <th className="num" style={{ textAlign: "right", width: 120 }}>Desired qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const canProduce = it.toProduce > 0;
                      return (
                        <tr key={it.orderItemId}>
                          <td><span className="design-name">{it.designLabel}</span></td>
                          <td className="num mono">{fmt(it.ordered)}</td>
                          <td className="num mono">{fmt(it.produced)}</td>
                          <td className="num mono" title="Available stock in hand (opening + produced − loaded)">{fmt(inHandFor(it))}</td>
                          <td className="num mono">{fmt(it.toProduce)}</td>
                          <td className="num">
                            {canProduce ? (
                              <input
                                type="number"
                                min={0}
                                max={it.toProduce}
                                value={qtyByItem[it.orderItemId] || ""}
                                onChange={(e) => setQty(it.orderItemId, e.target.value, it.toProduce)}
                                placeholder="0"
                                style={{ width: 100, textAlign: "right" }}
                              />
                            ) : (
                              <span className="chip" title="Fully produced">Done</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Independent mode — single desired qty. */}
          {mode === "independent" && (
            <div className="form-section">
              <div className="form-section-title">Quantity</div>
              <div className="form-grid">
                <label className="form-field">
                  <span className="lbl">Desired qty<span className="hint"> (boxes)</span><span className="req"> *</span></span>
                  <input type="number" min={0} value={indepQty} onChange={(e) => setIndepQty(e.target.value)} placeholder="0" />
                </label>
              </div>
            </div>
          )}

          <div className="form-section">
            <div className="form-section-title">Request</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Requested by</span>
                {/* Auto-stamped from the signed-in user — grey = system-filled. */}
                <input value={requestedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — priority, target date, remarks…" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {mode === "order"
                  ? orderId
                    ? "Enter a desired qty for at least one item"
                    : "Pick a Sales Order"
                  : "Pick an item and a desired qty"}
              </span>
            ) : totalRequested > 0 ? (
              `${fmt(totalRequested)} boxes requested${mode === "order" ? ` · ${orderLines.length} item${orderLines.length > 1 ? "s" : ""}` : ""}`
            ) : (
              "* Indicates a mandatory field"
            )}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Submitting…" : "Send for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}
