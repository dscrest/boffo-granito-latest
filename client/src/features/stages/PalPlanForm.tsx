/* ============================================================
   Palletization Plan form — plans a palletization that groups OrderItems
   from one Sales Order (or several, when editing). Header (planned date /
   salesperson) + a per-SO item picker (boxes + pallet per line). Palletise Boxes
   start blank so a partial (even single-item) palletization is allowed; a per-
   order "Fill available" button fills them all. Only produced boxes can be
   palletised (rows with nothing produced are disabled). Vehicle is NOT captured here —
   it is assigned later, at the Loading step. On save it emits a PalPlanInput;
   the PAL number is minted server-side. Reuses the shared form/modal CSS.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { NumberInput } from "@/ui/NumberInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listSalesPersons, currentSalespersonName, salesPersonOptions, type SalesPersonRow } from "@/features/masters/salespersonApi";
import { LineStockChip, useStockLookup } from "@/features/masters/LineStock";
import { listPalletizable, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { cachedPalPlans, listPalPlans, type PalPlan, type PalPlanInput } from "./palPlansApi";

// Leading dimension of a size string ("300x600 - GVT…" / "300x300" → "300").
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

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

  // Dedup: which OrderItems already sit in an OPEN (non-dispatched) plan, so we can
  // warn the user before they raise a duplicate palletization request.
  const [existingPlans, setExistingPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  useEffect(() => {
    void listPalPlans().then((r) => r.ok && setExistingPlans(r.plans));
  }, []);
  const usedByPlan = useMemo(() => {
    const m = new Map<string, string>(); // orderItemId → PAL number of an open plan
    existingPlans.forEach((p) => {
      if (p.status === "Completed") return; // dispatched → done, no longer a duplicate
      if (initial && p.id === initial.id) return; // don't warn about the plan we're editing
      p.lines.forEach((l) => { if (!m.has(l.orderItemId)) m.set(l.orderItemId, p.palNumber); });
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
      // Pallet defaults to the one chosen on the Sales Order (OrderItem.pallet).
      const defPallet: Record<string, string> = {};
      po.orders.forEach((o) => o.items.forEach((it) => { if (it.palletId) defPallet[it.orderItemId] = it.palletId; }));
      // Seed boxes/pallet from an existing plan (edit / clone) — overrides the SO default.
      if (initial) {
        const b: Record<string, number> = {};
        const p: Record<string, string> = { ...defPallet };
        for (const l of initial.lines) {
          b[l.orderItemId] = l.boxes;
          if (l.palletId) p[l.orderItemId] = l.palletId;
        }
        setBoxesByItem(b);
        setPalletByItem(p);
      } else {
        // Pallet defaults from the SO; Load Boxes start blank so the user can
        // palletise a subset (even one item) — "Fill available" fills them all.
        setPalletByItem(defPallet);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pallet specs offered for a line = those whose size WIDTH matches the item's.
  const palletsForItem = (it: PalletizableItem) => {
    const w = widthOf(it.sizeCode);
    return pallets.filter((p) => {
      if (!p.sizeId) return true;
      const pw = widthOf(p.sizeLabel);
      return !w || !pw || pw === w;
    });
  };

  // Clamp to the produced-available qty — you can't palletise more than is produced.
  const setBoxes = (itemId: string, raw: string, max: number) =>
    setBoxesByItem((p) => ({ ...p, [itemId]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  const setPallet = (itemId: string, pid: string) => setPalletByItem((p) => ({ ...p, [itemId]: pid }));

  // Convenience: fill Load Boxes with produced-available for a set of items.
  const fillAvailable = (items: PalletizableItem[]) =>
    setBoxesByItem((p) => {
      const next = { ...p };
      items.forEach((it) => { if (it.available > 0) next[it.orderItemId] = it.available; });
      return next;
    });

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

  // Save lines = every item with boxes > 0.
  const saveLines = useMemo(
    () =>
      allItems
        .map((it) => ({
          sales_order: it.salesOrderId,
          order_item: it.orderItemId,
          design: it.designId,
          pallet: palletByItem[it.orderItemId] || "",
          boxes: boxesByItem[it.orderItemId] || 0,
        }))
        .filter((l) => l.boxes > 0),
    [allItems, boxesByItem, palletByItem],
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
        vehicle_number: "", // vehicle is captured at the loading step, not at planning
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
            <Icon name="truck" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{editing ? `Edit ${initial!.palNumber}` : "New Palletization Plan"}</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Choose the items and pallets to palletise — assign a vehicle later, at loading</div>
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
                    <span className="lbl">Planned Date</span>
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
                const dupPals = [...new Set(o.items.map((it) => usedByPlan.get(it.orderItemId)).filter(Boolean))] as string[];
                return (
                <div className="form-section" key={o.salesOrderId}>
                  <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1 }}>{o.label}</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ height: 24, padding: "0 10px", fontWeight: 400, fontSize: "var(--t-sm)" }}
                      onClick={() => fillAvailable(o.items)}
                      title="Fill Palletise Boxes with the available qty for every line"
                    >
                      Fill available
                    </button>
                  </div>
                  {dupPals.length > 0 && (
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>
                      ⚠ This order already has an open palletization ({dupPals.join(", ")}) — avoid raising a duplicate.
                    </div>
                  )}
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        <th className="num" style={{ textAlign: "right", width: 150 }}>Palletise Boxes</th>
                        <th style={{ minWidth: 320 }}>Pallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((it) => {
                        const opts = palletsForItem(it);
                        const boxes = boxesByItem[it.orderItemId] || 0;
                        const noStock = it.available <= 0; // nothing produced yet → can't palletise
                        const palletErr = showErrors && boxes > 0 && !palletByItem[it.orderItemId];
                        const usedPal = usedByPlan.get(it.orderItemId);
                        return (
                          <tr key={it.orderItemId} style={noStock ? { opacity: 0.55 } : undefined}>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <LineStockChip stock={stockFor(it.designName)} qty={boxes} label={it.designLabel} />
                                <span className="design-name">{it.designLabel}</span>
                                {usedPal && (
                                  <span className="chip" style={{ fontSize: 11 }} title={`Already in open palletization ${usedPal}`}>in {usedPal}</span>
                                )}
                              </span>
                            </td>
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
