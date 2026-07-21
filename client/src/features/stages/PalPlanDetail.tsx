/* ============================================================
   Palletization Plan detail — split view (same design as Quote/Order detail).
   Route: /packing/:id. Left: searchable list of plans. Right: header card
   (PAL number + status chip + lifecycle transition buttons + Edit + More +
   ✕), then the "Associated SO(s)" grouped section (the plan's order items,
   grouped by Sales Order), plan meta fields, and the Activity timeline.

   More menu: Clone (seed a new plan), Print Palletization slip (PDF), Delete.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { ActivityLog, StatusTimeline } from "@/features/common/RecordDetail";
import { PalPlanForm } from "./PalPlanForm";
import { STATUS_CHIP } from "./PalPlans";
import {
  cachedPalPlans,
  createPalPlan,
  deletePalPlan,
  invalidatePalPlans,
  listPalPlans,
  PAL_STATUS_LABEL,
  planToInput,
  setPalStatus,
  updatePalPlan,
  type PalPlan,
  type PalPlanInput,
  type PalStatus,
} from "./palPlansApi";

// The single "advance" action offered from each state (back-steps stay implicit
// via Edit; the primary flow is Planning → ReadyToLoad → Loading → Completed).
const ADVANCE: Partial<Record<PalStatus, { to: PalStatus; label: string }>> = {
  Planning: { to: "ReadyToLoad", label: "Start Loading Prep" },
  ReadyToLoad: { to: "Loading", label: "Begin Loading" },
  Loading: { to: "Completed", label: "Mark Completed" },
};

export function PalPlanDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [listQ, setListQ] = useState("");

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
  };
  useEffect(() => {
    void load();
  }, []);

  const plan = useMemo(() => plans.find((p) => p.id === id) || null, [plans, id]);

  // Group the plan's lines by Sales Order for the "Associated SO(s)" section.
  const bySo = useMemo(() => {
    const m = new Map<string, { soNumber: string; salesOrderId: string; lines: PalPlan["lines"] }>();
    (plan?.lines || []).forEach((l) => {
      const g = m.get(l.salesOrderId) ?? m.set(l.salesOrderId, { soNumber: l.soNumber, salesOrderId: l.salesOrderId, lines: [] }).get(l.salesOrderId)!;
      g.lines.push(l);
    });
    return [...m.values()];
  }, [plan]);

  const changeStatus = async (to: PalStatus, msg: string) => {
    if (!plan) return;
    setBusy(true);
    const res = await setPalStatus(plan.id, to);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Status change failed");
      return;
    }
    toast.success(msg);
    invalidatePalPlans();
    await load();
  };

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

  const advance = ADVANCE[plan.status];
  const needle = listQ.trim().toLowerCase();
  const listed = needle
    ? plans.filter((x) => `${x.palNumber} ${x.vehicleNumber} ${x.soNumbers.join(" ")}`.toLowerCase().includes(needle))
    : plans;

  const moreItems = [
    ...(can("stages", "create") ? [{ label: "Clone", onClick: () => setCloning(true) }] : []),
    { label: "Print Palletization slip", onClick: onPrint },
    ...(can("stages", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && <PalPlanForm initial={plan} onSave={(i) => void onEditSave(i)} onClose={() => setEditing(false)} />}
      {cloning && <PalPlanForm initial={plan} clone onSave={(i) => void onCloneSave(i)} onClose={() => setCloning(false)} />}

      {/* Plan list — sticky, resizable, own scroll (mirrors Quote detail). */}
      <div
        className="card"
        style={{
          width: 300, minWidth: 220, maxWidth: 420, flexShrink: 0, padding: 0,
          resize: "horizontal", overflow: "hidden", display: "flex", flexDirection: "column",
          height: "calc(100vh - var(--header-h) - 46px)", position: "sticky", top: 0,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search plans…" value={listQ} onChange={(e) => setListQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((x) => {
            const cur = x.id === id;
            return (
              <Link
                key={x.id}
                to={`/packing/${x.id}`}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none",
                  borderBottom: "1px solid var(--border)", background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer", font: "inherit", color: "inherit", textDecoration: "none",
                }}
                title={x.palNumber}
              >
                <div className="mono" style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.palNumber}</div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[x.vehicleNumber, PAL_STATUS_LABEL[x.status]].filter(Boolean).join("  ·  ")}
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching plans</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }} title={plan.palNumber}>
              <span className="mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{plan.palNumber}</span>
              <span className={`chip palstatus ${STATUS_CHIP[plan.status]}`}>{PAL_STATUS_LABEL[plan.status]}</span>
            </div>
            {advance && can("stages", "edit") && (
              <button className="hbtn primary" disabled={busy} onClick={() => void changeStatus(advance.to, `Moved to ${PAL_STATUS_LABEL[advance.to]}`)} title={advance.label}>
                <Icon name="check" size={13} /> {advance.label}
              </button>
            )}
            {can("stages", "edit") && plan.status !== "Completed" && (
              <button className="hbtn" disabled={busy} onClick={() => setEditing(true)} title="Edit plan">
                <Icon name="edit" size={13} /> Edit
              </button>
            )}
            <MoreMenu items={moreItems} />
            <button className="btn x" onClick={() => navigate("/packing")} title="Close">
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
            {[plan.vehicleNumber && `Vehicle ${plan.vehicleNumber}`, `${fmt(plan.totalBoxes)} boxes`, plan.salespersonName].filter(Boolean).join("  ·  ")}
          </div>

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
                          <th>Design</th>
                          <th>Pallet</th>
                          <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lines.map((l) => (
                          <tr key={l.id}>
                            <td><span className="design-name">{l.designLabel}</span></td>
                            <td className="muted">{l.palletName}</td>
                            <td className="num mono">{fmt(l.boxes)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={2} style={{ fontWeight: 500 }}>Subtotal</td>
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
            <div className="form-section-title" style={{ marginBottom: 8 }}>Plan Details</div>
            <DetailRow label="Vehicle No." value={plan.vehicleNumber || "—"} />
            <DetailRow label="Planned Date" value={plan.plannedDate || "—"} />
            <DetailRow label="Dispatch Date" value={plan.dispatchDate || "—"} />
            <DetailRow label="Sales Person" value={plan.salespersonName || "—"} />
            <DetailRow label="Remarks" value={plan.remarks || "—"} />
          </div>
        </div>

        {/* Activity — status timeline + operation log for this plan. */}
        <div className="card" style={{ padding: 16 }}>
          <StatusTimeline entityType="PalletizationPlan" entityId={plan.id} />
          <ActivityLog table="PalletizationPlan" entityId={plan.id} />
        </div>
      </div>
    </div>
  );
}
