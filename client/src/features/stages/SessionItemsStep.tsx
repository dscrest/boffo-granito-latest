/* ============================================================
   Loading Session · step 1 — Select items (CR-203; the pick list of
   CR-201/202, moved out of the deleted New Loading modal).
   Pick the CUSTOMER in the left rail; the right pane lists every order
   of theirs with its designs (Design · Box Brand · Batch · Ready · Load).
   One row per batch, Load typed per batch (CR-204: no summary row; both
   panels searchable and scrolling on their own). Any mix of orders/designs goes into the one
   container (one customer each). The SO's containerisation plan is a
   helper only ("Fill from plan"); partly palletised batches stay listed,
   greyed, with why. Save mints ONE LoadBox with a load_plan snapshot,
   then the picked lines land via the all-or-nothing /pal-lines-box.
   With `box` the step adds pallets into that Open loading instead
   (customer locked to the loading's). `presetSalesOrderId` = that SO only.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { Combobox } from "@/ui/Combobox";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { listMaster, type MasterRow } from "@/features/masters/mastersApi";
import { nextPlanContainer, useContainerPlanBySo } from "./containerPlanPrefill";
import { groupReady, openLines, partialNote, spreadQty, type DesignRow, type SoBand } from "./newLoadingRows";
import { SessionSheetView } from "./SessionSheetView";
import {
  boxFill,
  createLoadBox,
  invalidatePalPlans,
  setLinesBox,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const VIEW_KEY = "boffo.loadingSession.view";

export interface SessionPickProps {
  plans: PalPlan[];
  boxes: LoadBox[];
  /** Bound to an existing Open loading: skip creation, just add pallets. */
  box?: LoadBox;
  /** Sales Order detail's "New Loading" (CR-175): that SO only, no customer rail. */
  presetSalesOrderId?: string;
  /** CR-252 (LoadingSession): Customer is only a filter — blank = every customer, a container may mix customers. */
  anyCustomer?: boolean;
  onSaved: (boxId: string) => void | Promise<void>;
}

