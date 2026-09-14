/* ============================================================
   Palletization Plan detail — split view (same design as Quote/Order detail).
   Route: /packing/:id. Left: searchable list of plans. Right: header card
   (PAL number + status chip + Edit + More + ✕), then the "Associated SO(s)"
   grouped section (the plan's order items, grouped by Sales Order), plan
   meta fields, and the Activity timeline. Loading/dispatch happen per
   LoadBox on /loading (CR-163 removed the legacy plan-level Begin Dispatch /
   Mark Dispatched / Assign Vehicle buttons); the plan status follows.

   More menu: Clone (seed a new plan), Print Palletization slip (PDF), Delete.
   ============================================================ */
import { codeOf } from "@/ui/statusCode";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { DetailRail } from "@/features/common/DetailRail";
import { ActivityLog, StatusTimeline } from "@/features/common/RecordDetail";
import { PalPlanForm } from "./PalPlanForm";
import { DispatchTab } from "./DispatchTab";
import { STATUS_CHIP } from "./PalPlans";
import {
  cachedLoadBoxes,
  cachedPalPlans,
  createPalPlan,
  deletePalPlan,
  invalidatePalPlans,
  listPalPlans,
  PAL_STATUS_LABEL,
  oiProgressOf,
  planToInput,
  updatePalPlan,
  PAL_LINE_STATUS_LABEL,
  type LoadBox,
  type PalPlan,
  type PalPlanInput,
} from "./palPlansApi";

type DetailTab = "items" | "dispatch" | "timeline" | "activity";
const tabStyle = (active: boolean): CSSProperties => ({
  padding: "8px 14px", border: "none", background: "none", cursor: "pointer",
  font: "inherit", color: active ? "var(--text)" : "var(--muted)",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent", fontWeight: active ? 600 : 400,
});

