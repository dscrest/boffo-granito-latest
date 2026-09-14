/* ============================================================
   Loading detail (/loading/:id) — one LoadBox as a first-class record,
   on the shared RecordDetail scaffold (house detail standard). Shows the
   assigned vehicle + loading capture, the loaded items with the
   design-coloured fill bar, each associated SO's containerisation plan
   (planned vs loaded), and the LoadBox activity/status timeline.
   Actions mirror the /loading board: Add Items (direct send-to-loading),
   Assign Vehicle (vehicle + seals), Dispatch, QR/Dispatch Copy prints and
   Delete Loading (Open only — items return to Ready for Loading).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { parseLoadPlan, type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { DetailRail, type DetailRailItem } from "@/features/common/DetailRail";
import { PlanSoContainerisation } from "@/features/quotes/PlanContainerisation";
import { useMasters } from "@/features/masters/useMasters";
import { useOrders } from "@/features/orders/useOrders";
import { nextPlanContainer, useContainerPlanBySo } from "./containerPlanPrefill";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { LoadingCustomerSheet } from "./LoadingCustomerSheet";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import { SendToLoadingModal } from "./SendToLoadingModal";
import { NewLoadingModal } from "./NewLoadingModal";
import {
  boxFill,
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  deleteLoadBox,
  dispatchLoadBox,
  invalidatePalPlans,
  lineFrac,
  listPalPlans,
  mixedBatchOrderItems,
  sealed,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

type Entry = { p: PalPlan; l: PalPlanLine };

export function LoadingDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const boxId = decodeURIComponent(id);
  const canEdit = can("stages", "edit");

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  // Live orders — the embedded planner's save invalidates the cache and this
  // subscription refreshes soHeads (and the plan below) without a reload.
  const { orders } = useOrders();
  const { planBySo, designIdOf } = useContainerPlanBySo();
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState(false);
  const [addItems, setAddItems] = useState(false);
  const [addPallets, setAddPallets] = useState(false);
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);
  const [planSo, setPlanSo] = useState(""); // Container Planning tab: selected SO
  useMasters(); // warm the designs cache for the embedded planner

  const load = async () => {
    const res = await listPalPlans();
    setLoading(false);
    if (res.ok) {
      setPlans(res.plans);
      setBoxes(res.boxes);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const box = boxes.find((b) => b.id === boxId) ?? null;
  const entries: Entry[] = useMemo(
    () => plans.flatMap((p) => p.lines.filter((l) => l.loadBoxId === boxId).map((l) => ({ p, l }))),
    [plans, boxId],
  );
  const lines = entries.map(({ l }) => l);
  // All boxed lines app-wide, for the SO-scoped editable Loading Sheet tab —
  // the sheet filters to the selected SO and shows EVERY container of it, so
  // vehicles/details for a multi-container order are assignable in one grid.
  const sheetRows = useMemo(
    () => plans.flatMap((p) => p.lines.map((l) => ({ l, box: boxes.find((b) => b.id === l.loadBoxId) }))),
    [plans, boxes],
  );
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  const pct = Math.round(boxFill(lines) * 100);
  // Stable colour per design (first-seen) — same rule as the board's box cards.
  const colorByDesign = new Map<string, string>();
  lines.forEach((l) => {
    if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
  });

  // Plan-only loading (SO-first New Loading, CR-126): nothing loaded yet, but
  // the load_plan JSON carries the planned lines — fall back to it for the
  // items table, counts and SOs, same as the Loadings grid (CR-127). When the
  // SO still has a live containerisation plan, render THAT (its next unsent
  // container) instead of the minted snapshot, so plan edits show here.
  const planLines = useMemo(() => {
    const snap = box && lines.length === 0 ? (parseLoadPlan(box.loadPlan)?.lines ?? []) : [];
    const soId = snap[0]?.so || "";
    const slice = soId && snap.every((l) => l.so === soId) ? nextPlanContainer(soId, planBySo, plans, boxes, designIdOf) : null;
    return slice
      ? slice.lines.map((ln) => ({ so: soId, design: ln.design, batch: "", boxes: ln.boxes, palletId: ln.palletId }))
      : snap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.loadPlan, lines.length, planBySo, plans, boxes, designIdOf]);
  const plannedBoxes = planLines.reduce((s, l) => s + (Number(l.boxes) || 0), 0);

  // One order head per associated SO — loaded lines plus the plan JSON.
  const soHeads = useMemo(() => {
    const planSos = box ? (parseLoadPlan(box.loadPlan)?.lines ?? []).map((l) => l.so) : [];
    const ids = [...new Set([...lines.map((l) => l.salesOrderId), ...planSos].filter(Boolean))];
    return ids
      .map((soId) => ({ soId, head: orders.find((o) => o.salesOrderId === soId) }))
      .filter((x): x is { soId: string; head: Order } => !!x.head);
  }, [orders, entries, box?.loadPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Left rail — every loading, newest first, customer under the LOAD code.
  // ponytail: customers/status re-derived here (~12 lines) instead of sharing
  // LoadingBay's boxRows — their row shapes differ.
  const railItems: DetailRailItem[] = useMemo(
    () =>
      [...boxes]
        .sort((a, b) => (b.createdTime || "").localeCompare(a.createdTime || ""))
        .map((b) => {
          const inBox = plans.flatMap((p) => p.lines.filter((l) => l.loadBoxId === b.id));
          const bPlan = parseLoadPlan(b.loadPlan);
          const customers =
            [...new Set(inBox.map((l) => l.customerName).filter(Boolean))].join(", ") ||
            [...new Set((bPlan?.lines ?? []).map((x) => orders.find((o) => o.salesOrderId === x.so)?.party).filter(Boolean))].join(", ");
          const status =
            b.status !== "Open" ? "Dispatched"
              : sealed(b) ? "Ready for Dispatch"
                : inBox.length ? "In Loading"
                  : bPlan ? "Planned" : "Empty";
          return {
            id: b.id,
            to: `/loading/${encodeURIComponent(b.id)}`,
            title: boxLabel(b),
            subtitle: [customers, b.vehicleNumber, status].filter(Boolean).join("  ·  "),
            searchText: [...new Set(inBox.map((l) => l.soNumber).filter(Boolean))].join(" "),
          };
        }),
    [boxes, plans, orders],
  );

  if (loading && !box) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading…</div>;
  }
  if (!box) {
    return <RecordDetail backTo="/loading" title="Loading not found" fields={[]} hiddenStorageKey="loadingDetailFields" />;
  }

  const open = box.status === "Open";
  const plan = parseLoadPlan(box.loadPlan);
  const stage = !open
    ? { label: "Dispatched", cls: "palstatus p-completed" }
    : sealed(box)
      ? { label: "Ready for Dispatch", cls: "palstatus p-palletized" }
      : entries.length > 0
        ? { label: "In Loading", cls: "palstatus p-loading" }
        : plan
          ? { label: "Planned", cls: "palstatus p-planning" }
          : { label: "Empty", cls: "palstatus p-planning" };
  // Sibling containers of a multi-container plan (LoadPlan.group). The
  // primary's own slice can lack the group key (it's patched in after the
  // mint), so also match boxes whose group points at this one.
  const groupId = plan?.group?.id || box.id;
  const siblings = boxes.filter((b) => b.id !== box.id && (b.id === groupId || parseLoadPlan(b.loadPlan)?.group?.id === groupId));

  const refresh = () => {
    invalidatePalPlans();
    void load();
  };

  const confirmLoadDetails = async (vehicleId: string, capture: LoadingCapture) => {
    setVehModal(false);
    setBusy(true);
    const res = await updateLoadBox(box.id, { ...(vehicleId ? { vehicle: vehicleId } : {}), ...capture });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save loading details");
      return;
    }
    const nowSealed = !!(capture.container_number || capture.line_seal);
    toast.success(open && nowSealed ? `${boxLabel(box)} → Ready for Dispatch` : "Loading details saved");
    refresh();
  };

  const onDispatch = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "Dispatch",
      message: `Dispatch ${boxLabel(box)}? ${entries.length} item${entries.length === 1 ? "" : "s"} leave with it.`,
    });
    if (!ok) return;
    setBusy(true);
    const res = await dispatchLoadBox(box.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not dispatch");
      return;
    }
    toast.success(`${boxLabel(box)} dispatched`);
    setEntryOverlay({ box, entries });
    refresh();
  };

  const onDelete = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "Delete loading",
      message:
        entries.length > 0
          ? `Delete ${boxLabel(box)}? ${entries.length} item${entries.length === 1 ? "" : "s"} return to Ready for Loading.`
          : `Delete ${boxLabel(box)}?`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteLoadBox(box.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not delete the loading");
      return;
    }
    toast.success(`${boxLabel(box)} deleted`);
    navigate("/loading");
  };

  const fields: RecordField[] = [
    { key: "orders", label: "Order(s)", value: soHeads.map(({ head }) => head.orderNumber || head.poNumber).filter(Boolean).join(", ") || "—" },
    { key: "customer", label: "Customer", value: [...new Set(soHeads.map(({ head }) => head.party).filter(Boolean))].join(", ") || "—" },
    { key: "plannedBoxes", label: "Planned Boxes", value: planLines.length ? fmt(plannedBoxes) : totalBoxes ? fmt(totalBoxes) : "—" },
    { key: "vehicle", label: "Vehicle", value: box.vehicleNumber || "—" },
    { key: "driver", label: "Driver", value: box.driverName || "—" },
    { key: "mobile", label: "Mobile", value: box.mobileNumber || "—" },
    { key: "containerNo", label: "Container No.", value: box.containerNumber || "—" },
    { key: "containerSize", label: "Size", value: box.containerSize || "—" },
    { key: "lineSeal", label: "Line Seal", value: box.lineSeal || "—" },
    { key: "electronicSeal", label: "Electronic Seal", value: box.electronicSeal || "—" },
    { key: "transporter", label: "Transporter", value: box.transporter || "—" },
    { key: "lrNumber", label: "LR / Docket No.", value: box.lrNumber || "—" },
    { key: "destination", label: "Destination / Port", value: box.destination || "—" },
    { key: "supervisor", label: "Loading Supervisor", value: box.loadingSupervisor || "—" },
    { key: "dispatchDate", label: "Dispatch Date", value: box.dispatchDate ? box.dispatchDate.slice(0, 10) : "—" },
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {/* Loading list — sticky, resizable, own scroll (mirrors PalPlan detail). */}
      <DetailRail placeholder="Search loadings…" currentId={boxId} items={railItems} />
      <div style={{ flex: 1, minWidth: 0 }}>
      <RecordDetail
        backTo="/loading"
        title={boxLabel(box)}
        statusChip={{ label: stage.label, cls: stage.cls }}
        subtitle={
          planLines.length > 0
            ? `${planLines.length} item${planLines.length === 1 ? "" : "s"} planned · ${fmt(plannedBoxes)} boxes — nothing loaded yet`
            : `${entries.length} item${entries.length === 1 ? "" : "s"} · ${fmt(totalBoxes)} boxes · ${pct}% full`
        }
        actions={
          <MoreMenu
            kebab
            icon="plus"
            title="Loading actions"
            items={[
              ...(canEdit && open
                ? [
                    { label: "Add Pallets", disabled: busy, title: "Load more palletised stock into this container", onClick: () => setAddPallets(true) },
                    { label: "Add Items", disabled: busy, title: "Send order items into this loading — no palletization step", onClick: () => setAddItems(true) },
                  ]
                : []),
              ...(canEdit
                ? [{ label: open && !sealed(box) ? "Assign Vehicle" : "Edit Load Details", disabled: busy, title: "Capture vehicle + container/seal details", onClick: () => setVehModal(true) }]
                : []),
              ...(canEdit && open && sealed(box)
                ? [{
                    label: "Dispatch",
                    disabled: busy || entries.length === 0,
                    title: entries.length === 0 ? "Load at least one item first" : "Dispatch — the Dispatch Entry opens after",
                    onClick: () => void onDispatch(),
                  }]
                : []),
              { label: "Print QR label", onClick: () => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, entries)) },
              { label: "Dispatch Copy", onClick: () => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries)) },
              ...(canEdit && open
                ? [{ label: "Delete Loading", danger: true, onClick: () => void onDelete() }]
                : []),
            ]}
          />
        }
        fields={fields}
        hiddenStorageKey="loadingDetailFields"
        activityTable="LoadBox"
        entityId={box.id}
        created={box.createdTime}
        extraTabs={[
          {
            id: "sheet",
            label: "Loading Sheet",
            // The Excel-style edit-in-place sheet scoped to this loading's
            // SO — every container of the order, vehicle/seal/LR/brand/PO
            // editable per row (same component as the /loading views).
            content: (() => {
              if (soHeads.length === 0)
                return <div className="card dim" style={{ padding: 18 }}>No orders associated yet — the order's loading sheet shows here.</div>;
              const selSo = soHeads.find((x) => x.soId === planSo)?.soId || soHeads[0].soId;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {soHeads.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {soHeads.map(({ soId, head }) => (
                        <button key={soId} className={`chip mono${soId === selSo ? " palstatus p-loading" : ""}`}
                          style={{ cursor: "pointer" }} onClick={() => setPlanSo(soId)} title={head.party}>
                          {head.orderNumber || head.poNumber}
                        </button>
                      ))}
                    </div>
                  )}
                  <LoadingCustomerSheet rows={sheetRows} canEdit={canEdit} onSaved={refresh} soFilter={selSo} />
                </div>
              );
            })(),
          },
          {
            id: "containers",
            label: "Container Planning",
            // The SO's containerisation plan, editable right here (Save writes
            // to the SalesOrder, same as /orders/:id/containerise).
            content: (() => {
              if (soHeads.length === 0)
                return <div className="card dim" style={{ padding: 18 }}>No orders associated yet — the orders' container plans show here.</div>;
              const selSo = soHeads.find((x) => x.soId === planSo)?.soId || soHeads[0].soId;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {soHeads.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {soHeads.map(({ soId, head }) => (
                        <button key={soId} className={`chip mono${soId === selSo ? " palstatus p-loading" : ""}`}
                          style={{ cursor: "pointer" }} onClick={() => setPlanSo(soId)} title={head.party}>
                          {head.orderNumber || head.poNumber}
                        </button>
                      ))}
                    </div>
                  )}
                  <PlanSoContainerisation key={selSo} soId={selSo} embedded />
                </div>
              );
            })(),
          },
        ]}
      >
        {siblings.length > 0 && (
          <div className="card" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Part of a {siblings.length + 1}-container plan · {plan?.group?.no ? `container ${plan.group.no} of ${plan.group.of}` : ""}</span>
            {siblings.map((b) => (
              <Link key={b.id} className="chip mono linkish" to={`/loading/${encodeURIComponent(b.id)}`} title={`Open ${boxLabel(b)}`}>
                {boxLabel(b)}
              </Link>
            ))}
          </div>
        )}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600 }}>Loaded Items</span>
            {/* Fill bar — design-coloured segments, fractional vs each line's pallet capacity. */}
            <div
              style={{ flex: 1, maxWidth: 320, display: "flex", height: 12, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
              title={`${fmt(totalBoxes)} boxes · ${pct}% of a full container`}
            >
              {lines.map((l) => (
                <div key={l.id} style={{ width: `${lineFrac(l) * 100}%`, background: colorByDesign.get(l.designId) }} title={`${l.designLabel}: ${fmt(l.boxes)} boxes`} />
              ))}
            </div>
            <span className="mono dim" style={{ fontSize: "var(--t-sm)", marginLeft: "auto" }}>
              {planLines.length > 0 ? `${fmt(plannedBoxes)} box planned` : `${fmt(totalBoxes)} box · ${pct}%`}
            </span>
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Design</th>
                  <th>Batch</th>
                  <th>Pallet</th>
                  <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                  <th>Order</th>
                  <th>Customer</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(({ p, l }) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: colorByDesign.get(l.designId), flex: "0 0 auto" }} />
                        <Link className="linkish" to={`/packing/${encodeURIComponent(p.id)}`} title={`Open ${p.palNumber}`}>{l.itemCode}</Link>
                      </span>
                    </td>
                    <td><span className="design-name">{l.designLabel}</span></td>
                    <td className="mono">{l.batchNumber || "—"}</td>
                    <td>{l.palletName}</td>
                    <td className="num mono">{fmt(l.boxes)}</td>
                    <td className="mono">
                      {l.salesOrderId ? (
                        <Link className="linkish" to={`/orders/${encodeURIComponent(l.salesOrderId)}`} title="Open order">{l.soNumber}</Link>
                      ) : (
                        l.soNumber || "—"
                      )}
                    </td>
                    <td className="muted">{l.customerName || "—"}</td>
                  </tr>
                ))}
                {/* Planned-but-not-loaded lines from the load_plan JSON. */}
                {entries.length === 0 &&
                  planLines.map((l, i) => {
                    const o = orders.find((x) => x.salesOrderId === l.so);
                    return (
                      <tr key={`plan-${i}`}>
                        <td><span className="palstatus p-planning">Planned</span></td>
                        <td><span className="design-name">{l.design}</span></td>
                        <td className="mono">{l.batch || "—"}</td>
                        <td className="muted">—</td>
                        <td className="num mono">{fmt(l.boxes)}</td>
                        <td className="mono">
                          {o ? (
                            <Link className="linkish" to={`/orders/${encodeURIComponent(l.so)}`} title="Open order">{o.orderNumber || o.poNumber}</Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="muted">{o?.party || "—"}</td>
                      </tr>
                    );
                  })}
                {entries.length === 0 && planLines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>
                      Nothing loaded yet{canEdit && open ? " — use Add Items, or load Ready items from the board." : "."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {mixedBatchOrderItems(lines) && (
            <div style={{ fontSize: "var(--t-sm)", color: "var(--c-amber)", padding: "8px 14px", borderTop: "1px solid var(--panel-2)" }}>
              An item in this loading spans more than one batch — tile texture may vary for that customer.
            </div>
          )}
        </div>
      </RecordDetail>

      {vehModal && (
        <VehicleLoadModal
          palNumber={boxLabel(box)}
          title={open && !sealed(box) ? "Assign Vehicle" : "Edit Load Details"}
          busy={busy}
          initialVehicleId={box.vehicleId}
          initialCapture={{
            container_number: box.containerNumber,
            line_seal: box.lineSeal,
            electronic_seal: box.electronicSeal,
            loading_supervisor: box.loadingSupervisor,
            container_size: box.containerSize,
            transporter: box.transporter,
            lr_number: box.lrNumber,
            destination: box.destination,
          }}
          onConfirm={(vehicleId, capture) => void confirmLoadDetails(vehicleId, capture)}
          onClose={() => setVehModal(false)}
        />
      )}

      {addItems && (
        <SendToLoadingModal
          presetBoxId={box.id}
          boxName={boxLabel(box)}
          onDone={() => {
            setAddItems(false);
            refresh();
          }}
          onClose={() => setAddItems(false)}
        />
      )}

      {addPallets && (
        <NewLoadingModal
          boxId={box.id}
          boxName={boxLabel(box)}
          onDone={refresh}
          onClose={() => setAddPallets(false)}
        />
      )}

      {entryOverlay && (
        <DispatchEntryOverlay
          box={boxes.find((b) => b.id === entryOverlay.box.id) ?? entryOverlay.box}
          entries={entryOverlay.entries}
          onClose={() => setEntryOverlay(null)}
        />
      )}
      </div>
    </div>
  );
}