/** Selection state + Save of step 1 — shared by this step and the CR-227 PlanSheetStep. */
export function useSessionPick({ plans, boxes, box, presetSalesOrderId, anyCustomer, onSaved }: SessionPickProps) {
  const [brands, setBrands] = useState<MasterRow[]>([]);
  const [pickedCustomer, setPickedCustomer] = useState("");
  // The ONE selection state: boxes to load per PalPlanLine id.
  const [qty, setQty] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const { planBySo, designIdOf } = useContainerPlanBySo();

  useEffect(() => {
    void listMaster("Brand", ["name"]).then((r) => {
      if (r.ok) setBrands(r.rows);
    });
  }, []);
  const brandName = (id: string) => brands.find((b) => b._id === id)?.name || "";

  const allLines = useMemo(() => plans.flatMap((p) => p.lines), [plans]);
  const boxLines = useMemo(() => (box ? allLines.filter((l) => l.loadBoxId === box.id) : []), [allLines, box]);

  // Customer fixed by the entry point: the SO's, or the loading's existing lines'.
  const lockedCustomer = presetSalesOrderId
    ? allLines.find((l) => l.salesOrderId === presetSalesOrderId)?.customerId || ""
    : anyCustomer ? "" : boxLines[0]?.customerId || "";
  const showRail = !presetSalesOrderId && !lockedCustomer;

  // Rail: every customer with Ready-for-Loading stock (blocked batches included,
  // so the pane can say why nothing loads), badge = boxes loadable now.
  const customers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; ready: number }>();
    for (const band of groupReady(allLines, () => true))
      for (const row of band.designs) {
        const l = row.lines[0].line;
        if (!l.customerId) continue;
        const c = m.get(l.customerId) ?? m.set(l.customerId, { id: l.customerId, name: l.customerName || l.customerId, ready: 0 }).get(l.customerId)!;
        c.ready += row.ready;
      }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allLines]);

  const customerId = lockedCustomer || pickedCustomer || (!anyCustomer && customers.length === 1 ? customers[0].id : "");
  // CR-227 "All customers" view: every customer's ready stock in one list.
  const allBands = useMemo<SoBand[]>(() => groupReady(allLines, () => true), [allLines]);
  const bands = useMemo<SoBand[]>(
    () =>
      presetSalesOrderId
        ? groupReady(allLines, (l) => l.salesOrderId === presetSalesOrderId)
        : customerId
          ? groupReady(allLines, (l) => l.customerId === customerId)
          : anyCustomer ? allBands : [],
    [allLines, allBands, anyCustomer, customerId, presetSalesOrderId],
  );

  const pickCustomer = (id: string) => {
    setPickedCustomer(id);
    if (!anyCustomer) setQty(new Map()); // one customer per container
  };

  const merge = (m: Map<string, number>) => setQty((prev) => new Map([...prev, ...m]));
  const setLine = (l: PalPlanLine, v: number) => merge(new Map([[l.id, Math.max(0, Math.min(l.boxes, Math.floor(v) || 0))]]));
  const setDesign = (row: DesignRow, v: number, skip?: Set<string>) => merge(spreadQty(openLines(row), v, skip));

  // Plan as a helper: prefill the SO's next unsent container, FIFO per design.
  /** The SO's next unsent planned container (null = no plan / all sent) + how many the plan has. */
  const planNext = (band: SoBand) => {
    const slice = nextPlanContainer(band.salesOrderId, planBySo, plans, boxes, designIdOf);
    return slice && { ...slice, of: planBySo.get(band.salesOrderId)!.plan.containers.length };
  };
  /** Returns the lines it put boxes on, so a row-based caller can show them. */
  const fillFromPlan = (band: SoBand): { rowKey: string; lineId: string }[] => {
    const slice = planNext(band);
    if (!slice) {
      toast.error("Every planned container of this order is already sent");
      return [];
    }
    const want = new Map<string, number>();
    for (const ln of slice.lines) want.set(designIdOf(ln.design), (want.get(designIdOf(ln.design)) || 0) + ln.boxes);
    const filled: { rowKey: string; lineId: string }[] = [];
    for (const row of band.designs) {
      if (!want.has(row.designId)) continue;
      setDesign(row, want.get(row.designId)!);
      for (const [lineId, n] of spreadQty(openLines(row), want.get(row.designId)!)) if (n > 0) filled.push({ rowKey: row.key, lineId });
    }
    return filled;
  };

  // anyCustomer: picks outlive the Customer filter, so count them over every band.
  const picked = (anyCustomer ? allBands : bands).flatMap((b) => b.designs.flatMap(openLines)).filter((l) => (qty.get(l.id) || 0) > 0);
  const totalBoxes = picked.reduce((s, l) => s + qty.get(l.id)!, 0);
  const totalPallets = picked.reduce((s, l) => s + (l.boxesPerPallet > 0 ? Math.ceil(qty.get(l.id)! / l.boxesPerPallet) : 0), 0);
  // Share of a container (boxFill idiom): already loaded + picked — advisory, never blocks (CR-195).
  const loadedFill = boxFill(boxLines);
  const fill = loadedFill + picked.reduce((s, l) => (l.palletCapacity > 0 ? s + qty.get(l.id)! / l.palletCapacity : s), 0);
  const over = fill > 1.001;

  const entriesOf = () => picked.map((l) => ({ lineId: l.id, ...(qty.get(l.id)! < l.boxes ? { boxes: qty.get(l.id)! } : {}) }));
  /** load_plan snapshot of the picks — keeps Planned rows rendering if the line assignment fails. */
  const loadPlan = () =>
    JSON.stringify({
      v: 1,
      lines: picked.map((l) => ({ so: l.salesOrderId, design: l.designLabel, batch: l.batchNumber, boxes: qty.get(l.id)!, palletId: l.palletId })),
    }).slice(0, 10000);
  /** The single-page session's Save: land the picks in `boxId`. "" = ok / nothing picked. */
  const saveAdds = async (boxId: string): Promise<string> => {
    const entries = entriesOf();
    if (entries.length === 0) return "";
    const res = await setLinesBox(boxId, entries);
    invalidatePalPlans();
    if (!res.ok) return res.error || "Could not load the items";
    setQty(new Map());
    return "";
  };

  const onSave = async () => {
    if (busy) return;
    const entries = entriesOf();
    if (box) {
      if (entries.length === 0) {
        // nothing to add — straight to step 2
        setBusy(true);
        await onSaved(box.id);
        setBusy(false);
        return;
      }
      setBusy(true);
      const res = await setLinesBox(box.id, entries);
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error || "Could not load the items");
        return;
      }
      toast.success(`${fmt(totalBoxes)} boxes added`);
      invalidatePalPlans();
      // Stay busy until the parent has reloaded and moved on (no second Save).
      setBusy(true);
      await onSaved(box.id);
      setBusy(false);
      return;
    }
    if (totalBoxes === 0) return;
    setBusy(true);
    const load_plan = loadPlan();
    const created = await createLoadBox({ load_plan });
    if (!created.ok || !created.data?.ROWID) {
      setBusy(false);
      toast.error(created.error || "Could not create the loading");
      return;
    }
    const rowid = String(created.data.ROWID);
    const label = created.data.load_number || `Container ${created.data.box_number ?? ""}`.trim();
    const res = await setLinesBox(rowid, entries);
    invalidatePalPlans();
    if (!res.ok) {
      // The loading exists with its plan — recoverable from step 1 of its session.
      toast.error(`${label} created but nothing loaded: ${res.error || "error"} — pick the items again`);
    } else {
      toast.success(`${fmt(totalBoxes)} boxes → ${label}`);
    }
    // Stay busy until the parent has reloaded and moved on — a second Save
    // here would mint a second container.
    await onSaved(rowid);
    setBusy(false);
  };

  return {
    brandName, customers, customerId, showRail, pickCustomer, bands, allBands, qty, setLine, setDesign, fillFromPlan, planNext,
    planBySo, boxLines, picked, totalBoxes, totalPallets, fill, over, busy, onSave, saveAdds, loadPlan,
  };
}

