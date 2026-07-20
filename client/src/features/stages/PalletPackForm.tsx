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
import { MoreMenu } from "@/features/common/DetailBits";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listPalletizable, type ClosePalletInput, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { NumberInput } from "../../ui/NumberInput";

// Leading dimension of a size string ("300x600 - GVT…" / "300x300" → "300").
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

// Distinct, on-theme colours for the truck load bar — assigned by first-seen
// design in the batch so N items always get N visibly-different segments (a hash
// gives no such guarantee and can collide two designs into the same hue). Brand
// orange leads so a single-item load reads as "the app colour". Cycles if a batch
// ever has more than 8 designs. Same OKLCH family as the theme's --c-* / --accent.
const DESIGN_PALETTE = [
  "oklch(0.68 0.17 55)",  // orange (brand)
  "oklch(0.60 0.13 195)", // teal
  "oklch(0.58 0.15 250)", // blue
  "oklch(0.55 0.16 300)", // purple
  "oklch(0.60 0.18 350)", // magenta
  "oklch(0.60 0.15 150)", // green
  "oklch(0.66 0.13 90)",  // gold
  "oklch(0.58 0.18 25)",  // rust
];

// ponytail: no Truck master yet — one truck ≈ one container of the chosen
// pallets. Falls back to a constant when no pallet spec is picked. Swap for a
// real Truck master + capacity when trucks get modelled.
const DEFAULT_TRUCK_BOXES = 1000;

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
  // Vehicles the operator adds beyond what packing needs; the auto count grows
  // on its own so no vehicle ever exceeds 100% (boxes spill to the next).
  const [extra, setExtra] = useState(0);

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

  // Group lines by chosen pallet → one PalletisedBatch per pallet.
  const batches = useMemo(() => {
    const by = new Map<string, { order_item: string; boxes: number }[]>();
    for (const l of saveLines) {
      if (!l.pallet) continue;
      (by.get(l.pallet) ?? by.set(l.pallet, []).get(l.pallet)!).push({ order_item: l.order_item, boxes: l.boxes });
    }
    return [...by.entries()].map(([pallet, lines]) => ({ pallet, lines }));
  }, [saveLines]);

  // Truck capacity (boxes) ≈ one container of the chosen pallets. Advisory.
  const truckCapacity = useMemo(() => {
    const caps = batches
      .map((b) => pallets.find((p) => p.id === b.pallet)?.boxesPerContainer || 0)
      .filter((n) => n > 0);
    return caps.length ? Math.max(...caps) : DEFAULT_TRUCK_BOXES;
  }, [batches, pallets]);

  // Only palletised lines ride a vehicle — a line without a pallet can't be
  // saved and has no capacity basis until its pallet is chosen.
  const palletLines = useMemo(() => saveLines.filter((l) => l.pallet), [saveLines]);
  const allocBoxes = palletLines.reduce((s, l) => s + l.boxes, 0);
  // Vehicle count grows so nothing exceeds one vehicle's capacity; the operator
  // can add empty extras on top. autoVehicles is the trailing-extra threshold.
  const autoVehicles = Math.max(1, Math.ceil(allocBoxes / truckCapacity));
  const vehicleCount = autoVehicles + extra;

  // First-fit each line's boxes across the vehicles so the load bar can show
  // per-item colour segments. vehicleCount is sized so everything fits — a full
  // vehicle spills into the next, never over capacity.
  const truckLoads = useMemo(() => {
    const cap = vehicleCount * truckCapacity;
    const loads: { designId: string; label: string; boxes: number; color: string }[][] = Array.from({ length: vehicleCount }, () => []);
    let idx = 0;
    let used = 0;
    const colorByDesign = new Map<string, string>();
    for (const l of palletLines) {
      const it = order?.items.find((x) => x.orderItemId === l.order_item);
      if (!it) continue;
      let remaining = l.boxes;
      if (!colorByDesign.has(it.designId))
        colorByDesign.set(it.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
      const color = colorByDesign.get(it.designId)!;
      while (remaining > 0 && idx < vehicleCount) {
        const space = truckCapacity - loads[idx].reduce((s, seg) => s + seg.boxes, 0);
        const put = Math.min(remaining, space);
        if (put > 0) {
          loads[idx].push({ designId: it.designId, label: it.designLabel, boxes: put, color });
          used += put;
          remaining -= put;
        }
        if (remaining > 0) idx++;
      }
    }
    return { loads, cap, used };
  }, [palletLines, vehicleCount, truckCapacity, order]);

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
          <div style={{ flex: 1 }} />
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

              {order && palletLines.length > 0 && (
                <div className="form-section">
                  <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Vehicle loading</span>
                    <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      {fmt(truckLoads.used)} / {fmt(truckLoads.cap)} boxes · {vehicleCount} vehicle{vehicleCount > 1 ? "s" : ""}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ marginLeft: "auto", padding: "3px 8px" }}
                      onClick={() => setExtra((n) => n + 1)}
                    >
                      <Icon name="plus" size={12} /> Add vehicle
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {truckLoads.loads.map((segs, i) => {
                      const loaded = segs.reduce((s, seg) => s + seg.boxes, 0);
                      const fillPct = truckCapacity > 0 ? Math.round((loaded / truckCapacity) * 100) : 0;
                      // Fill %: exactly full → green, otherwise under-filled → amber.
                      const fillColor = loaded === truckCapacity ? "var(--c-green)" : "var(--c-amber)";
                      // Vehicles beyond the auto-needed count are operator-added extras —
                      // removable (they're empty; auto vehicles carry the load and stay).
                      const removable = i >= autoVehicles;
                      const removeVehicle = () => setExtra((n) => Math.max(0, n - 1));
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {removable && (
                            <button type="button" className="btn x" title="Remove vehicle" onClick={removeVehicle} style={{ padding: 2 }}>
                              <Icon name="x" size={14} />
                            </button>
                          )}
                          <Icon name="truck" size={20} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  flex: 1,
                                  display: "flex",
                                  height: 18,
                                  borderRadius: 5,
                                  overflow: "hidden",
                                  border: "1px solid var(--border)",
                                  background: "var(--panel-2)",
                                }}
                                title={`${fmt(loaded)} / ${fmt(truckCapacity)} boxes`}
                              >
                                {segs.map((seg, j) => {
                                  const pct = loaded > 0 ? Math.round((seg.boxes / loaded) * 100) : 0;
                                  const wide = seg.boxes / truckCapacity >= 0.1;
                                  return (
                                    <div
                                      key={j}
                                      style={{
                                        width: `${(seg.boxes / truckCapacity) * 100}%`,
                                        background: seg.color,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "#fff",
                                        fontSize: 11,
                                        fontWeight: 600,
                                        textShadow: "0 1px 1px rgba(0,0,0,0.35)",
                                        overflow: "hidden",
                                      }}
                                      title={`${seg.label}: ${fmt(seg.boxes)} boxes · ${pct}%`}
                                    >
                                      {wide ? `${pct}%` : ""}
                                    </div>
                                  );
                                })}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 700, color: fillColor, minWidth: 44, textAlign: "right" }} title="Vehicle fill vs capacity">
                                {fillPct}%
                              </span>
                            </div>
                            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                              Vehicle {i + 1} · {fmt(loaded)} / {fmt(truckCapacity)} boxes
                            </div>
                            {segs.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 4 }}>
                                {/* ponytail: one row per segment — a design split across two
                                    order-item lines would appear twice; fine until that happens. */}
                                {segs.map((seg, j) => {
                                  const pct = loaded > 0 ? Math.round((seg.boxes / loaded) * 100) : 0;
                                  return (
                                    <span key={j} className="dim" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }}>
                                      <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flex: "0 0 auto" }} />
                                      {seg.label} · {fmt(seg.boxes)} boxes · {pct}%
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          {removable && (
                            <MoreMenu kebab items={[{ label: "Remove vehicle", danger: true, onClick: removeVehicle }]} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* TODO: list partially-empty vehicles (undispatched, under-capacity)
                     for reuse — source: open PalletisedBatch / a future Vehicle master.
                     Deferred to a later phase per spec 4.12. */}
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
