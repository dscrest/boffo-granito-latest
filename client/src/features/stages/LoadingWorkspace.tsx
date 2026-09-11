/* ============================================================
   Loading Workspace (/loading, default view) — SO-centric loading
   planner from the 2026-09-11 "Loading Sheet" design: pick Customer +
   Sales Order, then work three tabs.
   · Items — the SO's items split into "Ready for loading" (multi-select
     → Assign to Loading) and "In palletisation" (read-only progress,
     shortcut to /packing).
   · Container plan — the SO's LoadBoxes as cards: fill bar, pallet
     lines (whole-line Move between containers — lines are physical
     pallets, quantities split only at assign time via FIFO), unplanned
     balance strip, Add container.
   · Loading sheet — the Excel-style Customer Sheet scoped to the SO
     (LoadingCustomerSheet, unchanged columns).
   Structure/UX from the design; skin is the house one. Direct loading
   (no SO) and palletise-here were deliberately left out.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState } from "@/ui/States";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { usePersistedState } from "@/lib/usePersistedState";
import { parseLoadPlan, type Order } from "@/data";
import { CONTAINER_TYPES } from "@/features/masters/containersApi";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { listVehicles, type VehicleRow } from "@/features/masters/vehiclesApi";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import { allocateFifo } from "./allocateFifo";
import { LoadingCustomerSheet } from "./LoadingCustomerSheet";
import {
  boxFill,
  boxLabel,
  createLoadBox,
  deleteLoadBox,
  invalidatePalPlans,
  sealed,
  setLineBox,
  setLinesBox,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const byCreated = (a: PalPlanLine, b: PalPlanLine) => a.createdTime.localeCompare(b.createdTime);

/** One SO item with its palletisation/loading tallies. */
type ItemRow = {
  o: Order;
  coverage: number; // sqm per box (0 = unknown design)
  readyLines: PalPlanLine[]; // ReadyToLoad, un-boxed, FIFO
  ready: number; // boxes ready to load
  planned: number; // boxes already in containers
  balance: number; // ordered − planned
  where: Array<{ box: LoadBox; boxes: number }>;
};

const balColor = (bal: number) => (bal === 0 ? "var(--ok)" : bal < 0 ? "var(--danger)" : "var(--c-amber)");

