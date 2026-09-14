/* ============================================================
   New Loading — the modal form that starts a loading from palletised
   stock (replaces the 2026-09-10 pallet-first workspace, undone same
   week). Pick the SO (optionally narrowed by customer); the SO's saved
   containerisation plan propagates — its containers show with the
   remaining planned quantities prefilled against Ready-for-Loading
   stock — else a flat line-item list of the SO's palletised stock.
   One submit = ONE loading (one container): the LoadBox is minted with
   a load_plan snapshot, then the picked lines land via the
   all-or-nothing /pal-lines-box. Container/vehicle details are captured
   later (Confirm Load / Edit Load Details).
   With `boxId` the modal adds pallets into that Open loading instead
   (LoadingDetail's "Add Pallets") — no new LoadBox, no size field.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { CONTAINER_TYPES } from "@/features/masters/containersApi";
import { planProgress, progressChip } from "@/features/quotes/planProgress";
import { dispatchRows, dispatchedByDesign } from "./DispatchTab";
import { nextPlanContainer, useContainerPlanBySo } from "./containerPlanPrefill";
import { allocateFifo } from "./allocateFifo";
import {
  cachedPalPlans,
  createLoadBox,
  invalidatePalPlans,
  listPalPlans,
  loadableLineIds,
  setLinesBox,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const byCreated = (a: PalPlanLine, b: PalPlanLine) => a.createdTime.localeCompare(b.createdTime);

export function NewLoadingModal({
  boxId,
  boxName,
  presetSalesOrderId,
  onDone,
  onClose,
}: {
  /** Scope to an existing Open loading: skip creation, just add pallets. */
  boxId?: string;
  /** Display label of the scoped loading (header identity). */
  boxName?: string;
  /** Sales Order detail's "New Loading" (CR-175): SO fixed, pickers hidden. */
  presetSalesOrderId?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [soId, setSoId] = useState(presetSalesOrderId || "");
  const [size, setSize] = useState<string>(CONTAINER_TYPES[0]);
  // Plan view: qty per plan row ("ci:li"). Flat view: checked lines + qty per line.
  const [planQty, setPlanQty] = useState<Map<string, number>>(new Map());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [flatQty, setFlatQty] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  // User typed a plan quantity — stop the reactive prefill from clobbering it.
  const [touched, setTouched] = useState(false);
  const { planBySo, designIdOf } = useContainerPlanBySo();

  useEffect(() => {
    void listPalPlans().then((r) => {
      if (!r.ok) return;
      setPlans(r.plans);
      setBoxes(r.boxes);
    });
  }, []);

  // Palletised stock that can start loading right now (whole batch palletised).
  const readyPool = useMemo(() => {
    const all = plans.flatMap((p) => p.lines);
    const loadable = loadableLineIds(all);
    return all.filter((l) => loadable.has(l.id));
  }, [plans]);

  const customerOpts = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const l of readyPool)
      if (l.customerId && !seen.has(l.customerId)) seen.set(l.customerId, { value: l.customerId, label: l.customerName || l.customerId });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [readyPool]);

  const soOpts = useMemo(() => {
    const bySo = new Map<string, { label: string; customer: string; boxes: number }>();
    for (const l of readyPool) {
      if (customerId && l.customerId !== customerId) continue;
      const cur = bySo.get(l.salesOrderId) || { label: l.soNumber || l.salesOrderId, customer: l.customerName, boxes: 0 };
      cur.boxes += l.boxes;
      bySo.set(l.salesOrderId, cur);
    }
    return [...bySo.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([id, v]) => ({ value: id, label: v.label, hint: v.customer, badge: `${fmt(v.boxes)} boxes ready` }));
  }, [readyPool, customerId]);

  // The picked SO's ready lines (FIFO order) and per-design availability.
  const soLines = useMemo(() => readyPool.filter((l) => l.salesOrderId === soId).sort(byCreated), [readyPool, soId]);
  const availByDesign = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of soLines) m.set(l.designId, (m.get(l.designId) || 0) + l.boxes);
    return m;
  }, [soLines]);

  // SO container plan + its consumption (same derivation as the /packing hint).
  const cp = soId ? planBySo.get(soId) : undefined;
  const prog = useMemo(
    () =>
      cp
        ? planProgress(cp.plan, dispatchedByDesign(dispatchRows(plans, boxes, { kind: "so", salesOrderIds: [soId] })), designIdOf)
        : [],
    [cp, plans, boxes, soId, designIdOf],
  );

  const pickSo = (id: string) => {
    setSoId(id);
    setChecked(new Set());
    setFlatQty(new Map());
    setTouched(false);
  };

  // Plan propagation: prefill the first not-yet-sent container's lines from
  // ready stock, draining availability top-down. Reactive — reseeds from the
  // LATEST plan/stock as fetches land or the plan is edited elsewhere, until
  // the user types a quantity. Everything stays editable.
  useEffect(() => {
    if (touched) return;
    const next = new Map<string, number>();
    const slice = soId ? nextPlanContainer(soId, planBySo, plans, boxes, designIdOf) : null;
    if (slice) {
      const avail = new Map(availByDesign);
      slice.lines.forEach((ln, li) => {
        const dId = designIdOf(ln.design);
        const take = Math.min(ln.boxes, avail.get(dId) || 0);
        if (take > 0) avail.set(dId, (avail.get(dId) || 0) - take);
        next.set(`${slice.ci}:${li}`, take);
      });
    }
    setPlanQty(next);
  }, [touched, soId, planBySo, plans, boxes, availByDesign, designIdOf]);

  // Per-design totals picked in the plan view — inputs clamp against these so
  // the selection never exceeds the SO's ready stock.
  const pickedByDesign = useMemo(() => {
    const m = new Map<string, number>();
    cp?.plan.containers.forEach((c, ci) =>
      c.lines.forEach((ln, li) => {
        const q = planQty.get(`${ci}:${li}`) || 0;
        if (q > 0) {
          const dId = designIdOf(ln.design);
          m.set(dId, (m.get(dId) || 0) + q);
        }
      }),
    );
    return m;
  }, [cp, planQty, designIdOf]);

  const setPlanRow = (key: string, designId: string, v: number) => {
    setTouched(true);
    const cur = planQty.get(key) || 0;
    const othersPicked = (pickedByDesign.get(designId) || 0) - cur;
    const cap = Math.max(0, (availByDesign.get(designId) || 0) - othersPicked);
    setPlanQty((prev) => new Map(prev).set(key, Math.max(0, Math.min(cap, Math.floor(v) || 0))));
  };

  const flatQtyOf = (l: PalPlanLine) => Math.min(flatQty.get(l.id) ?? l.boxes, l.boxes);
  const totalBoxes = cp
    ? [...planQty.values()].reduce((s, n) => s + n, 0)
    : soLines.filter((l) => checked.has(l.id)).reduce((s, l) => s + flatQtyOf(l), 0);

  const buildEntries = (): Array<{ lineId: string; boxes?: number }> => {
    if (!cp) {
      return soLines
        .filter((l) => checked.has(l.id))
        .map((l) => {
          const q = flatQtyOf(l);
          return { lineId: l.id, ...(q < l.boxes ? { boxes: q } : {}) };
        });
    }
    const out: Array<{ lineId: string; boxes?: number }> = [];
    for (const [dId, want] of pickedByDesign) {
      const lines = soLines.filter((l) => l.designId === dId).map((l) => ({ id: l.id, boxes: l.boxes }));
      for (const e of allocateFifo(lines, want)) out.push(e);
    }
    return out;
  };

  // load_plan snapshot for the minted LoadBox (single slice, no group) — keeps
  // the loading's Planned rows rendering if the line assignment fails after.
  const buildLoadPlan = (): string => {
    const lines = cp
      ? cp.plan.containers.flatMap((c, ci) =>
          c.lines
            .map((ln, li) => ({ ln, q: planQty.get(`${ci}:${li}`) || 0 }))
            .filter(({ q }) => q > 0)
            .map(({ ln, q }) => ({ so: soId, design: ln.design, batch: "", boxes: q, palletId: ln.palletId })),
        )
      : soLines
          .filter((l) => checked.has(l.id))
          .map((l) => ({ so: soId, design: l.designLabel, batch: l.batchNumber, boxes: flatQtyOf(l), palletId: l.palletId }));
    return JSON.stringify({ v: 1, lines }).slice(0, 10000);
  };

  const onConfirm = async () => {
    if (busy || !soId || totalBoxes === 0) return;
    setBusy(true);
    const entries = buildEntries();
    if (boxId) {
      const res = await setLinesBox(boxId, entries);
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error || "Could not load the items");
        return;
      }
      toast.success(`${fmt(totalBoxes)} boxes added to ${boxName || "the loading"}`);
      invalidatePalPlans();
      onDone();
      onClose();
      return;
    }
    const created = await createLoadBox({ container_size: size, load_plan: buildLoadPlan() });
    if (!created.ok || !created.data?.ROWID) {
      setBusy(false);
      toast.error(created.error || "Could not create the loading");
      return;
    }
    const rowid = String(created.data.ROWID);
    const label = created.data.load_number || `Container ${created.data.box_number ?? ""}`.trim();
    const res = await setLinesBox(rowid, entries);
    setBusy(false);
    invalidatePalPlans();
    if (!res.ok) {
      // The loading exists with its plan — recoverable via Add Pallets there.
      toast.error(`${label} created but nothing loaded: ${res.error || "error"} — retry via Add Pallets on the loading`);
    } else {
      toast.success(`${fmt(totalBoxes)} boxes → ${label}`);
    }
    onDone();
    navigate(`/loading/${encodeURIComponent(rowid)}`);
  };

  const qtyInput = (value: number, max: number, disabled: boolean, onChange: (v: number) => void) => (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      disabled={disabled}
      onClick={(ev) => ev.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 90, textAlign: "right" }}
    />
  );

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{boxId ? "Add Pallets" : "New Loading"}</div>
            {boxId && boxName && <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{boxName}</div>}
            {presetSalesOrderId && (() => {
              // Record identity under the title: SO number · customer.
              const l = readyPool.find((x) => x.salesOrderId === presetSalesOrderId);
              return <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{[l?.soNumber || presetSalesOrderId, l?.customerName].filter(Boolean).join("  ·  ")}</div>;
            })()}
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-grid" style={{ gridTemplateColumns: presetSalesOrderId ? "minmax(0, 1fr)" : boxId ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))", marginBottom: 10 }}>
            {!presetSalesOrderId && (
              <>
                <label className="form-field">
                  <span className="lbl">Customer</span>
                  <Combobox
                    value={customerId}
                    options={customerOpts}
                    onChange={(v) => { setCustomerId(v); if (v && soId && !readyPool.some((l) => l.salesOrderId === soId && l.customerId === v)) pickSo(""); }}
                    placeholder="All customers"
                    ariaLabel="Customer"
                  />
                </label>
                <label className="form-field">
                  <span className="lbl">Sales Order<span className="req"> *</span></span>
                  <Combobox
                    value={soId}
                    options={soOpts}
                    onChange={pickSo}
                    placeholder="Pick a sales order…"
                    clearable={false}
                    ariaLabel="Sales Order"
                  />
                </label>
              </>
            )}
            {!boxId && (
              <label className="form-field">
                <span className="lbl">Container Size</span>
                <Combobox
                  value={size}
                  options={CONTAINER_TYPES.map((t) => ({ value: t, label: t }))}
                  onChange={setSize}
                  clearable={false}
                  ariaLabel="Container size"
                />
              </label>
            )}
          </div>

          {soId && cp && soLines.length === 0 && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "0 0 8px" }}>
              No palletised stock ready for this order — a batch loads only once it is fully palletised.
            </div>
          )}
          {soId && cp && (
            // Plan propagation: the SO's containerisation plan, container by
            // container, quantities editable against ready stock.
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 380, overflowY: "auto" }}>
              {cp.plan.containers.map((c, ci) => {
                const chip = prog[ci] ? progressChip(prog[ci]) : null;
                const sent = prog[ci]?.status === "Sent";
                return (
                  <div key={ci} style={{ opacity: sent ? 0.55 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>C{c.no}</span>
                      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{fmt(c.boxes)} boxes planned · {cp.docNo}</span>
                      {chip && <span className={chip.cls} style={{ marginLeft: "auto" }}>{chip.label}</span>}
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Design</th>
                          <th>Pallet</th>
                          <th className="num" style={{ textAlign: "right" }}>Planned</th>
                          <th className="num" style={{ textAlign: "right" }}>Ready</th>
                          <th className="num" style={{ textAlign: "right" }}>Load</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.lines.map((ln, li) => {
                          const key = `${ci}:${li}`;
                          const dId = designIdOf(ln.design);
                          const avail = availByDesign.get(dId) || 0;
                          const q = planQty.get(key) || 0;
                          return (
                            <tr key={key}>
                              <td><span className="design-name">{ln.design}</span></td>
                              <td className="dim">{ln.palletName || "—"}</td>
                              <td className="num mono">{fmt(ln.boxes)}</td>
                              <td className="num mono" style={avail === 0 ? { color: "var(--c-amber)" } : undefined}>{fmt(avail)}</td>
                              <td className="num">{qtyInput(q, avail, avail === 0 && q === 0, (v) => setPlanRow(key, dId, v))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {soId && !cp && (
            // No container plan on the SO — straight line-item selection of
            // its palletised stock.
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 380, overflowY: "auto" }}>
              {soLines.map((l) => {
                const isSel = checked.has(l.id);
                return (
                  <label
                    key={l.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
                      background: isSel ? "var(--accent-soft)" : "var(--bg)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                          return next;
                        })
                      }
                      style={{ margin: 0, flex: "0 0 auto" }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="design-name" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span> · {l.designLabel}
                      </span>
                      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {[l.batchNumber && `Batch ${l.batchNumber}`, l.palletName, `${fmt(l.boxes)} boxes ready`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {qtyInput(flatQtyOf(l), l.boxes, !isSel, (v) =>
                      setFlatQty((prev) => new Map(prev).set(l.id, Math.max(1, Math.min(l.boxes, Math.floor(v) || 1)))),
                    )}
                  </label>
                );
              })}
              {soLines.length === 0 && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>
                  No palletised stock ready for this order.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="df-foot">
          <span style={{ flex: 1, fontSize: "var(--t-sm)" }} className="dim mono">
            {totalBoxes > 0 ? `${fmt(totalBoxes)} boxes` : ""}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy || !soId || totalBoxes === 0} onClick={() => void onConfirm()}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : boxId ? `Add ${fmt(totalBoxes)} boxes` : `Create Loading · ${fmt(totalBoxes)} boxes`}
          </button>
        </div>
      </div>
    </div>
  );
}