/** Render-only since the single-page session: the page owns the hook and the one Save. */
export function SessionItemsStep({ pick, presetSalesOrderId }: { pick: ReturnType<typeof useSessionPick>; presetSalesOrderId?: string }) {
  const { brandName, customers, customerId, showRail, bands, qty, setLine, setDesign, fillFromPlan, planBySo, fill, over } = pick;
  const [custQuery, setCustQuery] = useState("");
  const [designQuery, setDesignQuery] = useState("");
  // Customer rail or one flat sheet — the user's own preference, kept per browser.
  const [view, setView] = useState<"customer" | "sheet">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "sheet" ? "sheet" : "customer";
    } catch {
      return "customer";
    }
  });
  const pickView = (v: "customer" | "sheet") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* blocked storage — the toggle still works for this visit */
    }
  };
  const pickCustomer = (id: string) => {
    pick.pickCustomer(id);
    setDesignQuery("");
  };

  const qtyInput = (value: number, disabled: boolean, onChange: (v: number) => void, label: string) => (
    <NumberInput
      maxDecimals={0}
      value={value || ""}
      placeholder="0"
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 90, textAlign: "right" }}
    />
  );

  // Search narrows what is SHOWN only — picked/totals/save read the full `bands`,
  // so a quantity typed before searching is never dropped.
  const dq = designQuery.trim().toLowerCase();
  const shownBands = !dq
    ? bands
    : bands
        .map((b) => (b.soNumber.toLowerCase().includes(dq) ? b : { ...b, designs: b.designs.filter((r) => r.designLabel.toLowerCase().includes(dq)) }))
        .filter((b) => b.designs.length > 0);
  const cq = custQuery.trim().toLowerCase();
  const shownCustomers = cq ? customers.filter((c) => c.name.toLowerCase().includes(cq)) : customers;

  const head = bands[0]?.designs[0]?.lines[0]?.line;
  const readyAll = bands.reduce((n, b) => n + b.designs.reduce((m, r) => m + r.ready, 0), 0);

  const fillMeter = (
    <div style={{ width: 260, flexShrink: 0 }} title="Share of a full container — advisory, never blocks">
      <div style={{ display: "flex", fontSize: "var(--t-sm)", marginBottom: 5 }}>
        <span className="dim">Container fill</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 600, color: over ? "var(--c-red)" : undefined }}>
          {Math.round(fill * 100)}%{over ? " — over capacity" : ""}
        </span>
      </div>
      <div className="bar tall">
        <i style={{ width: `${Math.min(100, fill * 100)}%`, background: over ? "var(--c-red)" : undefined }} />
      </div>
    </div>
  );
  const emptyNote = customerId || presetSalesOrderId ? `No palletized stock ready for this ${presetSalesOrderId ? "order" : "customer"}.` : "Pick a customer.";

  // Sheet view: the customer on top, then every order of theirs in one grid.
  const sheet = (
    <div className="card session-fill" style={{ display: "flex", flexDirection: "column", overflow: "hidden", padding: "14px 16px", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ flex: "1 1 260px", maxWidth: 360 }}>
          {showRail ? (
            <Combobox
              value={customerId}
              options={customers.map((c) => ({ value: c.id, label: c.name, badge: `${fmt(c.ready)} bx ready` }))}
              onChange={pickCustomer}
              placeholder="Customer…"
              ariaLabel="Customer"
              clearable={false}
            />
          ) : (
            <div style={{ fontWeight: 700, fontSize: "var(--t-2xl)" }} className="clip">{head?.customerName || "—"}</div>
          )}
        </div>
        {bands.length > 0 && (
          <input
            type="search"
            className="set-search"
            style={{ margin: 0, flex: "1 1 200px", maxWidth: 280 }}
            placeholder="Search designs…"
            value={designQuery}
            onChange={(e) => setDesignQuery(e.target.value)}
          />
        )}
        {bands.length > 0 && <span className="dim nw" style={{ fontSize: "var(--t-sm)" }}>{bands.length} order{bands.length === 1 ? "" : "s"} · <span className="mono">{fmt(readyAll)}</span> boxes ready</span>}
        <span style={{ flex: 1 }} />
        {bands.length > 0 && fillMeter}
      </div>
      <div className="pane-scroll" style={{ overflowX: "auto" }}>
        {shownBands.length > 0 ? (
          <SessionSheetView
            bands={shownBands}
            qty={qty}
            brandName={brandName}
            hasPlan={(so) => planBySo.has(so)}
            onFillFromPlan={fillFromPlan}
            onSetDesign={setDesign}
            qtyCell={(l, label) => qtyInput(qty.get(l.id) || 0, false, (v) => setLine(l, v), label)}
          />
        ) : (
          <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>{bands.length > 0 ? "No designs match." : emptyNote}</div>
        )}
      </div>
    </div>
  );

  const pane = (
    <>
      {bands.length > 0 && (
        <div className="set-pane-head" style={{ alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "var(--t-2xl)" }} className="clip">{head?.customerName || "—"}</div>
            <div className="sub">
              {bands.length} order{bands.length === 1 ? "" : "s"} · <span className="mono">{fmt(readyAll)}</span> boxes ready
            </div>
          </div>
          {fillMeter}
        </div>
      )}
      {bands.length > 0 && (
        <input
          type="search"
          className="set-search"
          style={{ marginTop: 0 }}
          placeholder="Search designs…"
          value={designQuery}
          onChange={(e) => setDesignQuery(e.target.value)}
        />
      )}
      <div className="pane-scroll" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shownBands.map((band) => (
          <div key={band.salesOrderId}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, marginBottom: 4, background: "var(--accent-soft)", color: "var(--accent-ink)", fontWeight: 700 }}>
              <span className="mono">{band.soNumber}</span>
              <span className="mono" style={{ fontWeight: 400 }}>{fmt(band.designs.reduce((n, r) => n + r.ready, 0))} bx ready</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                {planBySo.has(band.salesOrderId) && (
                  <button className="btn" onClick={() => fillFromPlan(band)} title={`Prefill from ${planBySo.get(band.salesOrderId)!.docNo}`}>
                    Fill from plan
                  </button>
                )}
                {band.designs.some((r) => r.ready > 0) && (
                  <button className="btn" onClick={() => band.designs.forEach((r) => setDesign(r, r.ready))} title="Take every ready box of this order">
                    Load all ready
                  </button>
                )}
              </span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Box Brand</th>
                  <th>Batch</th>
                  <th className="num" style={{ textAlign: "right" }}>Ready</th>
                  <th className="num" style={{ textAlign: "right" }}>Load</th>
                </tr>
              </thead>
              <tbody>
                {band.designs.map((row) =>
                    // One row per batch; the first carries the Design + Box Brand (CR-204).
                    row.lines.map(({ line: l, partial }, i) => (
                      <tr key={l.id} style={(qty.get(l.id) || 0) > 0 ? { background: "var(--accent-soft)" } : undefined}>
                        <td>{i === 0 && <span className="design-name">{row.designLabel}</span>}</td>
                        <td className="nw">{i === 0 && (brandName(row.brandId) || "—")}</td>
                        <td className="nw">
                          <span className="mono">{l.batchNumber || "—"}</span>
                          {l.palletName && <span className="dim"> · {l.palletName}</span>}
                        </td>
                        {(
                          <>
                            <td className="num mono" title={partial ? partialNote(partial) : undefined}>{fmt(l.boxes)}{partial && <span className="dim"> / {fmt(partial.total)}</span>}</td>
                            <td className="num">{qtyInput(qty.get(l.id) || 0, false, (v) => setLine(l, v), `Boxes to load, ${row.designLabel} batch ${l.batchNumber || "—"}`)}</td>
                          </>
                        )}
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        ))}
        {bands.length > 0 && shownBands.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>No designs match.</div>}
        {bands.length === 0 && (
          <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 0" }}>
            {emptyNote}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, flexShrink: 0 }}>
        <div className="seg" role="group" aria-label="View">
          <button className={`seg-btn ${view === "customer" ? "active" : ""}`} onClick={() => pickView("customer")}>Customer view</button>
          <button className={`seg-btn ${view === "sheet" ? "active" : ""}`} onClick={() => pickView("sheet")}>Sheet view</button>
        </div>
      </div>
      {view === "sheet" ? sheet : showRail ? (
        // Same rail + pane skin as the Settings workspace.
        <div className="set-wrap session-fill">
          <aside className="set-rail">
            <input
              type="search"
              className="set-search"
              style={{ marginTop: 0 }}
              placeholder="Search customers…"
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
            />
            <div className="set-groups">
              {shownCustomers.map((c) => (
                <button key={c.id} className={`set-group ${c.id === customerId ? "active" : ""}`} onClick={() => pickCustomer(c.id)}>
                  <span className="clip">{c.name}</span>
                  <span className="mono dim" style={{ flex: "0 0 auto" }}>{fmt(c.ready)}</span>
                </button>
              ))}
              {customers.length > 0 && shownCustomers.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>No customers match.</div>}
              {customers.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>No stock is ready for loading.</div>}
            </div>
          </aside>
          <section className="set-pane">{pane}</section>
        </div>
      ) : (
        <div className="card" style={{ padding: "22px 24px" }}>{pane}</div>
      )}

    </>
  );
}