export function LoadingWorkspace({
  plans,
  boxes,
  sheetRows,
  canEdit,
  onChanged,
}: {
  plans: PalPlan[];
  boxes: LoadBox[];
  sheetRows: Array<{ l: PalPlanLine; box?: LoadBox }>;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [customer, setCustomer] = usePersistedState("loading.ws.customer", "");
  const [soId, setSoId] = usePersistedState("loading.ws.so", "");
  const [tab, setTab] = usePersistedState<"items" | "plan" | "sheet">("loading.ws.tab", "items");
  const [sel, setSel] = useState<Set<string>>(new Set()); // selected order-item ids (ready table)
  const [target, setTarget] = useState(""); // "" = new container
  const [assign, setAssign] = useState<{ items: ItemRow[]; box: LoadBox | null } | null>(null);
  const [addSize, setAddSize] = useState<string>(CONTAINER_TYPES[0]);
  const [busy, setBusy] = useState(false);

  // Orders + designs (both cached list fetches; sqm rides on the design).
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  useEffect(() => {
    void listOrders().then((r) => { if (r.ok) setOrders(r.orders); });
    void listDesigns().then((r) => { if (r.ok) setDesigns(r.designs); });
  }, []);
  const { designIdOf } = useContainerPlanBySo();
  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);

  // ---- pickers ------------------------------------------------
  const soOrders = useMemo(() => orders.filter((o) => o.salesOrderId), [orders]);
  const customerOpts = useMemo(
    () =>
      [...new Set(soOrders.map((o) => o.party).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .map((p) => ({ value: p, label: p })),
    [soOrders],
  );
  const soOpts = useMemo(() => {
    const bySo = new Map<string, { label: string; party: string; date: string }>();
    for (const o of soOrders) {
      if (customer && o.party !== customer) continue;
      if (!bySo.has(o.salesOrderId!))
        bySo.set(o.salesOrderId!, { label: o.orderNumber || o.poNumber || o.salesOrderId!, party: o.party, date: o.orderDate });
    }
    return [...bySo.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0])) // newest first (house default)
      .map(([id, v]) => ({ value: id, label: v.label, hint: [v.party, v.date].filter(Boolean).join(" · ") }));
  }, [soOrders, customer]);

  // ---- per-item derivation -----------------------------------
  const allLines = useMemo(() => plans.flatMap((p) => p.lines), [plans]);
  const boxById = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const soLines = useMemo(() => allLines.filter((l) => l.salesOrderId === soId), [allLines, soId]);
  const soItemRows = useMemo(() => (soId ? soOrders.filter((o) => o.salesOrderId === soId) : []), [soOrders, soId]);

  const items: ItemRow[] = useMemo(() => {
    const byOi = new Map<string, PalPlanLine[]>();
    for (const l of soLines) byOi.set(l.orderItemId, [...(byOi.get(l.orderItemId) ?? []), l]);
    return soItemRows.map((o) => {
      const lines = byOi.get(o.id) ?? [];
      const readyLines = lines.filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId).sort(byCreated);
      const planned = lines.filter((l) => l.loadBoxId).reduce((s, l) => s + l.boxes, 0);
      const ready = readyLines.reduce((s, l) => s + l.boxes, 0);
      const whereMap = new Map<string, number>();
      for (const l of lines) if (l.loadBoxId) whereMap.set(l.loadBoxId, (whereMap.get(l.loadBoxId) || 0) + l.boxes);
      const where = [...whereMap.entries()].flatMap(([id, n]) => {
        const b = boxById.get(id);
        return b ? [{ box: b, boxes: n }] : [];
      });
      return {
        o,
        coverage: designById.get(designIdOf(o.design))?.coverageSqm || 0,
        readyLines,
        ready,
        planned,
        balance: o.orderQty - planned,
        where,
      };
    });
  }, [soItemRows, soLines, boxById, designById, designIdOf]);

  const readyItems = items.filter((i) => i.ready > 0 || i.planned > 0);
  const wipItems = items.filter((i) => i.o.orderQty > i.o.palletizedQty);
  const unplanned = items.filter((i) => i.ready > 0);

  // ---- SO totals (summary strip) ------------------------------
  const tOrd = items.reduce((s, i) => s + i.o.orderQty, 0);
  const tOrdSqm = items.reduce((s, i) => s + i.o.orderQty * i.coverage, 0);
  const tPlan = items.reduce((s, i) => s + i.planned, 0);
  const tPal = items.reduce((s, i) => s + i.o.palletizedQty, 0);
  const soHead = soItemRows[0];

  // ---- the SO's containers ------------------------------------
  const soBoxes = useMemo(() => {
    const withLines = new Set(soLines.filter((l) => l.loadBoxId).map((l) => l.loadBoxId));
    return boxes
      .filter(
        (b) =>
          withLines.has(b.id) ||
          (b.status === "Open" && (parseLoadPlan(b.loadPlan)?.lines ?? []).some((x) => x.so === soId)),
      )
      .sort((a, b) => boxLabel(a).localeCompare(boxLabel(b)));
  }, [boxes, soLines, soId]);
  const linesOfBox = (boxId: string) => allLines.filter((l) => l.loadBoxId === boxId);
  const openSoBoxes = soBoxes.filter((b) => b.status === "Open");
  const containerOpts = openSoBoxes.map((b) => ({
    value: b.id,
    label: `${boxLabel(b)}${b.containerSize ? ` · ${b.containerSize}` : ""} · ${fmt(linesOfBox(b.id).reduce((s, l) => s + l.boxes, 0))} bx`,
  }));

  // ---- mutations (sequential + refresh, house pattern) --------
  const after = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    onChanged();
  };

  const moveLine = async (l: PalPlanLine, v: string) => {
    if (busy || !v) return;
    setBusy(true);
    let toBox = v;
    if (v === "__new") {
      const created = await createLoadBox({ container_size: addSize });
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        toast.error(created.error || "Could not create the container");
        return;
      }
      toBox = String(created.data.ROWID);
    }
    const res = v === "__out" ? await setLineBox(l.id, "") : await setLineBox(l.id, toBox);
    setBusy(false);
    after(
      res.ok,
      res.error || "Could not move the pallet",
      v === "__out" ? `${l.itemCode} back to Ready for Loading` : `${l.itemCode} moved`,
    );
  };

  // Unplanned strip: load an item's whole ready balance into a container.
  const addItemTo = async (it: ItemRow, v: string) => {
    if (busy || !v) return;
    setBusy(true);
    const entries = allocateFifo(it.readyLines.map((l) => ({ id: l.id, boxes: l.boxes })), it.ready);
    let toBox = v;
    let label = "";
    if (v === "__new") {
      const created = await createLoadBox({ container_size: addSize });
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        toast.error(created.error || "Could not create the container");
        return;
      }
      toBox = String(created.data.ROWID);
      label = created.data.load_number || "the new container";
    } else {
      const b = boxById.get(v);
      label = b ? boxLabel(b) : "the container";
    }
    const res = await setLinesBox(toBox, entries);
    setBusy(false);
    after(res.ok, res.error || "Could not load the items", `${fmt(it.ready)} boxes → ${label}`);
  };

  const addContainer = async () => {
    if (busy) return;
    setBusy(true);
    const res = await createLoadBox({ container_size: addSize });
    setBusy(false);
    after(res.ok, res.error || "Could not create the container", `${res.data?.load_number || "Container"} created`);
  };

  const removeBox = async (b: LoadBox) => {
    if (busy) return;
    if (!(await confirmDialog({ title: "Delete loading", message: `Delete ${boxLabel(b)}?`, danger: true }))) return;
    setBusy(true);
    const res = await deleteLoadBox(b.id);
    setBusy(false);
    after(res.ok, res.error || "Could not delete the loading", `${boxLabel(b)} deleted`);
  };

  const openAssign = (box: LoadBox | null) => {
    const picked = items.filter((i) => sel.has(i.o.id) && i.ready > 0);
    if (picked.length === 0) return;
    setAssign({ items: picked, box });
  };

  // ---- small render helpers -----------------------------------
  const itemCell = (i: ItemRow) => (
    <div style={{ lineHeight: 1.25 }}>
      <span className="design-name" style={{ fontWeight: 600 }}>{i.o.design}</span>
      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
        {[i.o.size, i.o.finish, i.coverage ? `${i.coverage} sqm/box` : ""].filter(Boolean).join(" · ")}
      </div>
    </div>
  );

  const boxChip = (b: LoadBox, hasLines: boolean) => {
    const [label, cls] =
      b.status !== "Open"
        ? ["Dispatched", "p-completed"]
        : sealed(b)
          ? ["Ready for Dispatch", "p-palletized"]
          : hasLines
            ? ["In Loading", "p-loading"]
            : ["Planned", "p-planning"];
    return <span className={`chip palstatus ${cls}`}>{label}</span>;
  };

  const num = (v: number) => <span className="mono">{fmt(v)}</span>;

  // ---- render -------------------------------------------------
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Pickers + SO summary strip */}
      <div className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240 }}>
            <Combobox
              value={customer}
              options={customerOpts}
              onChange={(v) => { setCustomer(v); if (soHead && soHead.party !== v) { setSoId(""); setSel(new Set()); } }}
              placeholder="All customers"
              ariaLabel="Customer"
            />
          </div>
          <div style={{ minWidth: 300 }}>
            <Combobox
              value={soId}
              options={soOpts}
              onChange={(v) => { setSoId(v); setSel(new Set()); setTarget(""); }}
              placeholder="Pick a sales order…"
              ariaLabel="Sales Order"
            />
          </div>
          {(customer || soId) && (
            <button className="btn" onClick={() => { setCustomer(""); setSoId(""); setSel(new Set()); setTarget(""); }}>
              Clear filters
            </button>
          )}
          <div style={{ flex: 1 }} />
          {soId && (
            <span className="dim" style={{ fontSize: "var(--t-sm)", display: "flex", gap: 14, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
              {soHead?.portOfDischarge && <span>{soHead.portOfDischarge}</span>}
              <span>Ordered <b style={{ color: "var(--fg)" }}>{fmt(tOrd)}</b> bx{tOrdSqm > 0 ? ` · ${fmt(Math.round(tOrdSqm))} sqm` : ""}</span>
              <span>Planned <b style={{ color: "var(--fg)" }}>{fmt(tPlan)}</b> bx{tOrd > 0 ? ` · ${Math.round((tPlan / tOrd) * 100)}%` : ""}</span>
              <span>Palletised <b style={{ color: "var(--fg)" }}>{fmt(tPal)}</b> bx</span>
              <span>Balance <b style={{ color: balColor(tOrd - tPlan) }}>{fmt(tOrd - tPlan)}</b> bx</span>
            </span>
          )}
        </div>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <span className={`tab${tab === "items" ? " active" : ""}`} onClick={() => setTab("items")}>Items</span>
          <span className={`tab${tab === "plan" ? " active" : ""}`} onClick={() => setTab("plan")}>
            Container Plan{soId ? ` · ${soBoxes.length}` : ""}
          </span>
          <span className={`tab${tab === "sheet" ? " active" : ""}`} onClick={() => setTab("sheet")}>Loading Sheet</span>
        </div>
      </div>

      {!soId ? (
        <div className="card">
          <EmptyState title="Pick a sales order" hint="The workspace shows its items, container plan and loading sheet" />
        </div>
      ) : tab === "sheet" ? (
        <LoadingCustomerSheet rows={sheetRows} canEdit={canEdit} onSaved={onChanged} soFilter={soId} />
      ) : tab === "plan" ? (
        <>
          {unplanned.length > 0 && (
            <div className="card" style={{ padding: "10px 12px", borderColor: "var(--c-amber)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: "var(--c-amber)" }}>Ready, not in any container</span>
                <span className="dim mono" style={{ fontSize: "var(--t-sm)" }}>
                  {fmt(unplanned.reduce((s, i) => s + i.ready, 0))} boxes
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {unplanned.map((i) => (
                  <span key={i.o.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 4px 4px 10px" }}>
                    <span className="design-name" style={{ fontWeight: 600 }}>{i.o.design}</span>
                    <span className="dim mono">{fmt(i.ready)} bx</span>
                    {canEdit && (
                      <select value="" disabled={busy} onChange={(e) => void addItemTo(i, e.target.value)} style={{ height: 24, fontSize: "var(--t-sm)" }}>
                        <option value="">Add to…</option>
                        {containerOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        <option value="__new">New container</option>
                      </select>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 12, alignItems: "start" }}>
            {soBoxes.map((b) => {
              const inBox = linesOfBox(b.id);
              const fill = boxFill(inBox);
              const totBoxes = inBox.reduce((s, l) => s + l.boxes, 0);
              const editable = canEdit && b.status === "Open";
              return (
                <div key={b.id} className="card" style={{ padding: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                    <div style={{ lineHeight: 1.25 }}>
                      <button
                        type="button"
                        className="linkish mono"
                        style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer" }}
                        onClick={() => navigate(`/loading/${encodeURIComponent(b.id)}`)}
                        title={`Open ${boxLabel(b)}`}
                      >
                        {boxLabel(b)}
                      </button>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {[b.containerSize, b.containerNumber, [b.vehicleNumber, b.driverName].filter(Boolean).join(" · ") || "Vehicle not assigned"]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    {boxChip(b, inBox.length > 0)}
                    {editable && inBox.length === 0 && (
                      <button className="btn x" title="Delete loading" disabled={busy} onClick={() => void removeBox(b)}>✕</button>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: "var(--t-sm)" }}>
                    <div style={{ flex: 1, height: 6, background: "var(--accent-soft)", borderRadius: 3 }}>
                      <div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, Math.round(fill * 100))}%`, background: fill > 1.001 ? "var(--danger)" : "var(--accent)" }} />
                    </div>
                    <span className="mono" style={{ color: fill > 1.001 ? "var(--danger)" : "var(--fg)", fontWeight: 600 }}>{Math.round(fill * 100)}%</span>
                    <span className="dim mono">{fmt(totBoxes)} bx</span>
                  </div>
                  <div style={{ overflow: "auto" }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Batch</th>
                          <th style={{ textAlign: "right" }}>Boxes</th>
                          <th>Pallet</th>
                          {editable && <th style={{ width: 110 }} aria-label="Move" />}
                        </tr>
                      </thead>
                      <tbody>
                        {inBox.length === 0 && (
                          <tr><td colSpan={editable ? 5 : 4} className="dim" style={{ textAlign: "center", padding: 16 }}>
                            Empty — assign items from the Items tab or the strip above.
                          </td></tr>
                        )}
                        {inBox.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>{" "}
                              <span className="clip" style={{ maxWidth: 160 }} title={l.designLabel}>{l.designLabel}</span>
                              {l.salesOrderId !== soId && (
                                <span className="dim" style={{ fontSize: "var(--t-sm)", marginLeft: 6 }} title="Belongs to another sales order in this container">{l.soNumber}</span>
                              )}
                            </td>
                            <td className="nw mono">{l.batchNumber || "—"}</td>
                            <td className="mono" style={{ textAlign: "right" }}>{fmt(l.boxes)}</td>
                            <td className="nw dim">{l.palletName || "—"}</td>
                            {editable && (
                              <td onClick={(ev) => ev.stopPropagation()}>
                                <select value="" disabled={busy} onChange={(e) => void moveLine(l, e.target.value)} style={{ width: "100%", fontSize: "var(--t-sm)" }}>
                                  <option value="">Move…</option>
                                  {containerOpts.filter((o) => o.value !== b.id).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  <option value="__new">New container</option>
                                  <option value="__out">Remove from container</option>
                                </select>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {canEdit && (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 8, minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 16 }}>
                <span className="dim" style={{ fontWeight: 600 }}>Add container</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={addSize} onChange={(e) => setAddSize(e.target.value)}>
                    {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button className="hbtn" disabled={busy} onClick={() => void addContainer()}>
                    <Icon name="plus" size={13} /> Add
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ---- Items tab ---- */
        <>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>Ready for Loading</span>
              <span className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{readyItems.length} item{readyItems.length === 1 ? "" : "s"}</span>
              <div style={{ flex: 1 }} />
              {canEdit && (
                <>
                  {sel.size > 0 && <span className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{sel.size} selected</span>}
                  <div style={{ minWidth: 220 }}>
                    <Combobox
                      value={target}
                      options={containerOpts}
                      onChange={setTarget}
                      placeholder="New container…"
                      ariaLabel="Target container"
                    />
                  </div>
                  <button
                    className="hbtn primary"
                    style={{ height: 26, padding: "0 10px" }}
                    disabled={busy || sel.size === 0}
                    onClick={() => openAssign(target ? boxById.get(target) ?? null : null)}
                  >
                    Assign to Loading <Icon name="arrow-r" size={13} />
                  </button>
                </>
              )}
            </div>
            <div style={{ overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    {canEdit && (
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          checked={readyItems.length > 0 && readyItems.every((i) => sel.has(i.o.id))}
                          onChange={() =>
                            setSel(readyItems.every((i) => sel.has(i.o.id)) ? new Set() : new Set(readyItems.map((i) => i.o.id)))
                          }
                          style={{ margin: 0 }}
                          aria-label="Select all"
                        />
                      </th>
                    )}
                    <th>Item</th>
                    <th style={{ textAlign: "right" }}>Ordered</th>
                    <th style={{ textAlign: "right" }}>sqm</th>
                    <th style={{ textAlign: "right" }}>Ready</th>
                    <th style={{ textAlign: "right" }}>Planned</th>
                    <th style={{ textAlign: "right" }}>Balance</th>
                    <th>In Containers</th>
                  </tr>
                </thead>
                <tbody>
                  {readyItems.length === 0 && (
                    <tr><td colSpan={canEdit ? 8 : 7}>
                      <EmptyState title="Nothing palletised yet" hint="Items land here once palletisation marks them Ready for Loading" />
                    </td></tr>
                  )}
                  {readyItems.map((i) => {
                    const checked = sel.has(i.o.id);
                    return (
                      <tr
                        key={i.o.id}
                        onClick={canEdit ? () => setSel((p) => { const n = new Set(p); n.has(i.o.id) ? n.delete(i.o.id) : n.add(i.o.id); return n; }) : undefined}
                        style={{ cursor: canEdit ? "pointer" : undefined, background: checked ? "var(--accent-soft)" : undefined }}
                      >
                        {canEdit && (
                          <td onClick={(ev) => ev.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setSel((p) => { const n = new Set(p); n.has(i.o.id) ? n.delete(i.o.id) : n.add(i.o.id); return n; })}
                              style={{ margin: 0 }}
                              aria-label={`Select ${i.o.design}`}
                            />
                          </td>
                        )}
                        <td>{itemCell(i)}</td>
                        <td style={{ textAlign: "right" }}>{num(i.o.orderQty)}</td>
                        <td className="dim" style={{ textAlign: "right" }}>{i.coverage ? fmt(Math.round(i.o.orderQty * i.coverage)) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{num(i.ready)}</td>
                        <td style={{ textAlign: "right" }}>{num(i.planned)}</td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: balColor(i.balance) }}>{fmt(i.balance)}</td>
                        <td className="dim" style={{ fontSize: "var(--t-sm)" }}>
                          {i.where.length ? i.where.map((w) => `${boxLabel(w.box)} · ${fmt(w.boxes)}`).join(", ") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600 }}>In Palletisation</span>
              <span className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{wipItems.length} item{wipItems.length === 1 ? "" : "s"}</span>
              <div style={{ flex: 1 }} />
              {canEdit && wipItems.length > 0 && (
                <button className="hbtn" style={{ height: 26, padding: "0 10px" }} onClick={() => navigate("/packing")} title="Palletise on the Palletization board">
                  Palletise <Icon name="arrow-r" size={13} />
                </button>
              )}
            </div>
            <div style={{ overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ textAlign: "right" }}>Ordered</th>
                    <th style={{ textAlign: "right" }}>Palletised</th>
                    <th style={{ minWidth: 220 }}>Progress</th>
                    <th>Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {wipItems.length === 0 && (
                    <tr><td colSpan={5} className="dim" style={{ textAlign: "center", padding: 16 }}>
                      All items on this order are palletised.
                    </td></tr>
                  )}
                  {wipItems.map((i) => {
                    const pct = i.o.orderQty > 0 ? Math.round((i.o.palletizedQty / i.o.orderQty) * 100) : 0;
                    const batches = [...new Set(soLines.filter((l) => l.orderItemId === i.o.id).map((l) => l.batchNumber).filter(Boolean))];
                    return (
                      <tr key={i.o.id}>
                        <td>{itemCell(i)}</td>
                        <td style={{ textAlign: "right" }}>{num(i.o.orderQty)}</td>
                        <td style={{ textAlign: "right" }}>{num(i.o.palletizedQty)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: "var(--accent-soft)", borderRadius: 3 }}>
                              <div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, pct)}%`, background: "var(--c-amber)" }} />
                            </div>
                            <span className="dim mono" style={{ fontSize: "var(--t-sm)", width: 90, textAlign: "right" }}>
                              {pct > 0 ? `${pct}%` : "Not started"}
                            </span>
                          </div>
                        </td>
                        <td className="nw mono dim">{batches.join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {assign && (
        <AssignLoadingModal
          soId={soId}
          items={assign.items}
          box={assign.box}
          existingFill={assign.box ? boxFill(linesOfBox(assign.box.id)) : 0}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            setSel(new Set());
            setTarget("");
            setTab("plan");
            invalidatePalPlans();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Assign to Loading — the selected ready items land in ONE container
   (existing or minted here) with the loading capture taken up front.
   Every field except quantities can also be filled later (Confirm
   Load), so nothing here is required.
   ============================================================ */
function AssignLoadingModal({
  soId,
  items,
  box,
  existingFill,
  onClose,
  onDone,
}: {
  soId: string;
  items: ItemRow[];
  box: LoadBox | null;
  existingFill: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [qty, setQty] = useState<Map<string, number>>(
    () => new Map(items.map((i) => [i.o.id, Math.max(0, Math.min(i.ready, i.balance > 0 ? i.balance : i.ready))])),
  );
  const [size, setSize] = useState<string>(box?.containerSize || CONTAINER_TYPES[0]);
  const [vehicleId, setVehicleId] = useState(box?.vehicleId || "");
  const [cap, setCap] = useState<LoadingCapture>({});
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listVehicles().then((r) => { if (r.ok) setVehicles(r.vehicles); });
  }, []);

  const entriesOf = (i: ItemRow) =>
    allocateFifo(i.readyLines.map((l) => ({ id: l.id, boxes: l.boxes })), qty.get(i.o.id) || 0);
  const totalBoxes = items.reduce((s, i) => s + (qty.get(i.o.id) || 0), 0);
  // Fill estimate — fractional vs each line's pallet capacity (house rule).
  const fill =
    existingFill +
    items.reduce((s, i) => {
      const byId = new Map(i.readyLines.map((l) => [l.id, l]));
      return (
        s +
        entriesOf(i).reduce((t, e) => {
          const l = byId.get(e.lineId)!;
          return t + (l.palletCapacity > 0 ? (e.boxes ?? l.boxes) / l.palletCapacity : 0);
        }, 0)
      );
    }, 0);

  const capField = (key: keyof LoadingCapture, label: string, placeholder: string) => (
    <label className="form-field">
      <span className="lbl">{label}</span>
      <input value={cap[key] || ""} placeholder={placeholder} onChange={(e) => setCap((p) => ({ ...p, [key]: e.target.value }))} />
    </label>
  );

  const onConfirm = async () => {
    if (busy || totalBoxes === 0) return;
    setBusy(true);
    const entries = items.flatMap(entriesOf);
    // Only send fields the user filled (server rejects an empty vehicle).
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(cap)) if (v) patch[k] = v;
    if (vehicleId && vehicleId !== (box?.vehicleId || "")) patch.vehicle = vehicleId;
    let toBox: string;
    let label: string;
    if (box) {
      toBox = box.id;
      label = boxLabel(box);
      if (Object.keys(patch).length > 0 || size !== box.containerSize) {
        const up = await updateLoadBox(box.id, { ...patch, container_size: size });
        if (!up.ok) {
          setBusy(false);
          toast.error(up.error || "Could not save the loading details");
          return;
        }
      }
    } else {
      // load_plan snapshot keeps the loading's Planned rows rendering if the
      // line assignment fails after (same recovery as NewLoadingModal).
      const lineById = new Map(items.flatMap((i) => i.readyLines).map((l) => [l.id, l]));
      const planLines = entries.map((e) => {
        const l = lineById.get(e.lineId)!;
        return { so: soId, design: l.designLabel, batch: l.batchNumber, boxes: e.boxes ?? l.boxes, palletId: l.palletId };
      });
      const created = await createLoadBox({
        container_size: size,
        ...patch,
        load_plan: JSON.stringify({ v: 1, lines: planLines }).slice(0, 10000),
      });
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        toast.error(created.error || "Could not create the loading");
        return;
      }
      toBox = String(created.data.ROWID);
      label = created.data.load_number || `Container ${created.data.box_number ?? ""}`.trim();
    }
    const res = await setLinesBox(toBox, entries);
    setBusy(false);
    if (!res.ok) {
      toast.error(
        box
          ? res.error || "Could not load the items"
          : `${label} created but nothing loaded: ${res.error || "error"} — retry via Add Pallets on the loading`,
      );
      if (box) return; // keep the modal open to retry into the existing box
    } else {
      toast.success(`${fmt(totalBoxes)} boxes → ${label}`);
    }
    onDone();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Assign to Loading</div>
            {box && <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{boxLabel(box)}</div>}
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <table className="tbl" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Balance</th>
                <th style={{ textAlign: "right" }}>Ready</th>
                <th style={{ textAlign: "right" }}>Load</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.o.id}>
                  <td><span className="design-name">{i.o.design}</span></td>
                  <td className="mono dim" style={{ textAlign: "right" }}>{fmt(Math.max(0, i.balance))}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{fmt(i.ready)}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      max={i.ready}
                      value={qty.get(i.o.id) || 0}
                      onChange={(e) =>
                        setQty((p) => new Map(p).set(i.o.id, Math.max(0, Math.min(i.ready, Math.floor(Number(e.target.value)) || 0))))
                      }
                      style={{ width: 90, textAlign: "right" }}
                    />
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td>Total</td>
                <td />
                <td />
                <td className="mono" style={{ textAlign: "right" }}>{fmt(totalBoxes)}</td>
              </tr>
            </tbody>
          </table>
          {fill > 1.001 && (
            <div style={{ color: "var(--c-amber)", fontSize: "var(--t-sm)", fontWeight: 600, marginBottom: 10 }}>
              ~{Math.round(fill * 100)}% of a container by pallet capacity — consider a second container.
            </div>
          )}

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {capField("container_number", "Container No.", "e.g. MSCU1234567")}
            <label className="form-field">
              <span className="lbl">Container Size</span>
              <Combobox value={size} options={CONTAINER_TYPES.map((t) => ({ value: t, label: t }))} onChange={setSize} clearable={false} ariaLabel="Container size" />
            </label>
            <label className="form-field">
              <span className="lbl">Vehicle</span>
              <Combobox
                value={vehicleId}
                options={vehicles.map((v) => ({ value: v.id, label: [v.vehicleNumber, v.driverName].filter(Boolean).join(" · ") }))}
                onChange={setVehicleId}
                placeholder="Assign later…"
                ariaLabel="Vehicle"
              />
            </label>
            {capField("transporter", "Transporter", "e.g. Shree Logistics")}
            {capField("lr_number", "LR / Docket No.", "LR number")}
            {capField("destination", "Destination / Port", "Port or city")}
            {capField("electronic_seal", "Electronic Seal", "E-seal no.")}
            {capField("line_seal", "Line Seal", "Line seal no.")}
          </div>
        </div>

        <div className="df-foot">
          <span style={{ flex: 1, fontSize: "var(--t-sm)" }} className="dim">
            Details left blank can be captured later via Assign Vehicle
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy || totalBoxes === 0} onClick={() => void onConfirm()}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : box ? `Add ${fmt(totalBoxes)} boxes` : `Create Loading · ${fmt(totalBoxes)} boxes`}
          </button>
        </div>
      </div>
    </div>
  );
}
