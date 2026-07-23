/* ============================================================
   Palletization form — commits one or more PalletisedBatches via the
   close-pallet saga. The operator picks a sales order, then per LINE ITEM
   a pallet spec (filtered to the item's size) and a "Need Palletization"
   qty (defaults to the ordered qty; intentionally NOT capped at produced —
   the operator decides how many boxes to palletise). On save the lines are
   grouped by their chosen pallet into one batch per pallet.
   Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listPalletizable, type ClosePalletInput, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { NumberInput } from "../../ui/NumberInput";

// Leading dimension of a size string ("300x600 - GVT…" / "300x300" → "300").
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

export function PalletPackForm({
  onSave,
  onClose,
  presetOrderId,
  presetPalletId,
  preselectItemIds,
  autoFillAll,
}: {
  /** One batch per distinct pallet chosen across the lines. */
  onSave: (inputs: ClosePalletInput[]) => void | Promise<void>;
  onClose: () => void;
  /** When set, scope the form to one confirmed Sales Order (locked select). */
  presetOrderId?: string;
  /** When set, pre-fill every line's pallet to this spec. */
  presetPalletId?: string;
  /** OrderItem ROWIDs to seed a Need-Palletization qty for (rest start at 0). */
  preselectItemIds?: string[];
  /** Seed every line's Need-Palletization to its ordered qty on open. */
  autoFillAll?: boolean;
}) {
  const [orders, setOrders] = useState<PalletizableOrder[]>([]);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderId, setOrderId] = useState("");
  const [palletDate, setPalletDate] = useState(todayISO());
  const [remarks, setRemarks] = useState("");
  const [needByItem, setNeedByItem] = useState<Record<string, number>>({});
  const [palletByItem, setPalletByItem] = useState<Record<string, string>>({});

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
      if (presetOrderId && po.orders.some((o) => o.salesOrderId === presetOrderId)) {
        setOrderId(presetOrderId);
      } else if (po.orders.length === 1) {
        setOrderId(po.orders[0].salesOrderId);
      }
    })();
  }, [presetOrderId]);

  const order = useMemo(() => orders.find((o) => o.salesOrderId === orderId) || null, [orders, orderId]);

  // Pallet specs offered for a line = those whose size WIDTH matches the item's
  // (item 300x300 → any 300-series pallet). Size-agnostic pallets always show.
  const palletsForItem = (it: PalletizableItem) => {
    const w = widthOf(it.sizeCode);
    return pallets.filter((p) => {
      if (!p.sizeId) return true;
      const pw = widthOf(p.sizeLabel);
      return !w || !pw || pw === w;
    });
  };

  // Seed per-line Need Palletization (default = ordered qty) + pallet whenever
  // the chosen order changes, honouring any preselect / preset from the caller.
  useEffect(() => {
    if (!order) {
      setNeedByItem({});
      setPalletByItem({});
      return;
    }
    const need: Record<string, number> = {};
    const pal: Record<string, string> = {};
    const wanted = preselectItemIds ? new Set(preselectItemIds) : null;
    for (const it of order.items) {
      const seed = autoFillAll || !wanted || wanted.has(it.orderItemId);
      need[it.orderItemId] = seed ? it.ordered : 0;
      if (presetPalletId) pal[it.orderItemId] = presetPalletId;
    }
    setNeedByItem(need);
    setPalletByItem(pal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order, autoFillAll]);

  const setNeed = (itemId: string, raw: string) =>
    setNeedByItem((p) => ({ ...p, [itemId]: Math.max(0, Number(raw) || 0) })); // no cap (user mandate)
  const setPallet = (itemId: string, pid: string) => setPalletByItem((p) => ({ ...p, [itemId]: pid }));

  // Save lines = every item with a Need qty > 0.
  const saveLines = useMemo(
    () =>
      (order?.items || [])
        .map((it) => ({ order_item: it.orderItemId, boxes: needByItem[it.orderItemId] || 0, pallet: palletByItem[it.orderItemId] || "" }))
        .filter((l) => l.boxes > 0),
    [order, needByItem, palletByItem],
  );
  const totalBoxes = saveLines.reduce((s, l) => s + l.boxes, 0);
  const linesNeedingPallet = saveLines.filter((l) => !l.pallet).length;
  // ponytail: vehicle-fill preview lived here; it moved to the Loading step
  // (palletization is just the warehouse indicator now). Revive from git if the
  // Loading form wants the same VehicleFillBar.

  // Group lines by chosen pallet → one PalletisedBatch per pallet.
  const batches = useMemo(() => {
    const by = new Map<string, { order_item: string; boxes: number }[]>();
    for (const l of saveLines) {
      if (!l.pallet) continue;
      (by.get(l.pallet) ?? by.set(l.pallet, []).get(l.pallet)!).push({ order_item: l.order_item, boxes: l.boxes });
    }
    return [...by.entries()].map(([pallet, lines]) => ({ pallet, lines }));
  }, [saveLines]);

  const missing = !orderId || saveLines.length === 0 || linesNeedingPallet > 0;
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const orderErr = showErrors && !orderId ? "Sales Order is required" : null;

  const submit = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave(
        batches.map((b) => ({
          sales_order: orderId,
          pallet: b.pallet,
          delivery_date: palletDate || undefined,
          remarks: remarks.trim() || undefined,
          lines: b.lines,
        })),
      );
    } finally {
      setSaving(false);
    }
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="palette" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Palletise</div>
            <div className="sub2">Move produced boxes onto pallets in the warehouse</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
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
            <div className="muted" style={{ padding: 8 }}>No sales orders available to palletise.</div>
          )}

          {!loading && orders.length > 0 && (
            <>
              <div className="form-section">
                <div className="form-section-title">Batch</div>
                <div className="form-grid">
                  <label className="form-field">
                    <span className="lbl">
                      Sales Order<span className="req"> *</span>
                    </span>
                    {presetOrderId ? (
                      <input value={order?.label || presetOrderId} readOnly disabled />
                    ) : (
                      <Combobox
                        value={orderId}
                        options={orders.map((o) => ({ value: o.salesOrderId, label: o.label }))}
                        onChange={setOrderId}
                        placeholder="Search sales orders…"
                        invalid={!!orderErr}
                      />
                    )}
                    {orderErr && <span className="field-err">{orderErr}</span>}
                  </label>
                  <label className="form-field">
                    <span className="lbl">Palletization Date</span>
                    <DateInput value={palletDate} onChange={(e) => setPalletDate(e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span className="lbl">Remarks</span>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                  </label>
                </div>
              </div>

              {order && (
                <div className="form-section">
                  <div className="form-section-title">Items from this Sales Order</div>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                        <th className="num" style={{ textAlign: "right", width: 130 }}>Need Palletization</th>
                        <th className="num" style={{ textAlign: "right" }}>Palletised</th>
                        {/* Wide enough for the full pallet name on one line
                            (the combo popup matches the control width). */}
                        <th style={{ minWidth: 320 }}>Pallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => {
                        const opts = palletsForItem(it);
                        const need = needByItem[it.orderItemId] || 0;
                        const palletErr = showErrors && need > 0 && !palletByItem[it.orderItemId];
                        return (
                          <tr key={it.orderItemId}>
                            <td>
                              <span className="design-name">{it.designLabel}</span>
                            </td>
                            <td className="num mono">{fmt(it.ordered)}</td>
                            <td className="num">
                              <NumberInput
                                value={needByItem[it.orderItemId] ?? ""}
                                onChange={(e) => setNeed(it.orderItemId, e.target.value)}
                                placeholder="0"
                                style={{ width: 110, textAlign: "right" }}
                              />
                            </td>
                            <td className="num mono">{fmt(it.palletized)}</td>
                            <td>
                              <Combobox
                                value={palletByItem[it.orderItemId] || ""}
                                options={opts.map((p) => ({ value: p.id, label: p.name }))}
                                onChange={(v) => setPallet(it.orderItemId, v)}
                                placeholder={opts.length ? "Choose pallet…" : "No matching pallet"}
                                invalid={palletErr}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {saveLines.length === 0
                  ? "Enter a Need-Palletization qty for at least one item"
                  : linesNeedingPallet > 0
                    ? "Choose a pallet for every line with a qty"
                    : "Fill the required fields above"}
              </span>
            ) : totalBoxes > 0 ? (
              `${fmt(totalBoxes)} boxes · ${batches.length} pallet${batches.length > 1 ? "s" : ""}`
            ) : (
              "* Indicates a mandatory field"
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