export function PalPlanDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [tab, setTab] = useState<DetailTab>("items");

  const load = async () => {
    setLoading(true);
    const res = await listPalPlans();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load palletization plans");
      return;
    }
    setError(null);
    setPlans(res.plans);
    setBoxes(res.boxes);
  };
  useEffect(() => {
    void load();
  }, []);

  const plan = useMemo(() => plans.find((p) => p.id === id) || null, [plans, id]);
  const boxById = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  // Group the plan's lines by Sales Order for the "Associated SO(s)" section.
  const bySo = useMemo(() => {
    const m = new Map<string, { soNumber: string; salesOrderId: string; lines: PalPlan["lines"] }>();
    (plan?.lines || []).forEach((l) => {
      const g = m.get(l.salesOrderId) ?? m.set(l.salesOrderId, { soNumber: l.soNumber, salesOrderId: l.salesOrderId, lines: [] }).get(l.salesOrderId)!;
      g.lines.push(l);
    });
    return [...m.values()];
  }, [plan]);

  const oiProgress = useMemo(() => oiProgressOf(plan?.lines || []), [plan]);

  const onEditSave = async (input: PalPlanInput) => {
    if (!plan) return;
    setEditing(false);
    const res = await updatePalPlan(plan.id, input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success("Palletization plan updated");
    invalidatePalPlans();
    await load();
  };

  const onCloneSave = async (input: PalPlanInput) => {
    setCloning(false);
    const res = await createPalPlan(input);
    if (!res.ok) {
      toast.error(res.error || "Clone failed");
      return;
    }
    toast.success(`Cloned to ${res.data?.pal_number || `#${res.rowid}`}`);
    invalidatePalPlans();
    const newId = res.data?.ROWID || res.rowid;
    if (newId) navigate(`/packing/${encodeURIComponent(newId)}`);
  };

  const onDelete = async () => {
    if (!plan) return;
    if (!(await confirmDialog({ message: `Delete palletization plan ${plan.palNumber}? This cannot be undone.`, danger: true }))) return;
    const res = await deletePalPlan(plan.id);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Palletization plan deleted");
    invalidatePalPlans();
    navigate("/packing");
  };

  const onPrint = () => {
    if (!plan) return;
    void import("./palletSlipPdf").then((m) => m.downloadPalletSlipPdf(plan));
  };

  const onPrintPacking = () => {
    if (!plan) return;
    if (!plan.lines.some((l) => l.status === "ReadyToLoad" || l.loadBoxId)) { toast.error("No palletised items yet"); return; }
    void import("./packingReportPdf").then((m) => m.downloadPackingReportForPlan(plan));
  };

  if (loading && !plan) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="card" style={{ padding: 20 }}>
        {error && <ErrorCard message={error} onRetry={() => void load()} />}
        <EmptyState title="Plan not found" hint="It may have been deleted" action={<button className="hbtn" onClick={() => navigate("/packing")}>Back to Palletization</button>} />
      </div>
    );
  }

  // Edit is always visible (detail-page standard); a Completed plan locks it.
  const editLock = plan.status === "Completed" ? "Completed plans can't be edited" : "";

  const moreItems = [
    ...(can("stages", "create") ? [{ label: "Clone", onClick: () => setCloning(true) }] : []),
    { label: "Print Palletization slip", onClick: onPrint },
    { label: "Print Packing Report", onClick: onPrintPacking },
    ...(can("stages", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && <PalPlanForm initial={plan} onSave={(i) => void onEditSave(i)} onClose={() => setEditing(false)} />}
      {cloning && <PalPlanForm initial={plan} clone onSave={(i) => void onCloneSave(i)} onClose={() => setCloning(false)} />}

      {/* Plan list — sticky, resizable, own scroll (mirrors Quote detail). */}
      <DetailRail
        placeholder="Search plans…"
        currentId={id}
        items={plans.map((x) => ({
          id: x.id,
          to: `/packing/${x.id}`,
          title: x.palNumber,
          subtitle: [x.customerNames.join(", "), x.vehicleNumber, PAL_STATUS_LABEL[x.status]].filter(Boolean).join("  ·  "),
          searchText: x.soNumbers.join(" "),
        }))}
      />

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }} title={plan.palNumber}>
              <span className="mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{plan.palNumber}</span>
              <span className={`chip palstatus ${STATUS_CHIP[plan.status]}`}>{PAL_STATUS_LABEL[plan.status]}</span>
            </div>
            {can("stages", "edit") && (
              <button className="hbtn" disabled={!!editLock} onClick={() => setEditing(true)} title={editLock || "Edit plan"}>
                <Icon name="edit" size={13} /> Edit
              </button>
            )}
            <MoreMenu items={moreItems} />
            <button className="btn x" onClick={() => navigate("/packing")} title="Close">
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
            {[plan.vehicleNumber && `Vehicle ${plan.vehicleNumber}`, `${fmt(plan.totalBoxes)} boxes`, plan.salespersonName].filter(Boolean).join("  ·  ")}
          </div>

          {/* Tabs: palletise items · dispatch · timeline · activity */}
          <div className="row" style={{ display: "flex", gap: 4, marginTop: 12, borderBottom: "1px solid var(--border)" }}>
            <button style={tabStyle(tab === "items")} onClick={() => setTab("items")}>Palletise items</button>
            <button style={tabStyle(tab === "dispatch")} onClick={() => setTab("dispatch")}>Dispatch</button>
            <button style={tabStyle(tab === "timeline")} onClick={() => setTab("timeline")}>Timeline</button>
            <button style={tabStyle(tab === "activity")} onClick={() => setTab("activity")}>Activity</button>
          </div>

          {tab === "items" && (<>
          {/* Associated SO(s) — the grouped order items (replaces PO number). */}
          <div style={{ marginTop: 14 }}>
            <div className="form-section-title" style={{ marginBottom: 8 }}>
              Associated Sales Orders {bySo.length > 0 && <span className="dim">({bySo.length})</span>}
            </div>
            {bySo.length === 0 ? (
              <div className="dim" style={{ padding: "6px 0" }}>No order items on this plan.</div>
            ) : (
              bySo.map((g) => {
                const subtotal = g.lines.reduce((s, l) => s + l.boxes, 0);
                return (
                  <div key={g.salesOrderId} style={{ marginBottom: 14 }}>
                    <div style={{ marginBottom: 4 }}>
                      <Link className="linkish mono" to={`/orders/${encodeURIComponent(g.salesOrderId)}`} title="Open Sales Order">{g.soNumber}</Link>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Design</th>
                          <th>Size</th>
                          <th>Pallet</th>
                          <th>Status</th>
                          <th>Vehicle</th>
                          <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                          <th style={{ width: 30 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {g.lines.map((l) => {
                          const box = boxById.get(l.loadBoxId);
                          const done = l.status === "ReadyToLoad" || !!l.loadBoxId;
                          const prog = oiProgress.get(l.orderItemId);
                          const partial = !done && prog && prog.done > 0 && prog.done < prog.total;
                          const chipCls = l.status === "ReadyToLoad" ? "p-ready" : l.status === "Palletizing" ? "p-palletized" : "p-planning";
                          return (
                            <tr key={l.id}>
                              <td className="mono">{l.itemCode}</td>
                              <td><span className="design-name">{l.designLabel}</span></td>
                              <td className="muted mono">{l.sizeCode || "—"}</td>
                              <td className="muted">{l.palletName}</td>
                              <td>
                                <span className={`chip palstatus ${partial ? "p-palletized" : chipCls}`} title={partial ? "Partially palletised" : PAL_LINE_STATUS_LABEL[l.status]}>
                                  {codeOf(partial ? "Partially palletised" : PAL_LINE_STATUS_LABEL[l.status])}
                                </span>
                              </td>
                              <td className="muted">
                                {box ? (
                                  <Link
                                    className="linkish"
                                    to={`/loading/${encodeURIComponent(box.id)}`}
                                    onClick={(ev) => ev.stopPropagation()}
                                    title={box.status === "Dispatched" ? `Dispatched ${box.dispatchDate}` : "Open the loading"}
                                  >
                                    {box.vehicleNumber || `Container ${box.boxNumber}`}
                                  </Link>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="num mono">{fmt(l.boxes)}</td>
                              <td>
                                {done && (
                                  <button
                                    type="button"
                                    className="btn"
                                    title="Print pallet packing report for this item"
                                    style={{ padding: 0, height: 22, width: 22, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                    onClick={() => void import("./packingReportPdf").then((m) => m.downloadPackingReportForLines([l], plan.lines))}
                                  >
                                    <Icon name="printer" size={12} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td colSpan={7} style={{ fontWeight: 500 }}>Subtotal</td>
                          <td className="num mono" style={{ fontWeight: 500 }}>{fmt(subtotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
          </div>

          {/* Plan meta */}
          <div style={{ marginTop: 14 }}>
            {/* TODO: rename to Dispatch Details */}
            <div className="form-section-title" style={{ marginBottom: 8 }}>Plan Details</div>
            <DetailRow label="Vehicle No." value={plan.vehicleNumbers.join(", ") || "—"} />
            <DetailRow label="Driver" value={plan.driverName || "—"} />
            <DetailRow label="Driver Mobile" value={plan.mobileNumber || "—"} />
            <DetailRow label="Palletization Date" value={plan.plannedDate || "—"} />
            <DetailRow label="Dispatch Date" value={plan.dispatchDate || "—"} />
            <DetailRow label="Sales Person" value={plan.salespersonName || "—"} />
            <DetailRow label="Remarks" value={plan.remarks || "—"} />
          </div>
          </>)}

          {tab === "dispatch" && (
            <div style={{ marginTop: 14 }}>
              <DispatchTab scope={{ kind: "plan", planId: plan.id }} orderedBoxes={plan.totalBoxes} />
            </div>
          )}
          {tab === "timeline" && (
            <div style={{ marginTop: 14 }}>
              <StatusTimeline entityType="PalletizationPlan" entityId={plan.id} />
            </div>
          )}
          {tab === "activity" && (
            <div style={{ marginTop: 14 }}>
              <ActivityLog table="PalletizationPlan" entityId={plan.id} />
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
