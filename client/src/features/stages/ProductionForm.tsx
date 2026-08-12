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
import { LineStock, useStockLookup, signalColor } from "@/features/masters/LineStock";
import { useOrders } from "@/features/orders/useOrders";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { DateInput } from "@/ui/DateInput";
import { todayISO } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { listPalletizable, type PalletizableItem } from "./palletisationApi";
import { listProductionLogs, type ProductionRequestInput } from "./productionApi";
import { InProductionModal, InProductionCell } from "./InProductionModal";
import { NumberInput } from "../../ui/NumberInput";

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
  const stockFor = useStockLookup();
  const { orders } = useOrders();
  const requestedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);

  const [mode, setMode] = useState<"order" | "independent">(presetDesignId && !presetSalesOrderId ? "independent" : "order");
  const [orderId, setOrderId] = useState(presetSalesOrderId || "");
  const [items, setItems] = useState<PalletizableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});
  // Line whose "In production" drill-down popup is open (null = closed).
  const [breakdown, setBreakdown] = useState<PalletizableItem | null>(null);

  // Independent mode — Quote/SO-style line items (Item + Request Qty).
  // ponytail: no dedupe of the same design across rows; add distinct-design guard if it ever matters.
  type IndepLine = { design: string; qty: string };
  const emptyLine = (): IndepLine => ({ design: "", qty: "1" });
  const [indepLines, setIndepLines] = useState<IndepLine[]>(
    presetDesignId ? [{ design: presetDesignId, qty: "1" }] : [emptyLine()],
  );
  const setLine = (i: number, k: keyof IndepLine, v: string) =>
    setIndepLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setIndepLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setIndepLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const [prodDate, setProdDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  // Warn (don't block) if the selected order already has a production request.
  const [alreadyInProduction, setAlreadyInProduction] = useState(false);
  useEffect(() => {
    if (mode !== "order" || !orderId) { setAlreadyInProduction(false); return; }
    let live = true;
    void listProductionLogs().then((res) => {
      if (!live) return;
      setAlreadyInProduction(
        res.ok && res.entries.some((e) => e.salesOrderId === orderId && e.status !== "Rejected"),
      );
    });
    return () => { live = false; };
  }, [mode, orderId]);

  // Per-line stock via the ONE canonical source (lib/stock designStock), keyed on
  // the plain design_name — same numbers as Item master / Reports / LineStock.
  // shortfall = what still needs producing after stock in hand AND in-production
  // already committed. produced is inside `available`, so it is counted exactly once.
  const shortfallOf = (it: PalletizableItem) => {
    const st = stockFor(it.designName);
    return Math.max(0, it.ordered - st.available - st.inProduction);
  };

  // Sales Orders with something actually left to produce. A line is covered
  // when fully produced (kept produced-based — dispatch drains st.available and
  // must not resurrect a done line) OR its Remaining = ordered − stock − in-flight
  // is 0 (same formula as shortfallOf / the Remaining column). Partially covered
  // SOs get an "N of M items left" badge.
  const soOptions = useMemo<ComboOption[]>(() => {
    type Agg = { label: string; hint?: string; total: number; open: number };
    const bySo = new Map<string, Agg>();
    for (const o of orders) {
      if (!o.salesOrderId) continue;
      if (["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(o.status || "")) continue;
      const st = stockFor(o.designName);
      const covered =
        o.producedQty >= o.orderQty ||
        Math.max(0, o.orderQty - st.available - st.inProduction) === 0;
      const a =
        bySo.get(o.salesOrderId) ??
        { label: o.orderNumber || o.poNumber || o.salesOrderId, hint: o.party || undefined, total: 0, open: 0 };
      a.total += 1;
      if (!covered) a.open += 1;
      bySo.set(o.salesOrderId, a);
    }
    return [...bySo.entries()]
      .filter(([, a]) => a.open > 0)
      .map(([value, a]) => ({
        value,
        label: a.label,
        hint: a.hint,
        badge: a.open < a.total ? `${a.open} of ${a.total} items left` : undefined,
      }));
  }, [orders, stockFor]);

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
      setItems(order?.items ?? []);
      setQtyByItem({}); // qtyByItem holds only user overrides; rows default to their shortfall inline.
    });
    return () => {
      live = false;
    };
  }, [orderId, mode]);

  const setQty = (itemId: string, raw: string, max: number) =>
    setQtyByItem((p) => ({ ...p, [itemId]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  const designOptions = useMemo<ComboOption[]>(
    () =>
      designRows.map((d) => ({
        value: d.id,
        label: d.uniqueName || d.designName,
        hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined,
      })),
    [designRows],
  );

  // Only lines with a real shortfall are requestable; each defaults to its shortfall
  // unless the user overrode it (qtyByItem holds overrides only).
  const orderLines = useMemo(
    () =>
      items
        .map((it) => {
          const short = shortfallOf(it);
          return { order_item: it.orderItemId, qty_requested: short > 0 ? qtyByItem[it.orderItemId] ?? short : 0 };
        })
        .filter((l) => l.qty_requested > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, qtyByItem, stockFor],
  );
  const indepValid = useMemo(
    () =>
      indepLines
        .map((l) => ({ design: l.design, qty_requested: parseInt(l.qty, 10) || 0 }))
        .filter((l) => l.design && l.qty_requested > 0),
    [indepLines],
  );
  const totalRequested =
    mode === "order"
      ? orderLines.reduce((s, l) => s + l.qty_requested, 0)
      : indepValid.reduce((s, l) => s + l.qty_requested, 0);
  const missing =
    mode === "order" ? !orderId || orderLines.length === 0 : indepValid.length === 0;
  const lineCount = mode === "order" ? orderLines.length : indepValid.length;

  const panelRef = useModalA11y(onClose);

  const submit = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        lines: mode === "order" ? orderLines : indepValid,
        production_date: prodDate || undefined,
        performed_by: requestedBy,
        note: note.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="factory" size={18} />
          </div>
          <div>
            <div className="ttl">Record New Production</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Details</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Requested by</span>
                {/* Auto-stamped from the signed-in user — grey = system-filled. */}
                <input value={requestedBy || "—"} readOnly tabIndex={-1} style={{ background: "var(--bg-2)", color: "var(--muted)" }} title="Auto: the signed-in user" />
              </label>
              <label className="form-field">
                <span className="lbl">Date</span>
                <DateInput value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — priority, target date, remarks…" />
              </label>
            </div>
          </div>

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

            {mode === "order" ? (
              <div className="form-grid">
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
              </div>
            ) : null}
          </div>

          {mode === "order" && orderId && alreadyInProduction && (
            <div className="form-hint" role="status" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", marginBottom: 10, borderRadius: 6, background: "var(--warn-soft, #fff7ed)", color: "var(--warn-fg, #9a3412)", fontSize: "var(--t-sm)" }}>
              <Icon name="alert" size={14} />
              <span>This order already has production requested. Add only additional quantities.</span>
            </div>
          )}

          {/* Order mode — item-wise desired qty table. Every line shows, with a
              3-state stock signal (designStock): green = covered by stock in hand,
              amber = covered by in-production, red = shortfall. Covered lines are
              read-only; only lines with a real shortfall take a Desired qty. */}
          {mode === "order" && orderId && (
            <div className="form-section">
              <div className="form-section-title">
                <span>Items to produce on this Sales Order</span>
              </div>
              {loadingItems ? (
                <div className="muted" style={{ padding: 8 }}>Loading items…</div>
              ) : items.length === 0 ? (
                <div className="muted" style={{ padding: 8 }}>No line items on this order.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }} aria-label="Status" />
                      <th>Design</th>
                      <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                      <th className="num" style={{ textAlign: "right" }}>In production</th>
                      <th className="num" style={{ textAlign: "right" }}>Stock in hand</th>
                      <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                      <th className="num" style={{ textAlign: "right", width: 120 }}>Desired qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      // One canonical source, keyed on design_name (matches every other screen).
                      const st = stockFor(it.designName);
                      const short = Math.max(0, it.ordered - st.available - st.inProduction);
                      const color = signalColor(it.ordered, st); // green covered / amber in-prod / red short
                      const covered = short === 0; // green or amber → nothing to request
                      const inProd = color === "var(--c-amber)"; // covered by in-production, not physical stock
                      return (
                        <tr key={it.orderItemId}>
                          <td>
                            <span
                              title={short > 0 ? `Needs production — ${fmt(short)} short` : inProd ? "Covered by in-production" : "In stock"}
                              style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color }}
                            />
                          </td>
                          <td><span className="design-name">{it.designLabel}</span></td>
                          <td className="num mono">{fmt(it.ordered)}</td>
                          {/* In production = this design's remaining open-production boxes across ALL
                              orders. Click → which orders, so priority can be shuffled. designStock source. */}
                          <td className="num">
                            <InProductionCell total={st.inProduction} onOpen={() => setBreakdown(it)} />
                          </td>
                          <td className="num mono" title="Available stock in hand (opening + produced − loaded)">{fmt(st.available)}</td>
                          {/* Remaining = shortfall after stock in hand AND in-production: what still
                              needs producing. ordered 10000, stock 3300, in-prod 0 → 6700. */}
                          <td className="num mono">{fmt(short)}</td>
                          <td className="num">
                            {covered ? (
                              <span className="dim" style={{ color, whiteSpace: "normal", fontSize: "var(--t-sm)" }} title={inProd ? "Covered by boxes already in production" : "Covered by available stock in hand"}>
                                {inProd ? "In production — none needed" : "In stock — none needed"}
                              </span>
                            ) : (
                              <NumberInput
                                min={0}
                                max={short}
                                value={qtyByItem[it.orderItemId] ?? short}
                                onChange={(e) => setQty(it.orderItemId, e.target.value, short)}
                                placeholder="0"
                                style={{ width: 100, textAlign: "right" }}
                              />
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

          {/* Independent mode — Quote/SO-style line items: Item + Request Qty. */}
          {mode === "independent" && (
            <div className="form-section">
              <div className="form-section-title">Items to produce</div>
              <div className="ord-lines">
                <div className="ord-line ord-line-head qt-line" style={{ gridTemplateColumns: "2fr 1fr 26px" }}>
                  <span>Item<span className="req"> *</span></span>
                  <span>Request Qty</span>
                  <span />
                </div>
                {indepLines.map((l, i) => (
                  <div className="ord-line qt-line" key={i} style={{ gridTemplateColumns: "2fr 1fr 26px" }}>
                    <div className="form-field" style={{ gap: 2 }}>
                      <Combobox
                        value={l.design}
                        options={designOptions}
                        onChange={(v) => setLine(i, "design", v)}
                        placeholder="Search an item…"
                        ariaLabel="Item"
                        invalid={showErrors && !l.design && !!l.qty}
                      />
                      {l.design && (() => {
                        const name = designRows.find((d) => d.id === l.design)?.designName;
                        return name ? <LineStock stock={stockFor(name)} qty={Number(l.qty) || 0} label={name} /> : null;
                      })()}
                    </div>
                    <NumberInput
                      min={0}
                      value={l.qty}
                      onChange={(e) => setLine(i, "qty", e.target.value)}
                      placeholder="0"
                    />
                    <button className="btn ord-rm" onClick={() => removeLine(i)} title="Remove line" disabled={indepLines.length === 1} tabIndex={-1}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 10 }} onClick={addLine}>
                <Icon name="plus" size={12} /> Add line
              </button>
              <div className="qt-totals">
                <div className="row total">
                  <span>Total production</span>
                  <span className="mono">{fmt(totalRequested)} boxes</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? (
              <span className="field-err">
                {mode === "order"
                  ? orderId
                    ? "Enter a desired qty for at least one item"
                    : "Pick a Sales Order"
                  : "Add at least one item and a request qty"}
              </span>
            ) : totalRequested > 0 ? (
              `${fmt(totalRequested)} boxes requested · ${lineCount} item${lineCount > 1 ? "s" : ""}`
            ) : (
              "* Indicates a mandatory field"
            )}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {breakdown && (() => {
        const s = stockFor(breakdown.designName);
        return <InProductionModal label={breakdown.designLabel} total={s.inProduction} orders={s.inProductionOrders} onClose={() => setBreakdown(null)} />;
      })()}
    </div>
  );
}
