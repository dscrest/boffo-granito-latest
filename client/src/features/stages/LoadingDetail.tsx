/* ============================================================
   Loading detail (/loading/:id) — one LoadBox as a first-class record,
   on the shared RecordDetail scaffold (house detail standard). Shows the
   assigned vehicle + loading capture, the loaded items with the
   design-coloured fill bar, each associated SO's containerisation plan
   (planned vs loaded), and the LoadBox activity/status timeline.
   Actions mirror the /loading board: Add Items (direct send-to-loading),
   Confirm Load (vehicle + seals), Dispatch, QR/Dispatch Copy prints and
   Delete Loading (Open only — items return to Ready for Loading).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { MoreMenu } from "@/features/common/DetailBits";
import { ContainerPlanCard } from "@/features/quotes/ContainerPlanCard";
import { dispatchRows, dispatchedByDesign } from "./DispatchTab";
import { useMasters } from "@/features/masters/useMasters";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import { SendToLoadingModal } from "./SendToLoadingModal";
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
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState(false);
  const [addItems, setAddItems] = useState(false);
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);
  const { designRows } = useMasters();

  // Plan lines store a design NAME; dispatch counts are keyed by Design ROWID.
  const designKey = useMemo(() => {
    const byName = new Map<string, string>();
    designRows.forEach((d) => {
      if (d.designName) byName.set(d.designName, d.id);
      if (d.uniqueName) byName.set(d.uniqueName, d.id);
    });
    return (name: string) => byName.get(name) || name;
  }, [designRows]);

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
    void listOrders().then((r) => r.ok && setOrders(r.orders));
  }, []);

  const box = boxes.find((b) => b.id === boxId) ?? null;
  const entries: Entry[] = useMemo(
    () => plans.flatMap((p) => p.lines.filter((l) => l.loadBoxId === boxId).map((l) => ({ p, l }))),
    [plans, boxId],
  );
  const lines = entries.map(({ l }) => l);
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  const pct = Math.round(boxFill(lines) * 100);
  // Stable colour per design (first-seen) — same rule as the board's box cards.
  const colorByDesign = new Map<string, string>();
  lines.forEach((l) => {
    if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
  });

  // One order head per associated SO — for the Container Planning tab.
  const soHeads = useMemo(() => {
    const ids = [...new Set(lines.map((l) => l.salesOrderId).filter(Boolean))];
    return ids
      .map((soId) => ({ soId, head: orders.find((o) => o.salesOrderId === soId) }))
      .filter((x): x is { soId: string; head: Order } => !!x.head);
  }, [orders, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !box) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading…</div>;
  }
  if (!box) {
    return <RecordDetail backTo="/loading" title="Loading not found" fields={[]} hiddenStorageKey="loadingDetailFields" />;
  }

  const open = box.status === "Open";
  const stage = !open
    ? { label: "Dispatched", cls: "palstatus p-completed" }
    : sealed(box)
      ? { label: "Ready for Dispatch", cls: "palstatus p-palletized" }
      : entries.length > 0
        ? { label: "In Loading", cls: "palstatus p-loading" }
        : { label: "Empty", cls: "palstatus p-planning" };

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
    <>
      <RecordDetail
        backTo="/loading"
        title={boxLabel(box)}
        statusChip={{ label: stage.label, cls: stage.cls }}
        subtitle={`${entries.length} item${entries.length === 1 ? "" : "s"} · ${fmt(totalBoxes)} boxes · ${pct}% full`}
        actions={
          <>
            {canEdit && open && (
              <button className="hbtn" disabled={busy} onClick={() => setAddItems(true)} title="Send order items into this loading — no palletization step">
                <Icon name="plus" size={13} /> Add Items
              </button>
            )}
            {canEdit && (
              <button className="hbtn primary" disabled={busy} onClick={() => setVehModal(true)} title="Capture vehicle + container/seal details">
                {open && !sealed(box) ? "Confirm Load" : "Edit Load Details"}
              </button>
            )}
            {canEdit && open && sealed(box) && (
              <button className="hbtn primary" disabled={busy || entries.length === 0} onClick={() => void onDispatch()} title="Dispatch — the Dispatch Entry opens after">
                <Icon name="check" size={13} /> Dispatch
              </button>
            )}
            <MoreMenu
              items={[
                { label: "Print QR label", onClick: () => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, entries)) },
                { label: "Dispatch Copy", onClick: () => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries)) },
                ...(canEdit && open
                  ? [{ label: "Delete Loading", danger: true, onClick: () => void onDelete() }]
                  : []),
              ]}
            />
          </>
        }
        fields={fields}
        hiddenStorageKey="loadingDetailFields"
        activityTable="LoadBox"
        entityId={box.id}
        created={box.createdTime}
        extraTabs={[
          {
            id: "containers",
            label: "Container Planning",
            content:
              soHeads.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {soHeads.map(({ soId, head }) => {
                    const soBoxes = lines.filter((l) => l.salesOrderId === soId).reduce((s, l) => s + l.boxes, 0);
                    return (
                      <div key={soId}>
                        <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>
                          <Link className="linkish mono" to={`/orders/${encodeURIComponent(soId)}`}>{head.orderNumber || head.poNumber}</Link>
                          {"  ·  "}{head.party}{"  ·  "}loaded on this vehicle: {fmt(soBoxes)} boxes
                        </div>
                        <ContainerPlanCard
                          containerPlan={head.containerPlan}
                          docNo={head.orderNumber || head.poNumber}
                          plannerPath={`/orders/${soId}/containerise`}
                          dispatchedByDesign={dispatchedByDesign(dispatchRows(plans, boxes, { kind: "so", salesOrderIds: [soId] }))}
                          designKey={designKey}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="card dim" style={{ padding: 18 }}>Nothing loaded yet — the associated orders' container plans show here.</div>
              ),
          },
        ]}
      >
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
            <span className="mono dim" style={{ fontSize: "var(--t-sm)", marginLeft: "auto" }}>{fmt(totalBoxes)} box · {pct}%</span>
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
                {entries.length === 0 && (
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="hbtn" onClick={() => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, entries))}>
            Print QR Label
          </button>
          <button className="hbtn" onClick={() => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries))}>
            Dispatch Copy
          </button>
        </div>
      </RecordDetail>

      {vehModal && (
        <VehicleLoadModal
          palNumber={boxLabel(box)}
          title={open && !sealed(box) ? "Confirm Load" : "Edit Load Details"}
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

      {entryOverlay && (
        <DispatchEntryOverlay
          box={boxes.find((b) => b.id === entryOverlay.box.id) ?? entryOverlay.box}
          entries={entryOverlay.entries}
          onClose={() => setEntryOverlay(null)}
        />
      )}
    </>
  );
}
