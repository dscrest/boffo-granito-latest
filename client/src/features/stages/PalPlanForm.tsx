/* ============================================================
   Palletization Plan form — plans a palletization that groups OrderItems
   from one Sales Order (or several, when editing). Header (palletization date /
   salesperson / optional vehicle) + a per-SO item picker (boxes + pallet per
   line). Palletise Boxes start blank so a partial (even single-item)
   palletization is allowed. Only produced boxes can be palletised (rows with
   nothing produced are disabled). Vehicle is optional — it can also be assigned
   later, at the Loading step. On save it emits a PalPlanInput; the PAL number
   is minted server-side. Reuses the shared form/modal CSS.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { NumberInput } from "@/ui/NumberInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, palletsForSize, type PalletRow } from "@/features/masters/palletsApi";
import { listSalesPersons, currentSalespersonName, salesPersonOptions, type SalesPersonRow } from "@/features/masters/salespersonApi";
import { LineStockChip, useStockLookup } from "@/features/masters/LineStock";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import { listPalletizable, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { cachedPalPlans, listPalPlans, type PalPlan, type PalPlanInput } from "./palPlansApi";

export function PalPlanForm({
  onSave,
  onClose,
  initial,
  clone,
  presetOrderId,
}: {
  onSave: (input: PalPlanInput) => void | Promise<void>;
  onClose: () => void;
  /** Seed the form from an existing plan (edit or clone). */
  initial?: PalPlan;
  /** Clone mode: seed values but save as a NEW plan (blank PAL number). */
  clone?: boolean;
  /** Scope to one Sales Order (from "Send to Palletization") and prefill each
      line's Load Boxes with the produced-available qty. */
  presetOrderId?: string;
}) {
  const editing = !!initial && !clone;
  const [orders, setOrders] = useState<PalletizableOrder[]>([]);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [salesPersons, setSalesPersons] = useState<SalesPersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New mode (no preset, no seed): scope the item table to one chosen SO, like
  // "Send for Production". Edit/clone and preset (from SO/production) skip this.
  const pickSo = !initial && !presetOrderId;
  const [selectedSo, setSelectedSo] = useState("");
  const [plannedDate, setPlannedDate] = useState(initial?.plannedDate || todayISO());
  const [salesperson, setSalesperson] = useState(initial?.salespersonName || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  // Boxes + pallet chosen per order item (keyed by OrderItem ROWID).
  const [boxesByItem, setBoxesByItem] = useState<Record<string, number>>({});
  const [palletByItem, setPalletByItem] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const stockFor = useStockLookup(); // per-design stock signal dot (same as the SO form)
  // Pallet prefill from the SO/quote container plan (quotes/orders can arrive
  // after this form's own load, so it's resolved per render, never seeded).
  const { defaultPalletFor } = useContainerPlanBySo();
  const effPallet = (soId: string, it: PalletizableItem) =>
    palletByItem[it.orderItemId] ?? (defaultPalletFor(soId, it.designId) || it.palletId || "");

  // Dedup: which OrderItems already sit in an OPEN (non-dispatched) plan, so we can
  // warn the user before they raise a duplicate palletization request.
  const [existingPlans, setExistingPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  useEffect(() => {
    void listPalPlans().then((r) => r.ok && setExistingPlans(r.plans));
  }, []);
  const usedByPlan = useMemo(() => {
    const m = new Map<string, { id: string; pal: string }>(); // orderItemId → open plan holding it
    existingPlans.forEach((p) => {
      if (p.status === "Completed") return; // dispatched → done, no longer a duplicate
      if (initial && p.id === initial.id) return; // don't warn about the plan we're editing
      p.lines.forEach((l) => { if (!m.has(l.orderItemId)) m.set(l.orderItemId, { id: p.id, pal: p.palNumber }); });
    });
    return m;
  }, [existingPlans, initial]);

  useEffect(() => {
    void (async () => {
      const [po, pl, sp] = await Promise.all([
        listPalletizable(presetOrderId ? { includeOrderId: presetOrderId } : undefined),
        listPallets(),
        listSalesPersons(),
      ]);
      setLoading(false);
      if (!po.ok) {
        setError(po.error || "Failed to load palletizable items");
        return;
      }
      setOrders(po.orders);
      setPallets(pl.ok ? pl.pallets : []);
      setSalesPersons(sp.ok ? sp.salesPersons : []);
      // Salesperson defaults to the logged-in user (unless seeded from a record).
      if (!initial?.salespersonName) setSalesperson(currentSalespersonName(sp.ok ? sp.salesPersons : []));
      // Seed boxes/pallet from an existing plan (edit / clone) — an explicitly
      // saved pallet wins over the plan/SO default. New mode seeds nothing:
      // the default resolves per render via effPallet (container plan → SO
      // line's pallet), and Load Boxes start blank (partial-friendly).
      if (initial) {
        const b: Record<string, number> = {};
        const p: Record<string, string> = {};
        for (const l of initial.lines) {
          // A plan may hold several lines per item (one per batch) — sum them.
          b[l.orderItemId] = (b[l.orderItemId] || 0) + l.boxes;
          if (l.palletId) p[l.orderItemId] = l.palletId;
        }
        setBoxesByItem(b);
        setPalletByItem(p);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pallet specs offered for a line = those whose size WIDTH matches the item's.
  const palletsForItem = (it: PalletizableItem) => palletsForSize(pallets, it.sizeCode);

  // Clamp to the produced-available qty — you can't palletise more than is produced.
  const setBoxes = (itemId: string, raw: string, max: number) =>
    setBoxesByItem((p) => ({ ...p, [itemId]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  const setPallet = (itemId: string, pid: string) => setPalletByItem((p) => ({ ...p, [itemId]: pid }));

  // Orders shown as item sections: edit/clone/preset show what the API returned;
  // New mode shows only the SO picked above (nothing until one is chosen).
  const visibleOrders = useMemo(
    () => (pickSo ? orders.filter((o) => o.salesOrderId === selectedSo) : orders),
    [pickSo, orders, selectedSo],
  );

  // Picking an SO scopes the item table; Load Boxes stay blank (partial-friendly).
  const onSelectSo = (soId: string) => {
    setSelectedSo(soId);
    setBoxesByItem({});
  };

  // Flatten every VISIBLE order item for line building / lookup.
  const allItems = useMemo(
    () => visibleOrders.flatMap((o) => o.items.map((it) => ({ ...it, salesOrderId: o.salesOrderId }))),
    [visibleOrders],
  );

  // The form edits each item's TOTAL; an edited plan may hold one line per
  // batch, so the total is re-distributed FIFO over the item's original batch
  // lines — batch identity survives an edit (server replaces all lines).
  const origByItem = useMemo(() => {
    const m = new Map<string, { batch: string; boxes: number }[]>();
    for (const l of initial?.lines || []) {
      const arr = m.get(l.orderItemId) || [];
      arr.push({ batch: l.batchNumber, boxes: l.boxes });
      m.set(l.orderItemId, arr);
    }
    return m;
  }, [initial]);

  // Save lines = every item with boxes > 0, expanded per original batch line.
  const saveLines = useMemo(
    () =>
      allItems.flatMap((it) => {
        const total = boxesByItem[it.orderItemId] || 0;
        if (total <= 0) return [];
        const base = {
          sales_order: it.salesOrderId,
          order_item: it.orderItemId,
          design: it.designId,
          pallet: effPallet(it.salesOrderId, it),
        };
        const orig = origByItem.get(it.orderItemId) || [];
        if (!orig.length) return [{ ...base, boxes: total, batch_number: "" }];
        let remaining = total;
        const out: (typeof base & { boxes: number; batch_number: string })[] = [];
        for (const o of orig) {
          const alloc = Math.min(o.boxes, remaining);
          if (alloc > 0) out.push({ ...base, boxes: alloc, batch_number: o.batch });
          remaining -= alloc;
        }
        if (remaining > 0) out[out.length - 1].boxes += remaining;
        return out;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, boxesByItem, palletByItem, origByItem, defaultPalletFor],
  );
  const totalBoxes = saveLines.reduce((s, l) => s + l.boxes, 0);
  const linesNeedingPallet = saveLines.filter((l) => !l.pallet).length;

  const missing = saveLines.length === 0 || linesNeedingPallet > 0;

  const submit = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        pal_number: editing ? initial!.palNumber : "", // edit keeps its number; create/clone mint server-side
        vehicle_number: "", // legacy free-text, unused
        // No vehicle at palletization — vehicles attach to load boxes at the
        // Loading step. Edit keeps a legacy plan's existing vehicle untouched.
        vehicle: (editing && initial?.vehicleId) || "",
        planned_date: plannedDate || "",
        salesperson: salesperson || "",
        remarks: remarks.trim(),
        lines: saveLines.map((l, i) => ({ ...l, position: i })),
      });
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
            <div style={{ fontWeight: 600 }}>{editing ? `Edit ${initial!.palNumber}` : "New Palletization Plan"}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          {loading && <div className="muted" style={{ padding: 8 }}>Loading palletizable items…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>{error}</div>
          )}
          {!loading && !error && orders.length === 0 && !initial && (
            <div className="muted" style={{ padding: 8 }}>No order items ready to palletise.</div>
          )}

          {!loading && (
            <>
              <div className="form-section">
                <div className="form-section-title">Plan</div>
                <div className="form-grid">
                  {pickSo && (
                    <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                      <span className="lbl">Sales Order<span className="req"> *</span></span>
                      <Combobox
                        value={selectedSo}
                        options={orders.map((o) => ({ value: o.salesOrderId, label: o.label }))}
                        onChange={onSelectSo}
                        placeholder={orders.length ? "Search orders with palletisable stock…" : "No orders ready to palletise"}
                        ariaLabel="Sales Order"
                        invalid={showErrors && !selectedSo}
                      />
                    </label>
                  )}
                  <label className="form-field">
                    <span className="lbl">Palletization Date</span>
                    <DateInput value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span className="lbl">Sales Person</span>
                    <Combobox
                      value={salesperson}
                      options={salesPersonOptions(salesPersons)}
                      onChange={setSalesperson}
                      placeholder="Search sales persons…"
                    />
                  </label>
                  <label className="form-field">
                    <span className="lbl">Remarks</span>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                  </label>
                </div>
              </div>

              {pickSo && !selectedSo && (
                <div className="muted" style={{ padding: "8px 2px" }}>Choose a Sales Order above to load its items.</div>
              )}

              {visibleOrders.map((o) => {
                // Distinct open plans that already hold items from this order (dedup hint).
                const dupPals = [
                  ...new Map(
                    o.items.flatMap((it) => { const d = usedByPlan.get(it.orderItemId); return d ? [[d.id, d] as const] : []; }),
                  ).values(),
                ];
                return (
                <div className="form-section" key={o.salesOrderId}>
                  <div className="form-section-title">{o.label}</div>
                  {dupPals.length > 0 && (
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>
                      ⚠ This order already has an open palletization (
                      {dupPals.map((d, i) => (
                        <span key={d.id}>
                          {i > 0 && ", "}
                          <Link to={`/packing/${d.id}`}>{d.pal}</Link>
                        </span>
                      ))}
                      ) — avoid raising a duplicate.
                    </div>
                  )}
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        <th className="num" style={{ textAlign: "right", width: 150 }}>Palletise Boxes</th>
                        <th style={{ minWidth: 320 }}>Pallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((it) => {
                        // Size-matched pallets, plus the chosen one even if the
                        // size filter would miss it (plan prefill always shows).
                        const opts = palletsForItem(it);
                        const pallet = effPallet(o.salesOrderId, it);
                        if (pallet && !opts.some((p) => p.id === pallet)) {
                          const own = pallets.find((p) => p.id === pallet);
                          if (own) opts.unshift(own);
                        }
                        const boxes = boxesByItem[it.orderItemId] || 0;
                        const noStock = it.available <= 0; // nothing produced yet → can't palletise
                        const palletErr = showErrors && boxes > 0 && !pallet;
                        const usedPal = usedByPlan.get(it.orderItemId);
                        return (
                          <tr key={it.orderItemId} style={noStock ? { opacity: 0.55 } : undefined}>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <LineStockChip stock={stockFor(it.designName)} qty={boxes} label={it.designLabel} />
                                <span className="design-name">{it.designLabel}</span>
                                {usedPal && (
                                  <span className="chip" style={{ fontSize: 13 }} title={`Already in open palletization ${usedPal.pal}`}>
                                    in <Link to={`/packing/${usedPal.id}`}>{usedPal.pal}</Link>
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="num mono dim">{fmt(it.ordered)}</td>
                            <td className="num mono">{fmt(it.available)}</td>
                            <td className="num">
                              {noStock ? (
                                <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap" }}>⚠ needs production</span>
                              ) : (
                                <NumberInput
                                  value={boxesByItem[it.orderItemId] ?? ""}
                                  onChange={(e) => setBoxes(it.orderItemId, e.target.value, it.available)}
                                  placeholder="0"
                                  style={{ width: 110, textAlign: "right" }}
                                />
                              )}
                            </td>
                            <td>
                              <Combobox
                                value={pallet}
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
                );
              })}
            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {saveLines.length === 0
                  ? "Enter Palletise Boxes for at least one item"
                  : "Choose a pallet for every line with boxes"}
              </span>
            ) : totalBoxes > 0 ? (
              `${fmt(totalBoxes)} boxes · ${saveLines.length} line${saveLines.length > 1 ? "s" : ""} · ${[...new Set(saveLines.map((l) => l.sales_order))].length} order(s)`
            ) : (
              "Enter Palletise Boxes and a pallet for the items to palletise"
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
