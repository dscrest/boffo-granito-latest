/* ============================================================
   Palletization Plan form — plans a vehicle load that groups OrderItems
   from MULTIPLE Sales Orders. Header (vehicle / planned date / salesperson)
   + a per-SO item picker (boxes + pallet per line) + the shared vehicle-fill
   bar. On save it emits a PalPlanInput; the PAL number is minted server-side.
   Reuses the shared form/modal CSS (df-*, form-*) and VehicleFillBar.
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
import { listPalletizable, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { VehicleFillBar, type VehicleLine } from "./VehicleFillBar";
import { type PalPlan, type PalPlanInput } from "./palPlansApi";

// Leading dimension of a size string ("300x600 - GVT…" / "300x300" → "300").
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";
// ponytail: no Truck master yet — one vehicle ≈ one container of the chosen pallets.
const DEFAULT_TRUCK_BOXES = 1000;

export function PalPlanForm({
  onSave,
  onClose,
  initial,
  clone,
}: {
  onSave: (input: PalPlanInput) => void | Promise<void>;
  onClose: () => void;
  /** Seed the form from an existing plan (edit or clone). */
  initial?: PalPlan;
  /** Clone mode: seed values but save as a NEW plan (blank PAL number). */
  clone?: boolean;
}) {
  const editing = !!initial && !clone;
  const [orders, setOrders] = useState<PalletizableOrder[]>([]);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [salesPersons, setSalesPersons] = useState<SalesPersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vehicle, setVehicle] = useState(initial?.vehicleNumber || "");
  const [plannedDate, setPlannedDate] = useState(initial?.plannedDate || todayISO());
  const [salesperson, setSalesperson] = useState(initial?.salespersonName || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  // Boxes + pallet chosen per order item (keyed by OrderItem ROWID).
  const [boxesByItem, setBoxesByItem] = useState<Record<string, number>>({});
  const [palletByItem, setPalletByItem] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [po, pl, sp] = await Promise.all([listPalletizable(), listPallets(), listSalesPersons()]);
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
      // Seed boxes/pallet from an existing plan (edit / clone).
      if (initial) {
        const b: Record<string, number> = {};
        const p: Record<string, string> = {};
        for (const l of initial.lines) {
          b[l.orderItemId] = l.boxes;
          if (l.palletId) p[l.orderItemId] = l.palletId;
        }
        setBoxesByItem(b);
        setPalletByItem(p);
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

  const setBoxes = (itemId: string, raw: string) =>
    setBoxesByItem((p) => ({ ...p, [itemId]: Math.max(0, Number(raw) || 0) }));
  const setPallet = (itemId: string, pid: string) => setPalletByItem((p) => ({ ...p, [itemId]: pid }));

  // Flatten every order item (across all SOs) for line building / lookup.
  const allItems = useMemo(
    () => orders.flatMap((o) => o.items.map((it) => ({ ...it, salesOrderId: o.salesOrderId }))),
    [orders],
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

  // Vehicle capacity (boxes) ≈ one container of the chosen pallets. Advisory.
  const truckCapacity = useMemo(() => {
    const caps = saveLines
      .map((l) => pallets.find((p) => p.id === l.pallet)?.boxesPerContainer || 0)
      .filter((n) => n > 0);
    return caps.length ? Math.max(...caps) : DEFAULT_TRUCK_BOXES;
  }, [saveLines, pallets]);

  const vehicleLines = useMemo<VehicleLine[]>(
    () =>
      saveLines
        .filter((l) => l.pallet)
        .map((l) => {
          const it = allItems.find((x) => x.orderItemId === l.order_item);
          return { designId: it?.designId || l.order_item, label: it?.designLabel || "—", boxes: l.boxes };
        }),
    [saveLines, allItems],
  );

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
        vehicle_number: vehicle.trim(),
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
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Group order items from one or more Sales Orders onto a vehicle</div>
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
                  <label className="form-field">
                    <span className="lbl">Vehicle No.</span>
                    <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. GJ-01-AB-1234" />
                  </label>
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

              {orders.map((o) => (
                <div className="form-section" key={o.salesOrderId}>
                  <div className="form-section-title">{o.label}</div>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        <th className="num" style={{ textAlign: "right", width: 130 }}>Load Boxes</th>
                        <th style={{ minWidth: 320 }}>Pallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((it) => {
                        const opts = palletsForItem(it);
                        const boxes = boxesByItem[it.orderItemId] || 0;
                        const palletErr = showErrors && boxes > 0 && !palletByItem[it.orderItemId];
                        return (
                          <tr key={it.orderItemId}>
                            <td>
                              <span className="design-name">{it.designLabel}</span>
                            </td>
                            <td className="num mono">{fmt(it.available)}</td>
                            <td className="num">
                              <NumberInput
                                value={boxesByItem[it.orderItemId] ?? ""}
                                onChange={(e) => setBoxes(it.orderItemId, e.target.value)}
                                placeholder="0"
                                style={{ width: 110, textAlign: "right" }}
                              />
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
              ))}

              <VehicleFillBar lines={vehicleLines} truckCapacity={truckCapacity} extra={extra} onExtraChange={setExtra} />
            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {saveLines.length === 0
                  ? "Enter Load Boxes for at least one item"
                  : "Choose a pallet for every line with boxes"}
              </span>
            ) : totalBoxes > 0 ? (
              `${fmt(totalBoxes)} boxes · ${saveLines.length} line${saveLines.length > 1 ? "s" : ""} · ${[...new Set(saveLines.map((l) => l.sales_order))].length} order(s)`
            ) : (
              "Pick items and their pallets to plan a vehicle load"
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
