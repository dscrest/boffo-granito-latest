/* ============================================================
   Palletization Plan form — plans a palletization that groups OrderItems
   from one Sales Order (or several, when editing). Header (palletization date /
   salesperson / optional vehicle) + a per-SO item picker (boxes + pallet per
   line). Palletise Boxes start blank so a partial (even single-item)
   palletization is allowed. Boxes are capped at the SO ordered qty across
   ALL plans/lines (produced qty is a hint, not a clamp — CR 2026-09-10);
   untouched rows with nothing produced stay disabled in new mode. Vehicle is
   optional — it can also be assigned later, at the Loading step. On save it
   emits a PalPlanInput (Planning lines only); the PAL number is minted
   server-side. Reuses the shared form/modal CSS.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { NumberInput } from "@/ui/NumberInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { listPallets, palletsForSize, type PalletRow } from "@/features/masters/palletsApi";
import { listSalesPersons, currentSalespersonName, salesPersonOptions, type SalesPersonRow } from "@/features/masters/salespersonApi";
import { LineStockChip, useStockLookup } from "@/features/masters/LineStock";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import { listPalletizable, type PalletizableItem, type PalletizableOrder } from "./palletisationApi";
import { cachedPalPlans, listPalPlans, type PalPlan, type PalPlanInput } from "./palPlansApi";
import { listProductionLogs } from "./productionApi";
import { unqueuedByItem, type BatchSupply } from "./palletizeBatches";

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

  // New mode (no preset, no seed): customer-first (CR-223) — pick a customer at
  // the top (CR-224), all their orders show as sections, one Save = one plan for that
  // customer. Edit/clone and preset (from SO/production) skip this.
  const pickSo = !initial && !presetOrderId;
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [designQuery, setDesignQuery] = useState("");
  const [supply, setSupply] = useState<BatchSupply[]>([]);
  const [plannedDate, setPlannedDate] = useState(initial?.plannedDate || todayISO());
  const [salesperson, setSalesperson] = useState(initial?.salespersonName || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  // Boxes + pallet chosen per order item (keyed by OrderItem ROWID).
  const [boxesByItem, setBoxesByItem] = useState<Record<string, number>>({});
  const [palletByItem, setPalletByItem] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const form = useFormSave(onClose);
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
  // Production side of each order line (records + allocations), new mode only.
  useEffect(() => {
    if (!pickSo) return;
    void listProductionLogs().then((r) => {
      if (!r.ok) return;
      setSupply([...r.entries.flatMap((e) => e.records), ...r.allocEntries]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Read-only batch chips: produced/allocated batches not yet on any plan line.
  // The server assigns batches FIFO on save (createPalPlan) — display only here.
  const openBatches = useMemo(
    () => unqueuedByItem(supply, existingPlans.flatMap((p) => p.lines)),
    [supply, existingPlans],
  );
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
      // saved pallet wins over the plan/SO default. Only Planning lines are
      // editable here (and re-sent on save); Palletizing/ReadyToLoad lines are
      // locked and survive the save untouched (server replaces Planning only).
      // New mode seeds nothing: the default resolves per render via effPallet
      // (container plan → SO line's pallet), and Load Boxes start blank.
      if (initial) {
        const b: Record<string, number> = {};
        const p: Record<string, string> = {};
        for (const l of initial.lines) {
          if (l.palletId) p[l.orderItemId] = l.palletId;
          if (l.status !== "Planning") continue;
          // A plan may hold several lines per item (one per batch) — sum them.
          b[l.orderItemId] = (b[l.orderItemId] || 0) + l.boxes;
        }
        setBoxesByItem(b);
        setPalletByItem(p);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pallet specs offered for a line = those whose size WIDTH matches the item's.
  const palletsForItem = (it: PalletizableItem) => palletsForSize(pallets, it.sizeCode);

  const setBoxes = (itemId: string, raw: string, max: number) => {
    form.touch();
    setBoxesByItem((p) => ({ ...p, [itemId]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  };
  const setPallet = (itemId: string, pid: string) => {
    form.touch();
    setPalletByItem((p) => ({ ...p, [itemId]: pid }));
  };

  // Edit mode: the palletizable work list SKIPS items with nothing left to
  // palletise (available ≤ 0), which used to silently DROP those plan lines on
  // save. Merge the plan's own lines back in, synthesising entries the list
  // didn't return (ordered 0 = unknown → those rows are reduce-only).
  const mergedOrders = useMemo(() => {
    if (!initial) return orders;
    const out = orders.map((o) => ({ ...o, items: [...o.items] }));
    const bySo = new Map(out.map((o) => [o.salesOrderId, o] as const));
    for (const l of initial.lines) {
      let o = bySo.get(l.salesOrderId);
      if (!o) {
        o = {
          salesOrderId: l.salesOrderId,
          label: [l.soNumber, l.customerName].filter(Boolean).join(" · ") || l.salesOrderId,
          customerId: l.customerId,
          customerName: l.customerName,
          portOfDischarge: "",
          items: [],
        };
        bySo.set(l.salesOrderId, o);
        out.push(o);
      }
      if (!o.items.some((it) => it.orderItemId === l.orderItemId)) {
        o.items.push({
          orderItemId: l.orderItemId,
          designId: l.designId,
          designLabel: l.designLabel,
          designName: "",
          palletId: l.palletId,
          sizeId: "",
          sizeCode: l.sizeCode,
          ordered: 0, // unknown here — maxFor treats 0 as "reduce-only"
          available: 0,
          produced: 0,
          palletized: 0,
          toProduce: 0,
          inProduction: 0,
          inProductionOrders: [],
        });
      }
    }
    return out;
  }, [orders, initial]);

  // Orders shown as item sections: edit/clone/preset show what the API returned;
  // New mode shows every order of the customer picked at the top.
  const visibleOrders = useMemo(
    () => (pickSo ? mergedOrders.filter((o) => o.customerId === selectedCustomer) : mergedOrders),
    [pickSo, mergedOrders, selectedCustomer],
  );
  // Customer pick list: customers with palletizable stock.
  const customers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; available: number }>();
    for (const o of orders) {
      if (!o.customerId) continue;
      const c = m.get(o.customerId) || { id: o.customerId, name: o.customerName || "—", available: 0 };
      c.available += o.items.reduce((n, it) => n + Math.max(0, it.available), 0);
      m.set(o.customerId, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);
  // Search narrows what is SHOWN only — saveLines read the full visibleOrders,
  // so a quantity typed before searching is never dropped.
  const dq = pickSo ? designQuery.trim().toLowerCase() : "";
  const shownOrders = !dq
    ? visibleOrders
    : visibleOrders
        .map((o) => (o.label.toLowerCase().includes(dq) ? o : { ...o, items: o.items.filter((it) => it.designLabel.toLowerCase().includes(dq)) }))
        .filter((o) => o.items.length > 0);

  // Boxes locked in THIS plan (Palletizing/ReadyToLoad lines — not editable here).
  const lockedByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of initial?.lines || [])
      if (l.status !== "Planning") m.set(l.orderItemId, (m.get(l.orderItemId) || 0) + l.boxes);
    return m;
  }, [initial]);
  // Boxes already planned in OTHER plans (any status — the SO-qty budget is
  // spent once boxes are on any plan, dispatched included).
  const otherPlansByItem = useMemo(() => {
    const m = new Map<string, number>();
    existingPlans.forEach((p) => {
      if (initial && p.id === initial.id) return;
      p.lines.forEach((l) => m.set(l.orderItemId, (m.get(l.orderItemId) || 0) + l.boxes));
    });
    return m;
  }, [existingPlans, initial]);
  // Cap per user rule: total planned across all lines/plans ≤ the SO's ordered
  // qty (produced-based clamp dropped — production may lag the plan).
  const maxFor = (it: PalletizableItem) => {
    if (!it.ordered) return boxesByItem[it.orderItemId] || 0; // synthesized row — reduce-only
    return Math.max(
      0,
      it.ordered - (otherPlansByItem.get(it.orderItemId) || 0) - (lockedByItem.get(it.orderItemId) || 0),
    );
  };

  // Picking a customer scopes the sections; boxes reset — one customer per plan.
  const pickCustomer = (id: string) => {
    if (id === selectedCustomer) return;
    form.touch();
    setSelectedCustomer(id);
    setDesignQuery("");
    setBoxesByItem({});
  };

  // Flatten every VISIBLE order item for line building / lookup.
  const allItems = useMemo(
    () => visibleOrders.flatMap((o) => o.items.map((it) => ({ ...it, salesOrderId: o.salesOrderId }))),
    [visibleOrders],
  );

  // The form edits each item's Planning TOTAL; an edited plan may hold one
  // line per batch, so the total is re-distributed FIFO over the item's
  // original Planning batch lines — batch identity survives an edit (the
  // server replaces Planning lines only; advanced lines are untouched).
  const origByItem = useMemo(() => {
    const m = new Map<string, { batch: string; boxes: number }[]>();
    for (const l of initial?.lines || []) {
      if (l.status !== "Planning") continue;
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

  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    void form.run(() =>
      onSave({
        pal_number: editing ? initial!.palNumber : "", // edit keeps its number; create/clone mint server-side
        vehicle_number: "", // legacy free-text, unused
        // No vehicle at palletization — vehicles attach to load boxes at the
        // Loading step. Edit keeps a legacy plan's existing vehicle untouched.
        vehicle: (editing && initial?.vehicleId) || "",
        planned_date: plannedDate || "",
        salesperson: salesperson || "",
        remarks: remarks.trim(),
        lines: saveLines.map((l, i) => ({ ...l, position: i })),
      }),
    );
  };

  const planFields = (
              <div className="form-section">
                <div className="form-section-title">Plan</div>
                <div className="form-grid">
                  {pickSo && (
                    <label className="form-field">
                      <span className="lbl">Customer <span className="req">*</span></span>
                      <Combobox
                        value={selectedCustomer}
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                        onChange={pickCustomer}
                        placeholder="Search customers…"
                        invalid={showErrors && !selectedCustomer}
                      />
                    </label>
                  )}
                  <label className="form-field">
                    <span className="lbl">Palletization Date</span>
                    <DateInput value={plannedDate} onChange={(e) => {
                        form.touch();
                        setPlannedDate(e.target.value);
                      }} />
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
                    <input value={remarks} onChange={(e) => {
                        form.touch();
                        setRemarks(e.target.value);
                      }} placeholder="Optional" />
                  </label>
                </div>
              </div>
  );
  const sections = (
    <>
              {shownOrders.map((o) => (
                <div className="form-section" key={o.salesOrderId}>
                  <div className="form-section-title">{o.label}</div>
                  <div style={{ overflowX: "auto" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                        {pickSo && <th className="num" style={{ textAlign: "right" }}>Produced</th>}
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                        {pickSo && <th>Batches</th>}
                        <th className="num" style={{ textAlign: "right", width: 150 }}>Palletize Boxes</th>
                        <th style={{ minWidth: 240 }}>Pallet</th>
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
                        const locked = lockedByItem.get(it.orderItemId) || 0;
                        // "Needs production" hint only for untouched new-mode rows;
                        // in edit mode a plan line is always editable (reduce-only
                        // when its item has nothing left).
                        const noStock = !initial && it.available <= 0 && boxes <= 0;
                        // Cap exhausted by other plans — say so instead of an input
                        // that silently clamps every keystroke to 0.
                        const max = maxFor(it);
                        const allPlanned = !initial && it.ordered > 0 && max <= 0;
                        const palletErr = showErrors && boxes > 0 && !pallet;
                        const inProgress = usedByPlan.has(it.orderItemId);
                        return (
                          <tr key={it.orderItemId} style={noStock || allPlanned ? { opacity: 0.55 } : undefined}>
                            <td className="nw">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <LineStockChip stock={stockFor(it.designName)} qty={boxes} label={it.designLabel} />
                                <span className="design-name">{it.designLabel}</span>
                                {inProgress && (
                                  <span className="chip qstatus q-sent nw" style={{ fontSize: 13 }}>Palletization in progress</span>
                                )}
                              </span>
                            </td>
                            <td className="num mono dim">{fmt(it.ordered)}</td>
                            {pickSo && <td className="num mono dim">{fmt(it.produced)}</td>}
                            <td className="num mono">{fmt(it.available)}</td>
                            {pickSo && (
                              <td className="nw">
                                {!openBatches.get(it.orderItemId) && <span className="dim">—</span>}
                                {(openBatches.get(it.orderItemId) || []).map((b) => (
                                  <span key={b.batch} className="chip mono nw" style={{ fontSize: 13, marginRight: 4 }}>
                                    {b.batch} · {fmt(b.available)}
                                  </span>
                                ))}
                              </td>
                            )}
                            <td className="num">
                              {noStock ? (
                                <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap" }}>⚠ needs production</span>
                              ) : allPlanned ? (
                                <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap" }}>All {fmt(it.ordered)} already planned</span>
                              ) : (
                                <>
                                  <NumberInput
                                    value={boxesByItem[it.orderItemId] ?? ""}
                                    onChange={(e) => setBoxes(it.orderItemId, e.target.value, max)}
                                    placeholder="0"
                                    style={{ width: 110, textAlign: "right" }}
                                    title={it.ordered ? `Up to ${fmt(max)} — total across plans capped at the ordered ${fmt(it.ordered)}` : undefined}
                                  />
                                  {it.ordered > 0 && max < it.ordered && (
                                    <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2, whiteSpace: "nowrap" }}>
                                      max {fmt(max)}
                                    </div>
                                  )}
                                  {locked > 0 && (
                                    <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2, whiteSpace: "nowrap" }}>
                                      +{fmt(locked)} already palletized
                                    </div>
                                  )}
                                </>
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
                </div>
              ))}
    </>
  );

  return (
    <FormPage
      title={editing ? "Edit Palletization" : clone ? "Clone Palletization" : "New Palletization"}
      sub={initial ? (clone ? `Copy of ${initial.palNumber}` : initial.palNumber) : ""}
      busy={form.busy}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note={
        showErrors && missing ? (
          <span className="field-err">
            {saveLines.length === 0 ? "Enter Palletize Boxes for at least one item" : "Choose a pallet for every line with boxes"}
          </span>
        ) : totalBoxes > 0 ? (
          `${fmt(totalBoxes)} boxes · ${saveLines.length} line${saveLines.length > 1 ? "s" : ""} · ${[...new Set(saveLines.map((l) => l.sales_order))].length} order(s)`
        ) : (
          <span className="dim">Enter Palletize Boxes and a pallet for the items to palletize</span>
        )
      }
    >
          {loading && <div className="muted" style={{ padding: 8 }}>Loading palletizable items…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>{error}</div>
          )}
          {!loading && !error && orders.length === 0 && !initial && !pickSo && (
            <div className="muted" style={{ padding: 8 }}>No order items ready to palletize.</div>
          )}

          {!loading && (
            <>
              {planFields}
              {pickSo && selectedCustomer && (
                <input
                  type="search"
                  className="set-search"
                  style={{ marginTop: 0 }}
                  placeholder="Search orders or designs…"
                  value={designQuery}
                  onChange={(e) => setDesignQuery(e.target.value)}
                />
              )}
              {pickSo && customers.length === 0 && !error && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>No order items ready to palletize.</div>}
              {pickSo && customers.length > 0 && !selectedCustomer && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>Pick a customer.</div>}
              {pickSo && selectedCustomer && shownOrders.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>No designs match.</div>}
              {sections}
            </>
          )}
    </FormPage>
  );
}
